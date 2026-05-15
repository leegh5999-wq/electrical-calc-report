// 차단기·케이블 자동 추천 — KEC 212.4 / 232.5 기반 단순화 알고리즘.
//
// 1) 차단기 정격 (AT): IB ≤ AT (표준 정격 중 최소).
// 2) 케이블 단면적 (㎟): IB ≤ Iz (감쇄계수 적용) AND %VD ≤ 한계.
//
// MVP는 동선 1심 기중 30℃ 기준 단순 Iz 표를 사용. 정밀 KEC 표(공사방법별)는
// 차후 cable_data 시트에 Iz 컬럼 추가 시 사용.

import { toNum } from "./format.js";

// 표준 케이블 단면적 [㎟] — KS 표준
export const STANDARD_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];

// 단순 Iz 표 [A] — KEC 표 232.5-1 동선 1심 기중 30℃ 근사값
// (실제 공사방법별·심선수별로 다름; MVP는 평균치)
export const CABLE_IZ_CU = {
  1.5: 19,
  2.5: 26,
  4: 35,
  6: 46,
  10: 63,
  16: 85,
  25: 112,
  35: 138,
  50: 168,
  70: 213,
  95: 258,
  120: 299,
  150: 344,
  185: 392,
  240: 461,
  300: 530,
  400: 626,
  500: 718,
  630: 825,
};

// 표준 차단기 AT 정격 (MCB)
export const STANDARD_AT_MCB = [5, 10, 15, 20, 25, 30, 40, 50, 63, 80, 100, 125, 150, 175, 200, 225];

// 표준 차단기 AT 정격 (MCCB / CBR)
export const STANDARD_AT_MCCB = [16, 32, 50, 63, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500, 3200];

// 표준 AF (Frame size) — AT에 따라 결정
export function suggestAF(at) {
  if (at <= 30) return 30;
  if (at <= 50) return 50;
  if (at <= 100) return 100;
  if (at <= 225) return 225;
  if (at <= 400) return 400;
  if (at <= 630) return 630;
  if (at <= 800) return 800;
  if (at <= 1200) return 1200;
  return 1600;
}

/**
 * IB 이상의 표준 차단기 정격 중 최소를 추천.
 * @param {number} ib   설계전류 [A]
 * @param {"MCB"|"MCCB"} kind  차단기 종류
 * @returns {number|null}  AT 정격값
 */
export function recommendBreakerAT(ib, kind = "MCCB") {
  if (!Number.isFinite(ib) || ib <= 0) return null;
  const table = kind === "MCB" ? STANDARD_AT_MCB : STANDARD_AT_MCCB;
  for (const at of table) if (at >= ib) return at;
  return table[table.length - 1];   // 표준 초과면 최대값
}

/**
 * 감쇄계수 적용 후 유효 Iz 계산.
 * @param {number} baseIz  표준 30℃ Iz [A]
 * @param {object} dc      설계조건
 * @returns {number}
 */
export function effectiveIz(baseIz, dc) {
  const tempCorr = toNum(dc?.ambientTempAirCorr) || 1;   // 기중 주위온도 보정
  const circuitCorr = toNum(dc?.circuitCountCorr) || 1;  // 회로수 보정
  return baseIz * tempCorr * circuitCorr;
}

// ─── KECG-1702 도체·차단기 검토 (E-1) ──────────────────────────────────
// 도체: SB / SCB / SVD% / SSC 4가지 검토 → 최대값 = 최종 단면적
// 차단기: ATB / ATTh / ATSC 3가지 검토 → 최대값 = 최종 AT
// 단락전류 ISC는 단순화 — 별도 정밀 계산은 향후 단락전류 챕터에서.

const SSC_K_XLPE = 143;  // KEC 212.5-1 XLPE 절연 동선 상수

/**
 * 변압기·발전기 정격 기준 단락전류 (단순화).
 * 실제는 KEC 212.5에 따라 누적 임피던스 계산 필요. MVP는 정격 ÷ Xpu_avg.
 */
export function estimateISC(state, voltage) {
  const v = toNum(voltage) || 380;
  const t = state?.transformer;
  const g = state?.generator;
  const kva = (t && toNum(t.capacity)) || (g && toNum(g.capacity)) || 500;
  const ratedI = (kva * 1000) / (Math.sqrt(3) * v);
  // 변압기 임피던스 5%, 발전기 Xd″ 25% — 평균적인 단락 배수 약 10~20배 가정.
  // KEC 212.5 정밀 계산 전에 단순화로 정격의 20배 사용.
  return ratedI * 20;
}

/** SB: 허용전류 IB ≤ Iz × DF 만족 최소 단면적 */
export function reviewSB(ib, dc) {
  if (!Number.isFinite(ib) || ib <= 0) return null;
  for (const s of STANDARD_MM2) {
    if (effectiveIz(CABLE_IZ_CU[s] || 0, dc) >= ib) return s;
  }
  return STANDARD_MM2[STANDARD_MM2.length - 1];
}

/** SCB: 차단기 정격 IN ≤ Iz × DF 만족 최소 단면적 */
export function reviewSCB(at, dc) {
  if (!Number.isFinite(at) || at <= 0) return null;
  for (const s of STANDARD_MM2) {
    if (effectiveIz(CABLE_IZ_CU[s] || 0, dc) >= at) return s;
  }
  return STANDARD_MM2[STANDARD_MM2.length - 1];
}

/** SVD%: %VD ≤ 한계 만족 최소 단면적 */
export function reviewSVD({ ib, lengthM, voltage, vdLimit, k }) {
  if (!Number.isFinite(ib) || ib <= 0 || !Number.isFinite(voltage) || voltage <= 0) return null;
  for (const s of STANDARD_MM2) {
    if (lengthM <= 0) return s;
    const e = k * lengthM * ib / (1000 * s);
    const vdPct = (e / voltage) * 100;
    if (vdPct < vdLimit) return s;
  }
  return STANDARD_MM2[STANDARD_MM2.length - 1];
}

/** SSC: 단락전류 열적 보호 — S ≥ ISC × √t / K (KEC 212.5-1) */
export function reviewSSC(isc, dc) {
  if (!Number.isFinite(isc) || isc <= 0) return null;
  const t = toNum(dc?.scInstantTime) || 0.03;
  const safety = toNum(dc?.safetyFactorSSC) || 1.25;
  const sMin = (isc * Math.sqrt(t) / SSC_K_XLPE) * safety;
  for (const s of STANDARD_MM2) if (s >= sMin) return s;
  return STANDARD_MM2[STANDARD_MM2.length - 1];
}

/** ATB: IB 이상의 표준 AT (= recommendBreakerAT) */
export function reviewATB(ib, kind) {
  return recommendBreakerAT(ib, kind);
}

/**
 * ATTh: 차단기 규약동작전류 I2 ≤ 1.45 × Iz
 *   AT × i2_coef ≤ 1.45 × Iz   →   AT_max ≤ 1.45 × Iz / i2_coef
 *   현재 입력 AT 가 이 조건 만족하는지 표시.
 */
export function reviewATTh(at, cableMm2, dc, kind = "MCCB") {
  if (!Number.isFinite(at) || at <= 0 || !cableMm2) return null;
  const iz = effectiveIz(CABLE_IZ_CU[cableMm2] || 0, dc);
  // KEC 표 — 산업용 ≤63A 1.30, 그 외 1.45
  let i2 = 1.45;
  if (kind === "MCCB" || kind === "CBR") i2 = at <= 63 ? 1.30 : 1.37;
  else if (kind === "MCB" || kind === "RCBO") i2 = at <= 63 ? 1.45 : 1.52;
  const atMax = 1.45 * iz / i2;
  return { atMax, iz, i2, ok: at <= atMax };
}

/**
 * ATSC: 단락전류 보호 (KEC 212.5) — tN ≤ tZ
 *   tZ = (K × S / ISC)²
 *   차단기 순시동작시간 tN (DC.scInstantTime ≈ 0.03 s) 보다 tZ 가 커야 OK.
 */
export function reviewATSC(isc, cableMm2, dc) {
  if (!Number.isFinite(isc) || isc <= 0 || !cableMm2) return null;
  const tN = toNum(dc?.scInstantTime) || 0.03;
  const tZ = Math.pow(SSC_K_XLPE * cableMm2 / isc, 2);
  return { tN, tZ, ok: tN <= tZ };
}

/**
 * IB와 %VD 한계 모두 만족하는 최소 표준 단면적 추천.
 * @param {object} opts
 *   ib: 부하 전류 [A]
 *   lengthM: 케이블 길이 [m]
 *   voltage: 회로 전압 [V]
 *   vdLimit: %VD 한계 [%]
 *   k: 회로 방식 상수 (35.6 / 17.8 / 30.8 / 17.8)
 *   dc: 설계조건 (감쇄계수 lookup용)
 * @returns {number|null}  추천 ㎟ (못 찾으면 null)
 */
export function recommendCableSize({ ib, lengthM, voltage, vdLimit, k, dc }) {
  if (!Number.isFinite(ib) || ib <= 0) return null;
  if (!Number.isFinite(voltage) || voltage <= 0) return null;
  for (const size of STANDARD_MM2) {
    const baseIz = CABLE_IZ_CU[size];
    if (!baseIz) continue;
    const iz = effectiveIz(baseIz, dc);
    if (iz < ib) continue;   // 허용전류 부족 → 다음 사이즈
    if (lengthM > 0) {
      const e = k * lengthM * ib / (1000 * size);
      const vdPct = (e / voltage) * 100;
      if (vdPct >= vdLimit) continue;   // 전압강하 초과 → 다음 사이즈
    }
    return size;
  }
  return null;
}
