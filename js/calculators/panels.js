// Chapter 5: 분전반 부하계산서 (MVP)
// User adds/duplicates/deletes/renames panels per project. Each panel has
// metadata + a list of circuits. The 조명기구 reference table provides
// W/EA auto-fill when the user enters a fixture symbol on a circuit row.
//
// Routes:
//   #panels        → panel list
//   #panel/<id>    → panel editor

import { fmtInt, fmt1, fmt2, toNum, escapeHtml } from "../lib/format.js";
import { buildDesignDefaults } from "../lib/design_schema.js";
import { getTable } from "../lib/tables.js";

const PANEL_TYPES = ["LP", "LS", "LT", "L-", "S-", "P-", "EV", "기타"];
const PHASE_OPTIONS = [
  { value: "1Φ2W", label: "1Φ 2W (단상)" },
  { value: "1Φ3W", label: "1Φ 3W" },
  { value: "3Φ3W", label: "3Φ 3W" },
  { value: "3Φ4W", label: "3Φ 4W" },
];
const MOUNT_TYPES = ["노출형", "매입형", "자립형"];
const LOAD_KINDS  = [
  { value: "SP", label: "SP (예비)" },
  { value: "L",  label: "L (조명)" },
  { value: "E",  label: "E (전열)" },
  { value: "EL", label: "EL (비상조명)" },
  { value: "P",  label: "P (동력)" },
  { value: "AC", label: "AC (공조)" },
  { value: "EV", label: "EV (전기차)" },
  { value: "OD", label: "OD (옥외)" },
  { value: "ETC", label: "기타" },
];

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function getDC(state) {
  return { ...buildDesignDefaults(), ...(state.designConditions || {}) };
}

function isThreePhase(panel) { return panel.phase?.startsWith("3Φ"); }
function isFourWire(panel)   { return panel.phase === "3Φ4W" || panel.phase === "1Φ3W"; }

export function newPanel(state, overrides = {}) {
  const dc = getDC(state);
  return {
    id: uuid(),
    name: overrides.name || "신규 분전반",
    type: overrides.type || "LP",
    location: "",
    mountType: "노출형",
    parentPanelId: null,         // structured parent (another panel's id, or null = root)
    fromPanel: "",               // free-text external source (only used when parentPanelId is null, e.g. "MCC-F")
    phase: "3Φ4W",
    voltage: 380,
    branchDistanceMax: 30,
    branchDistanceMin: 5,
    vdLimit: 0.03,
    faultMax: null,
    faultMin: null,
    faultExpected: null,
    // 인입(간선) 케이블 — 상위 분전반(또는 변압기·MCC)에서 이 분전반까지의 케이블
    incomingCableSizeMm2: null,
    incomingCableLengthM: null,
    incomingCableType: "CV",
    note: "",
    circuits: [],
    ...overrides,
  };
}

// ─── Tree helpers ─────────────────────────────────────────────────────────
function pid(p)             { return p.parentPanelId ?? null; }
function getChildren(panels, parentId) { return panels.filter(p => pid(p) === parentId); }

function getDescendantIds(panels, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of getChildren(panels, cur)) {
      if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
    }
  }
  return out;
}

// Panels eligible to be the parent of `currentId` (excludes self + descendants).
function getValidParents(panels, currentId) {
  if (!currentId) return panels;
  const blocked = getDescendantIds(panels, currentId);
  return panels.filter(p => p.id !== currentId && !blocked.has(p.id));
}

// DFS panel order with depth — roots first, then descendants. Orphans (parent
// id pointing to a missing panel) are surfaced as roots at the end.
function panelTreeOrder(panels) {
  const result = [];
  const seen = new Set();
  const visit = (parentId, depth) => {
    for (const p of getChildren(panels, parentId)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      result.push({ panel: p, depth });
      visit(p.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const p of panels) if (!seen.has(p.id)) { seen.add(p.id); result.push({ panel: p, depth: 0 }); }
  return result;
}

function newCircuit() {
  return {
    no: "",            // blank = auto-numbered
    kind: "L",
    name: "",
    symbol: "",
    count: 1,
    wattEa: 0,
    phaseAssign: "L1",  // L1/L2/L3/N (for 3Φ); 'A' for 1Φ
    powerFactor: 1.0,
    breakerType: "MCB",
    breakerP: 2,
    breakerAF: 30,
    breakerAT: 20,
    cableType: "CV",
    cableSizeMm2: 2.5,
    cableLengthM: 0,
    note: "",
  };
}

// Look up lighting fixture by symbol from state.tables.lighting_fixtures.
function findFixture(state, symbol) {
  const t = state.tables?.lighting_fixtures;
  if (!t || !symbol) return null;
  const sym = String(symbol).trim();
  for (let i = 3; i < t.raw.length; i++) {
    const r = t.raw[i];
    if (r && String(r[2] ?? "").trim() === sym) {
      return { symbol: r[2], type: r[3], count: r[4], watt: r[5], label: r[6] };
    }
  }
  return null;
}

function circuitVA(c) {
  const cnt = toNum(c.count) ?? 0;
  const w   = toNum(c.wattEa) ?? 0;
  const pf  = toNum(c.powerFactor) || 1;
  // VA = (W) / PF.  Convention: wattEa stored as watts; circuit total VA = count × W / pf
  return cnt * w / pf;
}

export function ownLoadVA(p) {
  return p.circuits.reduce((a, c) => a + circuitVA(c), 0);
}

// Sum of direct children's total (own + their subtree). Cycle-safe.
export function childrenLoadVA(panels, p, visited = new Set()) {
  if (visited.has(p.id)) return 0;
  visited.add(p.id);
  let sum = 0;
  for (const child of getChildren(panels, p.id)) {
    sum += ownLoadVA(child) + childrenLoadVA(panels, child, visited);
  }
  return sum;
}

export function subtreeLoadVA(panels, p) {
  return ownLoadVA(p) + childrenLoadVA(panels, p);
}

// Active power [W] = Σ count × wattEa  (no PF division — wattEa is real watts).
export function ownLoadW(p) {
  return p.circuits.reduce((a, c) => a + ((toNum(c.count) ?? 0) * (toNum(c.wattEa) ?? 0)), 0);
}

export function childrenLoadW(panels, p, visited = new Set()) {
  if (visited.has(p.id)) return 0;
  visited.add(p.id);
  let sum = 0;
  for (const child of getChildren(panels, p.id)) {
    sum += ownLoadW(child) + childrenLoadW(panels, child, visited);
  }
  return sum;
}

export function subtreeLoadW(panels, p) {
  return ownLoadW(p) + childrenLoadW(panels, p);
}

export function getRoots(panels) {
  return panels.filter(p => !pid(p));
}

function phaseTotals(p) {
  if (!isThreePhase(p)) {
    return { single: ownLoadVA(p) };
  }
  const t = { L1: 0, L2: 0, L3: 0 };
  for (const c of p.circuits) {
    const v = circuitVA(c);
    if (c.phaseAssign === "L1") t.L1 += v;
    else if (c.phaseAssign === "L2") t.L2 += v;
    else if (c.phaseAssign === "L3") t.L3 += v;
    else {
      // unassigned → split equally to keep totals balanced
      t.L1 += v / 3; t.L2 += v / 3; t.L3 += v / 3;
    }
  }
  return t;
}

function imbalancePct(phases) {
  if (phases.single != null) return null;
  const vals = [phases.L1, phases.L2, phases.L3];
  const max  = Math.max(...vals);
  const min  = Math.min(...vals);
  const mean = (vals[0] + vals[1] + vals[2]) / 3;
  if (mean <= 0) return 0;
  return ((max - min) / mean) * 100;
}

// ─── List view ────────────────────────────────────────────────────────────
export function renderPanelList(view, state, save) {
  const panels = state.panels ||= [];

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>5. 분전반 부하계산서</h2>
        <div class="actions">
          <button class="btn" id="btn-add-panel">+ 새 분전반</button>
        </div>
      </div>
      <div class="meta" style="margin: 6px 0 12px; color:#6b7280; font-size:12px;">
        ${panels.length === 0
          ? "아직 분전반이 없습니다. 우측 상단 <strong>+ 새 분전반</strong> 으로 추가하세요. 현장마다 분전반 명칭·수량이 다르므로 필요한 만큼만 만드시면 됩니다."
          : `${panels.length}개 분전반 등록됨.`}
      </div>
      ${panels.length > 0 ? `
        <div class="meta" style="margin-bottom:8px;">
          <strong>총부하</strong> = 자체 + 자식. 변압기/발전기로 올라가는 값은 <strong>루트 분전반의 총부하</strong>만 합산해야 자식 중복 집계를 피할 수 있습니다.
        </div>
        <table class="t">
          <thead>
            <tr>
              <th style="width:32px">#</th>
              <th style="width:200px">분전반 명칭</th>
              <th style="width:140px">FROM (상위)</th>
              <th style="width:60px">분류</th>
              <th class="num" style="width:60px">회로</th>
              <th class="num" style="width:110px">자체부하 [VA]</th>
              <th class="num" style="width:110px">자식부하 [VA]</th>
              <th class="num" style="width:120px">총부하 [VA]</th>
              <th class="num" style="width:100px">불평형률</th>
              <th class="actions" style="width:140px"></th>
            </tr>
          </thead>
          <tbody>
            ${panelTreeOrder(panels).map(({ panel: p, depth }, i) => {
              const phases = phaseTotals(p);
              const imb = imbalancePct(phases);
              const ownVA = ownLoadVA(p);
              const chVA  = childrenLoadVA(panels, p);
              const totVA = ownVA + chVA;
              const parent = p.parentPanelId ? panels.find(p2 => p2.id === p.parentPanelId) : null;
              const fromCell = parent
                ? `<a href="#panel/${parent.id}" data-route>${escapeHtml(parent.name)}</a>`
                : (p.fromPanel
                    ? `<em style="color:#92400e;">${escapeHtml(p.fromPanel)}</em>`
                    : `<span style="color:#9ca3af;">(루트)</span>`);
              const isRoot = !p.parentPanelId;
              return `
                <tr data-id="${p.id}" ${isRoot ? '' : 'style="background:#fcfcfd;"'}>
                  <td class="idx">${i + 1}</td>
                  <td>
                    <span style="padding-left:${depth * 18}px; display:inline-block;">
                      ${depth > 0 ? '<span style="color:#9ca3af;">└ </span>' : ''}
                      <a href="#panel/${p.id}" data-route><strong>${escapeHtml(p.name)}</strong></a>
                      <small style="color:#6b7280;">&nbsp;${escapeHtml(p.location || '')}</small>
                    </span>
                  </td>
                  <td>${fromCell}</td>
                  <td>${escapeHtml(p.type)}</td>
                  <td class="num">${p.circuits.length}</td>
                  <td class="num">${fmtInt(ownVA)}</td>
                  <td class="num" style="color:${chVA > 0 ? '#075985' : '#9ca3af'};">${chVA > 0 ? fmtInt(chVA) : '-'}</td>
                  <td class="num"><strong>${fmtInt(totVA)}</strong></td>
                  <td class="num">${imb == null ? "-" : fmt1(imb) + " %"}</td>
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

  view.querySelector("#btn-add-panel").addEventListener("click", () => {
    // 기본 이름으로 즉시 생성 후 편집기로 이동. 편집기 헤더의 "분전반 명칭" 필드에서 바로 수정 가능.
    const defaultName = `신규-분전반-${panels.length + 1}`;
    const p = newPanel(state, { name: defaultName });
    panels.push(p);
    save(state);
    location.hash = `#panel/${p.id}`;
  });

  view.querySelector("tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    const idx = panels.findIndex(p => p.id === id);
    if (idx < 0) return;
    const act = btn.dataset.act;
    if (act === "open") { location.hash = `#panel/${id}`; }
    else if (act === "dup") {
      const copy = JSON.parse(JSON.stringify(panels[idx]));
      copy.id = uuid();
      copy.name = panels[idx].name + " (복사본)";
      panels.splice(idx + 1, 0, copy);
      save(state);
      renderPanelList(view, state, save);
    }
    else if (act === "del") {
      const target = panels[idx];
      const children = getChildren(panels, target.id);
      const childMsg = children.length > 0
        ? `\n자식 분전반 ${children.length}개는 상위(${panels.find(x => x.id === target.parentPanelId)?.name ?? "루트"})로 재배치됩니다.`
        : "";
      if (!confirm(`'${target.name}' 분전반을 삭제할까요? (회로 ${target.circuits.length}개 함께 삭제)${childMsg}`)) return;
      for (const child of children) child.parentPanelId = target.parentPanelId ?? null;
      panels.splice(idx, 1);
      save(state);
      renderPanelList(view, state, save);
    }
  });
}

// ─── Editor view ──────────────────────────────────────────────────────────
export async function renderPanelEditor(view, state, save, id) {
  const panels = state.panels ||= [];
  const p = panels.find(x => x.id === id);
  if (!p) {
    view.innerHTML = `<div class="notice">분전반을 찾을 수 없습니다. <a href="#panels">← 목록으로</a></div>`;
    return;
  }
  // Preload lighting fixtures so symbol auto-fill works without await per row.
  await getTable("lighting_fixtures", state);

  function renderHead() {
    const threePhase = isThreePhase(p);
    const validParents = getValidParents(panels, p.id);
    return `
      <section class="calc-header" style="grid-template-columns: repeat(4, 1fr);">
        <label>분전반 명칭 <input id="p-name"     value="${escapeHtml(p.name)}" /></label>
        <label>분류
          <select id="p-type">${PANEL_TYPES.map(t => `<option ${t === p.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        </label>
        <label>설치위치 <input id="p-location" value="${escapeHtml(p.location)}" /></label>
        <label>상위 분전반 (FROM)
          <select id="p-parent" title="이 분전반의 부하가 어느 분전반으로 올라가는지 선택. '루트'이면 변압기/MCC로 직접 인입.">
            <option value="">(루트 — 변압기/외부 인입)</option>
            ${validParents.map(par => `<option value="${par.id}" ${par.id === p.parentPanelId ? "selected" : ""}>${escapeHtml(par.name)}</option>`).join("")}
          </select>
        </label>

        <label>전압·회로
          <select id="p-phase">
            ${PHASE_OPTIONS.map(o => `<option value="${o.value}" ${o.value === p.phase ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </label>
        <label>전압 [V] <input id="p-voltage" type="number" min="100" step="10" value="${p.voltage}" /></label>
        <label>설치형태
          <select id="p-mount">${MOUNT_TYPES.map(m => `<option ${m === p.mountType ? "selected" : ""}>${m}</option>`).join("")}</select>
        </label>
        <label>분기 VD기준 <input id="p-vd"      type="number" min="0" step="0.001" value="${p.vdLimit}" /></label>

        <label>분기 원거리 [m] <input id="p-bdmax"  type="number" min="0" step="1" value="${p.branchDistanceMax ?? ""}" /></label>
        <label>분기 근거리 [m] <input id="p-bdmin"  type="number" min="0" step="1" value="${p.branchDistanceMin ?? ""}" /></label>
        <label>예상 단락전류 [kA] <input id="p-faulte" type="number" min="0" step="0.1" value="${p.faultExpected ?? ""}" /></label>
        <label>비고 <input id="p-note"    value="${escapeHtml(p.note)}" /></label>

        ${!p.parentPanelId ? `
          <label style="grid-column: 1 / -1;">외부 인입 표기 (선택, 루트일 때만)
            <input id="p-from-external" placeholder="예: MCC-F, 변압기 TR-1" value="${escapeHtml(p.fromPanel ?? "")}" />
          </label>` : ""}

        <fieldset style="grid-column: 1 / -1; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 8px 12px 4px; margin-top: 4px;">
          <legend style="font-size: 11px; color:#475569; padding: 0 6px;">
            인입 케이블 (${p.parentPanelId ? '상위 분전반' : '변압기/MCC'}에서 이 분전반까지)
            — 전압강하 계산서가 누적 VD에 사용
          </legend>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px;">
            <label>케이블 단면적 [㎟] <input id="p-incoming-mm2"   type="number" min="0" step="0.5" value="${p.incomingCableSizeMm2 ?? ""}" /></label>
            <label>케이블 길이 [m]   <input id="p-incoming-len"   type="number" min="0" step="1"   value="${p.incomingCableLengthM ?? ""}" /></label>
            <label>케이블 종류        <input id="p-incoming-type"  value="${escapeHtml(p.incomingCableType ?? "CV")}" /></label>
          </div>
        </fieldset>
      </section>`;
  }

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>
          <a href="#panels" data-route style="font-size:13px; font-weight:400; color:#6b7280;">← 분전반 목록</a>
          &nbsp;/&nbsp; <span id="p-title-name">${escapeHtml(p.name)}</span> 편집
          <small style="font-weight:400; color:#9ca3af;">(아래 '분전반 명칭' 필드에서 직접 수정)</small>
        </h2>
        <div class="actions">
          <button class="btn-danger" id="btn-delete">분전반 삭제</button>
        </div>
      </div>

      <div id="panel-head"></div>

      <h3 class="section-title">회로 목록</h3>
      <table class="t" id="p-circuits">
        <thead>
          <tr>
            <th style="width:42px">NO</th>
            <th style="width:90px">구분</th>
            <th>부하명</th>
            <th style="width:60px">기호</th>
            <th class="num" style="width:60px">수량</th>
            <th class="num" style="width:80px">W/EA</th>
            <th class="num" style="width:90px">역률</th>
            <th class="num" style="width:100px">부하 [VA]</th>
            <th style="width:70px" class="ph-col">상</th>
            <th class="num" style="width:50px">P</th>
            <th class="num" style="width:60px">AF</th>
            <th class="num" style="width:60px">AT</th>
            <th class="num" style="width:70px">㎟</th>
            <th class="num" style="width:60px">길이m</th>
            <th>비고</th>
            <th class="actions"></th>
          </tr>
        </thead>
        <tbody></tbody>
        <tfoot id="p-foot"></tfoot>
      </table>
      <div class="add-row">
        <button class="btn" id="btn-add-circuit">+ 회로 추가</button>
        <button class="btn-secondary" id="btn-add-spare" title="SPARE 회로 1개 추가">+ SPARE</button>
      </div>

      <section class="result">
        <h3>합계</h3>
        <dl class="result-grid">
          <dt>회로 수</dt>            <dd id="p-circuit-count">0</dd>
          <dt>자체 부하 <small>(회로 합)</small></dt>     <dd id="p-own-load">- VA</dd>
          <dt>자식 분전반 부하</dt>    <dd id="p-children-load">- VA</dd>
          <dt>총 부하 <small>(자체+자식, 상위로 인계)</small></dt> <dd id="p-total-load">- VA</dd>
          <dt class="ph-only">L1 / L2 / L3 (자체)</dt>
          <dd id="p-phase-totals" class="ph-only">-</dd>
          <dt class="ph-only">불평형률</dt>
          <dd id="p-imbalance" class="ph-only">-</dd>
        </dl>
      </section>
    </article>
  `;

  view.querySelector("#panel-head").innerHTML = renderHead();
  const tbody = view.querySelector("#p-circuits tbody");
  const foot  = view.querySelector("#p-foot");

  function phaseOptionsHtml(c) {
    if (isThreePhase(p)) {
      const opts = ["L1","L2","L3", ...(isFourWire(p) ? ["N"] : [])];
      return opts.map(o => `<option value="${o}" ${o === c.phaseAssign ? "selected" : ""}>${o}</option>`).join("");
    }
    return `<option value="A" selected>—</option>`;
  }

  function rowHtml(c, i) {
    const va = circuitVA(c);
    return `
      <tr data-i="${i}">
        <td class="idx"><input data-k="no" value="${escapeHtml(c.no ?? "")}" placeholder="${i + 1}" style="width:32px; text-align:center;" /></td>
        <td><select data-k="kind">${LOAD_KINDS.map(o => `<option value="${o.value}" ${o.value === c.kind ? "selected" : ""}>${o.label}</option>`).join("")}</select></td>
        <td><input data-k="name"   value="${escapeHtml(c.name)}" /></td>
        <td><input data-k="symbol" value="${escapeHtml(c.symbol)}" style="text-align:center;" /></td>
        <td class="num"><input data-k="count"        type="number" min="0" step="1"  value="${c.count ?? ""}" /></td>
        <td class="num"><input data-k="wattEa"       type="number" min="0" step="0.1" value="${c.wattEa ?? ""}" /></td>
        <td class="num"><input data-k="powerFactor"  type="number" min="0.1" max="1" step="0.01" value="${c.powerFactor ?? 1}" /></td>
        <td class="num computed" data-cell="va">${fmtInt(va)}</td>
        <td class="ph-col"><select data-k="phaseAssign">${phaseOptionsHtml(c)}</select></td>
        <td class="num"><input data-k="breakerP"      type="number" min="1" max="4" step="1" value="${c.breakerP ?? ""}" /></td>
        <td class="num"><input data-k="breakerAF"     type="number" min="0" step="1" value="${c.breakerAF ?? ""}" /></td>
        <td class="num"><input data-k="breakerAT"     type="number" min="0" step="1" value="${c.breakerAT ?? ""}" /></td>
        <td class="num"><input data-k="cableSizeMm2"  type="number" min="0" step="0.5" value="${c.cableSizeMm2 ?? ""}" /></td>
        <td class="num"><input data-k="cableLengthM"  type="number" min="0" step="1" value="${c.cableLengthM ?? ""}" /></td>
        <td><input data-k="note"   value="${escapeHtml(c.note)}" /></td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>`;
  }

  function renderRows() {
    tbody.innerHTML = p.circuits.map(rowHtml).join("");
    applyPhaseColumnVisibility();
  }

  function applyPhaseColumnVisibility() {
    const show = isThreePhase(p);
    view.querySelectorAll(".ph-col, .ph-only").forEach(el => {
      el.style.display = show ? "" : "none";
    });
  }

  function recalc() {
    p.circuits.forEach((c, i) => {
      const cell = tbody.querySelector(`tr[data-i="${i}"] [data-cell="va"]`);
      if (cell) cell.textContent = fmtInt(circuitVA(c));
    });
    const ownVA  = ownLoadVA(p);
    const childVA = childrenLoadVA(panels, p);
    const totVA  = ownVA + childVA;
    const phases = phaseTotals(p);
    const imb    = imbalancePct(phases);
    view.querySelector("#p-circuit-count").textContent = String(p.circuits.length);
    view.querySelector("#p-own-load").textContent      = fmtInt(ownVA)  + " VA";
    view.querySelector("#p-children-load").textContent = (childVA > 0 ? fmtInt(childVA) + " VA" : "-");
    view.querySelector("#p-total-load").textContent    = fmtInt(totVA)  + " VA";
    if (isThreePhase(p)) {
      view.querySelector("#p-phase-totals").textContent =
        `${fmtInt(phases.L1)} / ${fmtInt(phases.L2)} / ${fmtInt(phases.L3)} VA`;
      view.querySelector("#p-imbalance").textContent = (imb == null ? "-" : fmt1(imb) + " %");
    }

    // Footer row with same column layout as table
    foot.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:right;">자체 합 계</td>
        <td class="num">${fmtInt(ownVA)}</td>
        <td colspan="8"></td>
      </tr>
    `;
  }

  // ── Header bindings (re-render head/footer on phase change) ───────────
  function bindHead() {
    view.querySelector("#p-name").addEventListener("input", (e) => {
      p.name = e.target.value;
      const titleEl = view.querySelector("#p-title-name");
      if (titleEl) titleEl.textContent = e.target.value;
      save(state);
    });
    view.querySelector("#p-type").addEventListener("change", (e) => { p.type = e.target.value; save(state); });
    view.querySelector("#p-location").addEventListener("input", (e) => { p.location = e.target.value; save(state); });
    view.querySelector("#p-parent").addEventListener("change", (e) => {
      const newParentId = e.target.value || null;
      // Defensive: refuse cycle (shouldn't happen since dropdown filters descendants, but double-check)
      if (newParentId && getDescendantIds(panels, p.id).has(newParentId)) {
        alert("순환 참조가 됩니다 (자기 자신의 하위 분전반을 상위로 지정할 수 없습니다).");
        e.target.value = p.parentPanelId ?? "";
        return;
      }
      p.parentPanelId = newParentId;
      if (newParentId) p.fromPanel = "";  // structured parent takes precedence; clear free-text
      save(state);
      renderPanelEditor(view, state, save, id);  // re-render to update summary + external-label visibility
    });
    const extInp = view.querySelector("#p-from-external");
    if (extInp) extInp.addEventListener("input", (e) => { p.fromPanel = e.target.value; save(state); });

    view.querySelector("#p-incoming-mm2").addEventListener("input", (e) => { p.incomingCableSizeMm2 = toNum(e.target.value); save(state); });
    view.querySelector("#p-incoming-len").addEventListener("input", (e) => { p.incomingCableLengthM = toNum(e.target.value); save(state); });
    view.querySelector("#p-incoming-type").addEventListener("input", (e) => { p.incomingCableType = e.target.value; save(state); });
    view.querySelector("#p-phase").addEventListener("change", (e) => {
      p.phase = e.target.value;
      save(state);
      // Re-render rows + visibility because phase column changes
      renderRows();
      recalc();
    });
    view.querySelector("#p-voltage").addEventListener("input", (e) => { p.voltage = toNum(e.target.value) ?? 0; save(state); });
    view.querySelector("#p-mount").addEventListener("change", (e) => { p.mountType = e.target.value; save(state); });
    view.querySelector("#p-vd").addEventListener("input", (e) => { p.vdLimit = toNum(e.target.value); save(state); });
    view.querySelector("#p-bdmax").addEventListener("input", (e) => { p.branchDistanceMax = toNum(e.target.value); save(state); });
    view.querySelector("#p-bdmin").addEventListener("input", (e) => { p.branchDistanceMin = toNum(e.target.value); save(state); });
    view.querySelector("#p-faulte").addEventListener("input", (e) => { p.faultExpected = toNum(e.target.value); save(state); });
    view.querySelector("#p-note").addEventListener("input", (e) => { p.note = e.target.value; save(state); });
  }
  bindHead();

  // ── Circuit row bindings ─────────────────────────────────────────────
  const NUM_FIELDS = new Set(["count", "wattEa", "powerFactor", "breakerP", "breakerAF", "breakerAT", "cableSizeMm2", "cableLengthM"]);
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    if (!k) return;
    const c = p.circuits[i];
    let v = e.target.value;
    if (NUM_FIELDS.has(k)) v = toNum(v);
    c[k] = v;

    // Lighting-fixture auto-fill on symbol change
    if (k === "symbol" && v) {
      const fx = findFixture(state, v);
      if (fx && (toNum(c.wattEa) ?? 0) === 0) {
        c.wattEa = fx.watt ?? 0;
        const wInp = tr.querySelector('[data-k="wattEa"]');
        if (wInp) wInp.value = c.wattEa;
        if (!c.name && fx.label) { c.name = fx.label; tr.querySelector('[data-k="name"]').value = fx.label; }
      }
    }
    save(state);
    recalc();
  });
  tbody.addEventListener("change", (e) => {
    if (e.target.tagName !== "SELECT") return;
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k;
    p.circuits[i][k] = e.target.value;
    save(state);
    recalc();
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr");
    const i = +tr.dataset.i;
    const label = p.circuits[i].name || `회로 ${i + 1}`;
    if (!confirm(`'${label}' 회로를 삭제할까요?`)) return;
    p.circuits.splice(i, 1);
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-add-circuit").addEventListener("click", () => {
    p.circuits.push(newCircuit());
    save(state);
    renderRows();
    recalc();
  });
  view.querySelector("#btn-add-spare").addEventListener("click", () => {
    p.circuits.push({ ...newCircuit(), kind: "SP", name: "SPARE", count: 1, wattEa: 0 });
    save(state);
    renderRows();
    recalc();
  });

  view.querySelector("#btn-delete").addEventListener("click", () => {
    const children = getChildren(panels, p.id);
    const childMsg = children.length > 0
      ? `\n자식 분전반 ${children.length}개(${children.map(c => c.name).join(", ")})는 상위 분전반(${panels.find(x => x.id === p.parentPanelId)?.name ?? "루트"})로 재배치됩니다.`
      : "";
    if (!confirm(`'${p.name}' 분전반을 삭제할까요? (회로 ${p.circuits.length}개 함께 삭제)${childMsg}`)) return;
    // Re-parent children to this panel's parent (preserves tree integrity)
    for (const child of children) child.parentPanelId = p.parentPanelId ?? null;
    const idx = panels.findIndex(x => x.id === id);
    if (idx >= 0) panels.splice(idx, 1);
    save(state);
    location.hash = "#panels";
  });

  renderRows();
  recalc();
}
