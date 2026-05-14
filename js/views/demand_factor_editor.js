// 수용률 매트릭스 편집기 — 건축물 종류 × 부하 종류 매트릭스.
//
// 원본: 행 = 부하종류(전등전열/일반동력/냉방동력), 열 = 건축물(사무실/백화점/...)
// 매트릭스 형태로 편집 가능 — 행/열 추가, 셀 % 입력, 행/열 이름 변경.

import { toNum, escapeHtml, fmt1 } from "../lib/format.js";
import { getTable, resetTable } from "../lib/tables.js";

// 원본 raw 2D를 매트릭스로 파싱.
// raw 구조 (HEADER_ROW=4 기준):
//   r3 (index 3): "구분", "사무실", "백화점", "종합병원", "호텔", "기타건축물"
//   r4 (index 4): "전등전열부하", 83, 92, 75, 71, 92
//   r5: "일반동력부하", 72, 83, 70, 68, 83
//   r6: "냉방동력부하", 91, 95, 100, 96, 100
const HEADER_ROW = 3;  // 건축물 헤더 행 (0-indexed)
const COL_OFFSET = 1;  // 첫 컬럼은 부하종류 라벨

function parseMatrix(raw) {
  const headerRow = raw[HEADER_ROW] || [];
  const buildingTypes = [];
  for (let c = COL_OFFSET; c < headerRow.length; c++) {
    const v = headerRow[c];
    if (v != null && String(v).trim() !== "") buildingTypes.push(String(v).trim());
    else break;  // 빈 셀 만나면 종료
  }

  const rows = [];
  for (let r = HEADER_ROW + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row) continue;
    const label = String(row[0] ?? "").trim();
    if (!label) continue;
    // 두 번째 sub-table 헤더 만나면 정지 ("[..." 같은 라벨 또는 안내문)
    if (label.startsWith("[") || label.length > 30) break;
    const values = [];
    for (let c = COL_OFFSET; c < COL_OFFSET + buildingTypes.length; c++) {
      values.push(toNum(row[c]) ?? null);
    }
    // 모든 값이 null이면 sub-table 헤더/구분줄로 보고 정지
    if (values.every(v => v == null)) break;
    rows.push({ name: label, values });
  }

  return { buildingTypes, rows };
}

function rebuildRaw(matrix, originalRaw) {
  const colCount = Math.max(originalRaw[0]?.length ?? 0, matrix.buildingTypes.length + 2);
  const newRaw = [];
  // 헤더 행 (0..HEADER_ROW-1) 보존
  for (let i = 0; i < HEADER_ROW; i++) {
    newRaw.push(originalRaw[i] ? [...originalRaw[i]] : new Array(colCount).fill(null));
  }
  // 건축물 헤더 행
  const headerRow = new Array(colCount).fill(null);
  headerRow[0] = "구분";
  matrix.buildingTypes.forEach((bt, i) => { headerRow[COL_OFFSET + i] = bt; });
  newRaw.push(headerRow);
  // 데이터 행
  for (const r of matrix.rows) {
    const row = new Array(colCount).fill(null);
    row[0] = r.name;
    r.values.forEach((v, i) => { row[COL_OFFSET + i] = v; });
    newRaw.push(row);
  }
  return newRaw;
}

export async function renderDemandFactorEditor(view, state, save) {
  const table = await getTable("demand_factor", state);
  let matrix = parseMatrix(table.raw);
  // 비어있는 상태 방어
  if (matrix.buildingTypes.length === 0) matrix.buildingTypes = ["기타건축물"];
  if (matrix.rows.length === 0) matrix.rows = [{ name: "전등전열부하", values: matrix.buildingTypes.map(() => null) }];

  function persist() {
    table.raw = rebuildRaw(matrix, table.raw);
    table.dimensions = table.dimensions || {};
    table.dimensions.data_rows = matrix.rows.length;
    save(state);
  }

  function render() {
    view.innerHTML = `
      <article class="calc table-view">
        <div class="calc-title">
          <h2>수용률</h2>
          <div class="actions">
            <button class="btn" id="btn-add-row">+ 부하 종류</button>
            <button class="btn" id="btn-add-col">+ 건축물 종류</button>
            <button class="btn-danger" id="btn-reset">기본값으로 초기화</button>
          </div>
        </div>
        <div class="meta">
          발전기 부하집계에서 건축물 종류 × 부하 종류로 수용률[%]을 참조합니다.
          행(부하 종류)과 열(건축물 종류) 모두 자유롭게 추가/삭제·이름 변경 가능.
        </div>

        <table class="t" style="max-width: 900px;">
          <thead>
            <tr>
              <th style="width:140px">부하종류 \ 건축물</th>
              ${matrix.buildingTypes.map((bt, ci) => `
                <th style="min-width:90px;">
                  <input data-col="${ci}" class="dc-col-name" value="${escapeHtml(bt)}" style="width:100%; text-align:center;" />
                  <button class="btn-ghost" data-act="del-col" data-ci="${ci}" title="이 건축물 컬럼 삭제" style="font-size:10px; padding:0 4px;">✕</button>
                </th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${matrix.rows.map((r, ri) => `
              <tr data-ri="${ri}">
                <th style="text-align:left; background:#f9fafb;">
                  <input data-row="${ri}" class="dc-row-name" value="${escapeHtml(r.name)}" style="width:calc(100% - 24px);" />
                  <button class="btn-ghost" data-act="del-row" data-ri="${ri}" title="이 행 삭제" style="font-size:10px; padding:0 4px;">✕</button>
                </th>
                ${r.values.map((v, ci) => `
                  <td class="num"><input data-k="cell" data-ri="${ri}" data-ci="${ci}" type="number" min="0" max="100" step="1" value="${v ?? ""}" /></td>
                `).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="meta" style="margin-top:8px;">
          ※ 값은 백분율 [%] — 예: 83 은 83 % 수용. 100 = 100% (전부 사용).
        </div>
      </article>
    `;

    // 셀 입력
    view.querySelectorAll("input[data-k='cell']").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const ri = +e.target.dataset.ri;
        const ci = +e.target.dataset.ci;
        matrix.rows[ri].values[ci] = toNum(e.target.value);
        persist();
      });
    });
    // 행 이름
    view.querySelectorAll(".dc-row-name").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const ri = +e.target.dataset.row;
        matrix.rows[ri].name = e.target.value;
        persist();
      });
    });
    // 열 이름
    view.querySelectorAll(".dc-col-name").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const ci = +e.target.dataset.col;
        matrix.buildingTypes[ci] = e.target.value;
        persist();
      });
    });

    // 액션
    view.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const act = e.target.dataset.act;
        if (act === "del-row") {
          const ri = +e.target.dataset.ri;
          if (matrix.rows.length <= 1) { alert("마지막 행은 삭제할 수 없습니다."); return; }
          if (!confirm(`'${matrix.rows[ri].name}' 행을 삭제할까요?`)) return;
          matrix.rows.splice(ri, 1);
          persist();
          render();
        } else if (act === "del-col") {
          const ci = +e.target.dataset.ci;
          if (matrix.buildingTypes.length <= 1) { alert("마지막 열은 삭제할 수 없습니다."); return; }
          if (!confirm(`'${matrix.buildingTypes[ci]}' 컬럼을 삭제할까요?`)) return;
          matrix.buildingTypes.splice(ci, 1);
          matrix.rows.forEach(r => r.values.splice(ci, 1));
          persist();
          render();
        }
      });
    });

    view.querySelector("#btn-add-row").addEventListener("click", () => {
      matrix.rows.push({ name: "새 부하종류", values: matrix.buildingTypes.map(() => null) });
      persist();
      render();
    });
    view.querySelector("#btn-add-col").addEventListener("click", () => {
      matrix.buildingTypes.push("새 건축물");
      matrix.rows.forEach(r => r.values.push(null));
      persist();
      render();
    });
    view.querySelector("#btn-reset").addEventListener("click", async () => {
      if (!confirm("수용률을 기본값(원본 엑셀)으로 되돌릴까요?")) return;
      await resetTable("demand_factor", state);
      save(state);
      matrix = parseMatrix(state.tables.demand_factor.raw);
      if (matrix.buildingTypes.length === 0) matrix.buildingTypes = ["기타건축물"];
      if (matrix.rows.length === 0) matrix.rows = [{ name: "전등전열부하", values: matrix.buildingTypes.map(() => null) }];
      render();
    });
  }

  render();
}
