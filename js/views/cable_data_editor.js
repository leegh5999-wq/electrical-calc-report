// 케이블 데이터 전용 편집기.
//
// 원본 raw 구조: r0 행에 케이블 종류 헤더 (예: "[1C] 0.6/1KV CV", "[1C] 0.6/1KV FCV", ...)
// 가 일정 간격으로 배치 → 그 컬럼 위치부터 다음 헤더 전까지 한 그룹.
// 각 그룹: r1=컬럼 라벨(공칭단면적/완성품외경/단면적), r2=단위, r3~=데이터.
//
// 결과: 가로로 늘어선 4-5개 표를 카드별로 분리해 세로 표로 표시.
// 다심 케이블 sub-table (r23+) 은 fallback으로 raw 표시.

import { getTable, resetTable } from "../lib/tables.js";
import { escapeHtml, toNum } from "../lib/format.js";

const SINGLE_HEADER_ROWS = 3;   // r1 (그룹 헤더), r2 (컬럼라벨), r3 (단위) — 0-indexed 0,1,2

// 가로로 배치된 케이블 그룹을 자동 감지
function detectColumnGroups(raw, headerRow = 0) {
  const groups = [];
  const r1 = raw[headerRow] || [];
  let lastStart = -1;
  let lastTitle = null;
  for (let c = 0; c < r1.length; c++) {
    const val = r1[c];
    if (val != null && String(val).trim() !== "") {
      if (lastStart >= 0) {
        groups.push({ title: lastTitle, startCol: lastStart, endCol: c });
      }
      lastStart = c;
      lastTitle = String(val).trim();
    }
  }
  if (lastStart >= 0) {
    groups.push({ title: lastTitle, startCol: lastStart, endCol: r1.length });
  }
  return groups;
}

// 각 그룹의 컬럼 정의 (라벨 + 단위) + 데이터 추출
function fillGroupData(group, raw, labelRow, unitRow, dataStartRow) {
  const r2 = raw[labelRow] || [];
  const r3 = raw[unitRow] || [];
  group.columns = [];
  for (let c = group.startCol; c < group.endCol; c++) {
    const label = r2[c];
    if (label != null && String(label).trim() !== "") {
      group.columns.push({
        col: c,
        label: String(label).trim(),
        unit: r3[c] != null ? String(r3[c]).trim().replace(/^\[|\]$/g, "") : "",
      });
    }
  }
  group.dataRows = [];
  for (let r = dataStartRow; r < raw.length; r++) {
    const row = raw[r] || [];
    const values = group.columns.map(col => row[col.col]);
    // 모든 값이 null이면 데이터 종료
    if (values.every(v => v == null || v === "")) {
      if (group.dataRows.length === 0) continue;
      break;
    }
    group.dataRows.push({ rowIdx: r, values });
  }
  return group;
}

export async function renderCableDataEditor(view, state, save) {
  const table = await getTable("cable_data", state);
  const raw = table.raw;
  const totalCols = table.dimensions?.max_col ?? (raw[0]?.length ?? 20);

  // 단심 케이블 그룹 (r1~r22 영역)
  const singleGroups = detectColumnGroups(raw, 0)
    .filter(g => {
      // 단심 케이블 헤더 패턴 "[1C]" 또는 그냥 케이블 명칭만 추출
      // TRAY CODE 등 부속 표는 별도 처리
      return /^\[\d+C\]|^FCV|^F-CV|^CV/i.test(g.title);
    })
    .map(g => fillGroupData(g, raw, 1, 2, 3));

  // 다심 케이블 sub-table (r23+): 단순 raw 표시
  const multiCoreStartRow = 23;
  const multiCoreRows = [];
  for (let r = multiCoreStartRow; r < raw.length; r++) {
    const row = raw[r] || [];
    if (row.some(c => c != null && c !== "")) multiCoreRows.push({ rowIdx: r, cells: row });
  }

  function setCell(rowIdx, colIdx, value) {
    const row = raw[rowIdx] || (raw[rowIdx] = new Array(totalCols).fill(null));
    if (value === "" || value == null) row[colIdx] = null;
    else {
      const n = toNum(value);
      row[colIdx] = (Number.isFinite(n) && String(n) === String(value).trim()) ? n : value;
    }
    save(state);
  }

  function renderSingleGroup(g, idx) {
    if (g.columns.length === 0 || g.dataRows.length === 0) return "";
    return `
      <section class="cable-card">
        <h3 class="cable-card-title">${escapeHtml(g.title)}</h3>
        <table class="t" style="max-width:none;">
          <thead>
            <tr>
              <th style="width:32px">No</th>
              ${g.columns.map(col => `
                <th class="num">${escapeHtml(col.label)}${col.unit ? `<br><small style="color:#6b7280;">[${escapeHtml(col.unit)}]</small>` : ""}</th>
              `).join("")}
            </tr>
          </thead>
          <tbody>
            ${g.dataRows.map((dr, i) => `
              <tr>
                <td class="idx">${i + 1}</td>
                ${g.columns.map((col, ci) => {
                  const v = dr.values[ci];
                  const isNum = typeof v === "number";
                  return `<td class="num"><input data-r="${dr.rowIdx}" data-c="${col.col}" type="${isNum ? "number" : "text"}"
                                                  ${isNum ? 'step="any"' : ""}
                                                  value="${v == null ? "" : escapeHtml(String(v))}" /></td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function renderMultiCoreSection() {
    if (multiCoreRows.length === 0) return "";
    return `
      <section class="cable-card cable-card-raw">
        <h3 class="cable-card-title">다심 케이블 (FCV 2C/3C/4C)</h3>
        <div class="meta" style="margin-bottom: 6px;">원본 엑셀의 다심 케이블 표 영역. 추후 단심 케이블처럼 분리 처리 예정.</div>
        <div class="raw-grid-wrap" style="max-height: none;">
          <table class="t-readonly editable">
            <thead>
              <tr><th class="rowhead">#</th>${Array.from({length: totalCols}, (_, i) => `<th><small style="color:#9ca3af;">${String.fromCharCode(65 + (i % 26))}</small></th>`).join("")}</tr>
            </thead>
            <tbody>
              ${multiCoreRows.map(r => `
                <tr>
                  <th class="rowhead"><small>${r.rowIdx + 1}</small></th>
                  ${Array.from({length: totalCols}, (_, ci) => {
                    const v = r.cells[ci];
                    const isNum = typeof v === "number";
                    return `<td><input data-r="${r.rowIdx}" data-c="${ci}" type="${isNum ? "number" : "text"}"
                                       ${isNum ? 'step="any"' : ""}
                                       value="${v == null ? "" : escapeHtml(String(v))}" /></td>`;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  view.innerHTML = `
    <article class="calc table-view">
      <div class="calc-title">
        <h2>케이블 데이터 <small style="font-weight:400; color:#6b7280;">(편집 가능)</small></h2>
        <div class="actions">
          <button class="btn-danger" id="btn-reset">기본값으로 초기화</button>
        </div>
      </div>
      <div class="meta">
        원본 시트: <code>${escapeHtml(table.sheet)}</code> ·
        단심 케이블 ${singleGroups.length}종류 자동 분리 · 표준 단면적 [1.5 ~ 630 ㎟]
      </div>
      <div class="cable-card-grid">
        ${singleGroups.map(renderSingleGroup).join("")}
      </div>
      ${renderMultiCoreSection()}
    </article>
  `;

  view.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-r]"); if (!inp) return;
    setCell(+inp.dataset.r, +inp.dataset.c, inp.value);
  });

  view.querySelector("#btn-reset").addEventListener("click", async () => {
    if (!confirm("케이블 데이터를 기본값(원본 엑셀)으로 되돌릴까요?")) return;
    await resetTable("cable_data", state);
    save(state);
    location.reload();
  });
}
