const nfInt = new Intl.NumberFormat("ko-KR");
const nf1   = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const nf2   = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

export const fmtInt  = (v) => (v == null || isNaN(v)) ? "-" : nfInt.format(Math.round(v));
export const fmt1    = (v) => (v == null || isNaN(v)) ? "-" : nf1.format(v);
export const fmt2    = (v) => (v == null || isNaN(v)) ? "-" : nf2.format(v);
export const fmtPct  = (v) => (v == null || isNaN(v)) ? "-" : nf1.format(v * 100) + " %";

export const toNum   = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const escapeHtml = (s) => String(s ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
