// localStorage persistence + JSON import/export
const KEY = "ecr.v1.project";
const SCHEMA = "ecr.v1";

export function createInitialState() {
  return {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

export function load() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const data = JSON.parse(s);
    if (data.schema !== SCHEMA) return null;
    return data;
  } catch {
    return null;
  }
}

export function save(state) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearStorage() {
  localStorage.removeItem(KEY);
}

export function exportToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = (state.projectName || "ecr") + "_" + new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

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
