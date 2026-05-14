// Chapter 7: 접지 계산서 (KEC 142.3 / 211.1)
//
// 1) 보호도체 단면적 (KEC 142.3.1 표 142.3-1)
//    상도체 S → 보호도체 S_p:
//      S ≤ 16        → S_p ≥ S
//      16 < S ≤ 35   → S_p ≥ 16
//      S > 35        → S_p ≥ S/2
//
// 2) 접지봉 저항 (간이식)
//    R = ρ × ln(4L/d) / (2π × L)
//      ρ : 대지저항률 [Ω·m]
//      L : 봉 길이 [m]
//      d : 봉 직경 [m]
//
// 3) 다중 봉 합성 저항 (병렬, 상호간섭 단순화)
//    R_total ≈ R_single / n × η     (η: 결합 효율, 단순화 시 1)
//
// 4) 목표 저항 만족 봉 개수
//    n = ceil(R_single / R_target)

import { fmt2, fmt1, fmtInt, toNum, escapeHtml } from "../lib/format.js";

// KEC 142.3.1 보호도체 표준 단면적 계산
function recommendProtectiveConductor(phaseConductorMm2) {
  const s = toNum(phaseConductorMm2);
  if (!s || s <= 0) return null;
  if (s <= 16) return s;
  if (s <= 35) return 16;
  return s / 2;
}

// 표준 단면적 중 권장값 (이상)
const STANDARD_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400];
function nextStandard(value) {
  if (value == null) return null;
  for (const s of STANDARD_MM2) if (s >= value) return s;
  return STANDARD_MM2[STANDARD_MM2.length - 1];
}

// 단독 접지봉 저항 (KECG 4 / IEC 60364-5-54 부속서 D 간이식)
function singleRodResistance(rho, length, diameter) {
  if (!Number.isFinite(rho) || !Number.isFinite(length) || !Number.isFinite(diameter)) return null;
  if (length <= 0 || diameter <= 0) return null;
  return rho * Math.log(4 * length / diameter) / (2 * Math.PI * length);
}

// 다중 봉 병렬 합성 저항 (상호간섭 결합계수 적용)
function multipleRodResistance(rSingle, n, etaCoupling = 1) {
  if (!Number.isFinite(rSingle) || !Number.isFinite(n) || n <= 0) return null;
  const e = Number.isFinite(etaCoupling) && etaCoupling > 0 ? etaCoupling : 1;
  return rSingle / (n * e);
}

// 목표 저항 만족 최소 봉 개수
function recommendRodCount(rSingle, rTarget, etaCoupling = 1) {
  if (!Number.isFinite(rSingle) || !Number.isFinite(rTarget) || rTarget <= 0) return null;
  return Math.ceil(rSingle / (rTarget * (etaCoupling || 1)));
}

// KEC 접지 시스템 종류
const GROUNDING_SYSTEMS = [
  { value: "TN-S",  label: "TN-S — 분리된 PE+N" },
  { value: "TN-C-S", label: "TN-C-S — 부분 결합" },
  { value: "TN-C",  label: "TN-C — 단일 PEN" },
  { value: "TT",    label: "TT — 별도 접지" },
  { value: "IT",    label: "IT — 비접지" },
];

// 일반 사용처별 권장 접지저항 (KEC 142.7)
const TYPICAL_TARGETS = [
  { value: 10,  label: "10 Ω — 일반 보호접지 (저압 KEC 142.7)" },
  { value: 100, label: "100 Ω — 변압기 중성점 (대지전압 ≤ 150V)" },
  { value: 5,   label: "5 Ω — 통신·정보처리 설비 (권장)" },
  { value: 1,   label: "1 Ω — 피뢰 통합접지 (KEC 153)" },
];

export function renderGrounding(view, state, save) {
  if (!state.grounding) {
    state.grounding = {
      system: "TN-C-S",
      rho: 100,
      rodLength: 1.5,
      rodDiameterMm: 14,
      rodCount: 1,
      etaCoupling: 0.85,
      rTarget: 10,
      phaseConductorMm2: 16,
      protectiveConductorMm2: null,    // 사용자 override (null이면 자동)
      note: "",
    };
  }
  const g = state.grounding;

  function recalc() {
    const rho       = toNum(g.rho) || 0;
    const length    = toNum(g.rodLength) || 0;
    const diameter  = (toNum(g.rodDiameterMm) || 0) / 1000;   // mm → m
    const count     = toNum(g.rodCount) || 1;
    const etaCoupl  = toNum(g.etaCoupling) || 1;
    const rTarget   = toNum(g.rTarget) || 0;

    const rSingle = singleRodResistance(rho, length, diameter);
    const rTotal  = multipleRodResistance(rSingle, count, etaCoupl);
    const recCount = recommendRodCount(rSingle, rTarget, etaCoupl);

    const pcAuto = recommendProtectiveConductor(g.phaseConductorMm2);
    const pcEffective = toNum(g.protectiveConductorMm2) || pcAuto;
    const pcStd = nextStandard(pcAuto);

    return {
      rSingle, rTotal, recCount,
      pcAuto, pcEffective, pcStd,
      meetsTarget: rTotal != null && rTarget > 0 && rTotal <= rTarget,
    };
  }

  function render() {
    const r = recalc();
    view.innerHTML = `
      <article class="calc">
        <div class="calc-title">
          <h2>7. 접지 계산서 <small style="font-weight:400; color:#6b7280;">(KEC 142.3 / 211.1)</small></h2>
          <div class="actions">
            <button class="btn-secondary" id="btn-grounding-reset">초기화</button>
          </div>
        </div>

        <div class="notice">
          <strong>식:</strong>
            R<sub>1</sub> = ρ · ln(4L/d) / (2π · L)
            &nbsp;&nbsp;
            R<sub>total</sub> = R<sub>1</sub> / (n · η)
          &nbsp;|&nbsp;
          <strong>보호도체 (KEC 142.3-1):</strong>
            S ≤ 16 → S<sub>p</sub> ≥ S · 16 ~ 35 → S<sub>p</sub> ≥ 16 · > 35 → S<sub>p</sub> ≥ S/2
        </div>

        <section class="calc-header" style="grid-template-columns: repeat(4, 1fr);">
          <label>접지 시스템
            <select id="gd-system">
              ${GROUNDING_SYSTEMS.map(o => `<option value="${o.value}" ${o.value === g.system ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
            </select>
          </label>
          <label>대지저항률 ρ [Ω·m]
            <input id="gd-rho" type="number" min="1" step="1" value="${g.rho ?? ""}" />
          </label>
          <label>목표 접지저항 [Ω]
            <span style="display:flex; gap:6px; align-items:center;">
              <input id="gd-target" type="number" min="0.1" step="0.5" value="${g.rTarget ?? ""}" />
              <select id="gd-target-preset" style="flex:0 0 auto; width: 120px;">
                <option value="">권장</option>
                ${TYPICAL_TARGETS.map(t => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join("")}
              </select>
            </span>
          </label>
          <label>비고 <input id="gd-note" value="${escapeHtml(g.note)}" /></label>

          <label>봉 길이 L [m]
            <input id="gd-len" type="number" min="0.1" step="0.1" value="${g.rodLength ?? ""}" />
          </label>
          <label>봉 직경 d [mm]
            <input id="gd-dia" type="number" min="1" step="0.5" value="${g.rodDiameterMm ?? ""}" />
          </label>
          <label>봉 개수 n
            <input id="gd-count" type="number" min="1" step="1" value="${g.rodCount ?? ""}" />
          </label>
          <label>결합 효율 η <small>(1 = 단순 병렬)</small>
            <input id="gd-eta" type="number" min="0.3" max="1" step="0.05" value="${g.etaCoupling ?? ""}" />
          </label>

          <label>상도체 단면적 S [㎟]
            <input id="gd-phase" type="number" min="0" step="0.5" value="${g.phaseConductorMm2 ?? ""}" />
          </label>
          <label>보호도체 단면적 S<sub>p</sub> [㎟] <small>(빈 칸 = 자동)</small>
            <input id="gd-pc" type="number" min="0" step="0.5"
                   value="${g.protectiveConductorMm2 ?? ""}"
                   placeholder="자동: ${r.pcAuto != null ? fmt1(r.pcAuto) : "-"}" />
          </label>
        </section>

        <section class="result">
          <h3>산정 결과</h3>
          <dl class="result-grid">
            <dt>단독 봉 저항 R<sub>1</sub></dt>   <dd>${r.rSingle != null ? fmt2(r.rSingle) + " Ω" : "-"}</dd>
            <dt>합성 저항 R<sub>total</sub></dt>  <dd>${r.rTotal != null ? fmt2(r.rTotal) + " Ω" : "-"}</dd>
            <dt>목표 만족</dt>
            <dd class="${r.meetsTarget ? "verdict-ok" : "verdict-fail"}">
              ${r.meetsTarget ? `✓ 적정 (≤ ${fmt1(g.rTarget)} Ω)` : `✗ 부족 — 봉 ${r.recCount || "?"}개 이상 필요`}
            </dd>
            <dt>권장 봉 개수</dt>
            <dd>${r.recCount != null ? r.recCount + " 개" : "-"}</dd>

            <dt>보호도체 자동 추천</dt>
            <dd>${r.pcAuto != null ? `${fmt1(r.pcAuto)} ㎟ (표준 ${r.pcStd} ㎟ 이상)` : "-"}</dd>
            <dt>적용 보호도체</dt>
            <dd>${r.pcEffective != null ? fmt1(r.pcEffective) + " ㎟" : "-"}</dd>
          </dl>
          <small style="color:#6b7280; display:block; margin-top: 8px;">
            ※ 결합 효율 η: 봉 간격이 길이의 2배 이상이면 0.85~0.92 적용. 정밀 계산은 KEC 142.5 / IEC 60364-5-54 참조.
            ※ 대지저항률 ρ: 흙(점토) 100, 모래 1000, 자갈 200~1000 Ω·m. 실측 권장.
          </small>
        </section>
      </article>
    `;

    function bind(id, prop, isNum = true) {
      const el = view.querySelector(id);
      if (!el) return;
      el.addEventListener("input", (e) => {
        g[prop] = isNum ? toNum(e.target.value) : e.target.value;
        save(state);
        render();
      });
      el.addEventListener("change", (e) => {
        // for selects
        if (e.target.tagName === "SELECT") {
          g[prop] = e.target.value;
          save(state);
          render();
        }
      });
    }

    bind("#gd-system", "system", false);
    bind("#gd-rho", "rho");
    bind("#gd-target", "rTarget");
    bind("#gd-len", "rodLength");
    bind("#gd-dia", "rodDiameterMm");
    bind("#gd-count", "rodCount");
    bind("#gd-eta", "etaCoupling");
    bind("#gd-phase", "phaseConductorMm2");
    bind("#gd-pc", "protectiveConductorMm2");
    view.querySelector("#gd-note").addEventListener("input", (e) => {
      g.note = e.target.value;
      save(state);
    });
    view.querySelector("#gd-target-preset").addEventListener("change", (e) => {
      const v = toNum(e.target.value);
      if (v) {
        g.rTarget = v;
        save(state);
        render();
      }
    });
    view.querySelector("#btn-grounding-reset").addEventListener("click", () => {
      if (!confirm("접지 계산서를 초기화할까요?")) return;
      state.grounding = null;
      save(state);
      render();
    });
  }

  render();
}
