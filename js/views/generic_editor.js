// 자동 sub-table 분할 generic 편집기.
//
// raw 2D를 스캔해 "1. ...", "2. ..." 같은 번호 헤더를 만나면 새 카드 시작.
// 카드 안에서는 빈 열 자동 숨김, 셀 단위 인라인 편집 가능.
//
// cable_data 같이 가로로 여러 표가 배치된 경우는 단일 카드로 fallback.

import { getTable, resetTable, TABLE_LABELS } from "../lib/tables.js";
import { escapeHtml, toNum } from "../lib/format.js";

function colLetter(i) {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// raw 2D를 sub-table별 섹션으로 자동 분할.
// rule:
//   "1. ...", "2. ..." 등 번호로 시작 + 첫 컬럼만 값있는 행 → 새 카드 시작
//   빈 행(모든 셀 null) → 카드 사이 경계 / skip
function detectSections(raw) {
  const sections = [];
  let current = null;

  const isNumberHeader = (row) => {
    const nonEmpty = row.filter(c => c != null && c !== "").length;
    if (nonEmpty === 0) return false;
    const first = String(row[0] ?? "").trim();
    return /^\d+\.\s+/.test(first);
  };

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row) continue;
    const nonEmpty = row.filter(c => c != null && c !== "").length;

    if (isNumberHeader(row)) {
      if (current && current.rows.length > 0) sections.push(current);
      current = {
        title: String(row[0]).trim(),
        titleRowIdx: i,
        rows: [],
      };
      continue;
    }

    // 빈 행 → 카드 경계
    if (nonEmpty === 0) {
      // 카드 안에 데이터가 이미 있고 한 줄 띄어진 경우엔 그대로 추가
      // (트레이 단수 표 같이 sub-block 사이의 빈 행)
      if (current) current.rows.push({ rowIdx: i, cells: [...row] });
      continue;
    }

    if (!current) {
      // 첫 번째 카드 헤더 발견 전 행들 (예: 표지/메모) — "preamble" 카드
      current = { title: "", titleRowIdx: -1, rows: [] };
    }
    current.rows.push({ rowIdx: i, cells: [...row] });
  }
  if (current && current.rows.length > 0) sections.push(current);

  // 각 카드 끝의 trailing 빈 행 제거
  for (const s of sections) {
    while (s.rows.length > 0 && s.rows[s.rows.length - 1].cells.every(c => c == null || c === "")) {
      s.rows.pop();
    }
  }
  return sections;
}

// 카드의 모든 행에서 항상 비어있는 컬럼 = 숨김 후보
function detectEmptyCols(section, totalCols) {
  const empty = [];
  for (let c = 0; c < totalCols; c++) {
    const allNull = section.rows.every(r => {
      const v = r.cells[c];
      return v == null || v === "";
    });
    if (allNull) empty.push(c);
  }
  return new Set(empty);
}

export async function renderGenericEditor(view, state, save, slug) {
  const table = await getTable(slug, state);
  const label = TABLE_LABELS[slug] || slug;
  const totalCols = table.dimensions?.max_col ?? (table.raw[0]?.length ?? 0);
  let sections = detectSections(table.raw);

  // 한 개도 detect 안 됐으면 fallback: 전체를 1개 카드로
  if (sections.length === 0) {
    sections = [{
      title: "",
      titleRowIdx: -1,
      rows: table.raw.map((row, i) => ({ rowIdx: i, cells: [...row] })),
    }];
  }

  function persist() {
    save(state);
  }

  function setCell(rowIdx, colIdx, value) {
    const row = table.raw[rowIdx] || (table.raw[rowIdx] = new Array(totalCols).fill(null));
    if (value === "" || value == null) row[colIdx] = null;
    else {
      const n = toNum(value);
      row[colIdx] = (Number.isFinite(n) && String(n) === String(value).trim()) ? n : value;
    }
    persist();
  }

  function renderSection(section, sIdx) {
    const emptyCols = detectEmptyCols(section, totalCols);
    const visibleCols = [];
    for (let c = 0; c < totalCols; c++) if (!emptyCols.has(c)) visibleCols.push(c);

    if (section.rows.length === 0) return "";

    const head = visibleCols.map(c => `<th><small style="color:#9ca3af;">${colLetter(c)}</small></th>`).join("");
    const body = section.rows.map((r) => {
      const cells = visibleCols.map(c => {
        const v = r.cells[c];
        const isNum = typeof v === "number";
        return `<td><input data-r="${r.rowIdx}" data-c="${c}" type="${isNum ? "number" : "text"}"
                            ${isNum ? 'step="any"' : ""}
                            value="${v == null ? "" : escapeHtml(String(v))}" /></td>`;
      }).join("");
      return `<tr><th class="rowhead"><small>${r.rowIdx + 1}</small></th>${cells}</tr>`;
    }).join("");

    return `
      <section class="gen-section" data-si="${sIdx}">
        ${section.title ? `<div class="gen-section-head"><h3>${escapeHtml(section.title)}</h3></div>` : ""}
        <div class="raw-grid-wrap" style="max-height: none;">
          <table class="t-readonly editable">
            <thead>
              <tr><th class="rowhead"></th>${head}</tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  view.innerHTML = `
    <article class="calc table-view">
      <div class="calc-title">
        <h2>${escapeHtml(label)} <small style="font-weight:400; color:#6b7280;">(편집 가능)</small></h2>
        <div class="actions">
          <button class="btn-danger" id="btn-reset">기본값으로 초기화</button>
        </div>
      </div>
      <div class="meta">
        원본 시트: <code>${escapeHtml(table.sheet)}</code> · ${table.raw.length}행 × ${totalCols}열 ·
        ${sections.length}개 sub-table 자동 분할 · 빈 컬럼 자동 숨김
      </div>
      ${sections.map(renderSection).join("")}
    </article>
  `;

  // 셀 입력 — 이벤트 위임
  view.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-r]"); if (!inp) return;
    const r = +inp.dataset.r, c = +inp.dataset.c;
    setCell(r, c, inp.value);
  });

  view.querySelector("#btn-reset").addEventListener("click", async () => {
    if (!confirm(`${label}을(를) 기본값(원본 엑셀)으로 되돌릴까요?`)) return;
    await resetTable(slug, state);
    save(state);
    location.reload();
  });
}
