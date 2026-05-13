// Chapter 1: 변압기 용량 계산서
// Mirrors the source sheet 변압기용량 (44r × 16c) — header block + load rows + summary.
// Pulls defaults from state.designConditions (시스템 전압, 부하율 한계).

import { fmtInt, fmt1, fmt2, toNum, escapeHtml } from "../lib/format.js";
import { SYSTEM_VOLTAGES, buildDesignDefaults } from "../lib/design_schema.js";
import { pickPanels, pickMccs, mccTotalKva } from "../lib/panel_picker.js";
import { subtreeLoadVA } from "./panels.js";

// KS 표준 변압기 정격용량 (몰드/유입식 공통)
const KS_RATED_KVA = [50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000];

const TYPE_OPTIONS = ["고효율MOLD", "MOLD", "유입식", "건식", "비절연"];

function getDC(state) {
  const def = buildDesignDefaults();
  return { ...def, ...(state.designConditions || {}) };
}

function initialTransformer(state) {
  const dc = getDC(state);
  return {
    name: "TR-1",
    capacity: 750,
    type: "고효율MOLD",
    voltage: dc.systemVoltage,
    voltageFromDC: true,        // true while voltage matches DC.systemVoltage
    capacityMode: "manual",     // "manual" | "auto"  (auto = KS 표준 자동선정)
    loads: [],
  };
}

function newLoad() {
  return {
    group: "",
    name: "",
    connectedVA: 0,
    demandFactor: 1.0,
    breakerP: 4,
    breakerAF: "",
    breakerAT: "",
    note: "",
  };
}

function computeRow(l) {
  const cv  = toNum(l.connectedVA) ?? 0;
  const df  = toNum(l.demandFactor) ?? 1;
  return cv * df;
}

function pickKsCapacity(demandKva, loadMargin = 0.85) {
  // 자동 용량 = 수용부하 / 부하율 한계 (예: 110 / 0.85 ≈ 129) → KS 표준 올림
  const target = loadMargin > 0 ? demandKva / loadMargin : demandKva;
  for (const c of KS_RATED_KVA) if (c >= target) return c;
  return KS_RATED_KVA[KS_RATED_KVA.length - 1];
}

export async function renderTransformer(view, state, save) {
  if (!state.transformer) state.transformer = initialTransformer(state);
  const t = state.transformer;
  const dc = getDC(state);

  // Backward-compat: older saved state may lack voltageFromDC.
  if (t.voltageFromDC == null) t.voltageFromDC = (t.voltage === dc.systemVoltage);

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>1. 변압기 용량 계산</h2>
        <div class="actions">
          <button class="btn-secondary" id="btn-reset-tr">초기화</button>
        </div>
      </div>

      <section class="calc-header">
        <label>변압기 명칭
          <input id="tr-name" value="${escapeHtml(t.name)}" />
        </label>
        <label>TYPE
          <select id="tr-type">
            ${TYPE_OPTIONS.map(o => `<option ${o === t.type ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </label>
        <label>사용전압 ${t.voltageFromDC ? `<span class="src-badge" title="설계조건 → 시스템 전압">← 설계조건</span>` : ""}
          <select id="tr-voltage">
            ${SYSTEM_VOLTAGES.map(o => `<option ${o === t.voltage ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </label>
        <label>변압기 용량 (kVA)
          <span style="display:flex; gap:6px; align-items:center;">
            <input id="tr-capacity" type="number" min="0" step="1" value="${t.capacity}"
                   ${t.capacityMode === "auto" ? "disabled" : ""} />
            <label style="font-size:11px; white-space:nowrap;">
              <input type="checkbox" id="tr-capacity-auto" ${t.capacityMode === "auto" ? "checked" : ""} />
              자동
            </label>
          </span>
        </label>
      </section>

      <h3 class="section-title">부하 집계</h3>
      <table class="t" id="tr-loads">
        <thead>
          <tr>
            <th rowspan="2" style="width:36px">NO</th>
            <th rowspan="2" style="width:80px">구분</th>
            <th rowspan="2">부하명</th>
            <th rowspan="2" class="num" style="width:110px">연결부하<br>[VA]</th>
            <th rowspan="2" class="num" style="width:80px">수용율</th>
            <th rowspan="2" class="num" style="width:110px">수용부하<br>[VA]</th>
            <th colspan="3" style="width:180px">차단기</th>
            <th rowspan="2">비고</th>
            <th rowspan="2" class="actions"></th>
          </tr>
          <tr>
            <th class="num" style="width:50px">P</th>
            <th class="num" style="width:65px">AF</th>
            <th class="num" style="width:65px">AT</th>
          </tr>
        </thead>
        <tbody></tbody>
        <tfoot>
          <tr>
            <td colspan="3">합 계</td>
            <td class="num" id="tr-sum-connected">0</td>
            <td></td>
            <td class="num" id="tr-sum-demand">0</td>
            <td colspan="5"></td>
          </tr>
        </tfoot>
      </table>
      <div class="add-row">
        <button class="btn" id="btn-add-load">+ 부하 추가</button>
        <button class="btn-secondary" id="btn-import-panels"
                title="분전반에서 루트 분전반의 총부하를 자동으로 가져옵니다 (자식 분전반 중복 집계 자동 회피)">
          + 분전반에서 가져오기
        </button>
        <button class="btn-secondary" id="btn-import-mcc"
                title="MCC의 총 부하를 가져옵니다 (kVA)">
          + MCC에서 가져오기
        </button>
      </div>

      <section class="result">
        <h3>산정 결과</h3>
        <dl class="result-grid">
          <dt>수용부하 합계</dt>     <dd id="r-demand-kva">- kVA</dd>
          <dt>변압기 산정 용량</dt>   <dd id="r-capacity">- kVA</dd>
          <dt>부하율</dt>             <dd id="r-utilization">- %</dd>
          <dt>판정</dt>               <dd id="r-verdict">-</dd>
        </dl>
      </section>
    </article>
  `;

  const tbody = view.querySelector("#tr-loads tbody");

  function renderRows() {
    tbody.innerHTML = t.loads.map((l, i) => `
      <tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td><input data-k="group" value="${escapeHtml(l.group)}" /></td>
        <td><input data-k="name" value="${escapeHtml(l.name)}" /></td>
        <td class="num"><input data-k="connectedVA" type="number" min="0" step="1" value="${l.connectedVA ?? ""}" /></td>
        <td class="num"><input data-k="demandFactor" type="number" min="0" max="1" step="0.01" value="${l.demandFactor ?? ""}" /></td>
        <td class="num computed">${fmtInt(computeRow(l))}</td>
        <td class="num"><input data-k="breakerP" type="number" min="1" max="4" step="1" value="${l.breakerP ?? ""}" /></td>
        <td class="num"><input data-k="breakerAF" value="${escapeHtml(l.breakerAF)}" /></td>
        <td class="num"><input data-k="breakerAT" value="${escapeHtml(l.breakerAT)}" /></td>
        <td><input data-k="note" value="${escapeHtml(l.note)}" /></td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>
    `).join("");
  }

  function recalc() {
    const sumConn   = t.loads.reduce((a, l) => a + (toNum(l.connectedVA) ?? 0), 0);
    const sumDemand = t.loads.reduce((a, l) => a + computeRow(l), 0);
    view.querySelector("#tr-sum-connected").textContent = fmtInt(sumConn);
    view.querySelector("#tr-sum-demand").textContent   = fmtInt(sumDemand);

    const demandKva = sumDemand / 1000;
    view.querySelector("#r-demand-kva").textContent = fmt2(demandKva) + " kVA";

    const margin = dc.transformerLoadMargin || 0.85;

    let capacity = t.capacity;
    if (t.capacityMode === "auto") {
      capacity = pickKsCapacity(demandKva, margin);
      t.capacity = capacity;
      const inp = view.querySelector("#tr-capacity");
      if (inp) inp.value = capacity;
    }
    view.querySelector("#r-capacity").textContent = fmtInt(capacity) + " kVA";

    const util = capacity > 0 ? (demandKva / capacity) : 0;
    view.querySelector("#r-utilization").textContent = fmt1(util * 100) + " %";

    const verdictEl = view.querySelector("#r-verdict");
    verdictEl.classList.remove("verdict-ok", "verdict-warn", "verdict-fail");
    if (capacity <= 0) {
      verdictEl.textContent = "용량 미입력";
    } else if (util >= 1) {
      verdictEl.textContent = "용량 부족";
      verdictEl.classList.add("verdict-fail");
    } else if (util > margin) {
      verdictEl.textContent = `주의 (>${Math.round(margin * 100)}%)`;
      verdictEl.classList.add("verdict-warn");
    } else if (util === 0) {
      verdictEl.textContent = "부하 미입력";
    } else {
      verdictEl.textContent = "적정";
      verdictEl.classList.add("verdict-ok");
    }
  }

  // header bindings
  view.querySelector("#tr-name").addEventListener("input", (e) => { t.name = e.target.value; save(state); });
  view.querySelector("#tr-type").addEventListener("change", (e) => { t.type = e.target.value; save(state); });
  view.querySelector("#tr-voltage").addEventListener("change", (e) => {
    t.voltage = e.target.value;
    t.voltageFromDC = (t.voltage === dc.systemVoltage);
    save(state);
    renderTransformer(view, state, save); // re-render to update badge
  });
  view.querySelector("#tr-capacity").addEventListener("input", (e) => {
    t.capacity = toNum(e.target.value) ?? 0;
    save(state); recalc();
  });
  view.querySelector("#tr-capacity-auto").addEventListener("change", (e) => {
    t.capacityMode = e.target.checked ? "auto" : "manual";
    view.querySelector("#tr-capacity").disabled = e.target.checked;
    save(state); recalc();
  });

  // load row bindings
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    if (!k) return;
    const numFields = new Set(["connectedVA", "demandFactor", "breakerP"]);
    t.loads[i][k] = numFields.has(k) ? toNum(e.target.value) : e.target.value;
    // update row's 수용부하 cell
    tr.children[5].textContent = fmtInt(computeRow(t.loads[i]));
    save(state);
    recalc();
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr");
    const i = +tr.dataset.i;
    const name = t.loads[i].name || `${i + 1}번 행`;
    if (!confirm(`'${name}' 부하 행을 삭제할까요?`)) return;
    t.loads.splice(i, 1);
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-add-load").addEventListener("click", () => {
    t.loads.push(newLoad());
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-import-panels").addEventListener("click", async () => {
    const selected = await pickPanels({
      panels: state.panels || [],
      unit: "VA",
      title: "변압기 부하 — 분전반에서 가져오기",
    });
    if (!selected.length) return;
    for (const p of selected) {
      const total = subtreeLoadVA(state.panels, p);
      t.loads.push({
        group: p.type,
        name: p.name,
        connectedVA: Math.round(total),
        demandFactor: 1.0,
        breakerP: 4,
        breakerAF: "",
        breakerAT: "",
        note: p.location ? `분전반 (${p.location})` : "분전반에서 가져옴",
      });
    }
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-import-mcc").addEventListener("click", async () => {
    const selected = await pickMccs({
      mccPanels: state.mccPanels || [],
      unit: "VA",
      title: "변압기 부하 — MCC에서 가져오기",
    });
    if (!selected.length) return;
    for (const mcc of selected) {
      const totalVA = mccTotalKva(mcc) * 1000;
      t.loads.push({
        group: "MCC",
        name: mcc.name,
        connectedVA: Math.round(totalVA),
        demandFactor: 1.0,
        breakerP: 4,
        breakerAF: "",
        breakerAT: "",
        note: `MCC (${mcc.kind || ""})${mcc.location ? " " + mcc.location : ""}`,
      });
    }
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-reset-tr").addEventListener("click", () => {
    if (!confirm("변압기 계산서를 초기화할까요?")) return;
    state.transformer = initialTransformer(state);
    save(state);
    renderTransformer(view, state, save);
  });

  renderRows();
  recalc();
}
