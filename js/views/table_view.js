// Read-only viewer for reference tables that don't (yet) have a dedicated editor.
// Renders the raw 2D as-is so the user can verify what was imported from Excel.
// Editable versions can be added later (similar to lighting_editor.js).

import { getTable, TABLE_LABELS } from "../lib/tables.js";
import { escapeHtml } from "../lib/format.js";

export async function renderRawTable(view, state, save, slug) {
  const table = await getTable(slug, state);
  const label = TABLE_LABELS[slug] || slug;
  const cols = table.dimensions?.max_col ?? (table.raw[0]?.length ?? 0);

  // column letter labels (A, B, C, ...)
  const colLetters = [];
  for (let i = 0; i < cols; i++) {
    let n = i + 1, s = "";
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    colLetters.push(s);
  }

  const rowsHtml = table.raw.map((row, ri) => `
    <tr>
      <th>${ri + 1}</th>
      ${row.slice(0, cols).map(v => `<td>${v == null ? "" : escapeHtml(String(v))}</td>`).join("")}
    </tr>
  `).join("");

  view.innerHTML = `
    <article class="calc table-view">
      <div class="calc-title">
        <h2>${escapeHtml(label)}</h2>
        <div class="actions"></div>
      </div>
      <div class="meta">
        원본 시트: <code>${escapeHtml(table.sheet)}</code> · ${table.raw.length}행 × ${cols}열 ·
        편집 기능은 추후 추가됩니다 (현재는 읽기 전용).
      </div>
      <div style="overflow:auto; max-height: calc(100vh - 200px);">
        <table class="t-readonly">
          <thead>
            <tr><th></th>${colLetters.map(l => `<th>${l}</th>`).join("")}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </article>
  `;
}
