const WIKIDATA_API_ENDPOINT = "https://www.wikidata.org/w/api.php";
const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const OPENSTREETMAP_SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const SEARCH_RESULT_LIMIT = 6;
export async function searchBuildingSuggestions(query) {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) return [];

  const [osmResult, wikidataResult] = await Promise.allSettled([
    searchOpenStreetMapSuggestions(cleanQuery),
    searchWikidataSuggestions(cleanQuery),
  ]);

  const osmSuggestions = osmResult.status === "fulfilled" ? osmResult.value : [];
  const wikidataSuggestions = wikidataResult.status === "fulfilled" ? wikidataResult.value : [];

  return isLikelyLocalVenueQuery(cleanQuery)
    ? mergeSuggestions(osmSuggestions, wikidataSuggestions)
    : mergeSuggestions(wikidataSuggestions, osmSuggestions);
}

async function searchWikidataSuggestions(cleanQuery) {
  const url = new URL(WIKIDATA_API_ENDPOINT);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("language", "en");
  url.searchParams.set("uselang", "en");
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", String(SEARCH_RESULT_LIMIT));
  url.searchParams.set("search", cleanQuery);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Wikidata search failed with ${response.status}`);

  const data = await response.json();
  return (data.search || []).map((item) => ({
    id: `wikidata-search-${item.id}`,
    source: "Wikidata",
    wikidataId: item.id,
    label: item.label || item.id,
    description: item.description || "Wikidata public record",
    url: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`,
  }));
}

async function searchOpenStreetMapSuggestions(cleanQuery) {
  const variants = buildOpenStreetMapQueryVariants(cleanQuery);
  const settledResults = await Promise.allSettled(variants.map(requestOpenStreetMapSearch));

  return settledResults
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .map(mapOpenStreetMapPlaceToSuggestion)
    .filter(Boolean);
}

async function requestOpenStreetMapSearch(query) {
  const url = new URL(OPENSTREETMAP_SEARCH_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("limit", "4");
  url.searchParams.set("countrycodes", "gb");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: getOpenStreetMapRequestHeaders(),
  });

  if (!response.ok) throw new Error(`OpenStreetMap search failed with ${response.status}`);
  return response.json();
}

function getOpenStreetMapRequestHeaders() {
  const headers = {
    Accept: "application/json",
  };

  if (typeof process !== "undefined") {
    headers["User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
  }

  return headers;
}

function buildOpenStreetMapQueryVariants(query) {
  const variants = new Set([query]);
  const apostropheVariant = query
    .replace(/\bBulls Head\b/i, "Bull's Head")
    .replace(/\bKings Head\b/i, "King's Head")
    .replace(/\bQueens Head\b/i, "Queen's Head")
    .replace(/\bQueens Arms\b/i, "Queen's Arms")
    .replace(/\bKings Arms\b/i, "King's Arms");

  variants.add(apostropheVariant);

  if (!/^the\b/i.test(apostropheVariant)) {
    variants.add(`The ${apostropheVariant}`);
  }

  return [...variants].filter(Boolean).slice(0, 4);
}

function mapOpenStreetMapPlaceToSuggestion(place) {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = place.namedetails?.name
    || place.name
    || place.display_name?.split(",")[0]
    || "OpenStreetMap result";
  const address = place.display_name || "Address not available";
  const osmUrl = `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`;
  const type = titleCase([place.type, place.class].filter(Boolean).join(" "));
  const wikidataId = getWikidataId(place.extratags?.wikidata);
  const nhleId = getNhleId(place.extratags || {});
  const officialWebsite = getWebsiteUrl(place.extratags || {});
  const sourceLinks = [{
    name: "OpenStreetMap search result",
    url: osmUrl,
    coverage: "Mapped place search result including name, location, and address context",
  }];

  if (wikidataId) {
    sourceLinks.push({
      name: "Wikidata record",
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
      coverage: "Linked structured public record from OpenStreetMap",
    });
  }

  if (nhleId) {
    sourceLinks.push({
      name: "Historic England list entry",
      url: `https://historicengland.org.uk/listing/the-list/list-entry/${nhleId}`,
      coverage: "Official National Heritage List for England reference from OpenStreetMap",
    });
  }

  if (officialWebsite) {
    sourceLinks.push({
      name: "Official venue website",
      url: officialWebsite,
      coverage: "Website linked from OpenStreetMap for current venue identity and public description",
    });
  }

  return {
    id: `osm-search-${place.osm_type}-${place.osm_id}`,
    source: "OpenStreetMap",
    wikidataId,
    label: name,
    description: address,
    url: osmUrl,
    buildingRecord: {
      id: `osm-search-${place.osm_type}-${place.osm_id}`,
      sourceRecordIds: [
        `osm-search-${place.osm_type}-${place.osm_id}`,
        wikidataId && `wikidata-${wikidataId}`,
        nhleId && `historic-england-${nhleId}`,
      ].filter(Boolean),
      wikidataId,
      nhleId,
      officialWebsite,
      officialName: name,
      commonName: name,
      name,
      address,
      position: { lat, lng },
      buildDate: {
        value: "Date not available",
        confidence: "unknown",
        source: { name: "OpenStreetMap", url: osmUrl, coverage: "Search result and mapped place geometry" },
      },
      architecturalStyle: "",
      currentUse: type || "",
      sources: [
        "openstreetmap",
        ...(wikidataId ? ["wikidata"] : []),
        ...(nhleId ? ["historic-england"] : []),
        ...(officialWebsite ? [{ name: "Official venue website", url: officialWebsite, coverage: "Website linked from OpenStreetMap" }] : []),
      ],
      sourceLinks,
      pastUsesTimeline: type ? [{
        dateRange: "Current mapped use",
        useType: "Current mapped use",
        description: type,
        source: { name: "OpenStreetMap", url: osmUrl, coverage: "Mapped place tags" },
        confidence: "medium",
      }] : [],
      significantEvents: [],
    },
  };
}

function mergeSuggestions(...suggestionGroups) {
  const seen = new Set();
  return suggestionGroups.flat().filter((suggestion) => {
    const key = `${suggestion.label}|${suggestion.description}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, SEARCH_RESULT_LIMIT);
}

function isLikelyLocalVenueQuery(query) {
  return /\b(pub|inn|tavern|arms|head|crown|lion|bull|bulls|bull's|king|king's|kings|queen|queen's|queens|red lion|white hart|rose and crown)\b/i.test(query);
}

export async function fetchWikidataBuildingById(wikidataId) {
  const cleanId = String(wikidataId || "").trim();
  if (!/^Q\d+$/.test(cleanId)) return null;

  const query = buildEntityQuery(cleanId);
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: getRequestHeaders(),
  });

  if (!response.ok) throw new Error(`Wikidata entity lookup failed with ${response.status}`);

  const data = await response.json();
  const binding = data.results?.bindings?.[0];
  return binding ? mapBindingToBuilding(binding, cleanId) : null;
}

function getRequestHeaders() {
  const headers = {
    Accept: "application/sparql-results+json",
    "Api-User-Agent": "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)",
  };

  if (typeof process !== "undefined") {
    headers["User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
  }

  return headers;
}

function buildEntityQuery(wikidataId) {
  return `
SELECT ?item ?itemLabel ?itemDescription
       (SAMPLE(?coord) AS ?coordSample)
       (SAMPLE(?inception) AS ?inceptionSample)
       (GROUP_CONCAT(DISTINCT ?instanceLabel; separator=", ") AS ?instances)
       (GROUP_CONCAT(DISTINCT ?useLabel; separator=", ") AS ?uses)
       (GROUP_CONCAT(DISTINCT ?heritageLabel; separator=", ") AS ?heritage)
       (GROUP_CONCAT(DISTINCT ?styleLabel; separator=", ") AS ?styles)
       (GROUP_CONCAT(DISTINCT ?nhle; separator=", ") AS ?nhleIds)
       (SAMPLE(?openingDate) AS ?openingDateSample)
       (SAMPLE(?article) AS ?articleSample)
WHERE {
  VALUES ?item { wd:${wikidataId} }
  OPTIONAL { ?item wdt:P625 ?coord. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P366 ?use. }
  OPTIONAL { ?item wdt:P1435 ?heritage. }
  OPTIONAL { ?item wdt:P1216 ?nhle. }
  OPTIONAL { ?item wdt:P149 ?style. }
  OPTIONAL { ?item wdt:P1619 ?openingDate. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?item rdfs:label ?itemLabel.
    ?item schema:description ?itemDescription.
    ?instance rdfs:label ?instanceLabel.
    ?use rdfs:label ?useLabel.
    ?heritage rdfs:label ?heritageLabel.
    ?style rdfs:label ?styleLabel.
  }
}
GROUP BY ?item ?itemLabel ?itemDescription
LIMIT 1`;
}

function mapBindingToBuilding(binding, wikidataId) {
  const itemUrl = binding.item?.value || `https://www.wikidata.org/wiki/${wikidataId}`;
  const position = parseWktPoint(binding.coordSample?.value);
  const built = formatInception(binding.inceptionSample?.value);
  const name = cleanValue(binding.itemLabel?.value) || wikidataId;
  const description = cleanValue(binding.itemDescription?.value);
  const uses = splitValues(binding.uses?.value);
  const instances = splitValues(binding.instances?.value);
  const heritage = splitValues(binding.heritage?.value);
  const styles = splitValues(binding.styles?.value);
  const nhleIds = splitValues(binding.nhleIds?.value);
  const openingDate = formatInception(binding.openingDateSample?.value);
  const articleUrl = binding.articleSample?.value || "";

  return {
    id: `wikidata-${wikidataId}`,
    sourceRecordIds: [
      `wikidata-${wikidataId}`,
      ...nhleIds.map((id) => `historic-england-${id}`),
    ],
    nhleId: nhleIds[0] || "",
    officialName: name,
    commonName: name,
    name,
    address: description || "Address not available",
    buildDate: {
      value: built,
      confidence: built === "Unknown" ? "low" : "medium",
      source: { name: "Wikidata", url: itemUrl, coverage: "Structured public data" },
    },
    architecturalStyle: styles[0] || "",
    currentUse: [...uses, ...instances][0] || "",
    position,
    sources: ["wikidata", ...(articleUrl ? ["wikipedia"] : []), ...(nhleIds.length ? ["historic-england"] : [])],
    sourceLinks: [
      { name: "Wikidata record", url: itemUrl, coverage: "Structured public data and source references" },
      ...(articleUrl ? [{ name: "Wikipedia article", url: articleUrl, coverage: "Narrative public reference where available" }] : []),
      ...nhleIds.map((id) => ({
        name: "Historic England list entry",
        url: `https://historicengland.org.uk/listing/the-list/list-entry/${id}`,
        coverage: "Official National Heritage List for England record linked from Wikidata",
      })),
    ],
    pastUsesTimeline: buildPastUsesTimeline({ built, uses, instances, itemUrl }),
    significantEvents: buildSignificantEvents({ openingDate, heritage, itemUrl }),
  };
}

function buildPastUsesTimeline({ built, uses, instances, itemUrl }) {
  const values = [...uses, ...instances].filter(Boolean);
  if (!values.length) return [];

  return [{
    dateRange: built === "Unknown" ? "Undated recorded use" : `${built}-present`,
    useType: "Recorded use",
    description: values.slice(0, 5).join(", "),
    source: { name: "Wikidata", url: itemUrl, coverage: "Structured use/type statements" },
    confidence: "medium",
  }];
}

function buildSignificantEvents({ openingDate, heritage, itemUrl }) {
  const source = { name: "Wikidata", url: itemUrl, coverage: "Structured public data" };
  const events = [];

  if (openingDate !== "Unknown") {
    events.push({
      dateRange: openingDate,
      useType: "Opening",
      description: "Opening date recorded in Wikidata.",
      source,
      confidence: "medium",
    });
  }

  heritage.forEach((item) => events.push({
    dateRange: "Heritage listing",
    useType: "Heritage",
    description: item,
    source,
    confidence: "medium",
  }));

  return events;
}

function parseWktPoint(value = "") {
  const match = value.match(/Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/);
  if (!match) return null;
  return {
    lng: Number(match[1]),
    lat: Number(match[2]),
  };
}

function formatInception(value) {
  if (!value) return "Unknown";
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) ? `c. ${year}` : "Unknown";
}

function splitValues(value = "") {
  return value
    .split(",")
    .map((item) => cleanValue(item))
    .filter(Boolean);
}

function cleanValue(value = "") {
  return value.trim();
}

function titleCase(value = "") {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWikidataId(value = "") {
  const match = String(value).trim().match(/^Q\d+$/i);
  return match ? match[0].toUpperCase() : "";
}

function getNhleId(tags = {}) {
  return ["ref:GB:nhle", "ref:GB:NHLE", "heritage:ref", "nhle", "NHLE"]
    .map((tag) => tags[tag])
    .map((value) => String(value || "").match(/\b\d{7}\b/)?.[0] || "")
    .find(Boolean) || "";
}

function getWebsiteUrl(tags = {}) {
  const value = tags.website || tags["contact:website"] || tags.url || "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value;
}
