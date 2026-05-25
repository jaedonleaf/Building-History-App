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
       (GROUP_CONCAT(DISTINCT ?eventLabel; separator=", ") AS ?events)
       (SAMPLE(?article) AS ?articleSample)
WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${bounds.west} ${bounds.south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${bounds.east} ${bounds.north})"^^geo:wktLiteral .
  }
  ?item wdt:P17 wd:Q145 .
  ?item wdt:P31 ?instance .
  FILTER EXISTS { ?item wdt:P1435|wdt:P571|wdt:P84|wdt:P366|wdt:P793 ?anyValue. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P366 ?use. }
  OPTIONAL { ?item wdt:P1435 ?heritage. }
  OPTIONAL { ?item wdt:P84 ?architect. }
  OPTIONAL { ?item wdt:P793 ?event. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?item rdfs:label ?itemLabel.
    ?item schema:description ?itemDescription.
    ?instance rdfs:label ?instanceLabel.
    ?use rdfs:label ?useLabel.
    ?heritage rdfs:label ?heritageLabel.
    ?architect rdfs:label ?architectLabel.
    ?event rdfs:label ?eventLabel.
  }
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
  const events = splitValues(binding.events?.value);
  const description = cleanValue(binding.itemDescription?.value);
  const articleUrl = binding.articleSample?.value || "";

  return {
    id: `wikidata-${itemUrl.split("/").pop()}`,
    name,
    address: description || "UK building record from Wikidata",
    built,
    confidence: built === "Unknown" ? "Low" : "Medium",
    position,
    sources: ["wikidata", ...(articleUrl ? ["wikipedia"] : [])],
    sourceLinks: [
      { name: "Wikidata record", url: itemUrl, coverage: "Structured public data and source references" },
      ...(articleUrl ? [{ name: "Wikipedia article", url: articleUrl, coverage: "Narrative public reference where available" }] : []),
    ],
    timeline: buildTimeline({ built, uses, instances, heritage, architects, events, description }),
  };
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

function buildTimeline({ built, uses, instances, heritage, architects, events, description }) {
  const timeline = [];

  timeline.push({
    period: built,
    description: built === "Unknown"
      ? "No structured construction date was available in the public record."
      : "Approximate build or inception date from structured public records.",
  });

  if (uses.length || instances.length) {
    timeline.push({
      period: "Recorded use",
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

  if (events.length) {
    timeline.push({
      period: "Significant points",
      description: events.slice(0, 5).join(", "),
    });
  } else if (description) {
    timeline.push({
      period: "Significant points",
      description,
    });
  }

  return timeline;
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
