// 프로젝트 관리 모달: 목록 표시, 이름 편집, 복제, 삭제, 활성 전환.

import { escapeHtml } from "../lib/format.js";
import { loadIndex, renameProject, duplicateProject, deleteProject, setCurrentProject } from "../storage.js";

/**
 * 관리 모달을 띄움.
 * @param {() => void} onChange  - 인덱스 변경 후 콜백 (목록/현재 갱신)
 */
export function openProjectManager(onChange) {
  let index = loadIndex();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  function render() {
    index = loadIndex();
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width: 780px;">
        <h3 style="margin:0 0 6px;">프로젝트 관리</h3>
        <p class="meta" style="color:#6b7280; font-size:12px; margin: 0 0 10px;">
          ${index.projects.length}개 프로젝트. 한 명이 여러 현장을 동시에 다루실 때 사용하세요.
          데이터는 브라우저 localStorage에 프로젝트별로 분리 저장됩니다.
        </p>
        <table class="t">
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>프로젝트명</th>
              <th style="width:170px">마지막 수정</th>
              <th class="actions" style="width:170px"></th>
            </tr>
          </thead>
          <tbody>
            ${index.projects.map(p => {
              const isActive = p.id === index.currentId;
              const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleString("ko-KR") : "-";
              return `
                <tr data-id="${p.id}" ${isActive ? 'style="background:#eff6ff;"' : ""}>
                  <td>${isActive ? '<span style="font-size:10px; padding:1px 6px; background:#2563eb; color:#fff; border-radius:999px;">현재</span>' : ""}</td>
                  <td><input data-k="name" value="${escapeHtml(p.name)}" /></td>
                  <td><small style="color:#6b7280;">${escapeHtml(updated)}</small></td>
                  <td class="actions">
                    ${isActive
                      ? '<span style="color:#9ca3af; font-size:11px;">현재 작업 중</span>'
                      : '<button class="btn-ghost" data-act="switch" title="이 프로젝트로 전환">전환</button>'}
                    <button class="btn-ghost" data-act="dup"    title="복제">복제</button>
                    <button class="btn-ghost" data-act="delete" title="삭제"
                            ${index.projects.length <= 1 ? "disabled" : ""}>✕</button>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
        ${index.projects.length <= 1
          ? '<small style="color:#9a3412;">※ 마지막 프로젝트는 삭제할 수 없습니다.</small>'
          : ""}
        <div class="modal-actions">
          <button class="btn-secondary" id="pm-close">닫기</button>
        </div>
      </div>
    `;

    // 이름 입력 즉시 저장
    backdrop.querySelectorAll("tbody input").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.id;
        const p  = index.projects.find(x => x.id === id);
        if (!p) return;
        renameProject(id, e.target.value);
        p.name = e.target.value;   // 로컬 캐시 갱신
      });
    });

    // 액션 버튼
    backdrop.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.id;
        const act = e.target.dataset.act;
        if (act === "switch") {
          setCurrentProject(id);
          render();
          onChange && onChange();
        } else if (act === "dup") {
          duplicateProject(id);
          render();
          onChange && onChange();
        } else if (act === "delete") {
          const p = index.projects.find(x => x.id === id);
          if (!confirm(`'${p.name}' 프로젝트를 삭제할까요? 모든 데이터가 사라집니다.`)) return;
          deleteProject(id);
          render();
          onChange && onChange();
        }
      });
    });

    backdrop.querySelector("#pm-close").addEventListener("click", () => {
      cleanup();
    });
  }

  function cleanup() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  }
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cleanup(); });

  document.body.appendChild(backdrop);
  render();
}

/**
 * 새 프로젝트 만들기 모달 — 이름 입력 후 생성.
 * @param {(name) => void} onCreate
 */
export function openNewProjectDialog(onCreate) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width: 480px;">
      <h3 style="margin:0 0 6px;">새 프로젝트</h3>
      <p class="meta" style="color:#6b7280; font-size:12px; margin: 0 0 12px;">
        프로젝트명을 입력하세요. 추후 관리에서 변경 가능합니다.
      </p>
      <div style="display:grid; grid-template-columns: 90px 1fr; gap: 8px 12px; align-items:center;">
        <label for="np-name">프로젝트명</label>
        <input id="np-name" placeholder="프로젝트 이름" />
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="np-cancel">취소</button>
        <button class="btn" id="np-create">만들기</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const cleanup = () => { document.removeEventListener("keydown", onKey); backdrop.remove(); };
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cleanup(); });

  const nameInp = backdrop.querySelector("#np-name");
  nameInp.focus();
  backdrop.querySelector("#np-cancel").addEventListener("click", cleanup);
  backdrop.querySelector("#np-create").addEventListener("click", () => {
    const name = nameInp.value.trim() || "신규 프로젝트";
    cleanup();
    onCreate(name);
  });
  nameInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") backdrop.querySelector("#np-create").click();
  });
}
