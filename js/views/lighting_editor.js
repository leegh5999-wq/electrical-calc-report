// Editable view for 조명기구 (lighting fixtures).
// The underlying JSON keeps the raw 2D so VLOOKUP-style position-based access
// still works in formulas. The editor projects raw rows ↔ semantic rows.
//
// Raw column layout (1-indexed, from the source workbook):
//   col 2 = idx (auto)
//   col 3 = symbol (기호)   ← 분전반 sheets VLOOKUP by this
//   col 4 = type (종류)
//   col 5 = count (수량)
//   col 6 = watt (W/등)
//   col 7 = label (표기)
//   col 8 = totalWatt (수량 × W, 자동)

import { getTable, resetTable } from "../lib/tables.js";
import { fmtInt, toNum, escapeHtml } from "../lib/format.js";

const RAW_COLS = { idx: 1, symbol: 2, type: 3, count: 4, watt: 5, label: 6, totalWatt: 7 };
// (0-indexed within each row array; openpyxl col-1 was always None and we drop it.)

const DATA_START_ROW_INDEX = 3; // raw row index 3 == sheet row 4 (1-indexed)

function rawToRows(table) {
  // raw[i] is a row (array of 9 cells in source). We use indices 1..7 (skipping col 0 which is always None).
  const rows = [];
  for (let i = DATA_START_ROW_INDEX; i < table.raw.length; i++) {
    const r = table.raw[i];
    const sym = r[RAW_COLS.symbol];
    // Skip rows where 기호 is empty (placeholders left in the source sheet)
    if (sym == null || String(sym).trim() === "") continue;
    rows.push({
      _rawIndex: i,
      idx:    r[RAW_COLS.idx],
      symbol: r[RAW_COLS.symbol] ?? "",
      type:   r[RAW_COLS.type]   ?? "",
      count:  r[RAW_COLS.count]  ?? 1,
      watt:   r[RAW_COLS.watt]   ?? 0,
      label:  r[RAW_COLS.label]  ?? "",
    });
  }
  return rows;
}

function rowsToRaw(rows, table) {
  // Rebuild raw from rows, preserving header rows (raw[0..2]) and column 0 (None).
  const colCount = table.raw[0]?.length ?? 9;
  const newRaw = [];
  // Preserve original header rows (0..DATA_START_ROW_INDEX-1)
  for (let i = 0; i < DATA_START_ROW_INDEX; i++) {
    newRaw.push(table.raw[i] ? [...table.raw[i]] : new Array(colCount).fill(null));
  }
  rows.forEach((row, i) => {
    const r = new Array(colCount).fill(null);
    r[RAW_COLS.idx]       = i + 1;
    r[RAW_COLS.symbol]    = row.symbol || null;
    r[RAW_COLS.type]      = row.type || null;
    r[RAW_COLS.count]     = toNum(row.count) ?? 0;
    r[RAW_COLS.watt]      = toNum(row.watt) ?? 0;
    r[RAW_COLS.label]     = row.label || null;
    r[RAW_COLS.totalWatt] = (toNum(row.count) ?? 0) * (toNum(row.watt) ?? 0);
    newRaw.push(r);
  });
  return newRaw;
}

export async function renderLightingEditor(view, state, save) {
  const table = await getTable("lighting_fixtures", state);
  const rows = rawToRows(table);

  view.innerHTML = `
    <article class="calc table-view">
      <div class="calc-title">
        <h2>조명기구</h2>
        <div class="actions">
          <button id="btn-add" class="btn">+ 행 추가</button>
          <button id="btn-reset" class="btn-danger">기본값으로 초기화</button>
        </div>
      </div>
      <div class="meta">출처: ${escapeHtml(table.sheet)} (${escapeHtml(table.source)}). 분전반 시트가 <code>기호</code> 컬럼을 VLOOKUP합니다.</div>

      <table class="t" id="lf-table">
        <thead>
          <tr>
            <th style="width:48px">No</th>
            <th style="width:80px">기호</th>
            <th>종류</th>
            <th class="num" style="width:80px">수량</th>
            <th class="num" style="width:80px">W / 등</th>
            <th>표기</th>
            <th class="num" style="width:100px">합계 [W]</th>
            <th class="actions"></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </article>
  `;

  const tbody = view.querySelector("#lf-table tbody");
  let working = rows;

  function renderBody() {
    tbody.innerHTML = working.map((r, i) => `
      <tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td><input data-k="symbol" value="${escapeHtml(r.symbol)}" /></td>
        <td><input data-k="type"   value="${escapeHtml(r.type)}" /></td>
        <td class="num"><input data-k="count" type="number" min="0" step="1" value="${r.count ?? ""}" /></td>
        <td class="num"><input data-k="watt"  type="number" min="0" step="0.1" value="${r.watt ?? ""}" /></td>
        <td><input data-k="label"  value="${escapeHtml(r.label)}" /></td>
        <td class="num computed">${fmtInt((toNum(r.count) ?? 0) * (toNum(r.watt) ?? 0))}</td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>
    `).join("");
  }

  function persist() {
    state.tables.lighting_fixtures.raw = rowsToRaw(working, state.tables.lighting_fixtures);
    state.tables.lighting_fixtures.dimensions.data_rows = working.length;
    save(state);
  }

  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === "count" || k === "watt") {
      working[i][k] = toNum(e.target.value);
      const td = tr.children[6]; // 합계 [W]
      td.textContent = fmtInt((toNum(working[i].count) ?? 0) * (toNum(working[i].watt) ?? 0));
    } else {
      working[i][k] = e.target.value;
    }
    persist();
  });

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr");
    const i = +tr.dataset.i;
    if (!confirm(`${working[i].symbol || "(빈 행)"} 행을 삭제할까요?`)) return;
    working.splice(i, 1);
    persist();
    renderBody();
  });

  view.querySelector("#btn-add").addEventListener("click", () => {
    working.push({ symbol: "", type: "LED", count: 1, watt: 0, label: "" });
    persist();
    renderBody();
  });

  view.querySelector("#btn-reset").addEventListener("click", async () => {
    if (!confirm("조명기구를 기본값(원본 엑셀)으로 되돌릴까요? 편집 내용이 사라집니다.")) return;
    await resetTable("lighting_fixtures", state);
    save(state);
    working = rawToRows(state.tables.lighting_fixtures);
    renderBody();
  });

  renderBody();
}
