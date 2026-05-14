// Schema for 설계조건 (design conditions). Values stored in
// state.designConditions[<key>]. Other calculators import DESIGN_DEFAULTS
// and read from state.designConditions, falling back to the default.
//
// Mirrors the source workbook sheet `설계조건` (KECG 1701/1702).

export const CONSTRUCTION_METHODS = [
  { value: "A1", label: "A1 — 단열벽 속에 매입한 전선관 내부의 절연전선/단심케이블" },
  { value: "A2", label: "A2 — 단열벽 속에 매입한 전선관 내부의 다심케이블" },
  { value: "B1", label: "B1 — 목재/석재 벽면에 부착한 전선관 내부의 절연전선/단심케이블" },
  { value: "B2", label: "B2 — 목재/석재 벽면에 부착한 전선관 내부의 다심케이블" },
  { value: "D1", label: "D1 — 지중 매설한 전선관/케이블덕트 내의 단심/다심케이블" },
  { value: "E",  label: "E — 케이블래더에 포설 — 단심케이블" },
  { value: "F",  label: "F — 케이블래더에 포설 — 다심케이블" },
];

export const CONDUIT_TYPES = ["CD", "HI", "Steel", "FEP"];

export const MOTOR_START_METHODS = ["DOL", "Y-D", "리액터", "S.S", "INV"];

export const SYSTEM_VOLTAGES = [
  "3Φ4W 380/220V",
  "3Φ3W 380V",
  "3Φ3W 220V",
  "1Φ3W 220/110V",
  "1Φ2W 220V",
];

// Schema is an array of sections, each with a title and array of field defs.
// Field types:
//   "select"  : { options: [{value, label}], default }
//   "number"  : { default, step?, min?, max?, unit?, range? (string hint) }
//   "table"   : { columns: [{key,label,type,unit?}], rows: [...] }
//   "text"    : string
export const DESIGN_SCHEMA = [
  {
    id: "project",
    title: "0. 프로젝트 기본값",
    note: "모든 계산기가 기본값으로 참조합니다. 개별 계산기에서 덮어쓸 수 있습니다.",
    fields: [
      { key: "systemVoltage",          label: "시스템 전압", type: "select",
        options: SYSTEM_VOLTAGES.map(v => ({ value: v, label: v })),
        default: "3Φ4W 380/220V",
        help: "변압기·분전반·전압강하 계산의 기본 사용전압." },
      { key: "systemFrequency",        label: "시스템 주파수", type: "number", unit: "Hz", default: 60 },
      { key: "transformerLoadMargin",  label: "변압기 부하율 한계", type: "number",
        default: 0.85, step: 0.01, min: 0.5, max: 1.0,
        help: "자동 용량 선정 시 수용부하 ÷ 한계 = 목표용량(KS표준 올림). 판정 임계값으로도 사용." },
      { key: "generatorEfficiency",    label: "발전기 효율 η",     type: "number", default: 0.85, step: 0.01, min: 0.1, max: 1.0,
        help: "디젤 발전기 전기효율의 일반적 값 (0.80~0.95)." },
      { key: "generatorPowerFactor",   label: "발전기 역률 cosφ", type: "number", default: 0.8,  step: 0.01, min: 0.1, max: 1.0,
        help: "정격 역률 (대부분 0.8 지상)." },
      { key: "generatorSafetyMargin",  label: "발전기 여유계수",   type: "number", default: 1.1,  step: 0.01, min: 1.0, max: 2.0,
        help: "산정 용량 = (비상부하 ÷ η ÷ cosφ) × 여유계수." },
      { key: "generatorLoadMargin",    label: "발전기 부하율 한계", type: "number", default: 0.85, step: 0.01, min: 0.5, max: 1.0,
        help: "자동 KS 표준 용량 선정 및 판정 임계값." },
      { key: "generatorReactance",     label: "발전기 차동기 임피던스 Xd″", type: "number", default: 0.25, step: 0.01, min: 0.1, max: 0.5,
        help: "PG3 단자 전압강하 산정에 사용 (p.u., 보통 0.2~0.3)." },
      { key: "generatorTerminalVdLimit", label: "발전기 단자 전압강하 한계 ΔV", type: "number", default: 0.25, step: 0.01, min: 0.1, max: 0.4,
        help: "PG3 산정 시 모터 기동 중 허용 전압강하율 (보통 0.2~0.25)." },
      { key: "buildingType",           label: "건축물 종류",       type: "select",
        options: [
          { value: "사무실",     label: "사무실" },
          { value: "백화점",     label: "백화점" },
          { value: "종합병원",   label: "종합병원" },
          { value: "호텔",       label: "호텔" },
          { value: "기타건축물", label: "기타건축물 (학교 등)" },
        ],
        default: "기타건축물",
        help: "수용률 표에서 자동 조회 시 사용." },
    ],
  },
  {
    id: "construction",
    title: "1. 공사방법 기준",
    note: "KECG 1701 / KS C IEC 60364-5-52 표 4.1",
    fields: [
      { key: "constructionMethod", label: "공사방법", type: "select", options: CONSTRUCTION_METHODS, default: "B1",
        help: "케이블 포설 방법을 선택 — 허용전류·감쇄계수 계산의 기준이 됩니다." },
      { key: "ambientTempAir",            label: "기중 주위온도",           type: "number", unit: "℃", default: 40 },
      { key: "ambientTempAirCorr",        label: "기중 보정계수",           type: "number", default: 0.91, step: 0.01 },
      { key: "ambientTempUnderground",    label: "지중 주위온도",           type: "number", unit: "℃", default: 30 },
      { key: "ambientTempUndergroundCorr",label: "지중 보정계수",           type: "number", default: 0.93, step: 0.01 },
      { key: "circuitsPerTray",           label: "트레이 회로수",           type: "number", default: 9, help: "9회로 이상 적용" },
      { key: "circuitCountCorr",          label: "회로수 보정계수",         type: "number", default: 0.78, step: 0.01 },
      { key: "soilThermalResistivity",    label: "토양 열저항률",           type: "number", unit: "K·m/w", default: 1.5, step: 0.1 },
      { key: "soilThermalCorr",           label: "토양 열저항률 보정계수",  type: "number", default: 1.1, step: 0.01 },
      { key: "buryDepth",                 label: "매설깊이",                type: "number", unit: "m", default: 1, step: 0.1 },
      { key: "buryDepthCorr",             label: "매설깊이 보정계수",       type: "number", default: 0.96, step: 0.01 },
    ],
  },
  {
    id: "conductor",
    title: "2. 도체단면적(S) 선정기준",
    note: "KECG 1702",
    fields: [
      { key: "multiSingleBoundary",  label: "다심/단심 분기점", type: "number", unit: "㎟", default: 50,
        help: "이 값 이상은 단심 케이블 적용 (KEC 16㎟ 이상)" },
      { key: "loadPowerFactor",      label: "일반부하 역률",     type: "number", default: 1.0, step: 0.01, min: 0, max: 1 },
      { key: "loadEfficiency",       label: "일반부하 효율",     type: "number", default: 1.0, step: 0.01, min: 0, max: 1 },
      { key: "vdAllowedFeederPL",    label: "허용 전압강하 — PNL/부하 간선",   type: "number", unit: "%", default: 3 },
      { key: "vdAllowedBranchPL",    label: "허용 전압강하 — PNL/부하 분기",   type: "number", unit: "%", default: 3 },
      { key: "vdAllowedTotalPL",     label: "허용 전압강하 — PNL/부하 TOTAL", type: "number", unit: "%", default: 6, help: "KEC 기준 6%" },
      { key: "vdAllowedTotalMotor",  label: "허용 전압강하 — 전동기 TOTAL",   type: "number", unit: "%", default: 8 },
      { key: "scInstantTime",        label: "단락 시 차단기 순시동작시간",     type: "number", unit: "sec", default: 0.03, step: 0.01 },
      { key: "scRatedRatio",         label: "예상단락전류 (정격의 ×)",         type: "number", default: 0.5, step: 0.01 },
      { key: "safetyFactorSSC",      label: "여유계수 (SSC)",                  type: "number", default: 1.25, step: 0.01, range: "1.0~1.25" },
      { key: "vdMotorFeederPct",     label: "전동기 간선 허용 전압강하",       type: "number", unit: "%", default: 5 },
      { key: "vdMotorSinglePct",     label: "전동기 단일부하 허용 전압강하",   type: "number", unit: "%", default: 10 },
      { key: "motorStartPF",         label: "전동기 기동시 역률",              type: "number", default: 0.2, step: 0.01, range: "0.1~0.3" },
      { key: "safetyFactorSMSTh",    label: "여유계수 (SMSTh)",                type: "number", default: 1.25, step: 0.01, range: "1.0~1.25" },
      { key: "conduitFillCD",        label: "전선관 허용 단면적 비율 — CD",    type: "number", default: 1/3, step: 0.01 },
      { key: "conduitFillHI",        label: "전선관 허용 단면적 비율 — HI",    type: "number", default: 1/3, step: 0.01 },
      { key: "conduitFillSteel",     label: "전선관 허용 단면적 비율 — Steel", type: "number", default: 1/3, step: 0.01 },
      { key: "conduitFillFEP",       label: "전선관 허용 단면적 비율 — FEP",   type: "number", default: 1/3, step: 0.01 },
    ],
  },
  {
    id: "breaker",
    title: "4. 차단기 정격(AT) 선정",
    note: "KECG 1702 / KEC 212.4.1",
    fields: [
      { key: "i2HouseUnder63",  label: "I2 주택용 MCB·RCBO 63A 이하", type: "number", default: 1.45, step: 0.01 },
      { key: "i2HouseOver63",   label: "I2 주택용 MCB·RCBO 63A 초과", type: "number", default: 1.52, step: 0.01 },
      { key: "i2IndustryUnder63", label: "I2 산업용 MCCB·CBR 63A 이하", type: "number", default: 1.30, step: 0.01 },
      { key: "i2IndustryOver63",  label: "I2 산업용 MCCB·CBR 63A 초과", type: "number", default: 1.37, step: 0.01 },
      { key: "atms_safety",     label: "여유계수 (ATMS)", type: "number", default: 1.25, step: 0.01, range: "1.0~1.25" },
      { key: "inrushDOL",       label: "돌입전류 배율 k — DOL/Y-D/리액터", type: "number", default: 1.5, step: 0.01, range: "1.3~1.5" },
      { key: "inrushSS",        label: "돌입전류 배율 k — 소프트스타터(S.S)", type: "number", default: 1, step: 0.01 },
      { key: "inrushINV",       label: "돌입전류 배율 k — 인버터(INV)", type: "number", default: 1, step: 0.01 },
      { key: "atmiMultiplier",  label: "동작배율 (ATMI)", type: "number", default: 10, help: "10IN 순시" },
      { key: "atmi_safety",     label: "여유계수 (ATMI)", type: "number", default: 1.25, step: 0.01, range: "1.0~1.25" },
      { key: "tN_breaker",      label: "차단기 순시동작시간 tN", type: "number", unit: "sec", default: 0.03, step: 0.01, range: "0.01~0.05" },
    ],
  },
  {
    id: "motor",
    title: "5. 전동기 기동전류 선정",
    note: "KECG 1702 130p~136p",
    fields: [
      { key: "motorBetaTable", label: "β 전동기 전전압 기동배율 (정격별)", type: "table",
        columns: [
          { key: "ratingLabel", label: "정격 구분", type: "string" },
          { key: "beta",        label: "β 적용값",   type: "number", step: 0.1, range: "4.0~10" },
        ],
        default: [
          { ratingLabel: "≤ 5.5 kW",     beta: 6.0 },
          { ratingLabel: "7.5~22 kW",    beta: 9.5 },
          { ratingLabel: "30~55 kW",     beta: 8.2 },
          { ratingLabel: "75~132 kW",    beta: 7.2 },
          { ratingLabel: "≥ 160 kW",     beta: 7.7 },
        ],
      },
      { key: "motorMethodC", label: "C — 기동방식 계수", type: "table",
        columns: [
          { key: "method", label: "기동방식", type: "string" },
          { key: "tap",    label: "TAP",     type: "string" },
          { key: "c",      label: "C 값",    type: "number", step: 0.01 },
        ],
        default: [
          { method: "DOL",    tap: "-",    c: 1     },
          { method: "Y-D",    tap: "-",    c: 0.333 },
          { method: "리액터", tap: "0.65", c: 0.65  },
        ],
      },
      { key: "lambdaSS",   label: "λ — 소프트스타터 전류제한 비율", type: "number", default: 4,   step: 0.1, range: "3.0~5.0" },
      { key: "lambdaINV",  label: "λ — 인버터 전류제한 비율",       type: "number", default: 1.2, step: 0.1, range: "1.0~2.0" },
      { key: "inrushK",    label: "k — 돌입전류 배율",              type: "number", default: 1.5, step: 0.01, range: "1.3~1.5" },
      { key: "motorTmTable", label: "tm — 기동시간 [sec]", type: "table",
        columns: [
          { key: "method", label: "기동방식", type: "string" },
          { key: "tm",     label: "tm [sec]", type: "number", step: 0.1 },
        ],
        default: [
          { method: "DOL",    tm: 2  },
          { method: "Y-D",    tm: 6  },
          { method: "리액터", tm: 10 },
          { method: "S.S",    tm: 15 },
          { method: "INV",    tm: 4  },
        ],
      },
      { key: "cosThetaS", label: "cosθS — 전동기 기동시 역률", type: "number", default: 0.2, step: 0.01, range: "0.1~0.3" },
      { key: "ctRatio",   label: "CT 변류기 선정 배율",        type: "number", default: 1.5, step: 0.1 },
    ],
  },
];

// Flatten the schema's defaults into a single object for state initialization.
export function buildDesignDefaults() {
  const out = {};
  for (const section of DESIGN_SCHEMA) {
    for (const f of section.fields) {
      if (f.type === "table") {
        out[f.key] = structuredClone(f.default);
      } else {
        out[f.key] = f.default;
      }
    }
  }
  return out;
}
