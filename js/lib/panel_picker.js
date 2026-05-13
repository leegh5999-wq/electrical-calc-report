// Modal panel/MCC picker — pick items to import as load rows.

import { fmt2, fmtInt, toNum, escapeHtml } from "./format.js";
import { getRoots, subtreeLoadVA, subtreeLoadW } from "../calculators/panels.js";

/**
 * Show a modal that lets the user pick root panels.
 * @param {object} opts
 * @param {Array}  opts.panels    - All panels (will be filtered to roots)
 * @param {"VA"|"kW"} opts.unit   - Display unit for total load
 * @param {string} [opts.title]   - Modal title
 * @returns {Promise<Array>}      - Resolves to selected panel objects (empty on cancel)
 */
export function pickPanels({ panels, unit = "VA", title = "분전반에서 부하 가져오기" }) {
  return new Promise((resolve) => {
    const roots = getRoots(panels);

    if (roots.length === 0) {
      alert("등록된 분전반이 없습니다. '5. 분전반 (부하계산서)' 페이지에서 먼저 추가해 주세요.");
      return resolve([]);
    }

    const totalFor = (p) => unit === "VA"
      ? subtreeLoadVA(panels, p)
      : subtreeLoadW(panels, p) / 1000;       // W → kW
    const formatVal = (v) => unit === "VA" ? fmtInt(v) : fmt2(v);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3 style="margin:0 0 6px;">${escapeHtml(title)}</h3>
        <p class="meta" style="color:#6b7280; font-size:12px; margin: 0 0 10px;">
          <strong>루트 분전반만 표시</strong>됩니다 — 자식 분전반은 부모에 이미 포함되므로 중복 집계되지 않습니다.
          각 분전반의 <strong>총부하</strong>(자체 + 자식)가 한 행으로 추가됩니다.
        </p>
        <table class="t">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="pp-all" title="전체 선택/해제" /></th>
              <th style="width:160px">분전반 명칭</th>
              <th style="width:60px">분류</th>
              <th>설치위치</th>
              <th class="num" style="width:120px">총부하 [${escapeHtml(unit)}]</th>
            </tr>
          </thead>
          <tbody>
            ${roots.map(p => `
              <tr>
                <td><input type="checkbox" class="pp-sel" data-id="${p.id}" /></td>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td>${escapeHtml(p.type)}</td>
                <td>${escapeHtml(p.location || "-")}</td>
                <td class="num">${formatVal(totalFor(p))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn-secondary" id="pp-cancel">취소</button>
          <button class="btn" id="pp-confirm">선택 추가</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const cleanup = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
    };
    const onKey = (e) => { if (e.key === "Escape") { cleanup(); resolve([]); } };
    document.addEventListener("keydown", onKey);

    backdrop.querySelector("#pp-cancel").addEventListener("click", () => { cleanup(); resolve([]); });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) { cleanup(); resolve([]); }
    });

    backdrop.querySelector("#pp-all").addEventListener("change", (e) => {
      backdrop.querySelectorAll(".pp-sel").forEach(cb => { cb.checked = e.target.checked; });
    });

    backdrop.querySelector("#pp-confirm").addEventListener("click", () => {
      const ids = [...backdrop.querySelectorAll(".pp-sel:checked")].map(cb => cb.dataset.id);
      const selected = panels.filter(p => ids.includes(p.id));
      cleanup();
      resolve(selected);
    });
  });
}

// ── MCC picker ─────────────────────────────────────────────────────────────
// MCC 의 총 부하(kW 또는 kVA)를 한 행으로 가져옴.
function mccTotalKw(mcc) {
  return mcc.motors.reduce((a, m) => {
    if (m.loadKind === "M") return a + (toNum(m.powerKw) || 0);
    if (m.loadKind === "P") {
      const kva = toNum(m.inputKva) || 0;
      const pf  = toNum(m.powerFactor) || 1;
      return a + kva * pf;
    }
    return a;
  }, 0);
}
function mccTotalKva(mcc) {
  return mcc.motors.reduce((a, m) => {
    if (m.loadKind === "M") {
      const p = toNum(m.powerKw) || 0;
      const eta = toNum(m.efficiency) || 1;
      const pf  = toNum(m.powerFactor) || 1;
      return a + ((eta > 0 && pf > 0) ? p / (eta * pf) : 0);
    }
    if (m.loadKind === "P") return a + (toNum(m.inputKva) || 0);
    return a;
  }, 0);
}

/**
 * @param {object} opts
 * @param {Array}  opts.mccPanels - All MCC panels
 * @param {"VA"|"kW"} opts.unit   - Display unit (VA shows total kVA × 1000)
 * @param {string} [opts.title]
 * @returns {Promise<Array>}      - Selected MCC objects
 */
export function pickMccs({ mccPanels, unit = "kW", title = "MCC에서 부하 가져오기" }) {
  return new Promise((resolve) => {
    if (!mccPanels || mccPanels.length === 0) {
      alert("등록된 MCC가 없습니다. '4. MCC (동력부하)' 페이지에서 먼저 추가해 주세요.");
      return resolve([]);
    }

    const totalFor = (mcc) => unit === "VA" ? mccTotalKva(mcc) * 1000 : mccTotalKw(mcc);
    const formatVal = (v) => unit === "VA" ? fmtInt(v) : fmt2(v);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3 style="margin:0 0 6px;">${escapeHtml(title)}</h3>
        <p class="meta" style="color:#6b7280; font-size:12px; margin: 0 0 10px;">
          각 MCC의 <strong>총 부하</strong>(모터 합)가 한 행으로 추가됩니다.
          <strong>소방 MCC</strong>는 화재시·정전시 부하로 자동 분류됩니다.
        </p>
        <table class="t">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="mp-all" title="전체 선택/해제" /></th>
              <th style="width:160px">MCC 명칭</th>
              <th style="width:130px">분류</th>
              <th>설치위치</th>
              <th class="num" style="width:80px">모터수</th>
              <th class="num" style="width:120px">총 ${escapeHtml(unit === "VA" ? "VA" : "kW")}</th>
            </tr>
          </thead>
          <tbody>
            ${mccPanels.map(m => `
              <tr>
                <td><input type="checkbox" class="mp-sel" data-id="${m.id}" /></td>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td>${escapeHtml(m.kind)}</td>
                <td>${escapeHtml(m.location || "-")}</td>
                <td class="num">${m.motors.length}</td>
                <td class="num">${formatVal(totalFor(m))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn-secondary" id="mp-cancel">취소</button>
          <button class="btn" id="mp-confirm">선택 추가</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const cleanup = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
    };
    const onKey = (e) => { if (e.key === "Escape") { cleanup(); resolve([]); } };
    document.addEventListener("keydown", onKey);

    backdrop.querySelector("#mp-cancel").addEventListener("click", () => { cleanup(); resolve([]); });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) { cleanup(); resolve([]); }
    });

    backdrop.querySelector("#mp-all").addEventListener("change", (e) => {
      backdrop.querySelectorAll(".mp-sel").forEach(cb => { cb.checked = e.target.checked; });
    });

    backdrop.querySelector("#mp-confirm").addEventListener("click", () => {
      const ids = [...backdrop.querySelectorAll(".mp-sel:checked")].map(cb => cb.dataset.id);
      const selected = mccPanels.filter(m => ids.includes(m.id));
      cleanup();
      resolve(selected);
    });
  });
}

// Re-export the totals so callers (transformer/generator) can compute identical values.
export { mccTotalKw, mccTotalKva };
