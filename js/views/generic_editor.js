// Generic editable raw-cell viewer for reference tables that don't yet have
// a dedicated semantic editor. Each cell is an editable input; edits persist
// to state.tables[slug].raw immediately. Add/delete rows supported.

import { getTable, resetTable, TABLE_LABELS } from "../lib/tables.js";
import { escapeHtml, toNum } from "../lib/format.js";

function colLetter(i) {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function renderGenericEditor(view, state, save, slug) {
  const table = await getTable(slug, state);
  const label = TABLE_LABELS[slug] || slug;
  const cols  = table.dimensions?.max_col ?? (table.raw[0]?.length ?? 0);

  view.innerHTML = `
    <article class="calc table-view">
      <div class="calc-title">
        <h2>${escapeHtml(label)} <small style="font-weight:400; color:#6b7280;">(편집 가능)</small></h2>
        <div class="actions">
          <button class="btn" id="btn-add-row">+ 행 추가</button>
          <button class="btn-danger" id="btn-reset">기본값으로 초기화</button>
        </div>
      </div>
      <div class="meta">
        원본 시트: <code>${escapeHtml(table.sheet)}</code> · ${table.raw.length}행 × ${cols}열 ·
        모든 셀이 편집 가능합니다. 변경 즉시 저장됩니다.
      </div>
      <div class="raw-grid-wrap">
        <table class="t-readonly editable" id="raw-grid">
          <thead>
            <tr><th class="rowhead">#</th>${Array.from({length: cols}, (_, i) => `<th>${colLetter(i)}</th>`).join("")}<th class="actions"></th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </article>
  `;

  const tbody = view.querySelector("#raw-grid tbody");

  function renderBody() {
    const rows = table.raw.map((row, ri) => {
      const cells = Array.from({length: cols}, (_, ci) => {
        const v = row[ci];
        const isNum = typeof v === "number";
        return `<td><input data-r="${ri}" data-c="${ci}" type="${isNum ? "number" : "text"}"
                            ${isNum ? 'step="any"' : ''} value="${v == null ? "" : escapeHtml(String(v))}" /></td>`;
      }).join("");
      return `<tr data-r="${ri}"><th class="rowhead">${ri + 1}</th>${cells}<td class="actions"><button class="btn-ghost" data-act="del" title="행 삭제">✕</button></td></tr>`;
    }).join("");
    tbody.innerHTML = rows;
  }

  tbody.addEventListener("input", (e) => {
    const inp = e.target.closest("input"); if (!inp) return;
    const r = +inp.dataset.r, c = +inp.dataset.c;
    const v = inp.value;
    // Preserve number-ness when the field was numeric and parses cleanly.
    if (inp.type === "number") {
      const n = toNum(v);
      table.raw[r][c] = (v === "" ? null : (n ?? v));
    } else {
      table.raw[r][c] = v === "" ? null : v;
    }
    save(state);
  });

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = btn.closest("tr");
    const r = +tr.dataset.r;
    if (!confirm(`${r + 1}행을 삭제할까요?`)) return;
    table.raw.splice(r, 1);
    table.dimensions.max_row = table.raw.length;
    save(state);
    renderBody();
  });

  view.querySelector("#btn-add-row").addEventListener("click", () => {
    table.raw.push(new Array(cols).fill(null));
    table.dimensions.max_row = table.raw.length;
    save(state);
    renderBody();
  });

  view.querySelector("#btn-reset").addEventListener("click", async () => {
    if (!confirm(`${label}을(를) 기본값(원본 엑셀)으로 되돌릴까요? 편집 내용이 사라집니다.`)) return;
    await resetTable(slug, state);
    save(state);
    // refresh local reference (resetTable replaced the object)
    location.reload();
  });

  renderBody();
}
