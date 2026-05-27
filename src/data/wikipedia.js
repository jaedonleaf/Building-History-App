const HISTORICAL_KEYWORDS = [
  "home",
  "residence",
  "resident",
  "lived",
  "owned",
  "seat of",
  "family",
  "inherited",
  "possession",
  "queen",
  "king",
  "built for",
  "rebuilt",
  "renovated",
  "restored",
  "damaged",
  "destroyed",
  "fire",
  "war",
  "bomb",
  "siege",
  "birthplace",
  "death",
  "meeting",
  "opened",
  "closed",
  "converted",
  "used as",
];

export async function enrichBuildingWithWikipediaEvents(building) {
  const articleUrl = getWikipediaArticleUrl(building);
  if (!articleUrl || building.wikipediaEventsLoaded) return building;

  const title = articleUrl.split("/wiki/")[1];
  if (!title) return { ...building, wikipediaEventsLoaded: true };

  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&titles=${title}`);
    if (!response.ok) return { ...building, wikipediaEventsLoaded: true };

    const data = await response.json();
    const page = Object.values(data.query?.pages || {})[0] || {};
    const events = extractHistoricalSentences(page.extract || "", articleUrl);

    return {
      ...building,
      wikipediaEventsLoaded: true,
      significantEvents: mergeEvents(building.significantEvents, events),
    };
  } catch (error) {
    return { ...building, wikipediaEventsLoaded: true };
  }
}

function getWikipediaArticleUrl(building) {
  return (building.sources || []).find((source) => source.url?.includes("en.wikipedia.org/wiki/"))?.url
    || (building.sourceLinks || []).find((source) => source.url?.includes("en.wikipedia.org/wiki/"))?.url
    || "";
}

function extractHistoricalSentences(extract, articleUrl) {
  return extract
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(isHistoricallySignificantSentence)
    .slice(0, 4)
    .map((sentence) => ({
      dateRange: extractDateRange(sentence),
      useType: "Historical association",
      description: sentence,
      source: {
        name: "Wikipedia",
        url: articleUrl,
        coverage: "Article summary used for notable historical associations",
      },
      confidence: "low",
    }));
}

function isHistoricallySignificantSentence(sentence) {
  const lower = sentence.toLowerCase();
  return HISTORICAL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function extractDateRange(sentence) {
  const year = sentence.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (year) return `c. ${year[1]}`;

  const century = sentence.match(/\b(early|mid|late)?\s?([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (century) return `${century[1] ? `${century[1]} ` : ""}${century[2]}th century`;

  return "Historical association";
}

function mergeEvents(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((event) => {
    const key = `${event.dateRange}|${event.description}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
