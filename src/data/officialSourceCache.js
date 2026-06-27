const OFFICIAL_SOURCE_CACHE = {
  "https://thebullsheadreigate.co.uk/": {
    text: "The Bulls Head Reigate Surrey is a traditional family run public house, built in 1628.",
    sourceUrl: "https://thebullsheadreigate.co.uk/",
    retrievedAt: "2026-06-07",
  },
};

export function getCachedOfficialSourceText(url = "") {
  return OFFICIAL_SOURCE_CACHE[normaliseUrl(url)]?.text || "";
}

function normaliseUrl(url = "") {
  return String(url || "").replace(/\/+$/, "/");
}
