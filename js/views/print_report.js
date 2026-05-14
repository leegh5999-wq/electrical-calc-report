// 전체 보고서 인쇄용 페이지 — 모든 챕터를 한 페이지에 정적으로 렌더링.
// @media print 로 챕터별 페이지 분할 + 사이드바/버튼 숨김.
// 사용자가 Ctrl+P 또는 "인쇄" 버튼 클릭 시 깔끔한 PDF 생성.

import { fmtInt, fmt1, fmt2, escapeHtml, toNum } from "../lib/format.js";
import { buildDesignDefaults, DESIGN_SCHEMA } from "../lib/design_schema.js";
import { computeMotor } from "../calculators/mcc.js";
import { subtreeLoadVA, ownLoadVA, childrenLoadVA } from "../calculators/panels.js";

const COPPER_K = { "1Φ2W": 35.6, "1Φ3W": 17.8, "3Φ3W": 30.8, "3Φ4W": 17.8 };

function circuitVoltage(panel) {
  const v = toNum(panel.voltage) || 220;
  return panel.phase === "3Φ4W" ? v / Math.sqrt(3) : v;
}

// ─── 표지 ────────────────────────────────────────────────────────────────
function renderCover(state) {
  const projectName = state.projectName || "프로젝트";
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  return `
    <section class="report-cover">
      <div class="cover-spec">KEC 2026 · KDS · KECG 1701-2021</div>
      <h1 class="cover-title">전기 계산서</h1>
      <div class="cover-divider"></div>
      <div class="cover-project">${escapeHtml(projectName)}</div>
      <div class="cover-date">작성일: ${today}</div>
    </section>
  `;
}

// ─── 설계조건 ────────────────────────────────────────────────────────────
function renderDc(state, dc) {
  return `
    <section class="report-chapter">
      <h2 class="chapter-title">설계조건</h2>
      ${DESIGN_SCHEMA.map(sec => `
        <div class="dc-block">
          <h3>${escapeHtml(sec.title)}${sec.note ? ` <small>(${escapeHtml(sec.note)})</small>` : ""}</h3>
          <table class="report-table">
            <tbody>
              ${sec.fields.filter(f => f.type !== "table").map(f => `
                <tr>
                  <th style="width:42%">${escapeHtml(f.label)}</th>
                  <td>${escapeHtml(formatDcValue(f, dc[f.key]))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          ${sec.fields.filter(f => f.type === "table").map(f => `
            <h4>${escapeHtml(f.label)}</h4>
            <table class="report-table">
              <thead><tr>${f.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
              <tbody>
                ${(dc[f.key] || []).map(row => `<tr>${f.columns.map(c => `<td>${escapeHtml(String(row[c.key] ?? ""))}</td>`).join("")}</tr>`).join("")}
              </tbody>
            </table>
          `).join("")}
        </div>
      `).join("")}
    </section>
  `;
}
function formatDcValue(field, value) {
  if (value == null) return "-";
  if (field.type === "select") {
    const opt = field.options?.find(o => o.value === value);
    return opt ? opt.label : String(value);
  }
  return String(value) + (field.unit ? ` ${field.unit}` : "");
}

// ─── 변압기 ──────────────────────────────────────────────────────────────
function renderTransformer(t, dc) {
  if (!t) return "";
  const sumConn = t.loads.reduce((a, l) => a + (toNum(l.connectedVA) ?? 0), 0);
  const sumDemand = t.loads.reduce((a, l) => a + ((toNum(l.connectedVA) ?? 0) * (toNum(l.demandFactor) ?? 1)), 0);
  const cap = toNum(t.capacity) || 0;
  const util = cap > 0 ? (sumDemand / 1000) / cap : 0;

  return `
    <section class="report-chapter">
      <h2 class="chapter-title">1. 변압기 용량 계산서</h2>
      <table class="report-meta">
        <tr><th>변압기 명칭</th><td>${escapeHtml(t.name)}</td>
            <th>변압기 용량</th><td>${fmtInt(cap)} kVA</td></tr>
        <tr><th>TYPE</th><td>${escapeHtml(t.type)}</td>
            <th>사용전압</th><td>${escapeHtml(t.voltage)}</td></tr>
      </table>
      <h3>부하 집계</h3>
      <table class="report-table">
        <thead>
          <tr><th>NO</th><th>구분</th><th>부하명</th>
              <th class="num">연결부하 [VA]</th><th class="num">수용율</th>
              <th class="num">수용부하 [VA]</th><th>차단기 P/AF/AT</th><th>비고</th></tr>
        </thead>
        <tbody>
          ${t.loads.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(l.group || "")}</td>
              <td>${escapeHtml(l.name || "")}</td>
              <td class="num">${fmtInt(l.connectedVA)}</td>
              <td class="num">${fmt2(l.demandFactor)}</td>
              <td class="num">${fmtInt((toNum(l.connectedVA) ?? 0) * (toNum(l.demandFactor) ?? 1))}</td>
              <td>${l.breakerP || "-"}P / ${l.breakerAF || "-"} / ${l.breakerAT || "-"}</td>
              <td>${escapeHtml(l.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr><th colspan="3">합 계</th>
              <td class="num">${fmtInt(sumConn)}</td><td></td>
              <td class="num">${fmtInt(sumDemand)}</td><td colspan="2"></td></tr>
        </tfoot>
      </table>
      <h3>산정 결과</h3>
      <table class="report-table">
        <tr><th>수용부하 합계</th><td>${fmt2(sumDemand / 1000)} kVA</td>
            <th>변압기 정격</th><td>${fmtInt(cap)} kVA</td>
            <th>부하율</th><td>${fmt1(util * 100)} %</td></tr>
      </table>
    </section>
  `;
}

// ─── 발전기 ──────────────────────────────────────────────────────────────
function renderGenerator(state, dc) {
  const g = state.generator;
  if (!g) return "";
  const sumFire = g.loads.reduce((a, l) => a + (toNum(l.fireKw) ?? 0), 0);
  const sumBlackout = g.loads.reduce((a, l) => a + (toNum(l.blackoutKw) ?? 0), 0);
  const maxEmergency = Math.max(sumFire, sumBlackout);

  // KDS 산정
  const generalLoadPf = toNum(dc.loadPowerFactor) || 0.85;
  const generalLoadEta = toNum(dc.loadEfficiency) || 1.0;
  const generalKVA = maxEmergency / (generalLoadEta * generalLoadPf);

  const motors = [];
  for (const mcc of (state.mccPanels || [])) {
    for (const mo of mcc.motors) {
      if (mo.loadKind !== "M") continue;
      const r = computeMotor(mo, mcc, dc);
      if (r.kva <= 0) continue;
      const startMult = r.ib > 0 ? r.ims / r.ib : 0;
      motors.push({
        name: mo.equipName || mo.equipNo,
        mccName: mcc.name,
        kva: r.kva, startKva: r.kva * startMult,
        extra: r.kva * (startMult - 1),
      });
    }
  }
  const motorsKVA = motors.reduce((a, m) => a + m.kva, 0);
  const gp1 = generalKVA + motorsKVA;
  const maxExtra = motors.length > 0 ? motors.reduce((b, m) => (!b || m.extra > b.extra) ? m : b, null) : null;
  const gp2 = maxExtra ? gp1 + maxExtra.extra : gp1;
  const maxStart = motors.length > 0 ? motors.reduce((b, m) => (!b || m.startKva > b.startKva) ? m : b, null) : null;
  const Xd = toNum(dc.generatorReactance) || 0.25;
  const vdLimit = toNum(dc.generatorTerminalVdLimit) || 0.25;
  const cosPhiS = toNum(dc.motorStartPF) || 0.2;
  const pg3 = maxStart ? maxStart.startKva * Xd / (vdLimit * cosPhiS) : 0;
  const pg4 = Math.max(gp1, gp2, pg3);

  return `
    <section class="report-chapter">
      <h2 class="chapter-title">2. 발전기 용량 계산서</h2>
      <table class="report-meta">
        <tr><th>발전기 명칭</th><td>${escapeHtml(g.name)}</td>
            <th>종류</th><td>${escapeHtml(g.type)}</td>
            <th>사용전압</th><td>${escapeHtml(g.voltage)}</td>
            <th>선정 용량</th><td>${fmtInt(g.capacity)} kVA</td></tr>
      </table>

      <h3>부하 집계</h3>
      <table class="report-table">
        <thead>
          <tr><th>NO</th><th>부하명</th><th class="num">연결[kW]</th>
              <th class="num">수용율</th><th class="num">합산[kW]</th>
              <th class="num">화재시</th><th class="num">정전시</th><th>비고</th></tr>
        </thead>
        <tbody>
          ${g.loads.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(l.name || "")}</td>
              <td class="num">${fmt2(l.connectedKw)}</td>
              <td class="num">${l.demandFactorPct ?? ""}</td>
              <td class="num">${fmt2((toNum(l.connectedKw) ?? 0) * (toNum(l.demandFactorPct) ?? 0) / 100)}</td>
              <td class="num">${fmt2(l.fireKw)}</td>
              <td class="num">${fmt2(l.blackoutKw)}</td>
              <td>${escapeHtml(l.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr><th colspan="5">합 계 [kW]</th>
              <td class="num">${fmt2(sumFire)}</td>
              <td class="num">${fmt2(sumBlackout)}</td>
              <td>최대 ${fmt2(maxEmergency)}</td></tr>
        </tfoot>
      </table>

      <h3>KDS 정밀 산정 (KDS 31 35 30)</h3>
      <table class="report-table">
        <tr><th>일반 부하 kVA</th><td>${fmt2(generalKVA)}</td>
            <th>MCC 모터 kVA</th><td>${fmt2(motorsKVA)}</td>
            <th>GP1 정상</th><td><strong>${fmt2(gp1)}</strong></td></tr>
        <tr><th>최대 기동 모터</th><td colspan="3">${maxExtra ? `${escapeHtml(maxExtra.name)} (${escapeHtml(maxExtra.mccName)}) — 정상 ${fmt2(maxExtra.kva)} → 기동 ${fmt2(maxExtra.startKva)} kVA` : "-"}</td>
            <th>GP2 기동</th><td><strong>${fmt2(gp2)}</strong></td></tr>
      </table>

      <h3>PG법 4가지 비교</h3>
      <table class="report-table">
        <thead><tr><th>방법</th><th>의미</th><th class="num">결과 [kVA]</th></tr></thead>
        <tbody>
          <tr><td>PG1</td><td>정상 운전</td><td class="num">${fmt2(gp1)}</td></tr>
          <tr><td>PG2</td><td>최대 모터 기동</td><td class="num">${fmt2(gp2)}</td></tr>
          <tr><td>PG3</td><td>단자 전압강하 한계 (Xd″=${fmt2(Xd)}, ΔV=${fmt2(vdLimit)})</td><td class="num">${fmt2(pg3)}</td></tr>
          <tr style="font-weight:bold;"><td>PG4</td><td>max — 발전기 정격 권장</td><td class="num">${fmt2(pg4)}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

// ─── 전압강하 ────────────────────────────────────────────────────────────
function renderVoltageDrop(state, dc) {
  const panels = state.panels || [];
  const mccs = state.mccPanels || [];
  const limit = toNum(dc.vdAllowedTotalPL) || 6;

  // 회로별 행 수집 (단순화)
  const rows = [];
  for (const p of panels) {
    for (const c of p.circuits) {
      const va = (toNum(c.count) ?? 0) * (toNum(c.wattEa) ?? 0) / (toNum(c.powerFactor) || 1);
      const v = circuitVoltage(p);
      const i = v > 0 ? va / v : 0;
      const k = COPPER_K[p.phase] ?? 35.6;
      const a = toNum(c.cableSizeMm2);
      const l = toNum(c.cableLengthM) ?? 0;
      if (!a || a <= 0) {
        rows.push({ source: "분전반", panel: p.name, name: c.name, va, i, a: null, l, vd: null });
        continue;
      }
      const e = k * l * i / (1000 * a);
      const vd = (e / v) * 100;
      rows.push({ source: "분전반", panel: p.name, name: c.name, va, i, a, l, vd });
    }
  }
  for (const mcc of mccs) {
    for (const mo of mcc.motors) {
      if (mo.loadKind === "SP") continue;
      const r = computeMotor(mo, mcc, dc);
      const v = circuitVoltage(mcc);
      const k = COPPER_K[mcc.phase] ?? 35.6;
      const a = toNum(mo.cableSizeMm2);
      const l = toNum(mo.cableLengthM) ?? 0;
      if (!a || a <= 0) {
        rows.push({ source: "MCC", panel: mcc.name, name: mo.equipName || mo.equipNo, va: r.kva * 1000, i: r.ib, a: null, l, vd: null });
        continue;
      }
      const e = k * l * r.ib / (1000 * a);
      const vd = (e / v) * 100;
      rows.push({ source: "MCC", panel: mcc.name, name: mo.equipName || mo.equipNo, va: r.kva * 1000, i: r.ib, a, l, vd });
    }
  }

  return `
    <section class="report-chapter">
      <h2 class="chapter-title">3. 전압강하 계산서</h2>
      <p class="meta">한계: 총 ${fmt1(limit)}% (KEC) · 회로 ${rows.length}개</p>
      <table class="report-table">
        <thead>
          <tr><th>#</th><th>구분</th><th>분전반/MCC</th><th>회로</th>
              <th class="num">부하[VA]</th><th class="num">I[A]</th>
              <th class="num">㎟</th><th class="num">길이m</th>
              <th class="num">%VD</th><th>판정</th></tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => {
            const verdict = r.vd == null ? "데이터누락" : (r.vd >= limit ? "부적합" : (r.vd > limit * 0.85 ? "주의" : "적정"));
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.source)}</td>
                <td>${escapeHtml(r.panel)}</td>
                <td>${escapeHtml(r.name || "")}</td>
                <td class="num">${fmtInt(r.va)}</td>
                <td class="num">${fmt2(r.i)}</td>
                <td class="num">${r.a == null ? "-" : fmt1(r.a)}</td>
                <td class="num">${r.l}</td>
                <td class="num">${r.vd == null ? "-" : fmt2(r.vd) + " %"}</td>
                <td>${verdict}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

// ─── MCC ─────────────────────────────────────────────────────────────────
function renderMcc(mcc, dc) {
  return `
    <section class="report-chapter">
      <h2 class="chapter-title">4. MCC: ${escapeHtml(mcc.name)} <small>(${escapeHtml(mcc.kind)})</small></h2>
      <table class="report-meta">
        <tr><th>설치위치</th><td>${escapeHtml(mcc.location || "-")}</td>
            <th>FROM</th><td>${escapeHtml(mcc.fromPanel || "-")}</td>
            <th>전압회로</th><td>${escapeHtml(mcc.phase)} ${mcc.voltage}V</td></tr>
      </table>
      <h3>모터·부하</h3>
      <table class="report-table">
        <thead>
          <tr><th>NO</th><th>장비번호</th><th>장비명</th><th>종류</th>
              <th class="num">kW</th><th class="num">η</th><th class="num">cosθ</th>
              <th>기동</th><th class="num">IB[A]</th><th class="num">IMS[A]</th><th class="num">II[A]</th></tr>
        </thead>
        <tbody>
          ${mcc.motors.map((mo, i) => {
            const r = computeMotor(mo, mcc, dc);
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(mo.equipNo || "")}</td>
                <td>${escapeHtml(mo.equipName || "")}</td>
                <td>${escapeHtml(mo.loadKind)}</td>
                <td class="num">${mo.loadKind === "M" ? fmt2(mo.powerKw) : "-"}</td>
                <td class="num">${mo.loadKind === "M" ? fmt2(mo.efficiency) : "-"}</td>
                <td class="num">${fmt2(mo.powerFactor)}</td>
                <td>${mo.loadKind === "M" ? escapeHtml(mo.startMethod) : "-"}</td>
                <td class="num">${fmt2(r.ib)}</td>
                <td class="num">${mo.loadKind === "M" ? fmt1(r.ims) : "-"}</td>
                <td class="num">${mo.loadKind === "M" ? fmt1(r.ii) : "-"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

// ─── 분전반 ──────────────────────────────────────────────────────────────
function renderPanel(p, allPanels) {
  const ownVA = ownLoadVA(p);
  const chVA = childrenLoadVA(allPanels, p);
  const parent = p.parentPanelId ? allPanels.find(x => x.id === p.parentPanelId) : null;
  return `
    <section class="report-chapter">
      <h2 class="chapter-title">5. 분전반: ${escapeHtml(p.name)} <small>(${escapeHtml(p.type)})</small></h2>
      <table class="report-meta">
        <tr><th>설치위치</th><td>${escapeHtml(p.location || "-")}</td>
            <th>FROM</th><td>${parent ? escapeHtml(parent.name) : escapeHtml(p.fromPanel || "(루트)")}</td>
            <th>전압회로</th><td>${escapeHtml(p.phase)} ${p.voltage}V</td></tr>
        <tr><th>자체부하</th><td>${fmtInt(ownVA)} VA</td>
            <th>자식부하</th><td>${fmtInt(chVA)} VA</td>
            <th>총부하</th><td><strong>${fmtInt(ownVA + chVA)} VA</strong></td></tr>
      </table>
      ${p.circuits.length === 0 ? "" : `
        <h3>회로 목록</h3>
        <table class="report-table">
          <thead>
            <tr><th>NO</th><th>구분</th><th>부하명</th><th>기호</th>
                <th class="num">수량</th><th class="num">W/EA</th><th class="num">부하[VA]</th>
                <th>상</th><th>차단기</th><th class="num">㎟·m</th></tr>
          </thead>
          <tbody>
            ${p.circuits.map((c, i) => {
              const va = (toNum(c.count) ?? 0) * (toNum(c.wattEa) ?? 0) / (toNum(c.powerFactor) || 1);
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(c.kind)}</td>
                  <td>${escapeHtml(c.name || "")}</td>
                  <td>${escapeHtml(c.symbol || "")}</td>
                  <td class="num">${c.count ?? ""}</td>
                  <td class="num">${c.wattEa ?? ""}</td>
                  <td class="num">${fmtInt(va)}</td>
                  <td>${escapeHtml(c.phaseAssign || "")}</td>
                  <td>${c.breakerP || "-"}P/${c.breakerAF || "-"}/${c.breakerAT || "-"}</td>
                  <td class="num">${c.cableSizeMm2 ?? "-"} / ${c.cableLengthM ?? "-"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `}
    </section>
  `;
}

// ─── 트레이 ──────────────────────────────────────────────────────────────
function renderTray(t) {
  const totalArea = t.cables.reduce((a, c) => a + Math.PI * Math.pow((toNum(c.outerDiaMm) || 0) / 2, 2) * (toNum(c.count) || 0), 0);
  const trayArea = (toNum(t.widthMm) || 0) * (toNum(t.depthMm) || 0);
  const fill = trayArea > 0 ? (totalArea / trayArea) * 100 : 0;
  return `
    <section class="report-chapter">
      <h2 class="chapter-title">6. 케이블 트레이: ${escapeHtml(t.name)}</h2>
      <table class="report-meta">
        <tr><th>종류</th><td>${escapeHtml(t.type)}</td>
            <th>설치위치</th><td>${escapeHtml(t.location || "-")}</td>
            <th>폭 × 깊이</th><td>${t.widthMm} × ${t.depthMm} mm</td>
            <th>적재율 / 한계</th><td>${fmt1(fill)} % / ${t.fillLimitPct} %</td></tr>
      </table>
      ${t.cables.length === 0 ? "" : `
        <h3>케이블 목록</h3>
        <table class="report-table">
          <thead>
            <tr><th>NO</th><th>구분</th><th>FROM</th><th>TO</th>
                <th>종류</th><th class="num">굵기</th><th class="num">심선수</th>
                <th class="num">수량</th><th class="num">외경[mm]</th><th class="num">단면적[㎟]</th></tr>
          </thead>
          <tbody>
            ${t.cables.map((c, i) => {
              const d = toNum(c.outerDiaMm) || 0;
              const area = Math.PI * (d / 2) ** 2 * (toNum(c.count) || 0);
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(c.category)}</td>
                  <td>${escapeHtml(c.from || "")}</td>
                  <td>${escapeHtml(c.to || "")}</td>
                  <td>${escapeHtml(c.cableType)}</td>
                  <td class="num">${c.sizeMm2}</td>
                  <td class="num">${c.cores}</td>
                  <td class="num">${c.count}</td>
                  <td class="num">${c.outerDiaMm}</td>
                  <td class="num">${fmtInt(area)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `}
    </section>
  `;
}

// ─── 접지 ────────────────────────────────────────────────────────────────
function renderGrounding(g) {
  if (!g) return "";
  const rho = toNum(g.rho) || 0;
  const L = toNum(g.rodLength) || 0;
  const d = (toNum(g.rodDiameterMm) || 0) / 1000;
  const n = toNum(g.rodCount) || 1;
  const eta = toNum(g.etaCoupling) || 1;
  const rTarget = toNum(g.rTarget) || 0;
  const rSingle = (L > 0 && d > 0) ? rho * Math.log(4 * L / d) / (2 * Math.PI * L) : null;
  const rTotal = rSingle != null ? rSingle / (n * eta) : null;
  return `
    <section class="report-chapter">
      <h2 class="chapter-title">7. 접지 계산서 (KEC 142.3)</h2>
      <table class="report-meta">
        <tr><th>접지 시스템</th><td>${escapeHtml(g.system || "")}</td>
            <th>대지저항률 ρ</th><td>${rho} Ω·m</td>
            <th>봉 사양 L · d</th><td>${L} m · ${g.rodDiameterMm} mm</td>
            <th>봉 개수 / 결합효율</th><td>${n} 개 / ${eta}</td></tr>
        <tr><th>목표 저항</th><td>${rTarget} Ω</td>
            <th>단독 봉 R₁</th><td>${rSingle != null ? fmt2(rSingle) + " Ω" : "-"}</td>
            <th>합성 저항</th><td>${rTotal != null ? fmt2(rTotal) + " Ω" : "-"}</td>
            <th>판정</th><td>${rTotal != null && rTotal <= rTarget ? "적정 ✓" : "부족"}</td></tr>
        <tr><th>상도체 S</th><td>${g.phaseConductorMm2} ㎟</td>
            <th colspan="3">보호도체 (KEC 142.3-1): ${g.protectiveConductorMm2 ?? "자동"} ㎟</th></tr>
      </table>
      ${g.note ? `<p>비고: ${escapeHtml(g.note)}</p>` : ""}
    </section>
  `;
}

// ─── 메인 ────────────────────────────────────────────────────────────────
export function renderPrintReport(view, state, save) {
  const dc = { ...buildDesignDefaults(), ...(state.designConditions || {}) };
  const panels = state.panels || [];
  const mccs = state.mccPanels || [];
  const trays = state.trays || [];

  view.innerHTML = `
    <div class="print-controls">
      <h2 style="margin:0;">📄 전체 보고서</h2>
      <div>
        <button class="btn" id="btn-print-all">🖨️ 인쇄 / PDF 저장</button>
        <small style="color:#6b7280; margin-left: 8px;">
          Ctrl+P 또는 위 버튼 사용. 인쇄 시 사이드바·버튼 자동 숨김, A4 가로로 출력됩니다.
        </small>
      </div>
    </div>
    <article class="report">
      ${renderCover(state)}
      ${renderDc(state, dc)}
      ${renderTransformer(state.transformer, dc)}
      ${renderGenerator(state, dc)}
      ${renderVoltageDrop(state, dc)}
      ${mccs.map(m => renderMcc(m, dc)).join("")}
      ${panels.map(p => renderPanel(p, panels)).join("")}
      ${trays.map(t => renderTray(t)).join("")}
      ${renderGrounding(state.grounding)}
    </article>
  `;
  view.querySelector("#btn-print-all").addEventListener("click", () => window.print());
}
