// Bootstrap + hash router + 다중 프로젝트 라이프사이클.
import {
  loadIndex, loadProject, saveProject, createProject,
  exportToFile, importFromFile, importAsNewProject, setCurrentProject,
  createInitialState,
} from "./storage.js";
import { renderTransformer } from "./calculators/transformer.js";
import { renderGenerator }   from "./calculators/generator.js";
import { renderPanelList, renderPanelEditor } from "./calculators/panels.js";
import { renderMccList,   renderMccEditor }   from "./calculators/mcc.js";
import { renderTrayList,  renderTrayEditor }  from "./calculators/trays.js";
import { renderVoltageDrop } from "./calculators/voltage_drop.js";
import { renderLightingEditor } from "./views/lighting_editor.js";
import { renderGenericEditor } from "./views/generic_editor.js";
import { renderDesignConditions } from "./views/design_conditions.js";
import { openProjectManager, openNewProjectDialog } from "./views/project_manager.js";

// 현재 활성 프로젝트의 상태. 프로젝트 전환 시 통째로 교체됨.
let currentProjectId = null;
let state = null;

const view = document.getElementById("view");

function persist() {
  if (!currentProjectId || !state) return;
  saveProject(currentProjectId, state);
  refreshStorageInfo();
}

function refreshStorageInfo() {
  const el = document.getElementById("storage-info");
  if (!el) return;
  const updated = state?.updatedAt ? new Date(state.updatedAt) : null;
  el.textContent = updated
    ? `저장됨: ${updated.toLocaleString("ko-KR")}`
    : "저장됨: -";
}

function refreshProjectSwitcher() {
  const index = loadIndex();
  const sel = document.getElementById("project-switcher");
  if (!sel) return;
  sel.innerHTML = index.projects.map(p => {
    return `<option value="${p.id}" ${p.id === index.currentId ? "selected" : ""}>${escapeOption(p.name)}</option>`;
  }).join("");
}

function escapeOption(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** 현재 활성 프로젝트를 로드 → state 교체 → 현재 뷰 재렌더 */
function switchToCurrentProject(rerouteAfter = true) {
  const index = loadIndex();
  currentProjectId = index.currentId;
  state = loadProject(currentProjectId);
  refreshProjectSwitcher();
  refreshStorageInfo();
  if (rerouteAfter) route();
}

async function route() {
  const hash = location.hash.slice(1) || "transformer";
  try {
    if (hash === "transformer") {
      await renderTransformer(view, state, persist);
    } else if (hash === "generator") {
      await renderGenerator(view, state, persist);
    } else if (hash === "voltage-drop") {
      renderVoltageDrop(view, state, persist);
    } else if (hash === "panels") {
      renderPanelList(view, state, persist);
    } else if (hash.startsWith("panel/")) {
      const id = hash.slice("panel/".length);
      await renderPanelEditor(view, state, persist, id);
    } else if (hash === "mcc") {
      renderMccList(view, state, persist);
    } else if (hash.startsWith("mcc/")) {
      const id = hash.slice("mcc/".length);
      renderMccEditor(view, state, persist, id);
    } else if (hash === "trays") {
      renderTrayList(view, state, persist);
    } else if (hash.startsWith("tray/")) {
      const id = hash.slice("tray/".length);
      renderTrayEditor(view, state, persist, id);
    } else if (hash.startsWith("tables/")) {
      const slug = hash.slice("tables/".length);
      if (slug === "lighting_fixtures") {
        await renderLightingEditor(view, state, persist);
      } else if (slug === "design_conditions") {
        await renderDesignConditions(view, state, persist);
      } else {
        await renderGenericEditor(view, state, persist, slug);
      }
    } else {
      view.innerHTML = `<div class="notice">알 수 없는 경로: ${hash}</div>`;
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="notice"><strong>오류:</strong> ${err.message}<br>
      <small>로컬 파일 시스템에서 직접 열면 JSON 로드가 실패합니다. <code>py -m http.server 8000</code> 으로 실행해주세요.</small></div>`;
  }
  // active nav highlight
  document.querySelectorAll(".nav-list a[data-route]").forEach((a) => {
    const href = a.getAttribute("href").slice(1);
    const match = href === hash
      || (href === "panels" && hash.startsWith("panel/"))
      || (href === "mcc"    && hash.startsWith("mcc/"))
      || (href === "trays"  && hash.startsWith("tray/"))
      || (href === "voltage-drop" && hash === "voltage-drop");
    a.classList.toggle("active", match);
  });
  refreshStorageInfo();
}

function bindGlobals() {
  // 프로젝트 전환 드롭다운
  document.getElementById("project-switcher").addEventListener("change", (e) => {
    setCurrentProject(e.target.value);
    switchToCurrentProject(true);
  });

  // + 새 프로젝트
  document.getElementById("btn-project-new").addEventListener("click", () => {
    openNewProjectDialog((name) => {
      createProject(name);
      switchToCurrentProject(true);
    });
  });

  // 관리 모달
  document.getElementById("btn-project-manage").addEventListener("click", () => {
    openProjectManager(() => {
      // 인덱스 바뀜 — 현재 프로젝트 다시 로드
      switchToCurrentProject(true);
    });
  });

  // 내보내기
  document.getElementById("btn-export").addEventListener("click", () => {
    exportToFile(state, state.projectName);
  });

  // 인쇄
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  // 불러오기 — 파일 선택 후 새 프로젝트로 추가
  const fileInput = document.getElementById("file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = await importFromFile(f);
      importAsNewProject(data);
      switchToCurrentProject(true);
      alert("새 프로젝트로 불러왔습니다.");
    } catch (err) {
      alert("불러오기 실패: " + err.message);
    } finally {
      fileInput.value = "";
    }
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => {
  // 인덱스 로드 (마이그레이션 자동 처리됨)
  loadIndex();
  bindGlobals();
  switchToCurrentProject(true);
});
