// Bootstrap + hash-based router.
import { load, save, createInitialState, exportToFile, importFromFile } from "./storage.js";
import { renderTransformer } from "./calculators/transformer.js";
import { renderGenerator }   from "./calculators/generator.js";
import { renderPanelList, renderPanelEditor } from "./calculators/panels.js";
import { renderMccList,   renderMccEditor }   from "./calculators/mcc.js";
import { renderTrayList,  renderTrayEditor }  from "./calculators/trays.js";
import { renderVoltageDrop } from "./calculators/voltage_drop.js";
import { renderLightingEditor } from "./views/lighting_editor.js";
import { renderGenericEditor } from "./views/generic_editor.js";
import { renderDesignConditions } from "./views/design_conditions.js";

let state = load() || createInitialState();
const view = document.getElementById("view");

function persist() { save(state); refreshStorageInfo(); }

function refreshStorageInfo() {
  const el = document.getElementById("storage-info");
  if (!el) return;
  const updated = state.updatedAt ? new Date(state.updatedAt) : null;
  el.textContent = updated
    ? `저장됨: ${updated.toLocaleString("ko-KR")}`
    : "저장됨: -";
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
  // active nav highlight — exact match, or '#panel/...' highlights '#panels'
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
  const nameEl = document.getElementById("project-name");
  const siteEl = document.getElementById("project-site");
  nameEl.value = state.projectName;
  siteEl.value = state.projectSite;
  nameEl.addEventListener("input", (e) => { state.projectName = e.target.value; persist(); });
  siteEl.addEventListener("input", (e) => { state.projectSite = e.target.value; persist(); });

  document.getElementById("btn-export").addEventListener("click", () => exportToFile(state));
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  const fileInput = document.getElementById("file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = await importFromFile(f);
      state = data;
      persist();
      location.reload();
    } catch (err) {
      alert("불러오기 실패: " + err.message);
    } finally {
      fileInput.value = "";
    }
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => {
  bindGlobals();
  route();
});
