// Chapter 2: 발전기 용량 계산서 (MVP)
// Source sheets: 발전기-1(부하집계), 발전기-2(KDS), PG법, 수용률, 접지계산서
//
// This MVP covers 부하집계 + 단순 산정 (η·cosφ·여유계수 기반).
// 정밀 KDS·PG·접지 계산은 별도 화면으로 추후 추가.

import { fmtInt, fmt1, fmt2, toNum, escapeHtml } from "../lib/format.js";
import { SYSTEM_VOLTAGES, buildDesignDefaults } from "../lib/design_schema.js";
import { pickPanels, pickMccs, mccTotalKw } from "../lib/panel_picker.js";
import { subtreeLoadW } from "./panels.js";
import { computeMotor } from "./mcc.js";

// KS C 4202 일반적인 발전기 정격용량 (kVA)
const KS_GEN_KVA = [30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 625, 750, 1000, 1250, 1500, 2000, 2500, 3000];

const GEN_TYPE_OPTIONS  = ["디젤", "가스", "가솔린", "이중연료"];
const GEN_PHASE_OPTIONS = ["3Φ4W 380/220V", "3Φ3W 380V", "3Φ3W 220V"];

function getDC(state) {
  const def = buildDesignDefaults();
  return { ...def, ...(state.designConditions || {}) };
}

function initialGenerator(state) {
  const dc = getDC(state);
  return {
    name: "G-1",
    type: "디젤",
    voltage: dc.systemVoltage,
    voltageFromDC: true,
    capacity: 250,
    capacityMode: "auto",
    loads: [],
  };
}

function newLoad() {
  return {
    name: "",
    connectedKw: 0,
    demandFactorPct: 70,    // %
    fireKw: 0,
    blackoutKw: 0,
    note: "",
  };
}

function rowSum(l) {
  return ((toNum(l.connectedKw) ?? 0) * (toNum(l.demandFactorPct) ?? 0)) / 100;
}

function pickKsCapacity(requiredKva, loadMargin = 0.85) {
  const target = loadMargin > 0 ? requiredKva / loadMargin : requiredKva;
  for (const c of KS_GEN_KVA) if (c >= target) return c;
  return KS_GEN_KVA[KS_GEN_KVA.length - 1];
}

export async function renderGenerator(view, state, save) {
  if (!state.generator) state.generator = initialGenerator(state);
  const g = state.generator;
  const dc = getDC(state);

  if (g.voltageFromDC == null) g.voltageFromDC = (g.voltage === dc.systemVoltage);

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>2. 발전기 용량 계산</h2>
        <div class="actions">
          <button class="btn-secondary" id="btn-reset-gen">초기화</button>
        </div>
      </div>

      <section class="calc-header">
        <label>발전기 명칭
          <input id="g-name" value="${escapeHtml(g.name)}" />
        </label>
        <label>종류
          <select id="g-type">
            ${GEN_TYPE_OPTIONS.map(o => `<option ${o === g.type ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </label>
        <label>사용전압 ${g.voltageFromDC ? `<span class="src-badge" title="설계조건 → 시스템 전압">← 설계조건</span>` : ""}
          <select id="g-voltage">
            ${SYSTEM_VOLTAGES.map(o => `<option ${o === g.voltage ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </label>
        <label>발전기 용량 (kVA)
          <span style="display:flex; gap:6px; align-items:center;">
            <input id="g-capacity" type="number" min="0" step="1" value="${g.capacity}"
                   ${g.capacityMode === "auto" ? "disabled" : ""} />
            <label style="font-size:11px; white-space:nowrap;">
              <input type="checkbox" id="g-capacity-auto" ${g.capacityMode === "auto" ? "checked" : ""} />
              자동
            </label>
          </span>
        </label>
      </section>

      <div class="notice" style="margin:8px 0 14px;">
        산정식: <strong>발전기 용량 [kVA] = max(화재시부하, 정전시부하) ÷ (η × cosφ) × 여유계수</strong> &nbsp;|&nbsp;
        설계조건: η=<code>${fmt2(dc.generatorEfficiency)}</code>,
        cosφ=<code>${fmt2(dc.generatorPowerFactor)}</code>,
        여유계수=<code>${fmt2(dc.generatorSafetyMargin)}</code>,
        부하율 한계=<code>${fmt2(dc.generatorLoadMargin)}</code>
      </div>

      <h3 class="section-title">부하 집계</h3>
      <table class="t" id="g-loads">
        <thead>
          <tr>
            <th style="width:36px">NO</th>
            <th style="width:80px">구분</th>
            <th>부하명</th>
            <th class="num" style="width:100px">연결부하<br>[kW]</th>
            <th class="num" style="width:80px">수용률<br>[%]</th>
            <th class="num" style="width:100px">합산부하<br>[kW]</th>
            <th class="num" style="width:110px">화재시부하<br>[kW]</th>
            <th class="num" style="width:110px">정전시부하<br>[kW]</th>
            <th>비고</th>
            <th class="actions"></th>
          </tr>
        </thead>
        <tbody></tbody>
        <tfoot>
          <tr>
            <td colspan="3">합 계</td>
            <td class="num" id="g-sum-connected">0</td>
            <td></td>
            <td class="num" id="g-sum-total">0</td>
            <td class="num" id="g-sum-fire">0</td>
            <td class="num" id="g-sum-blackout">0</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
      <div class="add-row">
        <button class="btn" id="btn-add-load">+ 부하 추가</button>
        <button class="btn-secondary" id="btn-import-panels"
                title="분전반에서 루트 분전반의 총부하(kW)를 자동으로 가져옵니다">
          + 분전반에서 가져오기
        </button>
        <button class="btn-secondary" id="btn-import-mcc"
                title="MCC의 총 부하를 가져옵니다. MCC-F(소방)는 화재시·정전시 부하로 자동 분류">
          + MCC에서 가져오기
        </button>
        <button class="btn-secondary" id="btn-fill-emergency" title="모든 행의 화재시·정전시 부하를 합산부하 값으로 채웁니다">전체 비상부하 = 합산부하 적용</button>
      </div>

      <section class="result">
        <h3>산정 결과</h3>
        <dl class="result-grid">
          <dt>최대 비상부하</dt>          <dd id="g-max-emergency">- kW</dd>
          <dt>요구 발전기 용량</dt>       <dd id="g-required">- kVA</dd>
          <dt>선정 용량</dt>              <dd id="g-selected">- kVA</dd>
          <dt>부하율</dt>                 <dd id="g-utilization">- %</dd>
          <dt>판정</dt>                   <dd id="g-verdict">-</dd>
        </dl>
      </section>

      <section id="g-start-analysis" class="result" style="background:#fff7ed; border-color:#fed7aa;">
        <h3 style="color:#9a3412;">기동전류 영향 분석 (MCC 모터)</h3>
        <div id="g-start-body"></div>
      </section>

      <section id="g-kds-sizing" class="result" style="background:#ecfeff; border-color:#a5f3fc;">
        <h3 style="color:#0e7490;">KDS 정밀 산정 (KDS 31 35 30 / KECG-1702)</h3>
        <div id="g-kds-body"></div>
      </section>
    </article>
  `;

  const tbody = view.querySelector("#g-loads tbody");

  function renderRows() {
    tbody.innerHTML = g.loads.map((l, i) => `
      <tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td><input data-k="group" value="${escapeHtml(l.group ?? "")}" /></td>
        <td><input data-k="name"  value="${escapeHtml(l.name)}" /></td>
        <td class="num"><input data-k="connectedKw"      type="number" min="0" step="0.1" value="${l.connectedKw ?? ""}" /></td>
        <td class="num"><input data-k="demandFactorPct"  type="number" min="0" max="100" step="1" value="${l.demandFactorPct ?? ""}" /></td>
        <td class="num computed">${fmt2(rowSum(l))}</td>
        <td class="num"><input data-k="fireKw"      type="number" min="0" step="0.1" value="${l.fireKw ?? ""}" /></td>
        <td class="num"><input data-k="blackoutKw"  type="number" min="0" step="0.1" value="${l.blackoutKw ?? ""}" /></td>
        <td><input data-k="note" value="${escapeHtml(l.note ?? "")}" /></td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>
    `).join("");
  }

  function renderStartAnalysis(selectedKva) {
    const mccs = state.mccPanels || [];
    const motors = [];
    for (const mcc of mccs) {
      for (const mo of mcc.motors) {
        if (mo.loadKind !== "M") continue;
        const r = computeMotor(mo, mcc, dc);
        if (r.kva <= 0) continue;
        motors.push({ mccName: mcc.name, motor: mo, ...r });
      }
    }
    const body = view.querySelector("#g-start-body");
    if (motors.length === 0) {
      body.innerHTML = `<small style="color:#6b7280;">MCC에 등록된 전동기가 없어 분석을 생략합니다.</small>`;
      return;
    }

    // 정상 운전 kVA 합계
    const normalKva = motors.reduce((a, m) => a + m.kva, 0);
    // 기동 시 각 모터 kVA = 정상 kVA × (IMS/IB)
    motors.forEach(m => {
      m.startMultiplier = m.ib > 0 ? m.ims / m.ib : 0;
      m.startKva = m.kva * m.startMultiplier;
    });
    // 동시 기동: 모든 모터 기동중 kVA 합
    const simultStartKva = motors.reduce((a, m) => a + m.startKva, 0);
    // 순차 기동(권장): 가장 큰 모터 1대만 기동, 나머지는 정상 운전 → 부하 = (정상-최대정상) + 최대기동
    const sortedByImpact = [...motors].sort((a, b) => (b.startKva - b.kva) - (a.startKva - a.kva));
    const worstMotor = sortedByImpact[0];
    const seqStartKva = (normalKva - worstMotor.kva) + worstMotor.startKva;
    // 추가 부하 (순차 기동 = 정상 운전 대비 추가분)
    const seqExtraKva = worstMotor.startKva - worstMotor.kva;

    // 발전기 정격 전류
    const v = toNum(g.voltage) || 380;
    const isThree = g.voltage; // simplification: assume 3-phase
    const iRated = selectedKva > 0 ? (selectedKva * 1000) / (Math.sqrt(3) * v) : 0;

    // 판정: 순차 기동 / 동시 기동 부하 vs 발전기 용량
    const seqPct = selectedKva > 0 ? (seqStartKva / selectedKva) * 100 : 0;
    const simPct = selectedKva > 0 ? (simultStartKva / selectedKva) * 100 : 0;
    const seqCls = seqPct >= 100 ? "fail" : (seqPct > 90 ? "warn" : "ok");
    const simCls = simPct >= 100 ? "fail" : (simPct > 90 ? "warn" : "ok");

    body.innerHTML = `
      <dl class="result-grid" style="grid-template-columns: repeat(4, 1fr); gap: 6px 16px;">
        <dt>등록된 모터</dt>          <dd>${motors.length}개</dd>
        <dt>정상 운전 합계</dt>       <dd>${fmt2(normalKva)} kVA</dd>
        <dt>발전기 정격 전류</dt>     <dd>${fmt1(iRated)} A</dd>
        <dt>(이 발전기 ${fmtInt(selectedKva)} kVA 기준)</dt><dd style="color:#9a3412;">${fmtInt(selectedKva)} kVA</dd>

        <dt style="grid-column:1/-1; margin-top:6px; color:#9a3412; font-weight:600;">최악 기동 모터 (영향 가장 큰 1대)</dt>
        <dt>명칭</dt>                  <dd>${escapeHtml(worstMotor.motor.equipName || worstMotor.motor.equipNo)} (${escapeHtml(worstMotor.mccName)})</dd>
        <dt>기동 방식</dt>             <dd>${escapeHtml(worstMotor.motor.startMethod)} (β=${fmt2(worstMotor.beta)}, C=${fmt2(worstMotor.c)})</dd>
        <dt>정상 / 기동 kVA</dt>       <dd>${fmt2(worstMotor.kva)} → <strong>${fmt2(worstMotor.startKva)}</strong> (×${fmt2(worstMotor.startMultiplier)})</dd>
        <dt>기동 추가 부하</dt>        <dd><strong>+${fmt2(seqExtraKva)} kVA</strong></dd>

        <dt style="grid-column:1/-1; margin-top:6px; color:#9a3412; font-weight:600;">시나리오</dt>
        <dt>순차 기동 (권장, 최대 모터 1대씩)</dt><dd class="verdict-${seqCls}"><strong>${fmt2(seqStartKva)} kVA</strong> (${fmt1(seqPct)} %)</dd>
        <dt>동시 기동 (최악 케이스)</dt>          <dd class="verdict-${simCls}"><strong>${fmt2(simultStartKva)} kVA</strong> (${fmt1(simPct)} %)</dd>
      </dl>
      <small style="color:#9a3412; display:block; margin-top:8px;">
        ※ 순차 기동 권장. 부담률 100% 미만이면 적정. 일반적으로 KEC/KECG는 동시 기동은 비현실적이라 보지만 큰 모터 다수면 단자 전압강하 검토 필요.
      </small>
    `;
  }

  // KDS 31 35 30 / KECG-1702 정밀 발전기 용량 산정
  //   GP1 = ∑(P_i / (η_i × cosφ_i))                ... 정상 운전
  //   GP2 = GP1 + ΔPm_max                          ... 최대 모터 기동 시 추가 부하
  //   요구 정격 = max(GP1, GP2)
  //   KS 표준 권장 = ceil(요구 / loadMargin)
  function renderKdsSizing() {
    const body = view.querySelector("#g-kds-body");

    // 1) 일반 부하 (발전기 부하 행 — 비상부하만 발전기 부담)
    const generalLoadPf = toNum(dc.loadPowerFactor) || 0.85;
    const generalLoadEta = toNum(dc.loadEfficiency) || 1.0;
    const generalKW = Math.max(
      g.loads.reduce((a, l) => a + (toNum(l.fireKw)     ?? 0), 0),
      g.loads.reduce((a, l) => a + (toNum(l.blackoutKw) ?? 0), 0),
    );
    const generalKVA = generalLoadEta > 0 && generalLoadPf > 0
      ? generalKW / (generalLoadEta * generalLoadPf) : 0;

    // 2) MCC 모터 (각 정밀 데이터 사용)
    const motors = [];
    for (const mcc of (state.mccPanels || [])) {
      for (const mo of mcc.motors) {
        if (mo.loadKind !== "M") continue;
        const r = computeMotor(mo, mcc, dc);
        if (r.kva <= 0) continue;
        const startMult = r.ib > 0 ? (r.ims / r.ib) : 0;
        motors.push({
          name: mo.equipName || mo.equipNo || "(이름없음)",
          mccName: mcc.name,
          method: mo.startMethod,
          kva: r.kva,
          startKva: r.kva * startMult,
          extra: r.kva * (startMult - 1),    // 기동 추가 부하
          beta: r.beta, c: r.c,
        });
      }
    }
    const motorsKVA = motors.reduce((a, m) => a + m.kva, 0);

    // 3) GP1 = 모든 부하의 정상 입력 kVA 합
    const gp1 = generalKVA + motorsKVA;

    // 4) GP2 = 가장 큰 모터 기동 시 (extra 가 최대인 모터)
    const maxMotor = motors.length > 0
      ? motors.reduce((best, m) => (!best || m.extra > best.extra) ? m : best, null)
      : null;
    const gp2 = maxMotor ? gp1 + maxMotor.extra : gp1;

    // 5) 요구 정격, KS 표준 권장 (loadMargin 적용)
    const required = Math.max(gp1, gp2);
    const margin = toNum(dc.generatorLoadMargin) || 0.85;
    const ksRec = pickKsCapacity(required, margin);

    body.innerHTML = `
      <dl class="result-grid" style="grid-template-columns: repeat(4, 1fr); gap: 6px 16px;">
        <dt>일반 부하 (비상 합계 / η·cosφ)</dt>      <dd>${fmt2(generalKVA)} kVA</dd>
        <dt>MCC 모터 합계</dt>                         <dd>${fmt2(motorsKVA)} kVA</dd>
        <dt><strong>GP1 정상 운전</strong></dt>        <dd><strong>${fmt2(gp1)} kVA</strong></dd>
        <dt>(η<sub>일반</sub>=${fmt2(generalLoadEta)}, cosφ<sub>일반</sub>=${fmt2(generalLoadPf)})</dt>
        <dd></dd>

        ${maxMotor ? `
          <dt style="grid-column:1/-1; margin-top:6px; color:#0e7490; font-weight:600;">최대 기동 모터 (추가 부하 기준)</dt>
          <dt>명칭</dt>                  <dd>${escapeHtml(maxMotor.name)} (${escapeHtml(maxMotor.mccName)})</dd>
          <dt>기동방식</dt>              <dd>${escapeHtml(maxMotor.method)} (β=${fmt2(maxMotor.beta)}, C=${fmt2(maxMotor.c)})</dd>
          <dt>정상 / 기동 kVA</dt>       <dd>${fmt2(maxMotor.kva)} → <strong>${fmt2(maxMotor.startKva)}</strong></dd>
          <dt>기동 추가 부하</dt>        <dd><strong>+${fmt2(maxMotor.extra)} kVA</strong></dd>
        ` : ""}

        <dt style="grid-column:1/-1; margin-top:6px; color:#0e7490; font-weight:600;">정격 산정</dt>
        <dt>GP1 (정상)</dt>              <dd>${fmt2(gp1)} kVA</dd>
        <dt><strong>GP2 (최대 기동)</strong></dt>   <dd><strong>${fmt2(gp2)} kVA</strong></dd>
        <dt>요구 정격 = max(GP1, GP2)</dt> <dd><strong>${fmt2(required)} kVA</strong></dd>
        <dt><strong>KS 표준 권장</strong> <small>(부하율 ${fmt2(margin)})</small></dt>
        <dd class="verdict-ok"><strong>${fmtInt(ksRec)} kVA</strong></dd>
      </dl>
      <small style="color:#0e7490; display:block; margin-top:8px;">
        ※ 식: <code>GP1 = Σ(P/(η·cosφ))</code>, <code>GP2 = GP1 + ΔPm_max</code>, <code>발전기 = max(GP1, GP2) ÷ 부하율</code> → KS 올림.
        ※ 일반 부하 효율·역률은 설계조건의 <code>loadEfficiency</code>·<code>loadPowerFactor</code> 사용. MCC 모터는 개별 입력값 사용.
      </small>
    `;
  }

  function recalc() {
    const sumConn = g.loads.reduce((a, l) => a + (toNum(l.connectedKw) ?? 0), 0);
    const sumTot  = g.loads.reduce((a, l) => a + rowSum(l), 0);
    const sumFire = g.loads.reduce((a, l) => a + (toNum(l.fireKw)     ?? 0), 0);
    const sumBlk  = g.loads.reduce((a, l) => a + (toNum(l.blackoutKw) ?? 0), 0);
    view.querySelector("#g-sum-connected").textContent = fmt2(sumConn);
    view.querySelector("#g-sum-total").textContent     = fmt2(sumTot);
    view.querySelector("#g-sum-fire").textContent      = fmt2(sumFire);
    view.querySelector("#g-sum-blackout").textContent  = fmt2(sumBlk);

    const maxEmergency = Math.max(sumFire, sumBlk);
    view.querySelector("#g-max-emergency").textContent = fmt2(maxEmergency) + " kW";

    const eta    = dc.generatorEfficiency;
    const pf     = dc.generatorPowerFactor;
    const safety = dc.generatorSafetyMargin;
    const margin = dc.generatorLoadMargin || 0.85;

    const required = (eta > 0 && pf > 0) ? (maxEmergency / (eta * pf)) * safety : 0;
    view.querySelector("#g-required").textContent = fmt2(required) + " kVA";

    let selected = g.capacity;
    if (g.capacityMode === "auto") {
      selected = pickKsCapacity(required, margin);
      g.capacity = selected;
      const inp = view.querySelector("#g-capacity");
      if (inp) inp.value = selected;
    }
    view.querySelector("#g-selected").textContent = fmtInt(selected) + " kVA";

    const util = selected > 0 ? (required / selected) : 0;
    view.querySelector("#g-utilization").textContent = fmt1(util * 100) + " %";

    const verdictEl = view.querySelector("#g-verdict");
    verdictEl.classList.remove("verdict-ok", "verdict-warn", "verdict-fail");
    if (selected <= 0) {
      verdictEl.textContent = "용량 미입력";
    } else if (required === 0) {
      verdictEl.textContent = "비상부하 미입력";
    } else if (util >= 1) {
      verdictEl.textContent = "용량 부족";
      verdictEl.classList.add("verdict-fail");
    } else if (util > margin) {
      verdictEl.textContent = `주의 (>${Math.round(margin * 100)}%)`;
      verdictEl.classList.add("verdict-warn");
    } else {
      verdictEl.textContent = "적정";
      verdictEl.classList.add("verdict-ok");
    }

    // 기동전류 영향 분석 갱신
    renderStartAnalysis(selected);
    // KDS 정밀 산정 갱신
    renderKdsSizing();
  }

  // Header bindings
  view.querySelector("#g-name").addEventListener("input", (e) => { g.name = e.target.value; save(state); });
  view.querySelector("#g-type").addEventListener("change", (e) => { g.type = e.target.value; save(state); });
  view.querySelector("#g-voltage").addEventListener("change", (e) => {
    g.voltage = e.target.value;
    g.voltageFromDC = (g.voltage === dc.systemVoltage);
    save(state);
    renderGenerator(view, state, save);
  });
  view.querySelector("#g-capacity").addEventListener("input", (e) => {
    g.capacity = toNum(e.target.value) ?? 0;
    save(state); recalc();
  });
  view.querySelector("#g-capacity-auto").addEventListener("change", (e) => {
    g.capacityMode = e.target.checked ? "auto" : "manual";
    view.querySelector("#g-capacity").disabled = e.target.checked;
    save(state); recalc();
  });

  // Load row bindings
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    if (!k) return;
    const numFields = new Set(["connectedKw", "demandFactorPct", "fireKw", "blackoutKw"]);
    g.loads[i][k] = numFields.has(k) ? toNum(e.target.value) : e.target.value;
    tr.children[5].textContent = fmt2(rowSum(g.loads[i])); // 합산부하 셀 갱신
    save(state);
    recalc();
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr");
    const i = +tr.dataset.i;
    const name = g.loads[i].name || `${i + 1}번 행`;
    if (!confirm(`'${name}' 부하 행을 삭제할까요?`)) return;
    g.loads.splice(i, 1);
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-add-load").addEventListener("click", () => {
    g.loads.push(newLoad());
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-import-panels").addEventListener("click", async () => {
    const selected = await pickPanels({
      panels: state.panels || [],
      unit: "kW",
      title: "발전기 부하 — 분전반에서 가져오기",
    });
    if (!selected.length) return;
    for (const p of selected) {
      const totalKW = subtreeLoadW(state.panels, p) / 1000;   // W → kW
      g.loads.push({
        name: p.name,
        connectedKw: Math.round(totalKW * 100) / 100,   // 소수 2자리
        demandFactorPct: 100,        // 분전반은 이미 회로 합. 비상 여부는 화재/정전 칸에서 조정
        fireKw: 0,
        blackoutKw: 0,
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
      unit: "kW",
      title: "발전기 비상부하 — MCC에서 가져오기",
    });
    if (!selected.length) return;
    for (const mcc of selected) {
      const totKw = mccTotalKw(mcc);
      // 소방 MCC(MCC-F)는 화재시·정전시 모두 가동 (디폴트). 일반 MCC는 정전시만 디폴트.
      const isFire = (mcc.kind || "").includes("소방") || (mcc.name || "").startsWith("MCC-F");
      g.loads.push({
        name: mcc.name,
        connectedKw: Math.round(totKw * 100) / 100,
        demandFactorPct: 100,
        fireKw:     isFire ? Math.round(totKw * 100) / 100 : 0,
        blackoutKw: isFire ? Math.round(totKw * 100) / 100 : Math.round(totKw * 100) / 100,
        note: `MCC (${mcc.kind || ""})${mcc.location ? " " + mcc.location : ""}`,
      });
    }
    save(state);
    renderRows();
    recalc();
  });
  view.querySelector("#btn-fill-emergency").addEventListener("click", () => {
    if (!confirm("모든 행의 화재시/정전시 부하를 합산부하 값으로 채울까요?")) return;
    g.loads.forEach(l => {
      const s = rowSum(l);
      l.fireKw = s;
      l.blackoutKw = s;
    });
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-reset-gen").addEventListener("click", () => {
    if (!confirm("발전기 계산서를 초기화할까요?")) return;
    state.generator = initialGenerator(state);
    save(state);
    renderGenerator(view, state, save);
  });

  renderRows();
  recalc();
}
