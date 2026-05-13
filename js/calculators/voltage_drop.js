// Chapter 3: 전압강하 계산서 — 누적(간선 + 분기) 버전
//
// 공식:
//   e = K × L × I / (1000 × A)   [V]
//   %VD = e / V_nominal × 100
//
// 누적 계산:
//   panel.incomingVDpct = 분전반 인입 케이블의 VD% (분전반 총부하 전류 기준)
//   cumulativeVDpct(panel) = sum of all incomingVDpct from root to this panel
//   circuit.totalVDpct = cumulativeVDpct(panel) + branchVDpct
//
// 한계 (KEC):
//   판정 = totalVDpct vs `vdAllowedTotalPL` (기본 6%)
//   branch limit (3%) 와 feeder limit (3%) 는 별도 참고용

import { fmt1, fmt2, fmtInt, toNum, escapeHtml } from "../lib/format.js";
import { buildDesignDefaults } from "../lib/design_schema.js";
import { subtreeLoadVA } from "./panels.js";

// ── MCC helpers (kept inline; mcc.js doesn't export them) ───────────────
function mccMotorIB(motor, mcc) {
  const v = toNum(mcc.voltage) || 380;
  const isThree = mcc.phase?.startsWith("3Φ");
  if (motor.loadKind === "P") {
    const kva = toNum(motor.inputKva) || 0;
    const denom = isThree ? Math.sqrt(3) * v : v;
    return denom > 0 ? (kva * 1000) / denom : 0;
  }
  if (motor.loadKind === "M") {
    const p = toNum(motor.powerKw) || 0;
    const eta = toNum(motor.efficiency) || 1;
    const pf  = toNum(motor.powerFactor) || 1;
    const denom = isThree ? Math.sqrt(3) * v * eta * pf : v * eta * pf;
    return denom > 0 ? (p * 1000) / denom : 0;
  }
  return 0; // SP
}
function mccMotorKVA(motor) {
  if (motor.loadKind === "P") return toNum(motor.inputKva) || 0;
  if (motor.loadKind === "M") {
    const p = toNum(motor.powerKw) || 0;
    const eta = toNum(motor.efficiency) || 1;
    const pf  = toNum(motor.powerFactor) || 1;
    return (eta > 0 && pf > 0) ? p / (eta * pf) : 0;
  }
  return 0;
}
function mccTotalVA(mcc) {
  return mcc.motors.reduce((a, m) => a + mccMotorKVA(m) * 1000, 0);
}

const COPPER_K = {
  "1Φ2W": 35.6,
  "1Φ3W": 17.8,
  "3Φ3W": 30.8,
  "3Φ4W": 17.8,
};

// 인입(간선) 케이블 K — 분전반-분전반 사이 간선은 라인-라인 전압 기준
const COPPER_K_FEEDER = {
  "1Φ2W": 35.6,
  "1Φ3W": 17.8,
  "3Φ3W": 30.8,
  "3Φ4W": 17.8,
};

// 표준 케이블 단면적 (㎟) — 권장 단면적 자동 탐색용
const STANDARD_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

function getDC(state) {
  return { ...buildDesignDefaults(), ...(state.designConditions || {}) };
}

function circuitVoltage(panel) {
  const v = toNum(panel.voltage) || 220;
  switch (panel.phase) {
    case "3Φ4W": return v / Math.sqrt(3);
    case "3Φ3W": return v;
    case "1Φ3W": return v;
    case "1Φ2W": return v;
    default:      return v;
  }
}

function circuitVA(c) {
  const cnt = toNum(c.count) ?? 0;
  const w   = toNum(c.wattEa) ?? 0;
  const pf  = toNum(c.powerFactor) || 1;
  return cnt * w / pf;
}

// 단상 분기회로 전압강하
function branchE(circuit, panel) {
  const k = COPPER_K[panel.phase] ?? 35.6;
  const a = toNum(circuit.cableSizeMm2);
  const l = toNum(circuit.cableLengthM) ?? 0;
  if (!a || a <= 0) return null;
  const va = circuitVA(circuit);
  const v  = circuitVoltage(panel);
  const i  = v > 0 ? va / v : 0;
  return { e: k * l * i / (1000 * a), i, v, k, a, l };
}

// 분전반 인입(간선) 케이블 전압강하 — 분전반 총부하 기준 전류로 계산.
// V_base 는 분전반의 정격 전압 (예: 3Φ4W → 380V L-L)
function panelIncomingDrop(panel, panels) {
  const a = toNum(panel.incomingCableSizeMm2);
  const l = toNum(panel.incomingCableLengthM) ?? 0;
  if (!a || a <= 0) return null;          // 인입 케이블 미설정 → 인입 VD 없음
  const totalVA = subtreeLoadVA(panels, panel);
  const v = toNum(panel.voltage) || 380;
  const isThree = panel.phase?.startsWith("3Φ");
  // I = VA / (√3 × V_LL) for 3-phase, VA / V for single-phase
  const i = isThree ? totalVA / (v * Math.sqrt(3)) : totalVA / v;
  const k = COPPER_K_FEEDER[panel.phase] ?? 30.8;
  const e = k * l * i / (1000 * a);
  return { e, i, v, k, a, l, totalVA, pct: (e / v) * 100 };
}

// 분전반 누적 인입 VD% (이 분전반까지 도달하기까지의 모든 상위 인입의 합)
// 분기회로의 VD 는 포함하지 않음.
function cumulativeIncomingPct(panel, panels, visited = new Set()) {
  if (!panel || visited.has(panel.id)) return 0;
  visited.add(panel.id);
  const own = panelIncomingDrop(panel, panels);
  const ownPct = own ? own.pct : 0;
  let parentPct = 0;
  if (panel.parentPanelId) {
    const parent = panels.find(p => p.id === panel.parentPanelId);
    if (parent) parentPct = cumulativeIncomingPct(parent, panels, visited);
  }
  return ownPct + parentPct;
}

// 권장 단면적 — 총 VD가 한계 미만이 되는 표준 사이즈 (현재보다 큰 것 중 최소)
function suggestSize(circuit, panel, panels, totalLimit, cumulativePct) {
  const cur = toNum(circuit.cableSizeMm2) ?? 0;
  const k = COPPER_K[panel.phase] ?? 35.6;
  const v = circuitVoltage(panel);
  const i = v > 0 ? circuitVA(circuit) / v : 0;
  const l = toNum(circuit.cableLengthM) ?? 0;
  if (v <= 0 || i <= 0 || l <= 0) return null;
  for (const size of STANDARD_MM2) {
    if (size <= cur) continue;
    const e = k * l * i / (1000 * size);
    const pct = (e / v) * 100;
    if ((cumulativePct + pct) < totalLimit) return size;
  }
  return null;
}

// MCC 인입 케이블 전압강하 — 모터 전체 입력 kVA 기준 전류로 계산
function mccIncomingDrop(mcc) {
  const a = toNum(mcc.incomingCableSizeMm2);
  const l = toNum(mcc.incomingCableLengthM) ?? 0;
  if (!a || a <= 0) return null;
  const totalVA = mccTotalVA(mcc);
  const v = toNum(mcc.voltage) || 380;
  const isThree = mcc.phase?.startsWith("3Φ");
  const i = isThree ? totalVA / (v * Math.sqrt(3)) : totalVA / v;
  const k = COPPER_K_FEEDER[mcc.phase] ?? 30.8;
  const e = k * l * i / (1000 * a);
  return { e, i, v, k, a, l, totalVA, pct: (e / v) * 100 };
}

// MCC 모터를 회로처럼 취급해 분기 VD + (MCC 인입 누적) 계산
function computeMccRow(motor, mcc, totalLimit) {
  const va = mccMotorKVA(motor) * 1000;
  const v  = circuitVoltage(mcc);
  const i  = mccMotorIB(motor, mcc);

  // 누적 = MCC 인입 VD% (분전반과 달리 MCC는 자기 인입만, parent 없음)
  const incDrop = mccIncomingDrop(mcc);
  const cumulativePct = incDrop ? incDrop.pct : 0;

  const k = COPPER_K[mcc.phase] ?? 35.6;
  const a = toNum(motor.cableSizeMm2);
  const l = toNum(motor.cableLengthM) ?? 0;
  if (!a || a <= 0) {
    return { va, v, i, branchPct: null, cumulativePct, totalPct: null, status: "missing", a: null, l, recommendedMm2: null };
  }
  const e = k * l * i / (1000 * a);
  const branchPct = (e / v) * 100;
  const totalPct = cumulativePct + branchPct;

  let recommendedMm2 = null;
  if (totalPct >= totalLimit && v > 0 && i > 0 && l > 0) {
    for (const size of STANDARD_MM2) {
      if (size <= a) continue;
      const newE = k * l * i / (1000 * size);
      const newPct = (newE / v) * 100;
      if ((cumulativePct + newPct) < totalLimit) { recommendedMm2 = size; break; }
    }
  }
  return { va, v, i, branchPct, cumulativePct, totalPct, status: "computed", a, l, e, recommendedMm2 };
}

function computeRow(panel, circuit, panels, totalLimit) {
  const va = circuitVA(circuit);
  const v  = circuitVoltage(panel);
  const i  = v > 0 ? va / v : 0;

  // 누적 인입 VD% (이 분전반까지)
  const cumulativePct = cumulativeIncomingPct(panel, panels);

  // 분기 VD
  const br = branchE(circuit, panel);
  if (!br) {
    return { va, v, i, branchPct: null, cumulativePct, totalPct: null, status: "missing", a: null, l: toNum(circuit.cableLengthM) ?? 0, recommendedMm2: null };
  }
  const branchPct = (br.e / v) * 100;
  const totalPct = cumulativePct + branchPct;

  const recommendedMm2 = totalPct >= totalLimit
    ? suggestSize(circuit, panel, panels, totalLimit, cumulativePct)
    : null;

  return { va, v, i, branchPct, cumulativePct, totalPct, status: "computed", a: br.a, l: br.l, e: br.e, recommendedMm2 };
}

function verdict(totalPct, branchPct, totalLimit, branchLimit) {
  if (totalPct == null) return { cls: "missing", label: "데이터 누락" };
  if (totalPct >= totalLimit)         return { cls: "fail", label: `부적합 (>${fmt1(totalLimit)}%)` };
  if (totalPct > totalLimit * 0.85)   return { cls: "warn", label: "주의 (총)" };
  if (branchPct > branchLimit)        return { cls: "warn", label: "분기 한계 초과" };
  return { cls: "ok", label: "적정" };
}

export function renderVoltageDrop(view, state, save) {
  const panels = state.panels || [];
  const mccPanels = state.mccPanels || [];
  const dc = getDC(state);
  const branchLimit = toNum(dc.vdAllowedBranchPL) || 3;
  const totalLimit  = toNum(dc.vdAllowedTotalPL)  || 6;

  // Flatten circuits across panels
  const rows = [];
  for (const p of panels) {
    for (let ci = 0; ci < p.circuits.length; ci++) {
      const c = p.circuits[ci];
      const r = computeRow(p, c, panels, totalLimit);
      r.verdict = verdict(r.totalPct, r.branchPct, totalLimit, branchLimit);
      rows.push({ panel: p, circuit: c, source: "panel", ...r });
    }
  }
  // MCC motors as "virtual" circuits — treat MCC as a self-contained panel
  for (const mcc of mccPanels) {
    for (let mi = 0; mi < mcc.motors.length; mi++) {
      const motor = mcc.motors[mi];
      if (motor.loadKind === "SP") continue;     // skip 예비
      const r = computeMccRow(motor, mcc, totalLimit);
      r.verdict = verdict(r.totalPct, r.branchPct, totalLimit, branchLimit);
      rows.push({
        panel: { id: mcc.id, name: mcc.name, _mcc: true },     // pseudo-panel for display
        circuit: { name: motor.equipName || `(${motor.equipNo || mi + 1})` },
        source: "mcc",
        ...r,
      });
    }
  }

  const summary = { total: rows.length, ok: 0, warn: 0, fail: 0, missing: 0 };
  for (const r of rows) summary[r.verdict.cls]++;

  const showOnlyBad = state.vdShowOnlyBad ?? false;
  const displayRows = showOnlyBad ? rows.filter(r => r.verdict.cls === "fail" || r.verdict.cls === "warn") : rows;

  // Panel-level rollup for the "인입 VD" table — include both 분전반 and MCC
  const panelRollups = panels.map(p => {
    const inc = panelIncomingDrop(p, panels);
    const cum = cumulativeIncomingPct(p, panels);
    return { panel: p, inc, cum, source: "panel" };
  });
  const mccRollups = mccPanels.map(m => {
    const inc = mccIncomingDrop(m);
    return { panel: m, inc, cum: inc ? inc.pct : 0, source: "mcc" };
  });
  const allRollups = [...panelRollups, ...mccRollups];

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>3. 전압강하 계산서</h2>
        <div class="actions">
          <label style="font-size:12px; display:flex; align-items:center; gap:4px;">
            <input type="checkbox" id="vd-filter-bad" ${showOnlyBad ? "checked" : ""} />
            부적합·주의만 보기
          </label>
        </div>
      </div>

      <div class="notice">
        <strong>한계:</strong>
          분기 ${fmt1(branchLimit)}%,
          간선+분기 총 <strong>${fmt1(totalLimit)}%</strong> <span class="src-badge">← 설계조건</span> &nbsp;|&nbsp;
        <strong>판정:</strong> 총 VD% 기준 &nbsp;|&nbsp;
        <strong>식:</strong> <code>e = K × L × I / (1000 × A)</code> · K(동선): 1Φ2W=35.6, 3Φ3W=30.8, 3Φ4W·1Φ3W=17.8 &nbsp;|&nbsp;
        <strong>누적:</strong> 분전반의 <em>인입(간선)</em> 케이블 정보로 부모까지 거슬러 합산 (분전반 편집기 하단 '인입 케이블' 입력)
      </div>

      <section class="result">
        <h3>요약</h3>
        <dl class="result-grid" style="grid-template-columns: repeat(5, 1fr);">
          <dt>총 회로</dt>     <dd>${summary.total}</dd>
          <dt>적정</dt>        <dd class="verdict-ok">${summary.ok}</dd>
          <dt>주의</dt>        <dd class="verdict-warn">${summary.warn}</dd>
          <dt>부적합</dt>      <dd class="verdict-fail">${summary.fail}</dd>
          <dt>미입력</dt>      <dd style="color:#6b7280;">${summary.missing}</dd>
        </dl>
      </section>

      ${allRollups.length > 0 ? `
        <h3 class="section-title">인입(간선) VD — 분전반·MCC</h3>
        <table class="t">
          <thead>
            <tr>
              <th style="width:36px">#</th>
              <th style="width:50px">구분</th>
              <th>분전반/MCC</th>
              <th>FROM</th>
              <th class="num">총부하 [VA]</th>
              <th class="num">인입 I [A]</th>
              <th class="num">인입 ㎟</th>
              <th class="num">인입 m</th>
              <th class="num">인입 e [V]</th>
              <th class="num">인입 %VD</th>
              <th class="num">누적 %VD</th>
            </tr>
          </thead>
          <tbody>
            ${allRollups.map(({ panel, inc, cum, source }, i) => {
              const isMcc = source === "mcc";
              const editLink = isMcc ? `#mcc/${panel.id}` : `#panel/${panel.id}`;
              let fromCell;
              if (isMcc) {
                fromCell = panel.fromPanel ? `<em>${escapeHtml(panel.fromPanel)}</em>` : "(루트)";
              } else {
                const parent = panel.parentPanelId ? panels.find(p2 => p2.id === panel.parentPanelId) : null;
                fromCell = parent
                  ? escapeHtml(parent.name)
                  : (panel.fromPanel ? `<em>${escapeHtml(panel.fromPanel)}</em>` : "(루트)");
              }
              return `
                <tr>
                  <td class="idx">${i + 1}</td>
                  <td><span style="font-size:10px; padding:1px 6px; background:${isMcc ? "#fef3c7" : "#dbeafe"}; color:${isMcc ? "#92400e" : "#1e40af"}; border-radius:999px;">${isMcc ? "MCC" : "분전반"}</span></td>
                  <td><a href="${editLink}" data-route><strong>${escapeHtml(panel.name)}</strong></a></td>
                  <td>${fromCell}</td>
                  <td class="num">${inc ? fmtInt(inc.totalVA) : "-"}</td>
                  <td class="num">${inc ? fmt2(inc.i) : "-"}</td>
                  <td class="num">${inc ? fmt1(inc.a) : "<em>미입력</em>"}</td>
                  <td class="num">${inc ? inc.l : "<em>미입력</em>"}</td>
                  <td class="num">${inc ? fmt2(inc.e) : "-"}</td>
                  <td class="num">${inc ? fmt2(inc.pct) + " %" : "-"}</td>
                  <td class="num"><strong>${fmt2(cum)} %</strong></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      ` : ""}

      ${rows.length === 0 ? `
        <div class="notice" style="margin-top:14px;">
          분전반·회로가 등록되어 있지 않습니다. <a href="#panels">분전반 페이지</a>에서 먼저 회로를 추가하세요.
        </div>
      ` : `
        <h3 class="section-title">회로별 전압강하 점검 — 분전반 회로 + MCC 모터</h3>
        <table class="t" id="vd-table">
          <thead>
            <tr>
              <th style="width:32px">#</th>
              <th style="width:50px">구분</th>
              <th style="width:110px">분전반/MCC</th>
              <th>회로명</th>
              <th class="num" style="width:80px">부하 [VA]</th>
              <th class="num" style="width:60px">I [A]</th>
              <th class="num" style="width:50px">㎟</th>
              <th class="num" style="width:50px">m</th>
              <th class="num" style="width:80px">분기 %VD</th>
              <th class="num" style="width:80px">누적 %VD</th>
              <th class="num" style="width:80px">총 %VD</th>
              <th class="num" style="width:60px">한계</th>
              <th style="width:100px">판정</th>
              <th style="width:80px">권장 ㎟</th>
            </tr>
          </thead>
          <tbody>
            ${displayRows.map((r, i) => {
              const isMcc = r.source === "mcc";
              const editLink = isMcc ? `#mcc/${r.panel.id}` : `#panel/${r.panel.id}`;
              return `
                <tr class="vd-${r.verdict.cls}">
                  <td class="idx">${i + 1}</td>
                  <td><span style="font-size:10px; padding:1px 6px; background:${isMcc ? "#fef3c7" : "#dbeafe"}; color:${isMcc ? "#92400e" : "#1e40af"}; border-radius:999px;">${isMcc ? "MCC" : "분전반"}</span></td>
                  <td><a href="${editLink}" data-route>${escapeHtml(r.panel.name)}</a></td>
                  <td>${escapeHtml(r.circuit.name || "(이름 없음)")}</td>
                  <td class="num">${fmtInt(r.va)}</td>
                  <td class="num">${fmt2(r.i)}</td>
                  <td class="num">${r.a == null ? "<em>-</em>" : fmt1(r.a)}</td>
                  <td class="num">${r.l ?? 0}</td>
                  <td class="num">${r.branchPct == null ? "-" : fmt2(r.branchPct) + " %"}</td>
                  <td class="num">${fmt2(r.cumulativePct) + " %"}</td>
                  <td class="num"><strong>${r.totalPct == null ? "-" : fmt2(r.totalPct) + " %"}</strong></td>
                  <td class="num">${fmt1(totalLimit)} %</td>
                  <td class="verdict-${r.verdict.cls}">${escapeHtml(r.verdict.label)}</td>
                  <td class="num">${r.recommendedMm2 ? `<strong style="color:#0891b2;">≥ ${fmt1(r.recommendedMm2)}</strong>` : "-"}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
        ${showOnlyBad && displayRows.length === 0 ? `
          <div class="notice" style="margin-top:8px; background:#ecfdf5; border-color:#a7f3d0; color:#047857;">
            🎉 부적합·주의 회로가 없습니다. 모든 회로가 적정 또는 미입력 상태입니다.
          </div>
        ` : ""}
      `}
    </article>
  `;

  const filterEl = view.querySelector("#vd-filter-bad");
  if (filterEl) {
    filterEl.addEventListener("change", (e) => {
      state.vdShowOnlyBad = e.target.checked;
      save(state);
      renderVoltageDrop(view, state, save);
    });
  }
}
