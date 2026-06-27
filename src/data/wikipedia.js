const HISTORICAL_KEYWORDS = [
  "built",
  "constructed",
  "designed",
  "founded",
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
  "listed",
  "grade",
  "demolished",
  "acquired",
  "purchased",
  "sold",
];
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const MAX_EVENTS = 18;
const STRONG_EVENT_KEYWORDS = [
  "accident",
  "crash",
  "jumped",
  "survived",
  "escaped",
  "escape",
  "murder",
  "execution",
  "scandal",
  "mystery",
  "legend",
  "hidden",
  "secret",
  "tunnel",
  "world's first",
  "first in the world",
  "only surviving",
  "built",
  "constructed",
  "designed",
  "completed",
  "opened",
  "foundation stone",
  "rebuilt",
  "restored",
  "converted",
  "damaged",
  "destroyed",
  "demolished",
  "fire",
  "bomb",
  "war",
  "listed",
  "used as",
];
const WEAK_CONTEXT_KEYWORDS = [
  "member",
  "membership",
  "subscriber",
  "subscribers",
  "towns",
  "districts",
  "film",
  "filmed",
  "scenes",
  "television",
  "episode",
];
const BUILD_DATE_KEYWORDS = [
  "built",
  "constructed",
  "completed",
  "erected",
  "foundation stone",
];
const ORIGINAL_PURPOSE_CONTEXT = [
  "building",
  "house",
  "hall",
  "church",
  "chapel",
  "castle",
  "tower",
  "station",
  "warehouse",
  "hotel",
  "theatre",
  "library",
  "museum",
  "school",
  "college",
  "clubhouse",
  "arcade",
  "exchange",
  "market",
  "mill",
  "factory",
];
const COMMON_VENUE_WORDS = new Set([
  "bull",
  "bulls",
  "head",
  "king",
  "kings",
  "queen",
  "queens",
  "crown",
  "arms",
  "white",
  "hart",
  "red",
  "lion",
  "black",
  "horse",
  "royal",
  "oak",
  "inn",
  "pub",
  "hotel",
  "tavern",
  "bar",
  "club",
  "venue",
  "house",
]);
const GENERIC_LOCATION_WORDS = new Set([
  "address",
  "available",
  "building",
  "england",
  "english",
  "great",
  "kingdom",
  "listed",
  "national",
  "public",
  "record",
  "records",
  "sources",
  "street",
  "united",
]);
const KNOWN_PLACE_DISAMBIGUATORS = new Set([
  "barnes",
  "reigate",
  "london",
  "manchester",
  "surrey",
  "bristol",
  "leeds",
  "liverpool",
  "birmingham",
  "york",
  "bath",
  "oxford",
  "cambridge",
  "chester",
  "canterbury",
  "brighton",
]);

export async function enrichBuildingWithWikipediaEvents(building) {
  if (building.wikipediaEventsLoaded) return building;

  try {
    const article = await findWikipediaArticle(building);
    if (!article?.title) return { ...building, wikipediaEventsLoaded: true };

    const page = await fetchArticleExtract(article.title);
    const articleUrl = article.url || getPageUrl(page.title || article.title);
    const events = extractHistoricalSentences(page.extract || "", articleUrl);
    const buildDate = extractBuildDateClaim(page.extract || "", articleUrl);
    const originalPurpose = extractOriginalPurposeClaim(page.extract || "", buildDate?.note || "", page.title || article.title);
    const buildAttribution = extractBuildAttributionClaim(page.extract || "", buildDate?.note || "");
    const wikipediaSource = {
      name: "Wikipedia",
      url: articleUrl,
      coverage: "Article text scanned for significant dated historical events",
    };
    const useWikipediaBuildDate = shouldUseWikipediaBuildDate(building.buildDate, buildDate);

    return {
      ...building,
      wikipediaEventsLoaded: true,
      buildDate: useWikipediaBuildDate && buildDate
        ? buildDate
        : building.buildDate,
      built: useWikipediaBuildDate && buildDate
        ? buildDate.value
        : building.built,
      confidence: useWikipediaBuildDate && buildDate
        ? "Low"
        : building.confidence,
      originalPurpose: originalPurpose || building.originalPurpose || "",
      builtBy: buildAttribution.builtBy || building.builtBy || "",
      builtFor: buildAttribution.builtFor || (buildAttribution.builtBy && originalPurpose ? "" : building.builtFor) || "",
      buildPurposeSources: mergeSources(building.buildPurposeSources, hasWikipediaBuildPurpose(originalPurpose, buildAttribution) ? [{
        name: "Wikipedia",
        url: articleUrl,
        coverage: "Article text used to extract why the building was built",
      }] : []),
      significantEvents: mergeEvents(building.significantEvents, events),
      sources: mergeSources(building.sources, [wikipediaSource]),
      sourceLinks: mergeSources(building.sourceLinks, [{
        name: "Wikipedia article",
        url: articleUrl,
        coverage: "Article text scanned for significant dated historical events",
      }]),
    };
  } catch (error) {
    return { ...building, wikipediaEventsLoaded: true };
  }
}

function hasWikipediaBuildPurpose(originalPurpose = "", buildAttribution = {}) {
  return Boolean(originalPurpose || buildAttribution.builtBy || buildAttribution.builtFor);
}

async function findWikipediaArticle(building) {
  const articleUrl = getWikipediaArticleUrl(building);
  if (articleUrl) {
    const title = articleUrl.split("/wiki/")[1];
    return title ? { title: decodeURIComponent(title), url: articleUrl } : null;
  }

  const query = buildSearchQuery(building);
  if (!query) return null;

  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "10",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`${WIKIPEDIA_API_URL}?${params}`);
  if (!response.ok) return null;

  const data = await response.json();
  const candidates = data.query?.search || [];
  return candidates
    .map((candidate) => ({
      title: candidate.title,
      url: getPageUrl(candidate.title),
      score: scoreArticleCandidate(building, candidate),
    }))
    .filter((candidate) => candidate.score >= getArticleScoreThreshold(building))
    .sort((a, b) => b.score - a.score)[0] || null;
}

async function fetchArticleExtract(title) {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    redirects: "1",
    format: "json",
    origin: "*",
    titles: title,
  });
  const response = await fetch(`${WIKIPEDIA_API_URL}?${params}`);
  if (!response.ok) return {};

  const data = await response.json();
  return Object.values(data.query?.pages || {})[0] || {};
}

function getWikipediaArticleUrl(building) {
  return (building.sources || []).find((source) => source.url?.includes("en.wikipedia.org/wiki/"))?.url
    || (building.sourceLinks || []).find((source) => source.url?.includes("en.wikipedia.org/wiki/"))?.url
    || "";
}

function extractHistoricalSentences(extract, articleUrl) {
  return getStoryCandidates(extract)
    .map(cleanSentence)
    .map((sentence) => ({ sentence, score: scoreHistoricalSentence(sentence) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.sentence)
    .slice(0, MAX_EVENTS)
    .map((sentence) => ({
      dateRange: extractDateRange(sentence),
      useType: "Historical association",
      description: sentence,
      source: {
        name: "Wikipedia",
        url: articleUrl,
        coverage: "Article text used for significant dated historical associations",
      },
      confidence: "low",
    }));
}

function extractBuildDateClaim(extract, articleUrl) {
  const source = {
    name: "Wikipedia",
    url: articleUrl,
    coverage: "Article text used as fallback evidence for approximate build date",
  };

  const candidate = extract
    .replace(/={2,}\s*([^=]+?)\s*={2,}/g, "$1. ")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentence)
    .map((sentence) => ({ sentence, score: scoreBuildDateSentence(sentence) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)[0];

  if (!candidate) return null;

  const value = extractBuildDateValue(candidate.sentence);
  if (!value) return null;

  return {
    value,
    confidence: "low",
    source,
    note: candidate.sentence,
  };
}

function extractOriginalPurposeClaim(extract, buildDateNote = "", articleTitle = "") {
  const purposeFromBuildDate = extractOriginalPurposeFromText(buildDateNote);
  if (purposeFromBuildDate) return purposeFromBuildDate;

  const earlyPurpose = getSentences(extract)
    .slice(0, 8)
    .map(extractOriginalPurposeFromText)
    .find(Boolean);
  if (earlyPurpose) return earlyPurpose;

  const titleWords = significantWords(articleTitle);
  return getSentences(extract)
    .slice(0, 12)
    .map((sentence) => ({
      sentence,
      purpose: extractOriginalPurposeFromText(sentence),
      score: scoreOriginalPurposeSentence(sentence, titleWords),
    }))
    .filter((item) => item.purpose && item.score >= 4)
    .sort((a, b) => b.score - a.score)[0]?.purpose || "";
}

function extractBuildAttributionClaim(extract, buildDateNote = "") {
  const sentences = [
    buildDateNote,
    ...getSentences(extract).slice(0, 12),
  ].filter(Boolean);

  return sentences
    .map(extractBuildAttributionFromText)
    .find((item) => item.builtBy || item.builtFor) || { builtBy: "", builtFor: "" };
}

function extractBuildAttributionFromText(value = "") {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return { builtBy: "", builtFor: "" };

  const byToMatch = clean.match(/\b(?:built|constructed|erected|designed)\s+by\s+([^.;,]{3,90}?)\s+to\s+(house|serve|accommodate)\s+([^.;,]{3,90})/i);
  if (byToMatch) {
    return {
      builtBy: tidyBuilder(byToMatch[1]),
      builtFor: `to ${byToMatch[2].toLowerCase()} ${tidyOriginalPurpose(byToMatch[3])}`,
    };
  }

  const byForMatch = clean.match(/\b(?:built|constructed|erected|designed)\s+by\s+([^.;,]{3,90}?)\s+for\s+([^.;,]{3,90})/i);
  if (byForMatch) {
    return {
      builtBy: tidyBuilder(byForMatch[1]),
      builtFor: tidyOriginalPurpose(byForMatch[2]),
    };
  }

  const byMatch = clean.match(/\b(?:built|constructed|erected|designed)\s+by\s+([^.;,]{3,90})/i);
  if (byMatch) {
    return {
      builtBy: tidyBuilder(byMatch[1]),
      builtFor: "",
    };
  }

  const forMatch = clean.match(/\b(?:built|constructed|erected|designed)\s+for\s+([^.;,]{3,90})/i);
  if (forMatch) {
    return {
      builtBy: "",
      builtFor: tidyOriginalPurpose(forMatch[1]),
    };
  }

  return { builtBy: "", builtFor: "" };
}

function extractOriginalPurposeFromText(value = "") {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const patterns = [
    /\bofficially\s+(?:His|Her|Their)\s+Majesty's\s+Royal\s+Palace\s+and\s+Fortress\b/i,
    /\b(?:a\s+)?grand palace early in its history,\s+it served as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:is|was)\s+(?:an?\s+|the\s+)?(?:large\s+)?([^.;,]{3,90}?\b(?:estate house|country house|royal residence|residence of [^.;,]{3,70}))\b/i,
    /\b(?:building|site|premises|property)\s+(?:was\s+)?(?:originally\s+)?(?:built|constructed|used)\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90}?\b(?:prison|gaol|jail|court|courthouse|workhouse|warehouse|house|inn|hotel|church|chapel|school|hospital))\b/i,
    /\bformer\s+([^.;,]{3,90}?\b(?:prison|gaol|jail|court|courthouse|workhouse|warehouse|house|inn|hotel|church|chapel|school|hospital))\b/i,
    /\bthe current\s+[^.;,]{3,80}?\s+was commissioned\b/i,
    /\b(?:built|constructed|erected|designed)\s+by\s+[^.;,]{3,90}?\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+for\s+(?!the\s+king|the\s+queen|royal\s+residence\b)([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed|opened)\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:constructed|built)\s+for\s+use\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && !match[1] && /Royal\s+Palace\s+and\s+Fortress/i.test(match[0])) {
      return "a royal palace and fortress";
    }
    if (match && !match[1] && /\bwas commissioned\b/i.test(match[0])) {
      return "a larger royal residence";
    }
    if (!match?.[1]) continue;

    const purpose = tidyOriginalPurpose(match[1]);
    if (isPlausibleOriginalPurpose(purpose)) return purpose;
  }

  return "";
}

function scoreOriginalPurposeSentence(sentence, titleWords = new Set()) {
  const lower = sentence.toLowerCase();
  if (sentence.length < 30 || sentence.length > 300) return 0;
  if (WEAK_CONTEXT_KEYWORDS.some((keyword) => lower.includes(keyword))) return 0;
  if (!/\b(built|constructed|erected|designed|opened)\b/.test(lower)) return 0;

  let score = 1;
  if (hasDateCue(sentence)) score += 1;
  if (/\b(was|were)\s+(built|constructed|erected|designed|opened)\b/.test(lower)) score += 2;
  if (/\b(built|constructed|erected|designed)(?:\s+by\s+[^.;,]{3,90}?)?\s+(for|to)\b|\bopened\s+as\b|\bfor use as\b/.test(lower)) score += 2;
  if (ORIGINAL_PURPOSE_CONTEXT.some((keyword) => lower.includes(keyword))) score += 1;
  if ([...titleWords].some((word) => lower.includes(word))) score += 1;

  return score;
}

function isHistoricallySignificantSentence(sentence) {
  return scoreHistoricalSentence(sentence) >= 2;
}

function scoreHistoricalSentence(sentence) {
  if (sentence.length < 35 || sentence.length > 360) return 0;

  const lower = sentence.toLowerCase();
  if (isHardRejectedHistoricalSentence(lower)) return 0;
  const didYouKnowScore = getDidYouKnowSentenceScore(lower);
  if (!hasDateCue(sentence) && didYouKnowScore < 10) return 0;
  const hasHistoricalKeyword = HISTORICAL_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (!didYouKnowScore && !hasHistoricalKeyword) return 0;
  if (isRoutineHistoricalSentence(lower) && didYouKnowScore < 6) return 0;

  let score = didYouKnowScore || 1;
  if (STRONG_EVENT_KEYWORDS.some((keyword) => lower.includes(keyword))) score += 3;
  if (/\b(building|house|hall|church|chapel|castle|tower|station|warehouse|hotel|theatre|library|museum|school|college|clubhouse)\b/.test(lower)) score += 1;
  if (/\b(grade i|grade ii|listed building|national heritage list)\b/.test(lower)) score += 1;
  if (WEAK_CONTEXT_KEYWORDS.some((keyword) => lower.includes(keyword))) score -= 2;

  return score;
}

function getDidYouKnowSentenceScore(text = "") {
  if (/\b(accident|crash|jumped|fell|collapse|collapsed|explosion|derail|struck|trapped|rescued|miraculously|survived|survival|escaped death)\b/.test(text)) return 14;
  if (/\b(survived|survival|rescued|sheltered|saved|escaped injury|unharmed|miracle|bombing|blitz|fire)\b/.test(text)) return 13;
  if (/\b(crime|criminal|murder|murdered|assassinated|execution|executed|escaped|escape|prisoner|stole|theft|robbery|scandal|trial|treason|spy|espionage)\b/.test(text)) return 12;
  if (/\b(mystery|mysterious|legend|ghost|haunted|hidden|secret|tunnel|discovered beneath|lost|vanished|disappeared)\b/.test(text)) return 11;
  if (/\b(world war|second world war|first world war|wwii|wwi|wartime|bomb|bombed|air raid|blitz|siege|attack|occupation)\b/.test(text)) return 10;
  if (/\b(world's first|world first|first in the world|first ever|first public|record|largest|oldest|tallest|longest|only surviving|last surviving)\b/.test(text)) return 9;
  if (/\b(king|queen|prince|princess|monarch|prime minister|president|sir |dame |charles i|elizabeth i|william the conqueror|famous|notable)\b/.test(text)) return 8;
  if (/\b(film|filmed|cinema|music|concert|beatles|rolling stones|festival|theatre|opera|novel|artist|cultural)\b/.test(text)) return 7;
  if (/\b(engineering|engineer|feat|hydraulic|lift|bridge|span|innovative|pioneering)\b/.test(text)) return 6;
  return 0;
}

function isRoutineHistoricalSentence(text = "") {
  if (/\b(officially opened|opening ceremony|opened in|opened on|opened by|unveiled|plaque|listed building|grade ii|grade i\b)\b/.test(text)) return true;
  if (/\b(built|constructed|completed|designed|construction|foundation stone|architect|forebuilding|extra defences|storehouse)\b/.test(text) && getDidYouKnowSentenceScore(text) < 10) return true;
  if (/\b(renovated|renovation|refurbished|restored|restoration|leased|sold|purchased|acquired|ownership)\b/.test(text) && !/\b(fire|bomb|war|survived|hidden|secret|scandal|collapse)\b/.test(text)) return true;
  return false;
}

function isHardRejectedHistoricalSentence(text = "") {
  if (/\b(references|external links|further reading|list of|see also)\b/.test(text)) return true;
  if (/\b(has not survived|have not survived|no longer survives|does not survive)\b/.test(text)) return true;
  return false;
}

function scoreBuildDateSentence(sentence) {
  if (!hasDateCue(sentence)) return 0;
  if (sentence.length < 25 || sentence.length > 300) return 0;

  const lower = sentence.toLowerCase();
  if (!BUILD_DATE_KEYWORDS.some((keyword) => lower.includes(keyword))) return 0;
  if (WEAK_CONTEXT_KEYWORDS.some((keyword) => lower.includes(keyword))) return 0;
  if (isOccupantBusinessDateSentence(lower)) return 0;
  if (/\b(opened|founded)\s+by\b/.test(lower)) return 0;
  if (/\b(extension|extended|modified|modifications|alterations?|restored|rebuilt|interior)\b/.test(lower)) return 0;

  let score = 2;
  if (/\bwas (built|constructed|completed|erected)\b/.test(lower)) score += 3;
  if (/\b(built|constructed|completed|erected) (in|by|between|around|circa|c\.)\b/.test(lower)) score += 2;
  if (/\bbuilding|house|hall|church|chapel|castle|tower|station|warehouse|hotel|theatre|library|museum|school|college|clubhouse|exchange|arcade|market|mill|factory|prison|gaol|jail|court|courthouse|workhouse\b/.test(lower)) score += 1;
  if (/\bdesigned by\b/.test(lower)) score += 1;

  return score;
}

function isOccupantBusinessDateSentence(text = "") {
  return /\b(bar|pub|restaurant|cafe|shop|store|retailer|business|company|brand|chain|venue|club|nightclub)\b/.test(text)
    && /\b(opened|founded|launched|started|began trading|operates|occupied by|tenant)\b/.test(text)
    && !/\b(building|house|hall|church|chapel|castle|tower|station|warehouse|hotel|theatre|library|museum|school|college|prison|gaol|jail|court|workhouse)\b/.test(text);
}

function buildSearchQuery(building) {
  const name = cleanSearchText(building.buildingName || building.name);
  if (!name || isGenericName(name)) return "";

  const location = cleanSearchText(building.address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-2)
    .join(" ");

  return [name, location].filter(Boolean).join(" ");
}

function scoreArticleCandidate(building, candidate) {
  const title = normaliseText(candidate.title);
  const snippet = normaliseText(candidate.snippet);
  const buildingName = normaliseText(building.buildingName || building.name);
  const nameWords = [...significantWords(building.buildingName || building.name)];
  const addressWords = [...significantWords(building.address)];
  const localityWords = getLocalityWords(building);
  const combined = `${title} ${snippet}`;
  const nameHits = nameWords.filter((word) => combined.includes(word));
  const titleNameHits = nameWords.filter((word) => title.includes(word));
  const addressHits = addressWords.filter((word) => combined.includes(word));
  const localityHits = localityWords.filter((word) => combined.includes(word));
  const hasBuildingContext = /\b(building|house|hall|church|chapel|castle|station|warehouse|hotel|theatre|library|museum|school|college|prison|gaol|jail|court|workhouse|palace|bridge|tower)\b/.test(combined);
  const requiresLocality = requiresLocationVerifiedArticle(building);

  if (!nameHits.length) return 0;
  if (nameWords.length > 1 && titleNameHits.length < Math.min(2, nameWords.length) && !title.includes(buildingName)) return 0;
  if (nameWords.length <= 1 && !addressHits.length && !hasBuildingContext) return 0;
  if (requiresLocality && !localityHits.length) return 0;
  if (hasConflictingLocality(title, localityWords)) return 0;

  let score = 0;
  if (title === buildingName || title.includes(buildingName)) score += 6;

  nameWords.forEach((word) => {
    if (title.includes(word)) score += 2;
    else if (snippet.includes(word)) score += 1;
  });
  addressWords.forEach((word) => {
    if (title.includes(word) || snippet.includes(word)) score += 1;
  });
  localityWords.forEach((word) => {
    if (title.includes(word)) score += 3;
    else if (snippet.includes(word)) score += 2;
  });

  if (titleNameHits.length >= Math.min(2, nameWords.length)) score += 2;
  if (hasBuildingContext) score += 1;

  return score;
}

function getArticleScoreThreshold(building) {
  return requiresLocationVerifiedArticle(building) ? 8 : 4;
}

function requiresLocationVerifiedArticle(building = {}) {
  const text = normaliseText([
    building.buildingName,
    building.name,
    building.currentUse,
    building.address,
  ].join(" "));

  return /\b(pub|public house|inn|tavern|bar|hotel|shop|store|restaurant|cafe|club|venue)\b/.test(text)
    || getLocalityWords(building).length > 0 && hasCommonVenueName(building.buildingName || building.name);
}

function hasCommonVenueName(value = "") {
  const words = [...significantWords(value)];
  const distinctive = words.filter((word) => !COMMON_VENUE_WORDS.has(word));
  return distinctive.length <= 2;
}

function getLocalityWords(building = {}) {
  return [...new Set([
    ...significantWords(building.address),
    ...significantWords(getSourceLocalityText(building)),
  ])].filter((word) => !GENERIC_LOCATION_WORDS.has(word));
}

function getSourceLocalityText(building = {}) {
  return [
    ...(building.sources || []).map((source) => source.coverage),
    ...(building.sourceLinks || []).map((source) => source.coverage),
  ].join(" ");
}

function hasConflictingLocality(title = "", localityWords = []) {
  const parenthetical = title.match(/\b([a-z0-9]+)\b$/)?.[1] || "";
  if (!parenthetical || localityWords.includes(parenthetical)) return false;
  return KNOWN_PLACE_DISAMBIGUATORS.has(parenthetical);
}

function hasDateCue(sentence) {
  return /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(sentence)
    || /\b(early|mid|late)?\s?([0-9]{1,2})(?:st|nd|rd|th) century\b/i.test(sentence);
}

function extractDateRange(sentence) {
  const year = sentence.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (year) return `c. ${year[1]}`;

  const century = sentence.match(/\b(early|mid|late)?\s?([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (century) return `${century[1] ? `${century[1]} ` : ""}${century[2]}th century`;

  return "Historical association";
}

function extractBuildDateValue(sentence) {
  const range = sentence.match(/\bbetween\s+(1[0-9]{3}|20[0-2][0-9])\s+and\s+(1[0-9]{3}|20[0-2][0-9])\b/i);
  if (range) return `c. ${range[1]}-${range[2]}`;

  const year = sentence.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (year) return `c. ${year[1]}`;

  const century = sentence.match(/\b(early|mid|late)?\s?([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (century) return `c. ${century[1] ? `${century[1]} ` : ""}${century[2]}th century`;

  return "";
}

function getSentences(extract = "") {
  return extract
    .replace(/={2,}\s*([^=]+?)\s*={2,}/g, "$1. ")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentence)
    .filter(Boolean);
}

function getStoryCandidates(extract = "") {
  const sentences = getSentences(extract);
  const candidates = [...sentences];

  sentences.forEach((sentence, index) => {
    const next = sentences[index + 1];
    if (!next) return;

    const pair = `${sentence} ${next}`;
    if (pair.length <= 420 && getDidYouKnowSentenceScore(pair.toLowerCase()) >= 10) {
      candidates.push(pair);
    }
  });

  return candidates;
}

function tidyOriginalPurpose(value = "") {
  return value
    .replace(/\s+(during|when|with|by|in|and was|but was)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyBuilder(value = "") {
  return value
    .replace(/\s+(in|between|around|circa|c\.)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleOriginalPurpose(value = "") {
  const clean = value.trim();
  const lower = clean.toLowerCase();
  if (clean.length < 3 || clean.length > 90) return false;
  if (/^(it|this|that|there|the|a|an)$/i.test(clean)) return false;
  if (/^(the )?(king|queen|prince|duke|earl|lord|lady|elephant)\b/i.test(clean)) return false;
  if (/\b(company|corporation|limited|ltd|plc|railway company)\b/i.test(clean)) return false;
  if (/\b(repair|renovation|refurbishment|extension|maintenance|alteration|sale|purchase|lease|ownership)\b/.test(lower)) return false;
  return true;
}

function shouldUseWikipediaBuildDate(buildDate, wikipediaBuildDate = null) {
  const value = typeof buildDate === "string" ? buildDate : buildDate?.value;
  if (!value || value === "Date not available" || value === "Unknown" || value === "Build date unknown") return true;
  if (!wikipediaBuildDate?.value || wikipediaBuildDate.value === value) return false;

  const sourceName = buildDate?.source?.name || "";
  return /wikidata|openstreetmap/i.test(sourceName)
    && /\b(current|new|present|existing)\s+(building|castle|house|hall|church|chapel|station|warehouse|hotel|theatre|library|museum|school|college)\b/i.test(wikipediaBuildDate.note || "");
}

function mergeSources(existing = [], incoming = []) {
  const byKey = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((source) => {
    const key = source.url || source.name;
    if (key) byKey.set(key, source);
  });
  return [...byKey.values()];
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

function cleanSentence(sentence = "") {
  return sentence
    .replace(/^([A-Z][A-Za-z ]{2,40})\.\s+(?=[A-Z])/, "")
    .replace(/^\([^)]{1,180}\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPageUrl(title = "") {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function cleanSearchText(value = "") {
  return String(value || "")
    .replace(/\b(current use|not found|public sources|date not available|unnamed mapped building)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantWords(value = "") {
  return new Set(normaliseText(value)
    .split(" ")
    .filter((word) => word.length > 3 && !["building", "street", "road", "lane", "place", "avenue"].includes(word)));
}

function isGenericName(value = "") {
  return /^(building|mapped building|unnamed mapped building|unnamed building)$/i.test(value.trim());
}
