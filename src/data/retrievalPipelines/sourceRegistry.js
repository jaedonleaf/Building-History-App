export const CONFIDENCE_WEIGHTS = {
  governmentDataset: 95,
  statutoryHeritageRegister: 90,
  heritageGatewayArchiveMuseum: 85,
  universitySpecialistInstitution: 80,
  localHistorySociety: 75,
  specialistHeritageOrganisation: 70,
  citedWiki: 65,
  communityMap: 60,
  blogArticle: 50,
  unverifiedClaim: 30,
};

export const SOURCE_CATEGORIES = {
  primaryIdentity: "primary_identity",
  secondaryIdentity: "secondary_identity",
  primaryLocation: "primary_location",
  secondaryLocation: "secondary_location",
  coreRegistry: "core_registry",
  highestConfidenceHeritage: "highest_confidence_heritage",
  strongSecondaryHeritage: "strong_secondary_heritage",
  buildPurposePrimary: "build_purpose_primary",
  buildPurposeSecondary: "build_purpose_secondary",
  currentUsePrimary: "current_use_primary",
  currentUseSecondary: "current_use_secondary",
  currentUsePubSpecific: "current_use_pub_specific",
  previousUsePrimary: "previous_use_primary",
  historicMap: "historic_map",
  previousUseSupporting: "previous_use_supporting",
  listedStatusOfficial: "listed_status_official",
  listedStatusSecondary: "listed_status_secondary",
  newspaper: "newspaper",
  archive: "archive",
  localHistory: "local_history",
  historicalEventSupporting: "historical_event_supporting",
  sourceRouting: "source_routing",
};

export const SOURCE_PACKS = {
  pub: [
    "camra-pub-search",
    "camra-heritage-pubs",
    "pub-heritage",
    "historic-england-nhle",
    "heritage-gateway",
    "british-newspaper-archive",
    "local-newspapers",
    "local-history-societies",
  ],
  church: [
    "historic-england-nhle",
    "parish-records",
    "diocese-archives",
    "heritage-gateway",
  ],
  railway: [
    "historic-england-nhle",
    "railway-archives",
    "national-archives",
    "british-newspaper-archive",
    "local-newspapers",
  ],
  castle: [
    "historic-england-nhle",
    "national-archives",
    "heritage-gateway",
  ],
  industrial: [
    "historic-england-nhle",
    "national-library-scotland-maps",
    "national-archives",
    "local-museums",
  ],
};

export const SOURCE_REGISTRY = [
  source({
    id: "osm-nominatim",
    source_name: "OpenStreetMap Nominatim",
    source_url: "https://nominatim.openstreetmap.org",
    source_category: SOURCE_CATEGORIES.primaryIdentity,
    coverage_area: "Global place search, canonical names, aliases, coordinates, place matching",
    confidence_weight: CONFIDENCE_WEIGHTS.communityMap,
    supported_pipelines: ["identity", "location", "sourceDiscovery"],
  }),
  source({
    id: "overpass-api",
    source_name: "Overpass API",
    source_url: "https://overpass-api.de",
    source_category: SOURCE_CATEGORIES.primaryIdentity,
    coverage_area: "OpenStreetMap feature tags, building type, coordinates, current use, linked websites",
    confidence_weight: CONFIDENCE_WEIGHTS.communityMap,
    supported_pipelines: ["identity", "location", "sourceDiscovery", "currentUse"],
  }),
  source({
    id: "wikidata-query-service",
    source_name: "Wikidata Query Service",
    source_url: "https://query.wikidata.org",
    source_category: SOURCE_CATEGORIES.primaryIdentity,
    coverage_area: "Structured public identifiers, aliases, instance-of/type, inception, coordinates",
    confidence_weight: CONFIDENCE_WEIGHTS.citedWiki,
    supported_pipelines: ["identity", "sourceDiscovery", "buildDate", "whyBuilt", "coolHistoricalEvent"],
  }),
  source({
    id: "geonames",
    source_name: "GeoNames",
    source_url: "https://www.geonames.org/export/web-services.html",
    source_category: SOURCE_CATEGORIES.secondaryIdentity,
    coverage_area: "Place matching, names, coordinates, administrative geography",
    confidence_weight: CONFIDENCE_WEIGHTS.universitySpecialistInstitution,
    supported_pipelines: ["identity", "location"],
  }),
  source({
    id: "mapbox-geocoding",
    source_name: "Mapbox Geocoding",
    source_url: "https://docs.mapbox.com/api/search/geocoding/",
    source_category: SOURCE_CATEGORIES.secondaryIdentity,
    coverage_area: "Place metadata, address matching, coordinates, postcode validation when configured",
    confidence_weight: CONFIDENCE_WEIGHTS.universitySpecialistInstitution,
    supported_pipelines: ["identity", "location", "currentUse"],
  }),
  source({
    id: "os-open-names",
    source_name: "OS Open Names",
    source_url: "https://www.ordnancesurvey.co.uk/products/os-open-names",
    source_category: SOURCE_CATEGORIES.primaryLocation,
    coverage_area: "Great Britain address/place names, postcodes, coordinate verification",
    confidence_weight: CONFIDENCE_WEIGHTS.governmentDataset,
    supported_pipelines: ["location"],
  }),
  source({
    id: "mapbox-search",
    source_name: "Mapbox Search",
    source_url: "https://docs.mapbox.com/api/search/",
    source_category: SOURCE_CATEGORIES.secondaryLocation,
    coverage_area: "Business/place search, place metadata, opening status where configured",
    confidence_weight: CONFIDENCE_WEIGHTS.universitySpecialistInstitution,
    supported_pipelines: ["identity", "location", "currentUse"],
  }),
  source({
    id: "google-places",
    source_name: "Google Places",
    source_url: "https://developers.google.com/maps/documentation/places/web-service",
    source_category: SOURCE_CATEGORIES.secondaryLocation,
    coverage_area: "Place metadata, business status, category, coordinates and address when configured",
    confidence_weight: CONFIDENCE_WEIGHTS.universitySpecialistInstitution,
    supported_pipelines: ["identity", "location", "currentUse"],
  }),
  source({
    id: "historic-england-open-data-hub",
    source_name: "Historic England Open Data Hub",
    source_url: "https://historicengland.org.uk/listing/the-list/data-downloads/",
    source_category: SOURCE_CATEGORIES.coreRegistry,
    coverage_area: "England protected heritage open data and NHLE downloads",
    confidence_weight: CONFIDENCE_WEIGHTS.statutoryHeritageRegister,
    supported_pipelines: ["sourceDiscovery", "buildDate", "whyBuilt", "previousUse", "listedStatus"],
  }),
  source({
    id: "historic-england-open-data-api",
    source_name: "Historic England Open Data API",
    source_url: "https://opendata-historicengland.hub.arcgis.com/",
    source_category: SOURCE_CATEGORIES.coreRegistry,
    coverage_area: "England protected heritage open data API options",
    confidence_weight: CONFIDENCE_WEIGHTS.statutoryHeritageRegister,
    supported_pipelines: ["sourceDiscovery", "buildDate", "whyBuilt", "previousUse", "listedStatus"],
  }),
  source({
    id: "planning-data-uk",
    source_name: "Planning Data UK",
    source_url: "https://www.planning.data.gov.uk/",
    source_category: SOURCE_CATEGORIES.coreRegistry,
    coverage_area: "England planning and listed-building dataset discovery",
    confidence_weight: CONFIDENCE_WEIGHTS.governmentDataset,
    supported_pipelines: ["sourceDiscovery", "listedStatus"],
  }),
  source({
    id: "wikidata",
    source_name: "Wikidata",
    source_url: "https://www.wikidata.org",
    source_category: SOURCE_CATEGORIES.coreRegistry,
    coverage_area: "Structured public data, identifiers, aliases, citations where present",
    confidence_weight: CONFIDENCE_WEIGHTS.citedWiki,
    supported_pipelines: ["identity", "sourceDiscovery", "buildDate", "whyBuilt", "coolHistoricalEvent"],
  }),
  source({
    id: "wikipedia-api",
    source_name: "Wikipedia API",
    source_url: "https://en.wikipedia.org/api/rest_v1/",
    source_category: SOURCE_CATEGORIES.coreRegistry,
    coverage_area: "Narrative encyclopedic summaries and cited historical context",
    confidence_weight: CONFIDENCE_WEIGHTS.citedWiki,
    supported_pipelines: ["sourceDiscovery", "whyBuilt", "coolHistoricalEvent"],
  }),
  source({
    id: "historic-england-nhle",
    source_name: "National Heritage List for England (NHLE)",
    source_url: "https://historicengland.org.uk/listing/the-list/",
    source_category: SOURCE_CATEGORIES.highestConfidenceHeritage,
    coverage_area: "Official up-to-date register of nationally protected historic buildings and sites in England",
    confidence_weight: CONFIDENCE_WEIGHTS.statutoryHeritageRegister,
    supported_pipelines: ["buildDate", "whyBuilt", "previousUse", "listedStatus", "coolHistoricalEvent"],
  }),
  source({
    id: "planning-data-listed-buildings",
    source_name: "Planning Data Listed Buildings",
    source_url: "https://www.planning.data.gov.uk/dataset/listed-building",
    source_category: SOURCE_CATEGORIES.highestConfidenceHeritage,
    coverage_area: "Listed building dataset specifications and data for planning records",
    confidence_weight: CONFIDENCE_WEIGHTS.governmentDataset,
    supported_pipelines: ["listedStatus", "sourceDiscovery"],
  }),
  source({
    id: "heritage-gateway",
    source_name: "Heritage Gateway",
    source_url: "https://www.heritagegateway.org.uk/",
    source_category: SOURCE_CATEGORIES.strongSecondaryHeritage,
    coverage_area: "Historic environment records and heritage datasets",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["buildDate", "whyBuilt", "previousUse", "listedStatus", "coolHistoricalEvent"],
  }),
  source({
    id: "british-listed-buildings",
    source_name: "British Listed Buildings",
    source_url: "https://britishlistedbuildings.co.uk/",
    source_category: SOURCE_CATEGORIES.strongSecondaryHeritage,
    coverage_area: "Secondary validation for listed buildings and grades",
    confidence_weight: CONFIDENCE_WEIGHTS.specialistHeritageOrganisation,
    supported_pipelines: ["buildDate", "listedStatus"],
  }),
  source({
    id: "historic-environment-scotland",
    source_name: "Historic Environment Scotland",
    source_url: "https://portal.historicenvironment.scot/downloads",
    source_category: SOURCE_CATEGORIES.strongSecondaryHeritage,
    coverage_area: "Scotland heritage datasets and listed building downloads",
    confidence_weight: CONFIDENCE_WEIGHTS.statutoryHeritageRegister,
    supported_pipelines: ["buildDate", "listedStatus", "previousUse"],
  }),
  source({
    id: "historic-england",
    source_name: "Historic England",
    source_url: "https://historicengland.org.uk/",
    source_category: SOURCE_CATEGORIES.buildPurposePrimary,
    coverage_area: "Official heritage descriptions, original purpose, construction phases, architectural period",
    confidence_weight: CONFIDENCE_WEIGHTS.statutoryHeritageRegister,
    supported_pipelines: ["buildDate", "whyBuilt", "previousUse", "listedStatus", "coolHistoricalEvent"],
  }),
  source({
    id: "historic-england-archive",
    source_name: "Historic England Archive",
    source_url: "https://historicengland.org.uk/images-books/archive/",
    source_category: SOURCE_CATEGORIES.buildPurposePrimary,
    coverage_area: "Historic images, archive records, building evolution and historical context",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "local-council-conservation-reports",
    source_name: "Local council conservation documents",
    source_url: "",
    source_category: SOURCE_CATEGORIES.buildPurposeSecondary,
    coverage_area: "Local conservation area appraisals, historical context, land-use change",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["sourceDiscovery", "buildDate", "whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "museum-archives",
    source_name: "Museum archives",
    source_url: "",
    source_category: SOURCE_CATEGORIES.buildPurposeSecondary,
    coverage_area: "Museum-held building histories and local social context",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "local-history-societies",
    source_name: "Local history societies",
    source_url: "",
    source_category: SOURCE_CATEGORIES.buildPurposeSecondary,
    coverage_area: "Local historical context, former uses, incidents, folklore where source-backed",
    confidence_weight: CONFIDENCE_WEIGHTS.localHistorySociety,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "openstreetmap",
    source_name: "OpenStreetMap",
    source_url: "https://www.openstreetmap.org",
    source_category: SOURCE_CATEGORIES.currentUsePrimary,
    coverage_area: "Current mapped use, amenity/shop/tourism tags, official website links",
    confidence_weight: CONFIDENCE_WEIGHTS.communityMap,
    supported_pipelines: ["identity", "location", "currentUse"],
  }),
  source({
    id: "official-business-website",
    source_name: "Official business website",
    source_url: "",
    source_category: SOURCE_CATEGORIES.currentUseSecondary,
    coverage_area: "Operating business, current use, active/inactive status, venue history where present",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["currentUse", "buildDate", "whyBuilt", "previousUse"],
  }),
  source({
    id: "camra-pub-search",
    source_name: "CAMRA Pub Search",
    source_url: "https://camra.org.uk/pubs/",
    source_category: SOURCE_CATEGORIES.currentUsePubSpecific,
    coverage_area: "Pub current use, pub identity, beer/pub metadata, occasional venue history notes",
    confidence_weight: CONFIDENCE_WEIGHTS.specialistHeritageOrganisation,
    supported_pipelines: ["buildDate", "currentUse", "previousUse", "coolHistoricalEvent"],
    source_pack_only: true,
  }),
  source({
    id: "camra-heritage-pubs",
    source_name: "CAMRA Heritage Pubs",
    source_url: "https://camra.org.uk/pubs/",
    source_category: SOURCE_CATEGORIES.historicalEventSupporting,
    coverage_area: "Pub heritage significance, interiors, specialist pub heritage notes",
    confidence_weight: CONFIDENCE_WEIGHTS.specialistHeritageOrganisation,
    supported_pipelines: ["buildDate", "previousUse", "coolHistoricalEvent"],
    source_pack_only: true,
  }),
  source({
    id: "pub-heritage",
    source_name: "Pub Heritage",
    source_url: "",
    source_category: SOURCE_CATEGORIES.historicalEventSupporting,
    coverage_area: "Specialist pub heritage notes, interiors, historic pub significance",
    confidence_weight: CONFIDENCE_WEIGHTS.specialistHeritageOrganisation,
    supported_pipelines: ["buildDate", "previousUse", "coolHistoricalEvent"],
    source_pack_only: true,
  }),
  source({
    id: "national-library-scotland-maps",
    source_name: "National Library of Scotland Maps",
    source_url: "https://maps.nls.uk/",
    source_category: SOURCE_CATEGORIES.historicMap,
    coverage_area: "Historic map evidence for former uses, building footprint, land-use change",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["previousUse"],
  }),
  source({
    id: "national-archives",
    source_name: "The National Archives",
    source_url: "https://www.nationalarchives.gov.uk/",
    source_category: SOURCE_CATEGORIES.archive,
    coverage_area: "Archive records, wartime use, legal records, railway/industrial/royal records",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["previousUse", "coolHistoricalEvent", "whyBuilt"],
  }),
  source({
    id: "british-newspaper-archive",
    source_name: "British Newspaper Archive",
    source_url: "https://www.britishnewspaperarchive.co.uk/",
    source_category: SOURCE_CATEGORIES.newspaper,
    coverage_area: "Historic newspaper reports for incidents, crimes, fires, scandals, wartime stories",
    confidence_weight: CONFIDENCE_WEIGHTS.localHistorySociety,
    supported_pipelines: ["previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "local-newspapers",
    source_name: "Local newspapers",
    source_url: "",
    source_category: SOURCE_CATEGORIES.newspaper,
    coverage_area: "Local press reports for unusual incidents, fires, crimes, public controversies and local events",
    confidence_weight: CONFIDENCE_WEIGHTS.localHistorySociety,
    supported_pipelines: ["previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "council-heritage-pages",
    source_name: "Council heritage pages",
    source_url: "",
    source_category: SOURCE_CATEGORIES.localHistory,
    coverage_area: "Official local heritage pages, conservation context, significant local history",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "parish-records",
    source_name: "Parish records",
    source_url: "",
    source_category: SOURCE_CATEGORIES.previousUseSupporting,
    coverage_area: "Church/parish building context, dedications, construction phases, parish history",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "diocese-archives",
    source_name: "Diocese archives",
    source_url: "",
    source_category: SOURCE_CATEGORIES.previousUseSupporting,
    coverage_area: "Church administrative and architectural archive records",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse"],
  }),
  source({
    id: "railway-archives",
    source_name: "Railway archives",
    source_url: "",
    source_category: SOURCE_CATEGORIES.previousUseSupporting,
    coverage_area: "Railway station construction, line openings, engineering, incidents",
    confidence_weight: CONFIDENCE_WEIGHTS.universitySpecialistInstitution,
    supported_pipelines: ["buildDate", "whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "local-museums",
    source_name: "Local museums",
    source_url: "",
    source_category: SOURCE_CATEGORIES.previousUseSupporting,
    coverage_area: "Industrial and local building history held by museums",
    confidence_weight: CONFIDENCE_WEIGHTS.heritageGatewayArchiveMuseum,
    supported_pipelines: ["whyBuilt", "previousUse", "coolHistoricalEvent"],
  }),
  source({
    id: "broad-web-search-fallback",
    source_name: "Broad web search fallback",
    source_url: "",
    source_category: SOURCE_CATEGORIES.sourceRouting,
    coverage_area: "Last-resort discovery of candidate sources; extracted facts remain low confidence until verified",
    confidence_weight: CONFIDENCE_WEIGHTS.unverifiedClaim,
    supported_pipelines: ["identity", "sourceDiscovery", "buildDate", "whyBuilt", "currentUse", "previousUse", "coolHistoricalEvent"],
  }),
];

export function getSourcesForPipeline(pipelineId, { placeType = "", coverageArea = "" } = {}) {
  const packSources = getSourcePackForPlaceType(placeType)
    .map(getSourceById)
    .filter(Boolean)
    .filter((sourceItem) => sourceItem.supported_pipelines.includes(pipelineId));
  const packSourceIds = new Set(packSources.map((sourceItem) => sourceItem.id));
  const baseSources = SOURCE_REGISTRY
    .filter((sourceItem) => sourceItem.supported_pipelines.includes(pipelineId))
    .filter((sourceItem) => !sourceItem.source_pack_only || packSourceIds.has(sourceItem.id));
  const coverageSources = getCoverageSources(coverageArea, pipelineId);

  return sortByConfidence(dedupeSources([...baseSources, ...packSources, ...coverageSources]));
}

export function getActivatedSourcePacks(context = {}) {
  const placeType = [
    context.placeType,
    context.identity?.likely_place_type,
    context.selectedPlaceName,
    context.address,
  ].join(" ").toLowerCase();

  const packs = [];
  if (/\b(pub|public house|inn|bar)\b/.test(placeType)) packs.push("pub");
  if (/\b(church|chapel|cathedral)\b/.test(placeType)) packs.push("church");
  if (/\b(railway station|station)\b/.test(placeType)) packs.push("railway");
  if (/\b(castle|palace|royal)\b/.test(placeType)) packs.push("castle");
  if (/\b(mill|factory|warehouse|industrial)\b/.test(placeType)) packs.push("industrial");
  return packs;
}

export function getSourcePackForPlaceType(placeType = "") {
  return getActivatedSourcePacks({ placeType }).flatMap((packName) => SOURCE_PACKS[packName] || []);
}

export function getSourceById(id) {
  return SOURCE_REGISTRY.find((sourceItem) => sourceItem.id === id);
}

export function sortByConfidence(sources = []) {
  return [...sources].sort((a, b) => b.confidence_weight - a.confidence_weight);
}

function getCoverageSources(coverageArea, pipelineId) {
  const area = String(coverageArea || "").toLowerCase();
  if (!area.includes("england")) return [];
  return ["historic-england-nhle", "planning-data-listed-buildings"]
    .map(getSourceById)
    .filter(Boolean)
    .filter((sourceItem) => sourceItem.supported_pipelines.includes(pipelineId));
}

function source(config) {
  return Object.freeze({
    ...config,
    source_pack_only: Boolean(config.source_pack_only),
    name: config.source_name,
    type: config.source_category,
    confidenceScore: config.confidence_weight,
  });
}

function dedupeSources(sources) {
  const byId = new Map();
  sources.forEach((sourceItem) => byId.set(sourceItem.id, sourceItem));
  return [...byId.values()];
}
