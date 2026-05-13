// Structured form view for 설계조건. Values are stored in state.designConditions
// (a flat key-value object). Other calculators consume them.

import { DESIGN_SCHEMA, buildDesignDefaults } from "../lib/design_schema.js";
import { escapeHtml, toNum, fmt2 } from "../lib/format.js";

// Returns true if any new defaults were added (caller should persist).
function ensureState(state) {
  if (!state.designConditions) { state.designConditions = buildDesignDefaults(); return true; }
  const def = buildDesignDefaults();
  let mutated = false;
  for (const k of Object.keys(def)) {
    if (!(k in state.designConditions)) { state.designConditions[k] = def[k]; mutated = true; }
  }
  return mutated;
}

function renderField(f, value) {
  const id = `dc-${f.key}`;
  if (f.type === "select") {
    const opts = f.options.map(o => `
      <option value="${escapeHtml(o.value)}" ${value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>
    `).join("");
    return `
      <label class="dc-field" for="${id}">
        <span class="dc-label">${escapeHtml(f.label)}</span>
        <select id="${id}" data-key="${f.key}">${opts}</select>
        ${f.help ? `<small class="dc-help">${escapeHtml(f.help)}</small>` : ""}
      </label>`;
  }
  if (f.type === "number") {
    const step = f.step ?? 1;
    const min  = f.min != null ? `min="${f.min}"` : "";
    const max  = f.max != null ? `max="${f.max}"` : "";
    const suffix = [f.unit, f.range ? `(${f.range})` : null].filter(Boolean).join(" ");
    return `
      <label class="dc-field" for="${id}">
        <span class="dc-label">${escapeHtml(f.label)}</span>
        <span class="dc-input-row">
          <input id="${id}" type="number" step="${step}" ${min} ${max} data-key="${f.key}" value="${value ?? ""}" />
          ${suffix ? `<span class="dc-suffix">${escapeHtml(suffix)}</span>` : ""}
        </span>
        ${f.help ? `<small class="dc-help">${escapeHtml(f.help)}</small>` : ""}
      </label>`;
  }
  if (f.type === "table") {
    const cols = f.columns;
    const rows = (value || []).map((row, i) => `
      <tr data-i="${i}">
        ${cols.map(c => `
          <td class="${c.type === "number" ? "num" : ""}">
            <input data-c="${c.key}" type="${c.type === "number" ? "number" : "text"}"
                   ${c.step ? `step="${c.step}"` : ""}
                   value="${escapeHtml(row[c.key] ?? "")}" />
          </td>`).join("")}
        <td class="actions"><button class="btn-ghost" data-act="del">✕</button></td>
      </tr>
    `).join("");
    return `
      <div class="dc-field dc-field-wide" data-table-key="${f.key}">
        <span class="dc-label">${escapeHtml(f.label)}</span>
        <table class="t dc-table">
          <thead>
            <tr>${cols.map(c => `<th class="${c.type === "number" ? "num" : ""}">${escapeHtml(c.label)}${c.unit ? ` [${c.unit}]` : ""}</th>`).join("")}<th class="actions"></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="btn-ghost dc-add-row" data-key="${f.key}">+ 행 추가</button>
      </div>`;
  }
  return "";
}

function renderSection(section, dc) {
  return `
    <section class="dc-section" data-section="${section.id}">
      <h3>${escapeHtml(section.title)}</h3>
      ${section.note ? `<div class="dc-note">${escapeHtml(section.note)}</div>` : ""}
      <div class="dc-grid">
        ${section.fields.map(f => renderField(f, dc[f.key])).join("")}
      </div>
    </section>`;
}

export async function renderDesignConditions(view, state, save) {
  if (ensureState(state)) save(state);
  const dc = state.designConditions;

  view.innerHTML = `
    <article class="calc design-conditions">
      <div class="calc-title">
        <h2>설계조건</h2>
        <div class="actions">
          <button class="btn-danger" id="btn-dc-reset">기본값으로 초기화</button>
        </div>
      </div>
      <div class="notice">
        여기서 선택/입력한 값은 변압기·발전기·전압강하 등 모든 계산기에서 자동으로 참조됩니다.
        엑셀 시트 <code>설계조건</code> 의 구조를 그대로 따릅니다 (KECG 1701 / 1702 기준).
      </div>
      ${DESIGN_SCHEMA.map(s => renderSection(s, dc)).join("")}
    </article>
  `;

  // Inputs/selects (non-table)
  view.querySelectorAll("input[data-key], select[data-key]").forEach(el => {
    el.addEventListener("input", (e) => {
      const k = e.target.dataset.key;
      const v = e.target.tagName === "SELECT"
        ? e.target.value
        : (e.target.type === "number" ? (toNum(e.target.value) ?? null) : e.target.value);
      state.designConditions[k] = v;
      save(state);
    });
    el.addEventListener("change", (e) => {
      // ensures save on select change even if browser doesn't fire input
      if (e.target.tagName === "SELECT") {
        state.designConditions[e.target.dataset.key] = e.target.value;
        save(state);
      }
    });
  });

  // Mini-tables
  view.querySelectorAll("[data-table-key]").forEach(container => {
    const key = container.dataset.tableKey;
    const tbody = container.querySelector("tbody");

    tbody.addEventListener("input", (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      const i = +tr.dataset.i;
      const c = e.target.dataset.c;
      const isNum = e.target.type === "number";
      state.designConditions[key][i][c] = isNum ? (toNum(e.target.value) ?? null) : e.target.value;
      save(state);
    });
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act='del']"); if (!btn) return;
      const tr = e.target.closest("tr");
      const i = +tr.dataset.i;
      state.designConditions[key].splice(i, 1);
      save(state);
      // Re-render just this section's table
      renderDesignConditions(view, state, save);
    });
    container.querySelector(".dc-add-row").addEventListener("click", () => {
      const def = DESIGN_SCHEMA.flatMap(s => s.fields).find(f => f.key === key);
      const empty = {};
      def.columns.forEach(c => { empty[c.key] = c.type === "number" ? 0 : ""; });
      state.designConditions[key].push(empty);
      save(state);
      renderDesignConditions(view, state, save);
    });
  });

  view.querySelector("#btn-dc-reset").addEventListener("click", () => {
    if (!confirm("설계조건을 기본값으로 되돌릴까요? 편집 내용이 사라집니다.")) return;
    state.designConditions = buildDesignDefaults();
    save(state);
    renderDesignConditions(view, state, save);
  });
}
