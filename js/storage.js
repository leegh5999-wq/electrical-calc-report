// Multi-project localStorage layer.
//
// 키 구조:
//   ecr.v1.index             → { schema, currentId, projects: [{id, name, site, createdAt, updatedAt}] }
//   ecr.v1.project.<id>      → 프로젝트 전체 상태 (createInitialState 모양)
//
// 마이그레이션: 구버전(단일 프로젝트, `ecr.v1.project`)이 있으면 자동으로 첫 프로젝트로 변환.

const KEY_INDEX = "ecr.v1.index";
const KEY_LEGACY = "ecr.v1.project";
const KEY_PROJECT_PREFIX = "ecr.v1.project.";
const SCHEMA = "ecr.v1";

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function nowIso() { return new Date().toISOString(); }

export function createInitialState() {
  return {
    schema: SCHEMA,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    projectName: "",
    projectSite: "",
    transformer: null,
    generator: null,
    panels: [],
    mccPanels: [],
    trays: [],
    tables: {},
  };
}

// ── Index ────────────────────────────────────────────────────────────────
export function loadIndex() {
  // 1) 마이그레이션 (있다면 1회만)
  if (!localStorage.getItem(KEY_INDEX) && localStorage.getItem(KEY_LEGACY)) {
    try {
      const legacy = JSON.parse(localStorage.getItem(KEY_LEGACY));
      if (legacy && legacy.schema === SCHEMA) {
        const id = uuid();
        const meta = {
          id,
          name: legacy.projectName || "프로젝트 1",
          site: legacy.projectSite || "",
          createdAt: legacy.createdAt || nowIso(),
          updatedAt: legacy.updatedAt || nowIso(),
        };
        const index = { schema: SCHEMA, currentId: id, projects: [meta] };
        localStorage.setItem(KEY_INDEX, JSON.stringify(index));
        localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(legacy));
        localStorage.removeItem(KEY_LEGACY);
      }
    } catch (e) {
      console.warn("legacy migration failed:", e);
    }
  }

  // 2) 인덱스 읽기 (없으면 새로 생성)
  let raw = localStorage.getItem(KEY_INDEX);
  if (!raw) {
    const id = uuid();
    const meta = { id, name: "프로젝트 1", site: "", createdAt: nowIso(), updatedAt: nowIso() };
    const index = { schema: SCHEMA, currentId: id, projects: [meta] };
    localStorage.setItem(KEY_INDEX, JSON.stringify(index));
    localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(createInitialState()));
    return index;
  }
  return JSON.parse(raw);
}

function saveIndex(index) {
  localStorage.setItem(KEY_INDEX, JSON.stringify(index));
}

// ── Project state ────────────────────────────────────────────────────────
export function loadProject(id) {
  const raw = localStorage.getItem(KEY_PROJECT_PREFIX + id);
  if (!raw) return createInitialState();
  try {
    return JSON.parse(raw);
  } catch {
    return createInitialState();
  }
}

export function saveProject(id, state) {
  state.updatedAt = nowIso();
  localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(state));
  // 인덱스에도 updatedAt 반영 + name/site sync
  const index = loadIndex();
  const meta = index.projects.find(p => p.id === id);
  if (meta) {
    meta.updatedAt = state.updatedAt;
    // projectName/Site → meta로 sync
    if (state.projectName != null && state.projectName !== meta.name) meta.name = state.projectName;
    if (state.projectSite != null && state.projectSite !== meta.site) meta.site = state.projectSite;
    saveIndex(index);
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────
export function createProject(name = "프로젝트", site = "") {
  const index = loadIndex();
  const id = uuid();
  const meta = { id, name, site, createdAt: nowIso(), updatedAt: nowIso() };
  index.projects.push(meta);
  index.currentId = id;
  saveIndex(index);
  const state = createInitialState();
  state.projectName = name;
  state.projectSite = site;
  localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(state));
  return meta;
}

export function duplicateProject(sourceId, newName) {
  const index = loadIndex();
  const src = index.projects.find(p => p.id === sourceId);
  if (!src) return null;
  const srcState = loadProject(sourceId);
  const id = uuid();
  const meta = {
    id,
    name: newName || `${src.name} (복사본)`,
    site: src.site,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  index.projects.push(meta);
  saveIndex(index);
  const newState = JSON.parse(JSON.stringify(srcState));
  newState.projectName = meta.name;
  newState.createdAt = meta.createdAt;
  newState.updatedAt = meta.updatedAt;
  localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(newState));
  return meta;
}

export function renameProject(id, newName, newSite = null) {
  const index = loadIndex();
  const meta = index.projects.find(p => p.id === id);
  if (!meta) return false;
  meta.name = newName;
  if (newSite != null) meta.site = newSite;
  meta.updatedAt = nowIso();
  saveIndex(index);
  // project 내부 projectName/Site도 sync
  const state = loadProject(id);
  state.projectName = newName;
  if (newSite != null) state.projectSite = newSite;
  state.updatedAt = meta.updatedAt;
  localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(state));
  return true;
}

export function deleteProject(id) {
  const index = loadIndex();
  if (index.projects.length <= 1) return false;       // 마지막 1개는 삭제 불가
  index.projects = index.projects.filter(p => p.id !== id);
  if (index.currentId === id) {
    index.currentId = index.projects[0].id;           // 첫 번째로 전환
  }
  saveIndex(index);
  localStorage.removeItem(KEY_PROJECT_PREFIX + id);
  return true;
}

export function setCurrentProject(id) {
  const index = loadIndex();
  if (!index.projects.some(p => p.id === id)) return false;
  index.currentId = id;
  saveIndex(index);
  return true;
}

// ── JSON Import / Export ─────────────────────────────────────────────────
// 단일 프로젝트 내보내기 (현재 활성)
export function exportToFile(state, projectName = "ecr") {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (projectName || "ecr").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  a.href = url;
  a.download = `${safeName}_${nowIso().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 파일에서 불러와서 새 프로젝트로 추가
export function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.schema !== SCHEMA) {
          reject(new Error(`스키마 불일치: 기대값 ${SCHEMA}, 실제 ${data.schema || "없음"}`));
          return;
        }
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// 불러온 데이터를 새 프로젝트로 추가
export function importAsNewProject(data) {
  const id = uuid();
  const name = data.projectName || "불러온 프로젝트";
  const site = data.projectSite || "";
  const meta = { id, name, site, createdAt: nowIso(), updatedAt: nowIso() };
  const index = loadIndex();
  index.projects.push(meta);
  index.currentId = id;
  saveIndex(index);
  data.projectName = name;
  data.projectSite = site;
  data.updatedAt = meta.updatedAt;
  localStorage.setItem(KEY_PROJECT_PREFIX + id, JSON.stringify(data));
  return meta;
}
