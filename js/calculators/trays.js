// Chapter 6: 케이블 트레이 계산서 (MVP)
//
// Tray CRUD + cable inventory + fill-ratio check.
//
// 계산:
//   각 케이블 단면적 = π × (외경/2)² × 수량 [mm²]
//   총 단면적 = Σ 각 케이블 단면적
//   트레이 단면적 = 폭 × 깊이 [mm²]
//   적재율 = 총 단면적 / 트레이 단면적 × 100
//
// KEC 232.41.5: 케이블 트레이 적재율 일반적 한계 50% (단심 다발), 다심 100%.
// 기본값 50% 사용, 사용자가 한계 조정 가능.
//
// Routes:
//   #trays         → 트레이 목록
//   #tray/<id>     → 트레이 편집기

import { fmt1, fmt2, fmtInt, toNum, escapeHtml } from "../lib/format.js";

const TRAY_TYPE_OPTIONS = ["수직 (수직 사다리)", "수평 (수평 사다리)", "사다리형", "메쉬형", "덕트형"];
const CABLE_TYPE_OPTIONS = ["FCV", "FR8", "F-CV", "CV", "VCT", "CVV", "기타"];
const CATEGORY_OPTIONS = ["PNL", "동력", "조명", "통신", "비상", "접지", "기타"];

// KS 표준 케이블 트레이 폭 [mm]
const STANDARD_WIDTHS = [100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200];

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "tr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function newTray(state, overrides = {}) {
  return {
    id: uuid(),
    name: overrides.name || "신규 트레이",
    type: overrides.type || "수평 (수평 사다리)",
    location: "",
    widthMm: 400,
    depthMm: 100,
    fillLimitPct: 50,     // 적재율 한계 [%]
    note: "",
    cables: [],
    ...overrides,
  };
}

function newCable() {
  return {
    category: "PNL",
    from: "",
    to: "",
    cableType: "FCV",
    sizeMm2: 25,
    cores: 4,
    count: 1,
    outerDiaMm: 0,
    note: "",
  };
}

function cableArea(c) {
  const d = toNum(c.outerDiaMm) || 0;
  const cnt = toNum(c.count) || 0;
  return Math.PI * (d / 2) ** 2 * cnt;
}

function cableDiaSum(c) {
  const d = toNum(c.outerDiaMm) || 0;
  const cnt = toNum(c.count) || 0;
  return d * cnt;
}

function trayArea(t) {
  return (toNum(t.widthMm) || 0) * (toNum(t.depthMm) || 0);
}

function trayTotalArea(t) {
  return t.cables.reduce((a, c) => a + cableArea(c), 0);
}

function trayFillPct(t) {
  const area = trayArea(t);
  if (area <= 0) return 0;
  return (trayTotalArea(t) / area) * 100;
}

function suggestWidth(t) {
  const need = trayTotalArea(t);
  const depth = toNum(t.depthMm) || 100;
  const limit = (toNum(t.fillLimitPct) || 50) / 100;
  const current = toNum(t.widthMm) || 0;
  if (need <= 0 || depth <= 0) return null;
  // 현재 폭이 적재율 한계를 만족하면 권장 없음
  if (current > 0 && need <= (current * depth * limit)) return null;
  // 한계 초과 → 더 큰 표준 폭 탐색
  const targetWidth = need / (depth * limit);
  for (const w of STANDARD_WIDTHS) {
    if (w >= targetWidth && w > current) return w;
  }
  return null;
}

function fillVerdict(pct, limit) {
  if (pct == null || isNaN(pct)) return { cls: "missing", label: "-" };
  if (pct >= limit)         return { cls: "fail", label: `초과 (>${fmt1(limit)}%)` };
  if (pct > limit * 0.85)   return { cls: "warn", label: "주의" };
  return { cls: "ok", label: "적정" };
}

// ─── List view ────────────────────────────────────────────────────────────
export function renderTrayList(view, state, save) {
  const trays = state.trays ||= [];

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>6. 케이블 트레이 계산서</h2>
        <div class="actions">
          <button class="btn" id="btn-add-tray">+ 새 트레이</button>
        </div>
      </div>
      <div class="meta" style="margin: 6px 0 12px; color:#6b7280; font-size:12px;">
        ${trays.length === 0
          ? "아직 트레이가 없습니다. <strong>+ 새 트레이</strong>로 추가하세요. 각 트레이에 케이블 목록을 입력하면 적재율과 권장 폭이 자동 산정됩니다."
          : `${trays.length}개 트레이 등록됨. 적재율 한계는 KEC 232.41.5 기준 50% 권장.`}
      </div>
      ${trays.length > 0 ? `
        <table class="t">
          <thead>
            <tr>
              <th style="width:32px">#</th>
              <th style="width:170px">트레이 명칭</th>
              <th style="width:160px">종류</th>
              <th>위치</th>
              <th class="num" style="width:90px">폭 × 깊이 [mm]</th>
              <th class="num" style="width:80px">케이블 수</th>
              <th class="num" style="width:120px">총 단면적 [㎟]</th>
              <th class="num" style="width:100px">적재율</th>
              <th class="num" style="width:80px">한계</th>
              <th style="width:120px">판정</th>
              <th class="actions" style="width:140px"></th>
            </tr>
          </thead>
          <tbody>
            ${trays.map((t, i) => {
              const fill = trayFillPct(t);
              const v = fillVerdict(fill, toNum(t.fillLimitPct) || 50);
              const cableCount = t.cables.reduce((a, c) => a + (toNum(c.count) || 0), 0);
              return `
                <tr data-id="${t.id}" class="vd-${v.cls}">
                  <td class="idx">${i + 1}</td>
                  <td><a href="#tray/${t.id}" data-route><strong>${escapeHtml(t.name)}</strong></a></td>
                  <td>${escapeHtml(t.type)}</td>
                  <td>${escapeHtml(t.location || "-")}</td>
                  <td class="num">${t.widthMm} × ${t.depthMm}</td>
                  <td class="num">${cableCount}</td>
                  <td class="num">${fmtInt(trayTotalArea(t))}</td>
                  <td class="num"><strong>${fmt1(fill)} %</strong></td>
                  <td class="num">${fmt1(toNum(t.fillLimitPct) || 50)} %</td>
                  <td class="verdict-${v.cls}">${escapeHtml(v.label)}</td>
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

  view.querySelector("#btn-add-tray").addEventListener("click", () => {
    const t = newTray(state, { name: `트레이-${trays.length + 1}` });
    trays.push(t);
    save(state);
    location.hash = `#tray/${t.id}`;
  });

  view.querySelector("tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const id = btn.closest("tr").dataset.id;
    const idx = trays.findIndex(t => t.id === id); if (idx < 0) return;
    const act = btn.dataset.act;
    if (act === "open") location.hash = `#tray/${id}`;
    else if (act === "dup") {
      const copy = JSON.parse(JSON.stringify(trays[idx]));
      copy.id = uuid();
      copy.name = trays[idx].name + " (복사본)";
      trays.splice(idx + 1, 0, copy);
      save(state);
      renderTrayList(view, state, save);
    } else if (act === "del") {
      if (!confirm(`'${trays[idx].name}' 트레이를 삭제할까요? (케이블 ${trays[idx].cables.length}개 함께 삭제)`)) return;
      trays.splice(idx, 1);
      save(state);
      renderTrayList(view, state, save);
    }
  });
}

// ─── Editor view ──────────────────────────────────────────────────────────
export function renderTrayEditor(view, state, save, id) {
  const trays = state.trays ||= [];
  const t = trays.find(x => x.id === id);
  if (!t) {
    view.innerHTML = `<div class="notice">트레이를 찾을 수 없습니다. <a href="#trays">← 목록으로</a></div>`;
    return;
  }

  view.innerHTML = `
    <article class="calc">
      <div class="calc-title">
        <h2>
          <a href="#trays" data-route style="font-size:13px; font-weight:400; color:#6b7280;">← 트레이 목록</a>
          &nbsp;/&nbsp; <span id="t-title-name">${escapeHtml(t.name)}</span> 편집
        </h2>
        <div class="actions">
          <button class="btn-danger" id="btn-tray-delete">트레이 삭제</button>
        </div>
      </div>

      <section class="calc-header" style="grid-template-columns: repeat(4, 1fr);">
        <label>트레이 명칭 <input id="t-name" value="${escapeHtml(t.name)}" /></label>
        <label>종류
          <select id="t-type">${TRAY_TYPE_OPTIONS.map(o => `<option ${o === t.type ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>
        </label>
        <label>설치위치 <input id="t-location" value="${escapeHtml(t.location)}" /></label>
        <label>비고 <input id="t-note" value="${escapeHtml(t.note)}" /></label>
        <label>폭 [mm] <input id="t-width" type="number" min="50" step="50" value="${t.widthMm}" /></label>
        <label>깊이 [mm] <input id="t-depth" type="number" min="50" step="10" value="${t.depthMm}" /></label>
        <label>적재율 한계 [%] <input id="t-fill-limit" type="number" min="10" max="100" step="1" value="${t.fillLimitPct}" /></label>
        <label>표준 폭 옵션
          <select id="t-std-width">
            <option value="">(선택)</option>
            ${STANDARD_WIDTHS.map(w => `<option value="${w}">${w} mm</option>`).join("")}
          </select>
        </label>
      </section>

      <h3 class="section-title">케이블 목록</h3>
      <table class="t" id="t-cables">
        <thead>
          <tr>
            <th style="width:36px">NO</th>
            <th style="width:80px">구분</th>
            <th style="width:100px">FROM</th>
            <th style="width:100px">TO</th>
            <th style="width:80px">종류</th>
            <th class="num" style="width:70px">굵기 [㎟]</th>
            <th class="num" style="width:60px">심선수</th>
            <th class="num" style="width:60px">수량</th>
            <th class="num" style="width:80px">외경 [mm]</th>
            <th class="num" style="width:90px">단면적 [㎟]</th>
            <th>비고</th>
            <th class="actions"></th>
          </tr>
        </thead>
        <tbody></tbody>
        <tfoot id="t-foot"></tfoot>
      </table>
      <div class="add-row">
        <button class="btn" id="btn-add-cable">+ 케이블 추가</button>
      </div>

      <section class="result">
        <h3>적재율 산정</h3>
        <dl class="result-grid" style="grid-template-columns: repeat(5, 1fr);">
          <dt>트레이 단면적</dt>     <dd id="t-area">- ㎟</dd>
          <dt>총 케이블 단면적</dt>  <dd id="t-cable-area">- ㎟</dd>
          <dt>적재율</dt>            <dd id="t-fill"><strong>- %</strong></dd>
          <dt>판정</dt>              <dd id="t-verdict">-</dd>
          <dt>권장 폭</dt>           <dd id="t-suggest">-</dd>
        </dl>
      </section>
    </article>
  `;

  const tbody = view.querySelector("#t-cables tbody");
  const foot  = view.querySelector("#t-foot");

  function rowHtml(c, i) {
    const area = cableArea(c);
    return `
      <tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td><select data-k="category">${CATEGORY_OPTIONS.map(o => `<option ${o === c.category ? "selected" : ""}>${o}</option>`).join("")}</select></td>
        <td><input data-k="from" value="${escapeHtml(c.from)}" /></td>
        <td><input data-k="to"   value="${escapeHtml(c.to)}" /></td>
        <td><select data-k="cableType">${CABLE_TYPE_OPTIONS.map(o => `<option ${o === c.cableType ? "selected" : ""}>${o}</option>`).join("")}</select></td>
        <td class="num"><input data-k="sizeMm2"    type="number" min="0" step="0.5" value="${c.sizeMm2 ?? ""}" /></td>
        <td class="num"><input data-k="cores"      type="number" min="1" step="1" value="${c.cores ?? ""}" /></td>
        <td class="num"><input data-k="count"      type="number" min="1" step="1" value="${c.count ?? ""}" /></td>
        <td class="num"><input data-k="outerDiaMm" type="number" min="0" step="0.1" value="${c.outerDiaMm ?? ""}" /></td>
        <td class="num computed" data-cell="area">${fmtInt(area)}</td>
        <td><input data-k="note" value="${escapeHtml(c.note)}" /></td>
        <td class="actions"><button class="btn-ghost" data-act="del" title="삭제">✕</button></td>
      </tr>`;
  }

  function renderRows() {
    tbody.innerHTML = t.cables.map(rowHtml).join("");
  }

  function recalc() {
    t.cables.forEach((c, i) => {
      const cell = tbody.querySelector(`tr[data-i="${i}"] [data-cell="area"]`);
      if (cell) cell.textContent = fmtInt(cableArea(c));
    });
    const tArea  = trayArea(t);
    const cArea  = trayTotalArea(t);
    const fill   = trayFillPct(t);
    const limit  = toNum(t.fillLimitPct) || 50;
    const v      = fillVerdict(fill, limit);
    const sug    = suggestWidth(t);

    view.querySelector("#t-area").textContent       = fmtInt(tArea) + " ㎟";
    view.querySelector("#t-cable-area").textContent = fmtInt(cArea) + " ㎟";
    const fillEl = view.querySelector("#t-fill");
    fillEl.innerHTML = `<strong class="verdict-${v.cls}">${fmt1(fill)} %</strong> &nbsp;<small style="color:#9ca3af;">/ ${fmt1(limit)} %</small>`;
    const verdictEl = view.querySelector("#t-verdict");
    verdictEl.className = `verdict-${v.cls}`;
    verdictEl.textContent = v.label;
    view.querySelector("#t-suggest").textContent = sug ? `${sug} mm` : "-";

    foot.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:right;">총 단면적</td>
        <td class="num">${fmtInt(cArea)}</td>
        <td colspan="2"></td>
      </tr>
    `;
  }

  // ── Header bindings ──
  view.querySelector("#t-name").addEventListener("input", (e) => {
    t.name = e.target.value;
    const titleEl = view.querySelector("#t-title-name");
    if (titleEl) titleEl.textContent = e.target.value;
    save(state);
  });
  view.querySelector("#t-type").addEventListener("change", (e) => { t.type = e.target.value; save(state); });
  view.querySelector("#t-location").addEventListener("input", (e) => { t.location = e.target.value; save(state); });
  view.querySelector("#t-note").addEventListener("input", (e) => { t.note = e.target.value; save(state); });
  view.querySelector("#t-width").addEventListener("input", (e) => { t.widthMm = toNum(e.target.value); save(state); recalc(); });
  view.querySelector("#t-depth").addEventListener("input", (e) => { t.depthMm = toNum(e.target.value); save(state); recalc(); });
  view.querySelector("#t-fill-limit").addEventListener("input", (e) => { t.fillLimitPct = toNum(e.target.value); save(state); recalc(); });
  view.querySelector("#t-std-width").addEventListener("change", (e) => {
    const w = toNum(e.target.value);
    if (w) {
      t.widthMm = w;
      view.querySelector("#t-width").value = w;
      save(state); recalc();
    }
    e.target.value = "";
  });

  // ── Cable row bindings ──
  const NUM_FIELDS = new Set(["sizeMm2", "cores", "count", "outerDiaMm"]);
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    const k = e.target.dataset.k; if (!k) return;
    let v = e.target.value;
    if (NUM_FIELDS.has(k)) v = toNum(v);
    t.cables[i][k] = v;
    save(state); recalc();
  });
  tbody.addEventListener("change", (e) => {
    if (e.target.tagName !== "SELECT") return;
    const tr = e.target.closest("tr"); if (!tr) return;
    const i = +tr.dataset.i;
    t.cables[i][e.target.dataset.k] = e.target.value;
    save(state); recalc();
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act='del']"); if (!btn) return;
    const tr = e.target.closest("tr"); const i = +tr.dataset.i;
    const label = (t.cables[i].from || "") + "→" + (t.cables[i].to || "") || `${i + 1}번 행`;
    if (!confirm(`케이블 '${label}' 삭제할까요?`)) return;
    t.cables.splice(i, 1);
    save(state); renderRows(); recalc();
  });

  view.querySelector("#btn-add-cable").addEventListener("click", () => {
    t.cables.push(newCable());
    save(state); renderRows(); recalc();
  });

  view.querySelector("#btn-tray-delete").addEventListener("click", () => {
    if (!confirm(`'${t.name}' 트레이를 삭제할까요?`)) return;
    const idx = trays.findIndex(x => x.id === id);
    if (idx >= 0) trays.splice(idx, 1);
    save(state);
    location.hash = "#trays";
  });

  renderRows();
  recalc();
}
