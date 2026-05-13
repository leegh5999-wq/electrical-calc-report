// Chapter 4: MCC 동력부하 계산서 (MVP)
//
// Each MCC panel lists motor loads.  Per motor row we auto-compute:
//   IB  = P × 1000 / (√3 × V × η × cosθ)     (3-phase)
//   IMS = IB × β × C        for DOL/Y-D/리액터
//       = IB × λ            for S.S / INV
//   II  = IMS × k           (돌입전류, DOL/Y-D/리액터)
//       = IMS                S.S/INV
//   tm  per start method (from DC.motorTmTable)
//   입력부하 [kVA] = P / (η × cosθ)
//
// All coefficients (β, C, λ, k, tm) come from state.designConditions so
// changing 설계조건 immediately reflects here.
//
// Routes:
//   #mcc        → MCC list
//   #mcc/<id>   → MCC editor

import { fmtInt, fmt1, fmt2, toNum, escapeHtml } from "../lib/format.js";
import { buildDesignDefaults, MOTOR_START_METHODS, SYSTEM_VOLTAGES } from "../lib/design_schema.js";

const MCC_KIND_OPTIONS = ["MCC-F (소방)", "MCC-N (일반)", "MCP-PIT (피트)", "MCP-기타", "기타"];
const PHASE_OPTIONS = [
  { value: "1Φ2W", label: "1Φ 2W (단상)" },
  { value: "1Φ3W", label: "1Φ 3W" },
  { value: "3Φ3W", label: "3Φ 3W" },
  { value: "3Φ4W", label: "3Φ 4W" },
];
const LOAD_KIND_OPTIONS = [
  { value: "M",  label: "M (전동기)" },
  { value: "P",  label: "P (비전동기/일반)" },
  { value: "SP", label: "SP (예비)" },
];

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "mcc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function getDC(state) {
  return { ...buildDesignDefaults(), ...(state.designConditions || {}) };
}

// β lookup by rated kW. Matches the bands in DC.motorBetaTable defaults.
function lookupBeta(kw, dc) {
  const table = dc.motorBetaTable || [];
  let idx = 0;
  if (kw <= 5.5)        idx = 0;
  else if (kw <= 22)    idx = 1;
  else if (kw <= 55)    idx = 2;
  else if (kw <= 132)   idx = 3;
  else                  idx = 4;
  return toNum(table[idx]?.beta) ?? 9.5;
}
function lookupC(method, dc) {
  const row = (dc.motorMethodC || []).find(r => r.method === method);
  return toNum(row?.c) ?? 1;
}
function lookupTm(method, dc) {
  const row = (dc.motorTmTable || []).find(r => r.method === method);
  return toNum(row?.tm) ?? 2;
}

export function newMccPanel(state, overrides = {}) {
  return {
    id: uuid(),
    name: overrides.name || "신규 MCC",
    kind: overrides.kind || "MCC-N (일반)",
    location: "",
    fromPanel: "S/S",
    phase: "3Φ4W",
    voltage: 380,
    // 인입(간선) 케이블 — 변압기/MCC 상위로부터 이 MCC 까지
    incomingCableSizeMm2: null,
    incomingCableLengthM: null,
    incomingCableType: "CV",
    note: "",
    motors: [],
    ...overrides,
  };
}

function newMotor() {
  return {
    equipNo: "",
    equipName: "",
    loadKind: "M",       // M / P / SP
    powerKw: 0,
    inputKva: 0,         // 비전동기일 때만 사용
    efficiency: 0.85,
    powerFactor: 0.85,
    startMethod: "DOL",
    betaOverride: null,  // null → 자동 (kW 기반)
    // 모터까지의 케이블 — 전압강하 계산용
    cableSizeMm2: null,
    cableLengthM: null,
    cableType: "CV",
    note: "",
  };
}

function isThreePhase(panel) { return panel.phase?.startsWith("3Φ"); }

export function computeMotor(m, panel, dc) {
  if (m.loadKind === "SP") {
    return { ib: 0, ims: 0, ii: 0, tm: 0, beta: 0, c: 0, kva: 0, kw: 0 };
  }
  const v   = toNum(panel.voltage) || 380;
  const eta = toNum(m.efficiency) || 1;
  const pf  = toNum(m.powerFactor) || 1;
  const k   = toNum(dc.inrushK) || 1.5;
  const lambdaSS  = toNum(dc.lambdaSS)  || 4;
  const lambdaINV = toNum(dc.lambdaINV) || 1.2;

  if (m.loadKind === "P") {
    // 비전동기: 입력 kVA 가 곧 부하. 전류만 산정 (기동 무관).
    const kva = toNum(m.inputKva) || 0;
    const denom = isThreePhase(panel) ? Math.sqrt(3) * v : v;
    const ib = denom > 0 ? (kva * 1000) / denom : 0;
    return { ib, ims: 0, ii: 0, tm: 0, beta: 0, c: 0, kva, kw: kva * pf };
  }

  // M: 전동기
  const p = toNum(m.powerKw) ?? 0;
  const denom = isThreePhase(panel) ? Math.sqrt(3) * v * eta * pf : v * eta * pf;
  const ib = denom > 0 ? (p * 1000) / denom : 0;

  const method = m.startMethod || "DOL";
  const beta = toNum(m.betaOverride) ?? lookupBeta(p, dc);
  const c    = lookupC(method, dc);
  const tm   = lookupTm(method, dc);

  let ims = 0, ii = 0;
  if (method === "S.S")      { ims = ib * lambdaSS;  ii = ims; }
  else if (method === "INV") { ims = ib * lambdaINV; ii = ims; }
  else                       { ims = ib * beta * c;  ii = ims * k; }

  const kva = (eta > 0 && pf > 0) ? p / (eta * pf) : 0;
  return { ib, ims, ii, tm, beta, c, kva, kw: p };
}

// ─── List view ────────────────────────────────────────────────────────────
export function renderMccList(view, state, save) {
  const mccs = state.mccPanels ||= [];
  const dc = getDC(state);

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>4. MCC (동력부하 계산서)</h2>
        <div class="actions">
          <button class="btn" id="btn-add-mcc">+ 새 MCC</button>
        </div>
      </div>
      <div class="meta" style="margin: 6px 0 12px; color:#6b7280; font-size:12px;">
        ${mccs.length === 0
          ? "아직 MCC가 없습니다. 우측 상단 <strong>+ 새 MCC</strong> 으로 추가하세요. 동력부하·기동전류·기동돌입전류는 설계조건의 β·C·λ·k·tm 값을 사용해 자동 계산됩니다."
          : `${mccs.length}개 MCC 등록됨. 자동 계산 계수는 <a href="#tables/design_conditions">설계조건</a>에서 변경 가능합니다.`}
      </div>
      ${mccs.length > 0 ? `
        <table class="t">
          <thead>
            <tr>
              <th style="width:32px">#</th>
              <th style="width:160px">MCC 명칭</th>
              <th style="width:130px">분류</th>
              <th>설치위치</th>
              <th style="width:110px">FROM</th>
              <th style="width:90px">전압회로</th>
              <th class="num" style="width:70px">모터수</th>
              <th class="num" style="width:110px">총 kW</th>
              <th class="num" style="width:110px">총 kVA</th>
              <th class="num" style="width:110px">최대 IMS [A]</th>
              <th class="actions" style="width:140px"></th>
            </tr>
          </thead>
          <tbody>
            ${mccs.map((m, i) => {
              let totKw = 0, totKva = 0, maxIms = 0, motorCount = 0;
              for (const mo of m.motors) {
                const r = computeMotor(mo, m, dc);
                totKw += r.kw; totKva += r.kva;
                if (r.ims > maxIms) maxIms = r.ims;
                if (mo.loadKind !== "SP") motorCount++;
              }
              return `
                <tr data-id="${m.id}">
                  <td class="idx">${i + 1}</td>
                  <td><a href="#mcc/${m.id}" data-route><strong>${escapeHtml(m.name)}</strong></a></td>
                  <td>${escapeHtml(m.kind)}</td>
                  <td>${escapeHtml(m.location || "-")}</td>
                  <td>${escapeHtml(m.fromPanel || "-")}</td>
                  <td>${escapeHtml(m.phase)} ${m.voltage}V</td>
                  <td class="num">${motorCount}</td>
                  <td class="num">${fmt2(totKw)}</td>
                  <td class="num">${fmt2(totKva)}</td>
                  <td class="num">${fmt1(maxIms)}</td>
                  <td class="actions">
                    <button class="btn-ghost" data-act="open" title="편집">편집</button>
                    <button class="btn-ghost" data-act="dup"  title="복제">복제</button>
                    <button class="btn-ghost" data-act="del"  title="삭제">✕</button>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      ` : ""}
    </article>
  `;

  view.querySelector("#btn-add-mcc").addEventListener("click", () => {
    const m = newMccPanel(state, { name: `MCC-${mccs.length + 1}` });
    mccs.push(m);
    save(state);
    location.hash = `#mcc/${m.id}`;
  });

  view.querySelector("tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const tr = btn.closest("tr"); const id = tr.dataset.id;
    const idx = mccs.findIndex(m => m.id === id); if (idx < 0) return;
    const act = btn.dataset.act;
    if (act === "open") location.hash = `#mcc/${id}`;
    else if (act === "dup") {
      const copy = JSON.parse(JSON.stringify(mccs[idx]));
      copy.id = uuid();
      copy.name = mccs[idx].name + " (복사본)";
      mccs.splice(idx + 1, 0, copy);
      save(state);
      renderMccList(view, state, save);
    } else if (act === "del") {
      if (!confirm(`'${mccs[idx].name}' MCC를 삭제할까요? (모터 ${mccs[idx].motors.length}개 함께 삭제)`)) return;
      mccs.splice(idx, 1);
      save(state);
      renderMccList(view, state, save);
    }
  });
}

// ─── Editor view ──────────────────────────────────────────────────────────
export function renderMccEditor(view, state, save, id) {
  const mccs = state.mccPanels ||= [];
  const m = mccs.find(x => x.id === id);
  if (!m) {
    view.innerHTML = `<div class="notice">MCC를 찾을 수 없습니다. <a href="#mcc">← 목록으로</a></div>`;
    return;
  }
  const dc = getDC(state);

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>
          <a href="#mcc" data-route style="font-size:13px; font-weight:400; color:#6b7280;">← MCC 목록</a>
          &nbsp;/&nbsp; <span id="m-title-name">${escapeHtml(m.name)}</span> 편집
          <small style="font-weight:400; color:#9ca3af;">(아래 'MCC 명칭'에서 직접 수정)</small>
        </h2>
        <div class="actions">
          <button class="btn-danger" id="btn-mcc-delete">MCC 삭제</button>
        </div>
      </div>

      <section class="calc-header" style="grid-template-columns: repeat(4, 1fr);">
        <label>MCC 명칭 <input id="m-name" value="${escapeHtml(m.name)}" /></label>
        <label>분류
          <select id="m-kind">${MCC_KIND_OPTIONS.map(k => `<option ${k === m.kind ? "selected" : ""}>${escapeHtml(k)}</option>`).join("")}</select>
        </label>
        <label>설치위치 <input id="m-location" value="${escapeHtml(m.location)}" /></label>
        <label>FROM (상위) <input id="m-from"     value="${escapeHtml(m.fromPanel)}" placeholder="예: S/S, 변압기 TR-1" /></label>
        <label>전압·회로
          <select id="m-phase">${PHASE_OPTIONS.map(o => `<option value="${o.value}" ${o.value === m.phase ? "selected" : ""}>${o.label}</option>`).join("")}</select>
        </label>
        <label>전압 [V] <input id="m-voltage" type="number" min="100" step="10" value="${m.voltage}" /></label>
        <label style="grid-column: 3 / -1;">비고 <input id="m-note" value="${escapeHtml(m.note)}" /></label>

        <fieldset style="grid-column: 1 / -1; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 8px 12px 4px; margin-top: 4px;">
          <legend style="font-size: 11px; color:#475569; padding: 0 6px;">
            인입 케이블 (FROM → 이 MCC) — 전압강하 누적 VD 계산에 사용
          </legend>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px;">
            <label>케이블 단면적 [㎟] <input id="m-incoming-mm2"  type="number" min="0" step="0.5" value="${m.incomingCableSizeMm2 ?? ""}" /></label>
            <label>케이블 길이 [m]   <input id="m-incoming-len"  type="number" min="0" step="1"   value="${m.incomingCableLengthM ?? ""}" /></label>
            <label>케이블 종류       <input id="m-incoming-type" value="${escapeHtml(m.incomingCableType ?? "CV")}" /></label>
          </div>
        </fieldset>
      </section>

      <div class="notice" style="margin: 10px 0 14px;">
        <strong>자동 계산 계수:</strong> β (정격별, ≤5.5 / 7.5~22 / 30~55 / 75~132 / ≥160 kW) ·
        C (DOL=${fmt2(lookupC("DOL", dc))}, Y-D=${fmt2(lookupC("Y-D", dc))}, 리액터=${fmt2(lookupC("리액터", dc))}) ·
        k=${fmt2(dc.inrushK)} · λ(S.S)=${fmt2(dc.lambdaSS)} · λ(INV)=${fmt2(dc.lambdaINV)}
        <span class="src-badge">← 설계조건</span>
      </div>

      <h3 class="section-title">모터/부하 목록</h3>
      <table class="t" id="m-motors">
        <thead>
          <tr>
            <th rowspan="2" style="width:36px">NO</th>
            <th rowspan="2" style="width:80px">장비번호</th>
            <th rowspan="2">장비명</th>
            <th rowspan="2" style="width:120px">부하종류</th>
            <th rowspan="2" class="num" style="width:80px">정격<br>[kW]</th>
            <th rowspan="2" class="num" style="width:80px">입력<br>[kVA]</th>
            <th rowspan="2" class="num" style="width:60px">η</th>
            <th rowspan="2" class="num" style="width:60px">cosθ</th>
            <th rowspan="2" style="width:90px">기동방식</th>
            <th colspan="4">자동 계산</th>
            <th colspan="2">케이블</th>
            <th rowspan="2">비고</th>
            <th rowspan="2" class="actions"></th>
          </tr>
          <tr>
            <th class="num" style="width:75px">IB [A]</th>
            <th class="num" style="width:80px">IMS [A]</th>
            <th class="num" style="width:80px">II [A]</th>
            <th class="num" style="width:60px">tm [s]</th>
            <th class="num" style="width:60px">㎟</th>
            <th class="num" style="width:60px">m</th>
          </tr>
        </thead>
        <tbody></tbody>
        <tfoot id="m-foot"></tfoot>
      </table>
      <div class="add-row">
        <button class="btn" id="btn-add-motor">+ 모터 추가</button>
        <button class="btn-secondary" id="btn-add-nonmotor">+ 일반부하 추가</button>
      </div>

      <section class="result">
        <h3>요약</h3>
        <dl class="result-grid" style="grid-template-columns: repeat(5, 1fr);">
          <dt>모터 수</dt>          <dd id="m-motor-count">-</dd>
          <dt>총 정격 [kW]</dt>     <dd id="m-tot-kw">-</dd>
          <dt>총 입력 [kVA]</dt>    <dd id="m-tot-kva">-</dd>
          <dt>최대 IMS [A]</dt>     <dd id="m-max-ims">-</dd>
          <dt>최대 II [A]</dt>      <dd id="m-max-ii">-</dd>
        </dl>
        <small style="color:#6b7280;">최대 IMS·II 는 단일 모터 최댓값 — 발전기 기동 영향 분석에 사용. 동시 기동 가정 시 모든 IMS의 합산이 필요할 수 있음.</small>
      </section>
    </article>
  `;

  const tbody = view.querySelector("#m-motors tbody");
  const foot  = view.querySelector("#m-foot");

  function rowHtml(mo, i) {
    const r = computeMotor(mo, m, dc);
    const isMotor   = mo.loadKind === "M";
    const isNonM    = mo.loadKind === "P";
    return `
      <tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td><input data-k="equipNo"   value="${escapeHtml(mo.equipNo)}" /></td>
        <td><input data-k="equipName" value="${escapeHtml(mo.equipName)}" /></td>
        <td><select data-k="loadKind">${LOAD_KIND_OPTIONS.map(o => `<option value="${o.value}" ${o.value === mo.loadKind ? "selected" : ""}>${o.label}</option>`).join("")}</select></td>
        <td class="num"><input data-k="powerKw"     type="number" min="0" step="0.1" value="${mo.powerKw ?? ""}" ${isMotor ? "" : "disabled"} /></td>
        <td class="num"><input data-k="inputKva"    type="number" min="0" step="0.1" value="${mo.inputKva ?? ""}" ${isNonM ? "" : "disabled"} /></td>
        <td class="num"><input data-k="efficiency"  type="number" min="0.1" max="1" step="0.01" value="${mo.efficiency ?? ""}" ${isMotor ? "" : "disabled"} /></td>
        <td class="num"><input data-k="powerFactor" type="number" min="0.1" max="1" step="0.01" value="${mo.powerFactor ?? ""}" /></td>
        <td><select data-k="startMethod" ${isMotor ? "" : "disabled"}>${MOTOR_START_METHODS.map(s => `<option value="${s}" ${s === mo.startMethod ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td class="num computed" data-cell="ib">${fmt2(r.ib)}</td>
        <td class="num computed" data-cell="ims">${isMotor ? fmt1(r.ims) : "-"}</td>
        <td class="num computed" data-cell="ii">${isMotor ? fmt1(r.ii) : "-"}</td>
        <td class="num computed" data-cell="tm">${isMotor ? r.tm : "-"}</td>
        <td class="num"><input data-k="cableSizeMm2" type="number" min="0" step="0.5" value="${mo.cableSizeMm2 ?? ""}" /></td>
        <td class="num"><input data-k="cableLengthM" type="number" min="0" step="1" value="${mo.cableLengthM ?? ""}" /></td>
        <td><input data-k="note" value="${escapeHtml(mo.note)}" /></td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>`;
  }

  function renderRows() {
    tbody.innerHTML = m.motors.map(rowHtml).join("");
  }

  function recalc() {
    let totKw = 0, totKva = 0, maxIms = 0, maxIi = 0, motorCount = 0;
    m.motors.forEach((mo, i) => {
      const r = computeMotor(mo, m, dc);
      totKw += r.kw; totKva += r.kva;
      if (r.ims > maxIms) maxIms = r.ims;
      if (r.ii  > maxIi)  maxIi  = r.ii;
      if (mo.loadKind === "M") motorCount++;
      // update computed cells
      const tr = tbody.querySelector(`tr[data-i="${i}"]`);
      if (tr) {
        tr.querySelector('[data-cell="ib"]').textContent  = fmt2(r.ib);
        tr.querySelector('[data-cell="ims"]').textContent = mo.loadKind === "M" ? fmt1(r.ims) : "-";
        tr.querySelector('[data-cell="ii"]').textContent  = mo.loadKind === "M" ? fmt1(r.ii)  : "-";
        tr.querySelector('[data-cell="tm"]').textContent  = mo.loadKind === "M" ? r.tm : "-";
      }
    });
    view.querySelector("#m-motor-count").textContent = String(motorCount);
    view.querySelector("#m-tot-kw").textContent     = fmt2(totKw) + " kW";
    view.querySelector("#m-tot-kva").textContent    = fmt2(totKva) + " kVA";
    view.querySelector("#m-max-ims").textContent    = fmt1(maxIms) + " A";
    view.querySelector("#m-max-ii").textContent     = fmt1(maxIi) + " A";

    foot.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:right;">합 계</td>
        <td class="num">${fmt2(totKw)}</td>
        <td class="num">${fmt2(totKva)}</td>
        <td colspan="3"></td>
        <td colspan="6"></td>
        <td colspan="2"></td>
      </tr>
    `;
  }

  // ── Header bindings ──
  view.querySelector("#m-name").addEventListener("input", (e) => {
    m.name = e.target.value;
    const t = view.querySelector("#m-title-name"); if (t) t.textContent = e.target.value;
    save(state);
  });
  view.querySelector("#m-kind").addEventListener("change", (e) => { m.kind = e.target.value; save(state); });
  view.querySelector("#m-location").addEventListener("input", (e) => { m.location = e.target.value; save(state); });
  view.querySelector("#m-from").addEventListener("input", (e) => { m.fromPanel = e.target.value; save(state); });
  view.querySelector("#m-phase").addEventListener("change", (e) => { m.phase = e.target.value; save(state); recalc(); });
  view.querySelector("#m-voltage").addEventListener("input", (e) => { m.voltage = toNum(e.target.value) || 0; save(state); recalc(); });
  view.querySelector("#m-note").addEventListener("input", (e) => { m.note = e.target.value; save(state); });

  view.querySelector("#m-incoming-mm2").addEventListener("input", (e) => { m.incomingCableSizeMm2 = toNum(e.target.value); save(state); });
  view.querySelector("#m-incoming-len").addEventListener("input", (e) => { m.incomingCableLengthM = toNum(e.target.value); save(state); });
  view.querySelector("#m-incoming-type").addEventListener("input", (e) => { m.incomingCableType = e.target.value; save(state); });

  // ── Motor row bindings ──
  const NUM_FIELDS = new Set(["powerKw", "inputKva", "efficiency", "powerFactor", "cableSizeMm2", "cableLengthM"]);
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k; if (!k) return;
    let v = e.target.value;
    if (NUM_FIELDS.has(k)) v = toNum(v);
    m.motors[i][k] = v;
    save(state);
    recalc();
  });
  tbody.addEventListener("change", (e) => {
    if (e.target.tagName !== "SELECT") return;
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    m.motors[i][k] = e.target.value;
    save(state);
    // 부하종류 변경 시에만 re-render (활성/비활성 칸 갱신). 기동방식 등은 recalc만.
    if (k === "loadKind") renderRows();
    recalc();
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr"); const i = +tr.dataset.i;
    if (!confirm(`'${m.motors[i].equipName || `${i + 1}번 행`}' 삭제할까요?`)) return;
    m.motors.splice(i, 1);
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-add-motor").addEventListener("click", () => {
    m.motors.push({ ...newMotor(), loadKind: "M" });
    save(state); renderRows(); recalc();
  });
  view.querySelector("#btn-add-nonmotor").addEventListener("click", () => {
    m.motors.push({ ...newMotor(), loadKind: "P", inputKva: 1, startMethod: "DOL" });
    save(state); renderRows(); recalc();
  });

  view.querySelector("#btn-mcc-delete").addEventListener("click", () => {
    if (!confirm(`'${m.name}' MCC를 삭제할까요? (모터 ${m.motors.length}개 함께 삭제)`)) return;
    const idx = mccs.findIndex(x => x.id === id);
    if (idx >= 0) mccs.splice(idx, 1);
    save(state);
    location.hash = "#mcc";
  });

  renderRows();
  recalc();
}
