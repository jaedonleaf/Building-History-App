const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const MAX_VIEWPORT_DEGREES = 0.22;

export async function fetchWikidataBuildingsForBounds(bounds) {
  if (!bounds || bounds.width > MAX_VIEWPORT_DEGREES || bounds.height > MAX_VIEWPORT_DEGREES) {
    return { buildings: [], skipped: true };
  }

  const query = buildQuery(bounds);
  const url = `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Wikidata request failed with ${response.status}`);
  }

  const data = await response.json();
  return {
    buildings: data.results.bindings.map(mapBindingToBuilding).filter(Boolean),
    skipped: false,
  };
}

function getRequestHeaders() {
  const headers = {
    Accept: "application/sparql-results+json",
  };

  if (typeof process !== "undefined") {
    headers["Api-User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
    headers["User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
  }

  return headers;
}

function buildQuery(bounds) {
  return `
SELECT ?item ?itemLabel ?itemDescription
       (SAMPLE(?coord) AS ?coordSample)
       (SAMPLE(?inception) AS ?inceptionSample)
       (GROUP_CONCAT(DISTINCT ?instanceLabel; separator=", ") AS ?instances)
       (GROUP_CONCAT(DISTINCT ?useLabel; separator=", ") AS ?uses)
       (GROUP_CONCAT(DISTINCT ?heritageLabel; separator=", ") AS ?heritage)
       (GROUP_CONCAT(DISTINCT ?architectLabel; separator=", ") AS ?architects)
       (GROUP_CONCAT(DISTINCT ?styleLabel; separator=", ") AS ?styles)
       (GROUP_CONCAT(DISTINCT ?eventTimeline; separator=";;") AS ?events)
       (SAMPLE(?openingDate) AS ?openingDateSample)
       (SAMPLE(?article) AS ?articleSample)
WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${bounds.west} ${bounds.south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${bounds.east} ${bounds.north})"^^geo:wktLiteral .
  }
  ?item wdt:P17 wd:Q145 .
  ?item wdt:P31 ?instance .
  ?item wdt:P571 ?inception.
  OPTIONAL { ?item wdt:P366 ?use. }
  OPTIONAL { ?item wdt:P1435 ?heritage. }
  OPTIONAL { ?item wdt:P84 ?architect. }
  OPTIONAL { ?item wdt:P149 ?style. }
  OPTIONAL { ?item p:P793 ?eventStatement. ?eventStatement ps:P793 ?event. OPTIONAL { ?eventStatement pq:P585 ?eventDate. } }
  OPTIONAL { ?item wdt:P1619 ?openingDate. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?item rdfs:label ?itemLabel.
    ?item schema:description ?itemDescription.
    ?instance rdfs:label ?instanceLabel.
    ?use rdfs:label ?useLabel.
    ?heritage rdfs:label ?heritageLabel.
    ?architect rdfs:label ?architectLabel.
    ?style rdfs:label ?styleLabel.
    ?event rdfs:label ?eventLabel.
  }
  BIND(IF(BOUND(?event), CONCAT(IF(BOUND(?eventDate), STR(YEAR(?eventDate)), ""), "|", ?eventLabel), "") AS ?eventTimeline)
}
GROUP BY ?item ?itemLabel ?itemDescription
ORDER BY ?itemLabel
LIMIT 120`;
}

function mapBindingToBuilding(binding) {
  const position = parseWktPoint(binding.coordSample?.value);
  const itemUrl = binding.item?.value;
  const name = cleanValue(binding.itemLabel?.value);

  if (!position || !itemUrl || !name || name.startsWith("Q")) return null;

  const built = formatInception(binding.inceptionSample?.value);
  const uses = splitValues(binding.uses?.value);
  const instances = splitValues(binding.instances?.value);
  const heritage = splitValues(binding.heritage?.value);
  const architects = splitValues(binding.architects?.value);
  const styles = splitValues(binding.styles?.value);
  const events = parseTimelineValues(binding.events?.value, "Significant event");
  const description = cleanValue(binding.itemDescription?.value);
  const articleUrl = binding.articleSample?.value || "";
  const openingDate = formatInception(binding.openingDateSample?.value);

  return {
    id: `wikidata-${itemUrl.split("/").pop()}`,
    officialName: name,
    commonName: name,
    name,
    address: description || "UK building record from Wikidata",
    buildDate: {
      value: built,
      confidence: built === "Unknown" ? "low" : "medium",
      source: { name: "Wikidata", url: itemUrl, coverage: "Structured public data" },
    },
    built,
    confidence: built === "Unknown" ? "Low" : "Medium",
    architecturalStyle: styles[0] || "",
    currentUse: [...uses, ...instances][0] || "",
    position,
    sources: ["wikidata", ...(articleUrl ? ["wikipedia"] : [])],
    sourceLinks: [
      { name: "Wikidata record", url: itemUrl, coverage: "Structured public data and source references" },
      ...(articleUrl ? [{ name: "Wikipedia article", url: articleUrl, coverage: "Narrative public reference where available" }] : []),
    ],
    pastUsesTimeline: buildPastUsesTimeline({ built, uses, instances, itemUrl }),
    significantEvents: buildSignificantEvents({ built, openingDate, heritage, architects, events, description, itemUrl }),
    timeline: buildTimeline({
      built,
      openingDate,
      uses,
      instances,
      heritage,
      architects,
      events,
      description,
    }),
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

function buildSignificantEvents({ built, openingDate, heritage, architects, events, description, itemUrl }) {
  const source = { name: "Wikidata", url: itemUrl, coverage: "Structured public data" };
  const significantEvents = [];

  if (built !== "Unknown") {
    significantEvents.push({
      dateRange: built,
      useType: "Construction",
      description: "Inception/build date recorded in Wikidata.",
      source,
      confidence: "medium",
    });
  }

  if (openingDate !== "Unknown" && openingDate !== built) {
    significantEvents.push({
      dateRange: openingDate,
      useType: "Opening",
      description: "Opening date recorded in Wikidata.",
      source,
      confidence: "medium",
    });
  }

  heritage.forEach((item) => significantEvents.push({
    dateRange: "Heritage listing",
    useType: "Heritage",
    description: item,
    source,
    confidence: "medium",
  }));

  architects.forEach((item) => significantEvents.push({
    dateRange: "Design attribution",
    useType: "Architect",
    description: item,
    source,
    confidence: "medium",
  }));

  significantEvents.push(...events.map((event) => ({ ...event, source })));

  if (description) {
    significantEvents.push({
      dateRange: "Public description",
      useType: "Description",
      description,
      source,
      confidence: "low",
    });
  }

  return significantEvents;
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

function buildTimeline({ built, openingDate, uses, instances, heritage, architects, events, description }) {
  const timeline = [];

  timeline.push({
    period: built,
    description: built === "Unknown"
      ? "No structured construction date was available in the public record."
      : "Approximate build or inception date from structured public records.",
  });

  if (openingDate !== "Unknown" && openingDate !== built) {
    timeline.push({
      period: openingDate,
      description: "Recorded opening date from structured public records.",
    });
  }

  timeline.push(...sortTimelineEntries(events));

  if (uses.length || instances.length) {
    timeline.push({
      period: "Undated recorded use",
      description: [...uses, ...instances].slice(0, 5).join(", "),
    });
  }

  if (heritage.length) {
    timeline.push({
      period: "Heritage",
      description: heritage.slice(0, 4).join(", "),
    });
  }

  if (architects.length) {
    timeline.push({
      period: "Architect",
      description: architects.slice(0, 4).join(", "),
    });
  }

  if (description) {
    timeline.push({
      period: "Significant points",
      description,
    });
  }

  return timeline;
}

function parseTimelineValues(value = "", fallbackLabel) {
  return value
    .split(";;")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [start, end, label] = item.split("|").map((part) => cleanValue(part));
      if (!label) return null;
      return {
        sortYear: Number(start || end) || 9999,
        period: formatPeriod(start, end, fallbackLabel),
        description: `${fallbackLabel}: ${label}`,
      };
    })
    .filter(Boolean);
}

function formatPeriod(start, end, fallbackLabel) {
  if (start && end) return `c. ${start}-${end}`;
  if (start) return `from c. ${start}`;
  if (end) return `until c. ${end}`;
  return fallbackLabel;
}

function sortTimelineEntries(entries) {
  return entries
    .slice()
    .sort((a, b) => a.sortYear - b.sortYear)
    .map(({ sortYear, ...entry }) => entry);
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
