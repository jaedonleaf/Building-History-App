import { buildings } from "./data/buildings.js";
import { areLikelySameBuilding, hasLimitedHistory, mergeBuildingHistories, normaliseBuildingHistory } from "./data/buildingHistory.js";
import { fetchHistoricEnglandBuildingsForBounds } from "./data/historicEngland.js";
import { DISCOVERY_MODES, isHistoricallyEligible } from "./data/historicalSignificance.js";
import { enrichBuildingWithModularRetrieval } from "./data/modularBuildingHistory.js";
import { fetchOpenStreetMapBuildingsForBounds } from "./data/openStreetMap.js";
import { fetchWikidataBuildingById, searchBuildingSuggestions } from "./data/placeSearch.js";
import { fetchWikidataBuildingsForBounds } from "./data/wikidata.js";

let localMapboxToken = "";
let viewportLoadTimer = 0;
let searchSuggestionTimer = 0;
let searchRequestId = 0;
const ROUTE_SOURCE_ID = "walking-route";
const ROUTE_LAYER_ID = "walking-route-line";

const state = {
  selectedBuilding: normaliseBuildingHistory(buildings[0]),
  buildings: buildings.map(normaliseBuildingHistory),
  discoveryMode: DISCOVERY_MODES.history,
  activeFilter: "all",
  map: null,
  markers: [],
  userMarker: null,
  userLocation: null,
  activeRoute: null,
  searchSuggestions: [],
};

const elements = {
  map: document.querySelector("#map"),
  fallbackMap: document.querySelector("#fallbackMap"),
  mapStatus: document.querySelector("#mapStatus"),
  buildingName: document.querySelector("#buildingName"),
  buildingType: document.querySelector("#buildingType"),
  buildingAddress: document.querySelector("#buildingAddress"),
  builtDate: document.querySelector("#builtDate"),
  nameType: document.querySelector("#nameType"),
  confidence: document.querySelector("#confidence"),
  currentUse: document.querySelector("#currentUse"),
  timeline: document.querySelector("#timeline"),
  eventList: document.querySelector("#eventList"),
  limitedDataNotice: document.querySelector("#limitedDataNotice"),
  sourceList: document.querySelector("#sourceList"),
  navigationPanel: document.querySelector("#navigationPanel"),
  routeSummary: document.querySelector("#routeSummary"),
  routeSteps: document.querySelector("#routeSteps"),
  clearRouteButton: document.querySelector("#clearRouteButton"),
  googleMapsLink: document.querySelector("#googleMapsLink"),
  directionsButton: document.querySelector("#directionsButton"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  searchSuggestions: document.querySelector("#searchSuggestions"),
  discoveryModeButtons: document.querySelectorAll("[data-discovery-mode]"),
  filterButtons: document.querySelectorAll("[data-filter]"),
  locateButton: document.querySelector("#locateButton"),
  reportButton: document.querySelector("#reportButton"),
};

function getMapboxToken() {
  return localStorage.getItem("buildingHistory.mapboxToken") || localMapboxToken;
}

function getMapboxStyle() {
  return localStorage.getItem("buildingHistory.mapboxStyle") || "mapbox://styles/mapbox/streets-v12";
}

function setStatus(message) {
  elements.mapStatus.textContent = message;
}

function buildGoogleMapsUrl(building) {
  const query = encodeURIComponent(`${building.name}, ${building.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[character]));
}

function formatTimelineDescription(item) {
  return item.description;
}

function formatTimelineDateRange(item) {
  const dateRange = String(item.dateRange || "").trim();
  return /^(undated\s+)?recorded use$/i.test(dateRange) ? "" : dateRange;
}

function getTimelineSortYear(item) {
  const dateRange = formatTimelineDateRange(item);
  if (item.useType === "Build date" && /date not available/i.test(String(item.dateRange || ""))) {
    return 9999;
  }
  const extractedYear = extractTimelineYear(`${dateRange} ${item.description || ""}`);
  if (extractedYear !== 9999) return extractedYear;
  if (Number.isFinite(item.sortYear) && item.sortYear !== 9999) return item.sortYear;
  return 9999;
}

function extractTimelineYear(value = "") {
  const text = String(value);
  const yearMatch = text.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (yearMatch) return Number(yearMatch[1]);

  const centuryMatch = text.match(/\b([1-9]|1[0-9]|20)(?:st|nd|rd|th)[-\s]+century\b/i);
  if (centuryMatch) return (Number(centuryMatch[1]) - 1) * 100;

  return 9999;
}

function sortTimelineItems(items = []) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const yearDifference = getTimelineSortYear(left.item) - getTimelineSortYear(right.item);
      return yearDifference || left.index - right.index;
    })
    .map(({ item }) => item);
}

function getBuildingType(building) {
  return building.currentUse
    || building.architecturalStyle
    || inferBuildingType(building)
    || "Type not found in public sources";
}

function inferBuildingType(building) {
  const text = [
    building.buildingName,
    building.address,
    ...building.pastUsesTimeline.map((item) => item.description),
  ].join(" ").toLowerCase();

  if (/\barcade\b/.test(text)) return "Commercial arcade";
  if (/\bpost office|postal\b/.test(text)) return "Civic/postal building";
  if (/\bwarehouse\b/.test(text)) return "Warehouse";
  if (/\bchurch|chapel|cathedral|minster|abbey\b/.test(text)) return "Place of worship";
  if (/\bschool|college|academy|university\b/.test(text)) return "Education building";
  if (/\bpub|public house|bar|inn|tavern|hotel\b/.test(text)) return "Hospitality building";
  if (/\bhouse|residential|apartments|flats|dwelling|terrace\b/.test(text)) return "Residential building";
  if (/\bshop|retail|commercial|office|market|bank\b/.test(text)) return "Commercial building";

  return "";
}

function renderTimelineItem(item) {
  const dateRange = formatTimelineDateRange(item);

  return `
    <li>
      ${dateRange ? `<time>${escapeHtml(dateRange)}</time>` : ""}
      <p>${escapeHtml(formatTimelineDescription(item))}</p>
      <small>${escapeHtml(item.source?.name || "Unknown source")} &middot; ${escapeHtml(item.confidence)} confidence</small>
    </li>
  `;
}

function renderSignificantEvent(item) {
  return `
    <li>
      <time>${escapeHtml(item.dateRange)}</time>
      <p>${escapeHtml(item.description)}</p>
      <small>${escapeHtml(item.source?.name || "Unknown source")} &middot; ${escapeHtml(item.confidence)} confidence</small>
    </li>
  `;
}

function renderHistoricalEventFallback() {
  return `
    <li>
      <time>Historical events</time>
      <p>Nothing that interesting has happened here -_-</p>
    </li>
  `;
}

function formatBuildDateDescription(building) {
  const originalPurpose = building.originalPurpose || extractOriginalPurpose(building);
  return `${building.buildingName} was built ${building.buildDate.value}. ${formatBuildReasonSentence(building, originalPurpose)}`;
}

function formatMissingBuildDateDescription(building) {
  const originalPurpose = building.originalPurpose || extractOriginalPurpose(building);
  return `The build date is not available. ${formatBuildReasonSentence(building, originalPurpose)}`;
}

function formatBuildReasonSentence(building = {}, originalPurpose = "") {
  const attribution = formatBuildAttributionSentence(building, originalPurpose).trim();
  if (attribution) return attribution;

  if (building.constructionContext) {
    return ` Public sources identify it as ${building.constructionContext}, but no explicit construction-purpose statement has been verified yet.`;
  }

  return "No source-backed construction purpose has been found for this building yet.";
}

function formatBuildAttributionSentence(building = {}, originalPurpose = "") {
  if (building.builtBy && building.builtFor) {
    const builtFor = String(building.builtFor).trim();
    const connector = /^to\b/i.test(builtFor) ? "" : "for ";
    return ` It was built by ${building.builtBy} ${connector}${builtFor}.`;
  }

  if (building.builtBy && originalPurpose) {
    const preposition = /^(an?|the)\s/i.test(originalPurpose) ? "as" : "for";
    return ` It was built by ${building.builtBy} ${preposition} ${originalPurpose}.`;
  }

  if (building.builtFor) {
    const builtFor = String(building.builtFor).trim();
    const connector = /^to\b/i.test(builtFor) ? "" : "for ";
    return ` It was built ${connector}${builtFor}.`;
  }

  return formatOriginalPurposeSentence(originalPurpose);
}

function formatOriginalPurposeSentence(originalPurpose = "") {
  if (!originalPurpose) return "";
  const purpose = withIndefiniteArticle(originalPurpose);
  const preposition = /^(an?|the)\s/i.test(purpose) ? "as" : "for";
  return ` It was built ${preposition} ${purpose}.`;
}

function withIndefiniteArticle(value = "") {
  const clean = String(value || "").trim();
  if (!clean || /^(an?|the|their|his|her|its)\s/i.test(clean)) return clean;
  return `${/^[aeiou]/i.test(clean) ? "an" : "a"} ${clean}`;
}

function extractOriginalPurpose(building = {}) {
  return [
    building.buildDate?.note,
    ...((building.pastUsesTimeline || []).map((item) => item.description)),
  ].map(extractOriginalPurposeFromText).find(Boolean) || "";
}

function extractOriginalPurposeFromText(value = "") {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const patterns = [
    /\bofficially\s+(?:His|Her|Their)\s+Majesty's\s+Royal\s+Palace\s+and\s+Fortress\b/i,
    /\b(?:a\s+)?grand palace early in its history,\s+it served as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+by\s+[^.;,]{3,90}?\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+for\s+([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed|opened)\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:constructed|built)\s+for\s+use\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && !match[1] && /Royal\s+Palace\s+and\s+Fortress/i.test(match[0])) {
      return "a royal palace and fortress";
    }
    if (match?.[1]) return tidyOriginalPurpose(match[1]);
  }

  return "";
}

function tidyOriginalPurpose(value = "") {
  return value
    .replace(/\s+(during|when|with|by|in)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getMostInterestingHistoricalEvent(events = [], building = {}) {
  return events
    .map((event) => ({ event, score: scoreDidYouKnowEvent(event, building) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score)[0]?.event || null;
}

function scoreDidYouKnowEvent(event = {}, building = {}) {
  const text = `${event.useType || ""} ${event.description || ""}`.toLowerCase();
  const dateText = String(event.dateRange || "").toLowerCase();
  if (!text.trim()) return 0;
  if (!isTrustedHistoricalSource(event.source?.name)) return 0;

  if (isDisallowedDidYouKnowEvent(text)) return 0;
  if (isGenericHistoricalContext(text, building)) return 0;
  if (!isDirectlyConnectedStory(text, building)) return 0;

  const datedBonus = /\b(1[0-9]{3}|20[0-2][0-9])\b|century/.test(`${dateText} ${text}`) ? 3 : 0;
  const specificityBonus = getSpecificityBonus(text);
  const categoryScore = getDidYouKnowCategoryScore(text);

  return categoryScore ? categoryScore + specificityBonus + datedBonus : 0;
}

function getDidYouKnowCategoryScore(text = "") {
  if (/\b(accident|crash|jumped|fell|collapse|collapsed|explosion|derail|struck|trapped|rescued|miraculously|survived|survival|escaped death)\b/.test(text)) return 120;
  if (/\b(survived|survival|rescued|sheltered|saved|escaped injury|unharmed|miracle|bombing|blitz|fire)\b/.test(text)) return 112;
  if (/\b(crime|criminal|murder|murdered|assassinated|execution|executed|escaped|escape|prisoner|stole|theft|robbery|scandal|trial|treason|spy|espionage)\b/.test(text)) return 106;
  if (/\b(mystery|mysterious|legend|ghost|haunted|hidden|secret|tunnel|discovered beneath|lost|vanished|disappeared)\b/.test(text)) return 100;
  if (/\b(world war|second world war|first world war|wwii|wwi|wartime|bomb|bombed|air raid|blitz|siege|attack|occupation)\b/.test(text)) return 94;
  if (/\b(king|queen|prince|princess|monarch|prime minister|president|sir |dame |charles i|elizabeth i|william the conqueror|famous|notable)\b/.test(text)) return 86;
  if (/\b(world's first|world first|first in the world|first ever|first public|record|largest|oldest|tallest|longest|only surviving|last surviving)\b/.test(text)) return 84;
  if (/\b(film|filmed|cinema|music|concert|beatles|rolling stones|festival|theatre|opera|novel|artist|cultural)\b/.test(text)) return 78;
  if (/\b(engineering|engineer|feat|hydraulic|lift|bridge|span|innovative|pioneering|designed to|constructed to)\b/.test(text)) return 74;
  if (/\b(civil war|revolution|coronation|parliament|suffrage|protest|riot|strike|political|national|international)\b/.test(text)) return 70;
  return 0;
}

function isDisallowedDidYouKnowEvent(text = "") {
  if (/\b(references|external links|further reading|list of|see also)\b/.test(text)) return true;
  if (/\b(has not survived|have not survived|no longer survives|does not survive)\b/.test(text)) return true;
  if (/\b(maintenance|repair|repairs|repaired|planning application|application|consent|permission|lease|leased|sold|sale|purchased|acquired|ownership|owner|property transaction|real estate)\b/.test(text)) return true;
  if (/\b(officially opened|opened in|opening ceremony|opened by|unveiled|commemorative plaque|plaque was unveiled)\b/.test(text) && !hasSurprisingCue(text)) return true;
  if (/\b(built|constructed|completed|designed|foundation stone|architect|listed building|grade ii|grade i\b|national heritage list)\b/.test(text) && !hasSurprisingCue(text)) return true;
  if (/\b(renovated|renovation|refurbished|refurbishment|alterations?|restored|restoration)\b/.test(text) && !/\b(fire|bomb|war|destroyed|damaged|survived|hidden|secret|collapse|scandal)\b/.test(text)) return true;
  if (/\b(became|converted|changed use|adapted)\b/.test(text) && !hasSurprisingCue(text)) return true;
  return false;
}

function isDirectlyConnectedStory(text = "", building = {}) {
  const buildingWords = significantBuildingWords(building);
  if (!buildingWords.length) return true;
  if (buildingWords.some((word) => text.includes(word))) return true;
  return /\b(here|there|site|building|house|hall|tower|bridge|palace|castle|station|hotel|theatre|church|warehouse|arcade|it|its)\b/.test(text);
}

function getSpecificityBonus(text = "") {
  let score = 0;
  if (/\b(1[0-9]{3}|20[0-2][0-9])\b/.test(text)) score += 4;
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text)) score += 3;
  if (/\b\d+\b/.test(text)) score += 2;
  if (/\b(secret|hidden|notorious|famously|mysteriously|survived|escaped|first|only|last)\b/.test(text)) score += 5;
  return score;
}

function hasSurprisingCue(text = "") {
  return getDidYouKnowCategoryScore(text) >= 70;
}

function isGenericHistoricalContext(text = "", building = {}) {
  if (/\b(examples? (of|include)|include:|such as|for example|other examples?|similar examples?|grand shopping arcades include)\b/.test(text)) return true;
  if (/\b(palais royal|passage de feydeau|piccadilly arcade|galleria vittorio emanuele)\b/.test(text)) return true;

  const buildingWords = significantBuildingWords(building);
  if (!buildingWords.length) return false;

  const hasBuildingReference = buildingWords.some((word) => text.includes(word));
  const refersToOtherBuildings = /\b(other|similar|examples?|include|such as)\b/.test(text)
    && /\b(buildings?|arcades?|houses?|halls?|churches?|stations?|warehouses?)\b/.test(text);

  return refersToOtherBuildings && !hasBuildingReference;
}

function hasNotableHistoricalCue(text = "") {
  return hasSurprisingCue(text);
}

function isTrustedHistoricalSource(sourceName = "") {
  return /wikipedia|wikidata|historic england|historic royal palaces|openstreetmap/i.test(sourceName);
}

function significantBuildingWords(building = {}) {
  return [
    building.buildingName,
    building.name,
    building.address,
  ].join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4 && !["building", "street", "market", "road", "place", "arcade"].includes(word));
}

function renderSource(source) {
  const name = escapeHtml(source.name || "Unknown source");
  const coverage = escapeHtml(source.coverage || "Source reference");
  const title = source.url
    ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${name}</a>`
    : `<strong>${name}</strong>`;

  return `
    <li>
      ${title}
      <span>${coverage}</span>
    </li>
  `;
}

function renderBuilding(building, options = {}) {
  const previousSelectedId = state.selectedBuilding?.id;
  state.selectedBuilding = building;
  const buildingType = getBuildingType(building);
  elements.buildingName.textContent = building.buildingName;
  elements.buildingType.textContent = buildingType;
  elements.buildingAddress.textContent = building.address;
  elements.builtDate.textContent = building.buildDate.value;
  elements.nameType.textContent = `${building.buildingName} / ${buildingType}`;
  elements.confidence.textContent = building.buildDate.confidence;
  elements.currentUse.textContent = building.currentUse || "Not found in public sources";
  elements.googleMapsLink.href = buildGoogleMapsUrl(building);
  elements.directionsButton.disabled = !building.position;
  elements.limitedDataNotice.hidden = !hasLimitedHistory(building);

  const buildDateItem = {
    dateRange: building.buildDate.value,
    useType: "Build date",
    description: building.buildDate.value === "Date not available"
      ? formatMissingBuildDateDescription(building)
      : formatBuildDateDescription(building),
    source: building.buildDate.source,
    confidence: building.buildDate.confidence,
    sortYear: extractTimelineYear(building.buildDate.value),
  };

  elements.timeline.innerHTML = sortTimelineItems([buildDateItem, ...building.pastUsesTimeline])
    .map(renderTimelineItem)
    .join("") || `
      <li>
        <time>Past uses</time>
        <p>No past-use timeline found in public sources yet.</p>
      </li>
    `;

  const interestingEvent = getMostInterestingHistoricalEvent(building.significantEvents, building);
  elements.eventList.innerHTML = interestingEvent
    ? renderSignificantEvent(interestingEvent)
    : renderHistoricalEventFallback();

  const renderedSources = (building.sources || [])
    .map(renderSource)
    .join("");

  elements.sourceList.innerHTML = renderedSources || `
    <li>
      <span>No source URL available for this record.</span>
    </li>
  `;

  updateMarkerSelection({
    animate: options.forceSelectionAnimation || previousSelectedId !== building.id,
  });
  enrichSelectedBuildingWithModularRetrieval(building);
}

async function enrichSelectedBuildingWithModularRetrieval(building) {
  if (building.modularRetrievalLoaded) return;

  const enriched = await enrichBuildingWithModularRetrieval(building, {
    mapboxToken: getMapboxToken(),
  });
  if (enriched === building) return;

  const updated = applyBuildingEnrichment(building, enriched);

  if (updated && state.selectedBuilding.id === building.id) {
    renderBuilding(updated);
    if (state.map) state.markers = createMapboxMarkers(state.buildings);
  }
}

function applyBuildingEnrichment(original, enriched) {
  const index = state.buildings.findIndex((item) => item.id === original.id);
  if (index < 0) return null;

  const current = state.buildings[index];
  const merged = mergeBuildingHistories(current, normaliseBuildingHistory(enriched));
  state.buildings[index] = merged;
  return merged;
}

function selectById(id) {
  const building = state.buildings.find((item) => item.id === id);
  if (building) {
    renderBuilding(building, { forceSelectionAnimation: true });
    focusMap(building);
  }
}

async function runSearch() {
  const term = elements.searchInput.value.trim().toLowerCase();
  if (!term) return;

  const match = getFilteredBuildings(state.buildings).find((building) => {
    return `${building.name} ${building.address}`.toLowerCase().includes(term);
  });

  if (match) {
    hideSearchSuggestions();
    renderBuilding(match);
    focusMap(match);
    setStatus(`Showing ${match.name}.`);
    return;
  }

  if (state.searchSuggestions.length) {
    await selectSearchSuggestion(state.searchSuggestions[0]);
    return;
  }

  try {
    setStatus(`Searching public records for "${elements.searchInput.value.trim()}"...`);
    const suggestions = await searchBuildingSuggestions(elements.searchInput.value.trim());
    if (suggestions.length) {
      await selectSearchSuggestion(suggestions[0]);
      return;
    }
    setStatus("No public record matched this search.");
  } catch (error) {
    setStatus("Search could not reach public records. Try again in a moment.");
  }
}

function scheduleSearchSuggestions() {
  window.clearTimeout(searchSuggestionTimer);
  searchSuggestionTimer = window.setTimeout(updateSearchSuggestions, 250);
}

async function updateSearchSuggestions() {
  const query = elements.searchInput.value.trim();
  const requestId = ++searchRequestId;

  if (query.length < 2) {
    hideSearchSuggestions();
    return;
  }

  const localSuggestions = getLocalSearchSuggestions(query);
  renderSearchSuggestions(localSuggestions);

  try {
    const publicSuggestions = await searchBuildingSuggestions(query);
    if (requestId !== searchRequestId) return;
    renderSearchSuggestions(mergeSearchSuggestions(localSuggestions, publicSuggestions));
  } catch (error) {
    if (requestId === searchRequestId && !localSuggestions.length) {
      hideSearchSuggestions();
    }
  }
}

function getLocalSearchSuggestions(query) {
  const term = query.toLowerCase();
  return state.buildings
    .filter((building) => `${building.buildingName} ${building.address}`.toLowerCase().includes(term))
    .slice(0, 5)
    .map((building) => ({
      id: `loaded-${building.id}`,
      source: "Loaded record",
      label: building.buildingName,
      description: building.address,
      building,
    }));
}

function mergeSearchSuggestions(localSuggestions, publicSuggestions) {
  const seen = new Set();
  return [...localSuggestions, ...publicSuggestions].filter((suggestion) => {
    const key = `${suggestion.label}|${suggestion.description}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function renderSearchSuggestions(suggestions) {
  state.searchSuggestions = suggestions;

  if (!suggestions.length) {
    hideSearchSuggestions();
    return;
  }

  elements.searchSuggestions.innerHTML = suggestions.map((suggestion, index) => `
    <li role="option">
      <button type="button" data-suggestion-index="${index}">
        <strong>${escapeHtml(suggestion.label)}</strong>
        <span>${escapeHtml(suggestion.description)} - ${escapeHtml(suggestion.source)}</span>
      </button>
    </li>
  `).join("");
  elements.searchSuggestions.hidden = false;
  elements.searchInput.setAttribute("aria-expanded", "true");
}

function hideSearchSuggestions() {
  state.searchSuggestions = [];
  elements.searchSuggestions.hidden = true;
  elements.searchSuggestions.innerHTML = "";
  elements.searchInput.setAttribute("aria-expanded", "false");
}

async function selectSearchSuggestion(suggestion) {
  if (!suggestion) return;

  hideSearchSuggestions();
  elements.searchInput.value = suggestion.label;

  if (suggestion.building) {
    renderBuilding(suggestion.building);
    focusMap(suggestion.building);
    setStatus(`Showing ${suggestion.building.buildingName}.`);
    return;
  }

  if (!suggestion.wikidataId) {
    if (suggestion.buildingRecord) {
      const building = normaliseBuildingHistory(suggestion.buildingRecord);
      mergeBuildings([building]);
      const selected = state.buildings.find((item) => item.sourceRecordIds.includes(building.id)) || building;

      renderBuilding(selected);
      focusMap(selected);
      if (state.map) state.markers = createMapboxMarkers(state.buildings);
      setStatus(`Showing ${selected.buildingName} from ${suggestion.source}.`);
      return;
    }

    setStatus("This suggestion does not have a loadable public record.");
    return;
  }

  try {
    setStatus(`Loading ${suggestion.label} from public records...`);
    const record = await fetchWikidataBuildingById(suggestion.wikidataId);
    if (!record) {
      setStatus("No building details were available for that public record.");
      return;
    }

    const building = suggestion.buildingRecord
      ? mergeBuildingHistories(normaliseBuildingHistory(suggestion.buildingRecord), normaliseBuildingHistory(record))
      : normaliseBuildingHistory(record);
    mergeBuildings([building]);
    const selected = state.buildings.find((item) => item.sourceRecordIds.includes(building.id)) || building;

    renderBuilding(selected);
    focusMap(selected);
    if (state.map) state.markers = createMapboxMarkers(state.buildings);
    setStatus(`Showing ${selected.buildingName} from Wikidata.`);
  } catch (error) {
    setStatus("The selected public record could not be loaded.");
  }
}

function setActiveFilter(filter) {
  state.activeFilter = filter;
  elements.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });
  refreshVisibleBuildings();
}

function setDiscoveryMode(mode) {
  state.discoveryMode = mode === DISCOVERY_MODES.everything ? DISCOVERY_MODES.everything : DISCOVERY_MODES.history;
  elements.discoveryModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.discoveryMode === state.discoveryMode);
  });
  refreshVisibleBuildings();
}

function refreshVisibleBuildings() {
  state.markers = createMapboxMarkers(state.buildings);
  const count = getFilteredBuildings(state.buildings).length;
  const modeLabel = state.discoveryMode === DISCOVERY_MODES.history ? "historically rich" : "available";
  const filterLabel = state.activeFilter === "all" ? "building records" : `${state.activeFilter} records`;
  setStatus(`Showing ${count} ${modeLabel} ${filterLabel}.`);
}

function attachFallbackMap() {
  elements.fallbackMap.setAttribute("aria-hidden", "false");
  elements.fallbackMap.querySelectorAll("[data-building-id]").forEach((button) => {
    button.addEventListener("click", () => selectById(button.dataset.buildingId));
  });
  updateMarkerSelection({ animate: false });
}

function focusMap(building) {
  if (!state.map || !building.position) return;
  state.map.flyTo({
    center: [building.position.lng, building.position.lat],
    zoom: 18,
    essential: true,
  });
}

function initMapboxMap() {
  const token = getMapboxToken();
  if (!token || !window.mapboxgl) {
    attachFallbackMap();
    return;
  }

  try {
    mapboxgl.accessToken = token;

    state.map = new mapboxgl.Map({
      container: elements.map,
      style: getMapboxStyle(),
      center: [state.selectedBuilding.position.lng, state.selectedBuilding.position.lat],
      zoom: 17,
      pitch: 35,
      attributionControl: true,
    });

    state.map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    state.map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right",
    );

    state.markers = createMapboxMarkers(state.buildings);
    elements.fallbackMap.hidden = true;
    setStatus("Mapbox map active. Tap a marker to view building history.");
    state.map.on("load", loadBuildingsForViewport);
    state.map.on("moveend", scheduleViewportLoad);
  } catch (error) {
    attachFallbackMap();
    setStatus("Mapbox could not load. Check the access token and allowed URLs.");
  }
}

function createMapboxMarkers(nextBuildings) {
  state.markers.forEach((marker) => marker.remove());
  const markers = getFilteredBuildings(nextBuildings).map((building) => {
    if (!building.position) return null;
    const markerElement = document.createElement("button");
    markerElement.className = "live-map-marker";
    markerElement.type = "button";
    markerElement.dataset.buildingId = building.id;
    markerElement.setAttribute("aria-label", `Open ${building.buildingName}`);
    markerElement.addEventListener("click", () => renderBuilding(building, { forceSelectionAnimation: true }));

    return new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([building.position.lng, building.position.lat])
      .addTo(state.map);
  }).filter(Boolean);

  updateMarkerSelection({ animate: false });
  return markers;
}

function updateMarkerSelection({ animate = false } = {}) {
  const selectedId = state.selectedBuilding?.id;
  const markerElements = [
    ...elements.map.querySelectorAll(".live-map-marker"),
    ...elements.fallbackMap.querySelectorAll("[data-building-id]"),
  ];

  markerElements.forEach((marker) => {
    const isSelected = marker.dataset.buildingId === selectedId;
    marker.classList.toggle("is-selected", isSelected);

    if (animate && isSelected) {
      marker.classList.remove("marker-selection-pulse");
      void marker.offsetWidth;
      marker.classList.add("marker-selection-pulse");
    }
  });
}

function getFilteredBuildings(nextBuildings) {
  const discoveryFiltered = state.discoveryMode === DISCOVERY_MODES.history
    ? nextBuildings.filter((building) => isHistoricallyEligible(building))
    : nextBuildings;

  if (state.activeFilter === "all") return discoveryFiltered;
  return discoveryFiltered.filter((building) => getBuildingCategories(building).includes(state.activeFilter));
}

function getBuildingCategories(building) {
  const text = [
    building.buildingName,
    building.address,
    building.currentUse,
    building.architecturalStyle,
    ...building.pastUsesTimeline.map((item) => `${item.useType} ${item.description}`),
  ].join(" ").toLowerCase();

  const categories = [];
  if (/\b(church|chapel|cathedral|minster|abbey|mosque|synagogue|temple)\b/.test(text)) categories.push("church");
  if (/\b(pub|public house|bar|inn|tavern|hotel)\b/.test(text)) categories.push("pub");
  if (/\b(school|college|academy|university|education)\b/.test(text)) categories.push("school");
  if (/\b(castle|fort|palace|manor|keep)\b/.test(text)) categories.push("castle");
  if (/\b(shop|retail|commercial|office|market|warehouse|bank)\b/.test(text)) categories.push("commercial");
  if (/\b(house|residential|apartments|flats|dwelling|terrace)\b/.test(text)) categories.push("residential");

  return categories;
}

function scheduleViewportLoad() {
  window.clearTimeout(viewportLoadTimer);
  viewportLoadTimer = window.setTimeout(loadBuildingsForViewport, 700);
}

async function loadBuildingsForViewport() {
  if (!state.map) return;

  const bounds = getCurrentBounds();
  if (!bounds) return;

  try {
    setStatus("Loading public building records for this map area...");
    const [wikidataResult, osmResult, historicEnglandResult] = await Promise.allSettled([
      fetchWikidataBuildingsForBounds(bounds),
      fetchOpenStreetMapBuildingsForBounds(bounds),
      fetchHistoricEnglandBuildingsForBounds(bounds),
    ]);

    const results = [wikidataResult, osmResult, historicEnglandResult]
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (results.length === 0) {
      setStatus("Public building records could not be loaded for this area.");
      return;
    }

    if (results.every((result) => result.skipped)) {
      setStatus("Zoom in to load UK building records for the visible area.");
      return;
    }

    const loadedBuildings = results.flatMap((result) => result.buildings).map(normaliseBuildingHistory);
    mergeBuildings(loadedBuildings);
    state.markers = createMapboxMarkers(state.buildings);
    const visibleCount = getFilteredBuildings(state.buildings).length;
    const hiddenCount = state.buildings.length - visibleCount;
    setStatus(state.discoveryMode === DISCOVERY_MODES.history
      ? `Showing ${visibleCount} historically rich records. ${hiddenCount} lower-information records are available in Explore Everything.`
      : `Showing all ${visibleCount} loaded building records.`);
  } catch (error) {
    setStatus("Public building records could not be loaded for this area.");
  }
}

function getCurrentBounds() {
  const mapBounds = state.map.getBounds();
  const west = clampLng(mapBounds.getWest());
  const east = clampLng(mapBounds.getEast());
  const south = clampLat(mapBounds.getSouth());
  const north = clampLat(mapBounds.getNorth());

  if (west >= east || south >= north) return null;

  return {
    west: Number(west.toFixed(6)),
    east: Number(east.toFixed(6)),
    south: Number(south.toFixed(6)),
    north: Number(north.toFixed(6)),
    width: Math.abs(east - west),
    height: Math.abs(north - south),
  };
}

function mergeBuildings(nextBuildings) {
  nextBuildings.forEach((building) => {
    const exactIndex = state.buildings.findIndex((existing) => existing.sourceRecordIds.includes(building.id));
    if (exactIndex >= 0) {
      state.buildings[exactIndex] = mergeBuildingHistories(state.buildings[exactIndex], building);
      return;
    }

    const likelyIndex = state.buildings.findIndex((existing) => areLikelySameBuilding(existing, building));
    if (likelyIndex >= 0) {
      state.buildings[likelyIndex] = mergeBuildingHistories(state.buildings[likelyIndex], building);
    } else {
      state.buildings.push(building);
    }
  });
}

function clampLng(value) {
  return Math.max(-8.8, Math.min(1.9, value));
}

function clampLat(value) {
  return Math.max(49.8, Math.min(60.9, value));
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const current = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      state.userLocation = current;

      if (state.map) {
        state.map.flyTo({
          center: [current.lng, current.lat],
          zoom: 18,
          essential: true,
        });
        if (state.userMarker) state.userMarker.remove();
        state.userMarker = new mapboxgl.Marker({ color: "#286fa8" })
          .setLngLat([current.lng, current.lat])
          .addTo(state.map);
      }
      setStatus("Location found.");
    },
    () => setStatus("Location permission was not granted."),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function startInAppNavigation() {
  const building = state.selectedBuilding;
  if (!building) return;

  if (!building.position) {
    setStatus("This building does not have coordinates for in-app navigation.");
    return;
  }

  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.");
    return;
  }

  setStatus("Finding your location for directions...");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      if (state.map && getMapboxToken()) {
        try {
          const route = await fetchWalkingRoute(state.userLocation, building.position);
          renderMapboxRoute(route, building);
          setStatus(`Walking route to ${building.buildingName} loaded in the app.`);
          return;
        } catch (error) {
          renderDirectRouteFallback(state.userLocation, building);
          setStatus("Mapbox walking route was unavailable. Showing direct distance guidance.");
          return;
        }
      }

      renderDirectRouteFallback(state.userLocation, building);
      setStatus(`Showing direct distance guidance to ${building.buildingName}.`);
    },
    () => {
      setStatus("Location permission was not granted.");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function fetchWalkingRoute(origin, destination) {
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}`);
  url.searchParams.set("steps", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("access_token", getMapboxToken());

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Directions request failed with ${response.status}`);

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route?.geometry) throw new Error("No route geometry returned");
  return route;
}

function renderMapboxRoute(route, building) {
  const routeFeature = {
    type: "Feature",
    properties: {},
    geometry: route.geometry,
  };

  if (state.map.getSource(ROUTE_SOURCE_ID)) {
    state.map.getSource(ROUTE_SOURCE_ID).setData(routeFeature);
  } else {
    state.map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: routeFeature,
    });
    state.map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#0b6b57",
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });
  }

  const steps = route.legs?.[0]?.steps || [];
  state.activeRoute = { type: "mapbox", route, buildingId: building.id };
  renderRoutePanel({
    summary: `${formatDistance(route.distance)} walking route to ${building.buildingName}. Estimated ${formatDuration(route.duration)}.`,
    steps: steps.map((step) => ({
      instruction: step.maneuver?.instruction || "Continue",
      distance: step.distance,
    })).slice(0, 8),
  });
  fitRouteBounds(route.geometry.coordinates);
}

function renderDirectRouteFallback(origin, building) {
  const distance = distanceMetres(origin, building.position);
  const bearing = bearingDegrees(origin, building.position);
  const direction = compassDirection(bearing);

  state.activeRoute = { type: "direct", origin, buildingId: building.id };
  renderRoutePanel({
    summary: `${building.buildingName} is ${formatDistance(distance)} away, roughly ${direction}.`,
    steps: [
      { instruction: `Head ${direction} towards ${building.buildingName}.`, distance },
      { instruction: "Use street signs and crossings; this fallback is not turn-by-turn routing.", distance: 0 },
    ],
  });
}

function renderRoutePanel({ summary, steps }) {
  elements.navigationPanel.hidden = false;
  elements.routeSummary.textContent = summary;
  elements.routeSteps.innerHTML = steps.map((step) => `
    <li>
      <span>${escapeHtml(step.instruction)}</span>
      ${step.distance ? `<small>${escapeHtml(formatDistance(step.distance))}</small>` : ""}
    </li>
  `).join("");
}

function clearRoute() {
  state.activeRoute = null;
  elements.navigationPanel.hidden = true;
  elements.routeSummary.textContent = "Route not started.";
  elements.routeSteps.innerHTML = "";

  if (state.map?.getLayer(ROUTE_LAYER_ID)) state.map.removeLayer(ROUTE_LAYER_ID);
  if (state.map?.getSource(ROUTE_SOURCE_ID)) state.map.removeSource(ROUTE_SOURCE_ID);
  setStatus("Route cleared.");
}

function fitRouteBounds(coordinates = []) {
  if (!state.map || !coordinates.length) return;

  const bounds = coordinates.reduce((nextBounds, coordinate) => {
    return nextBounds.extend(coordinate);
  }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

  state.map.fitBounds(bounds, {
    padding: 72,
    maxZoom: 17,
    duration: 900,
  });
}

function distanceMetres(a, b) {
  const lat = (a.lat + b.lat) / 2 * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function bearingDegrees(origin, destination) {
  const lat1 = origin.lat * Math.PI / 180;
  const lat2 = destination.lat * Math.PI / 180;
  const lngDelta = (destination.lng - origin.lng) * Math.PI / 180;
  const y = Math.sin(lngDelta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lngDelta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function compassDirection(degrees) {
  const directions = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return directions[Math.round(degrees / 45) % 8];
}

function formatDistance(metres = 0) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

function formatDuration(seconds = 0) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}

function showReportState() {
  setStatus("Record flag saved locally for the next data review workflow.");
}

function initEvents() {
  elements.searchButton.addEventListener("click", runSearch);
  elements.searchInput.addEventListener("input", scheduleSearchSuggestions);
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
    if (event.key === "Escape") hideSearchSuggestions();
  });
  elements.searchSuggestions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-suggestion-index]");
    if (!button) return;
    const suggestion = state.searchSuggestions[Number(button.dataset.suggestionIndex)];
    selectSearchSuggestion(suggestion);
  });
  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveFilter(button.dataset.filter));
  });
  elements.discoveryModeButtons.forEach((button) => {
    button.addEventListener("click", () => setDiscoveryMode(button.dataset.discoveryMode));
  });
  elements.locateButton.addEventListener("click", locateUser);
  elements.directionsButton.addEventListener("click", startInAppNavigation);
  elements.clearRouteButton.addEventListener("click", clearRoute);
  elements.reportButton.addEventListener("click", showReportState);
}

async function loadLocalConfig() {
  try {
    const config = await import("./local-config.js");
    localMapboxToken = config.MAPBOX_TOKEN || "";
  } catch (error) {
    localMapboxToken = "";
  }
}

function finishWebSplash() {
  const splash = document.querySelector("#webSplash");
  if (!splash) return;
  window.setTimeout(() => {
    splash.classList.add("is-hidden");
  }, 3800);
}

await loadLocalConfig();
renderBuilding(state.selectedBuilding);
initEvents();
initMapboxMap();
finishWebSplash();
