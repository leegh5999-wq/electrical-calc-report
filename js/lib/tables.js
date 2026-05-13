// Reference-table loader. Default seeds live in data/tables/<slug>.json.
// User-edited copies live in state.tables[<slug>]. UI calls save() after edits.

const SEED_PATHS = {
  lighting_fixtures: "data/tables/lighting_fixtures.json",
  equipment_list:    "data/tables/equipment_list.json",
  design_conditions: "data/tables/design_conditions.json",
  cb:                "data/tables/cb.json",
  cable_data:        "data/tables/cable_data.json",
  derating_factor:   "data/tables/derating_factor.json",
  demand_factor:     "data/tables/demand_factor.json",
};

export const TABLE_LABELS = {
  lighting_fixtures: "조명기구",
  equipment_list:    "장비일람",
  design_conditions: "설계조건",
  cb:                "차단기 (CB)",
  cable_data:        "케이블 데이터",
  derating_factor:   "감쇄계수 (DF)",
  demand_factor:     "수용률",
};

const fetchCache = new Map();

async function fetchSeed(slug) {
  if (fetchCache.has(slug)) return fetchCache.get(slug);
  const path = SEED_PATHS[slug];
  if (!path) throw new Error(`Unknown table: ${slug}`);
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load seed for ${slug}: ${res.status}`);
  const json = await res.json();
  fetchCache.set(slug, json);
  return json;
}

// Returns a deep-cloned copy from seed (for resetting / first load).
async function freshSeed(slug) {
  const seed = await fetchSeed(slug);
  return structuredClone(seed);
}

// Read-or-init: returns the user-edited table if present, else seed (and persists seed).
export async function getTable(slug, state) {
  if (state.tables[slug]) return state.tables[slug];
  state.tables[slug] = await freshSeed(slug);
  return state.tables[slug];
}

export async function resetTable(slug, state) {
  state.tables[slug] = await freshSeed(slug);
  return state.tables[slug];
}

export function listTables() {
  return Object.keys(SEED_PATHS);
}
