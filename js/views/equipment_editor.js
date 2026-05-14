// 장비일람 의미 기반 편집기 — 섹션(부하종류) 그룹화 + 항목별 9컬럼.
//
// 원본 raw 2D를 의미 있는 구조로 파싱·편집·재저장. raw 2D는 호환성용으로 유지.
// 컬럼: 장비번호 / 명칭 / 상 / 전원[V] / 동력[kW] / 수량 / 예비 / 시설용량[kW] / 환산부하[VA]

import { fmtInt, toNum, escapeHtml } from "../lib/format.js";
import { getTable, resetTable } from "../lib/tables.js";

const HEADER_ROWS = 3;   // 원본 raw 0~2는 헤더, 데이터는 row index 3부터

// 섹션 헤더 판단 휴리스틱.
// "펌프 류", "환기휀 류", "공조류" 같이 한글이 포함된 단독 셀은 섹션.
// "F-4", "P-1", "BP-2" 같은 장비번호 패턴(영문대문자+숫자 조합)은 섹션 아님 (불완전 항목).
function isLikelySection(rowFirstCell) {
  const s = String(rowFirstCell ?? "").trim();
  if (!s) return false;
  // 장비번호 패턴: 영문 + 숫자 (예: P-1, FP-1, BP-1, F-4, EV-1 등)
  if (/^[A-Za-z]+-?\d+/.test(s)) return false;
  // 한글 포함이면 섹션 후보
  if (/[ㄱ-힝]/.test(s)) return true;
  return false;
}

// raw 2D → 섹션·항목 구조 파싱
function parseSections(raw) {
  const sections = [];
  let current = null;

  for (let i = HEADER_ROWS; i < raw.length; i++) {
    const row = raw[i];
    if (!row) continue;
    const nonEmpty = row.filter(c => c != null && c !== "").length;
    if (nonEmpty === 0) continue;

    // 섹션 헤더: 첫 컬럼만 값 + 한글 패턴
    const isSection = nonEmpty === 1 && isLikelySection(row[0]);

    if (isSection) {
      current = { name: String(row[0]).trim(), items: [] };
      sections.push(current);
    } else {
      const item = {
        equipNo:     row[0] ?? "",
        name:        row[1] ?? "",
        phase:       row[2] ?? "",
        voltage:     row[3] ?? "",
        powerKw:     row[4] ?? null,
        count:       row[5] ?? null,
        spare:       row[6] ?? null,
        installedKw: row[7] ?? null,
        convertedVA: row[8] ?? null,
      };
      if (!current) {
        current = { name: "기타", items: [] };
        sections.push(current);
      }
      current.items.push(item);
    }
  }
  return sections;
}

// 섹션·항목 구조 → raw 2D 재구성 (헤더 행 보존)
function rebuildRaw(sections, originalRaw) {
  const colCount = Math.max(originalRaw[0]?.length ?? 0, 10);
  const newRaw = [];
  for (let i = 0; i < HEADER_ROWS; i++) {
    newRaw.push(originalRaw[i] ? [...originalRaw[i]] : new Array(colCount).fill(null));
  }
  for (const section of sections) {
    const secRow = new Array(colCount).fill(null);
    secRow[0] = section.name;
    newRaw.push(secRow);
    for (const it of section.items) {
      const row = new Array(colCount).fill(null);
      row[0] = it.equipNo || null;
      row[1] = it.name || null;
      row[2] = it.phase || null;
      row[3] = it.voltage || null;
      row[4] = toNum(it.powerKw);
      row[5] = toNum(it.count);
      row[6] = toNum(it.spare);
      row[7] = toNum(it.installedKw);
      row[8] = toNum(it.convertedVA);
      newRaw.push(row);
    }
  }
  return newRaw;
}

function newItem() {
  return {
    equipNo: "", name: "", phase: 3, voltage: 380,
    powerKw: 0, count: 1, spare: 0, installedKw: 0, convertedVA: 0,
  };
}

export async function renderEquipmentEditor(view, state, save) {
  const table = await getTable("equipment_list", state);
  let sections = parseSections(table.raw);
  // 비어있는 상태면 기본 섹션 하나
  if (sections.length === 0) sections = [{ name: "기타", items: [] }];

  function persist() {
    table.raw = rebuildRaw(sections, table.raw);
    table.dimensions = table.dimensions || {};
    table.dimensions.data_rows = sections.reduce((a, s) => a + s.items.length, 0);
    save(state);
  }

  function totalsBySection() {
    return sections.map(sec => ({
      name: sec.name,
      count: sec.items.length,
      kwSum: sec.items.reduce((a, it) => a + (toNum(it.powerKw) ?? 0) * (toNum(it.count) ?? 0), 0),
      vaSum: sec.items.reduce((a, it) => a + (toNum(it.convertedVA) ?? 0), 0),
    }));
  }

  function render() {
    const totals = totalsBySection();
    const grandKw  = totals.reduce((a, t) => a + t.kwSum, 0);
    const grandVa  = totals.reduce((a, t) => a + t.vaSum, 0);
    const grandCnt = totals.reduce((a, t) => a + t.count, 0);

    view.innerHTML = `
      <article class="calc table-view">
        <div class="calc-title">
          <h2>장비일람</h2>
          <div class="actions">
            <button class="btn" id="btn-add-section">+ 섹션 추가</button>
            <button class="btn-danger" id="btn-reset">기본값으로 초기화</button>
          </div>
        </div>
        <div class="meta">
          발전기·MCC 계산서에서 참조하는 장비 목록. 부하 종류(섹션)로 그룹화합니다.
          섹션명·항목 모두 자유롭게 추가/수정/삭제 가능.
        </div>

        <section class="result" style="margin-top: 10px; margin-bottom: 14px;">
          <dl class="result-grid" style="grid-template-columns: repeat(4, 1fr);">
            <dt>섹션 수</dt>      <dd>${sections.length}</dd>
            <dt>총 장비 수</dt>   <dd>${grandCnt}</dd>
            <dt>총 동력 합</dt>   <dd>${fmtInt(grandKw)} kW</dd>
            <dt>총 환산부하</dt>  <dd>${fmtInt(grandVa)} VA</dd>
          </dl>
        </section>

        ${sections.map((sec, si) => `
          <section class="equip-section" data-si="${si}">
            <div class="equip-section-head">
              <input class="equip-section-name" data-si="${si}" value="${escapeHtml(sec.name)}" placeholder="섹션명 (예: 펌프류)" />
              <span class="equip-section-stats">
                ${sec.items.length}개 · ${fmtInt(totals[si].kwSum)} kW · ${fmtInt(totals[si].vaSum)} VA
              </span>
              <div class="equip-section-actions">
                <button class="btn-ghost" data-act="add-item" data-si="${si}">+ 장비</button>
                <button class="btn-ghost" data-act="del-section" data-si="${si}" title="섹션 + 항목 모두 삭제">✕ 섹션</button>
              </div>
            </div>
            ${sec.items.length === 0 ? `
              <div class="meta" style="padding: 8px 12px; color:#9ca3af; font-style: italic;">
                항목 없음. 우측 "+ 장비" 로 추가하세요.
              </div>
            ` : `
              <table class="t">
                <thead>
                  <tr>
                    <th style="width:36px">NO</th>
                    <th style="width:90px">장비번호</th>
                    <th>명칭</th>
                    <th class="num" style="width:50px">상</th>
                    <th class="num" style="width:70px">전원[V]</th>
                    <th class="num" style="width:90px">동력[kW]</th>
                    <th class="num" style="width:60px">수량</th>
                    <th class="num" style="width:60px">예비</th>
                    <th class="num" style="width:100px">시설용량[kW]</th>
                    <th class="num" style="width:110px">환산부하[VA]</th>
                    <th class="actions"></th>
                  </tr>
                </thead>
                <tbody>
                  ${sec.items.map((it, ii) => `
                    <tr data-si="${si}" data-ii="${ii}">
                      <td class="idx">${ii + 1}</td>
                      <td><input data-k="equipNo" value="${escapeHtml(it.equipNo)}" /></td>
                      <td><input data-k="name" value="${escapeHtml(it.name)}" /></td>
                      <td class="num"><input data-k="phase" type="number" min="1" max="3" value="${it.phase ?? ""}" /></td>
                      <td class="num"><input data-k="voltage" type="number" min="0" value="${it.voltage ?? ""}" /></td>
                      <td class="num"><input data-k="powerKw" type="number" min="0" step="0.1" value="${it.powerKw ?? ""}" /></td>
                      <td class="num"><input data-k="count" type="number" min="0" step="1" value="${it.count ?? ""}" /></td>
                      <td class="num"><input data-k="spare" type="number" min="0" step="1" value="${it.spare ?? ""}" /></td>
                      <td class="num"><input data-k="installedKw" type="number" min="0" step="0.1" value="${it.installedKw ?? ""}" /></td>
                      <td class="num"><input data-k="convertedVA" type="number" min="0" step="1" value="${it.convertedVA ?? ""}" /></td>
                      <td class="actions"><button class="btn-ghost" data-act="del-item" data-si="${si}" data-ii="${ii}">✕</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `}
          </section>
        `).join("")}

        <div class="add-row" style="margin-top:14px;">
          <button class="btn" id="btn-add-section-bottom">+ 섹션 추가</button>
        </div>
      </article>
    `;

    // 항목 셀 입력
    view.querySelectorAll("tr[data-si] input[data-k]").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const tr = e.target.closest("tr");
        const si = +tr.dataset.si;
        const ii = +tr.dataset.ii;
        const k = e.target.dataset.k;
        const numFields = new Set(["phase", "voltage", "powerKw", "count", "spare", "installedKw", "convertedVA"]);
        sections[si].items[ii][k] = numFields.has(k) ? toNum(e.target.value) : e.target.value;
        persist();
      });
    });
    // 섹션명 변경 (이름만 바꿔서 stats 업데이트 안 해도 됨)
    view.querySelectorAll(".equip-section-name").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const si = +e.target.dataset.si;
        sections[si].name = e.target.value;
        persist();
      });
    });
    // 액션 버튼
    view.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const act = e.target.dataset.act;
        const si = +e.target.dataset.si;
        const ii = e.target.dataset.ii != null ? +e.target.dataset.ii : null;
        if (act === "add-item") {
          sections[si].items.push(newItem());
          persist();
          render();
        } else if (act === "del-item") {
          sections[si].items.splice(ii, 1);
          persist();
          render();
        } else if (act === "del-section") {
          if (!confirm(`'${sections[si].name}' 섹션과 그 안의 장비 ${sections[si].items.length}개를 삭제할까요?`)) return;
          sections.splice(si, 1);
          if (sections.length === 0) sections.push({ name: "기타", items: [] });
          persist();
          render();
        }
      });
    });
    // 섹션 추가 버튼
    const addSection = () => {
      sections.push({ name: "새 섹션", items: [] });
      persist();
      render();
    };
    view.querySelector("#btn-add-section").addEventListener("click", addSection);
    view.querySelector("#btn-add-section-bottom").addEventListener("click", addSection);
    // 초기화
    view.querySelector("#btn-reset").addEventListener("click", async () => {
      if (!confirm("장비일람을 기본값(원본 엑셀)으로 되돌릴까요? 편집 내용이 사라집니다.")) return;
      await resetTable("equipment_list", state);
      save(state);
      sections = parseSections(state.tables.equipment_list.raw);
      if (sections.length === 0) sections = [{ name: "기타", items: [] }];
      render();
    });
  }

  render();
}
