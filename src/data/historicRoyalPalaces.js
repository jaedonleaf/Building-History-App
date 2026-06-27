const HRP_SOURCE_NAME = "Historic Royal Palaces";

const HRP_RECORDS = [
  {
    match: ["tower of london", "white tower"],
    sourceUrl: "https://www.hrp.org.uk/tower-of-london/history-and-stories/the-story-of-the-tower-of-london/",
    currentUse: "Historic visitor attraction",
    buildDate: "c. 1078",
    buildDateNote: "Historic Royal Palaces records William the Conqueror's mighty stone tower at the centre of his London fortress.",
  },
  {
    match: ["hampton court palace"],
    sourceUrl: "https://www.hrp.org.uk/hampton-court-palace/history-and-stories/the-story-of-hampton-court-palace/",
    currentUse: "Historic visitor attraction",
    buildDate: "early 16th century",
    buildDateNote: "Historic Royal Palaces records that the original Tudor Hampton Court Palace was begun by Cardinal Thomas Wolsey in the early 16th century.",
  },
  {
    match: ["kensington palace"],
    sourceUrl: "https://www.hrp.org.uk/kensington-palace/history-and-stories/the-story-of-kensington-palace/",
    currentUse: "Royal residence and historic visitor attraction",
    buildDate: "c. 1689",
    buildDateNote: "Historic Royal Palaces records that William III and Mary II chose Nottingham House in 1689 as their country retreat.",
  },
  {
    match: ["kew palace"],
    sourceUrl: "https://www.hrp.org.uk/kew-palace/history-and-stories/the-story-of-kew-palace/",
    currentUse: "Historic visitor attraction",
    buildDate: "c. 1631",
    buildDateNote: "Historic Royal Palaces presents Kew Palace as a 17th-century house later used by the royal family.",
  },
  {
    match: ["banqueting house", "banqueting house whitehall"],
    sourceUrl: "https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/",
    currentUse: "Historic visitor attraction and events venue",
    buildDate: "c. 1622",
    buildDateNote: "Historic Royal Palaces presents Banqueting House as Inigo Jones's surviving royal building at Whitehall.",
  },
  {
    match: ["hillsborough castle", "hillsborough castle and gardens"],
    sourceUrl: "https://www.hrp.org.uk/hillsborough-castle/history-and-stories/the-story-of-hillsborough-castle/",
    currentUse: "Royal residence, government house and historic visitor attraction",
    buildDate: "18th century",
    buildDateNote: "Historic Royal Palaces presents Hillsborough Castle as an 18th-century house with royal and governmental use.",
  },
];

export function enrichBuildingWithHistoricRoyalPalaces(building) {
  if (building.hrpLoaded) return building;

  const record = findHrpRecord(building);
  if (!record) return { ...building, hrpLoaded: true };

  const source = buildSource(record);
  const shouldUseBuildDate = shouldUseHrpBuildDate(building.buildDate);

  return {
    ...building,
    hrpLoaded: true,
    currentUse: shouldReplaceCurrentUse(building.currentUse) ? record.currentUse : building.currentUse,
    buildDate: shouldUseBuildDate
      ? {
        value: record.buildDate,
        confidence: "medium",
        source,
        note: record.buildDateNote,
      }
      : building.buildDate,
    built: shouldUseBuildDate ? record.buildDate : building.built,
    confidence: shouldUseBuildDate ? "Medium" : building.confidence,
    significantEvents: building.significantEvents || [],
    sources: mergeSources(building.sources, [source]),
    sourceLinks: mergeSources(building.sourceLinks, [source]),
  };
}

function findHrpRecord(building) {
  const haystack = [
    building.buildingName,
    building.name,
    building.address,
    ...(building.sourceRecordIds || []),
  ].join(" ").toLowerCase();

  return HRP_RECORDS.find((record) => record.match.some((term) => haystack.includes(term)));
}

function buildSource(record) {
  return {
    name: HRP_SOURCE_NAME,
    url: record.sourceUrl,
    coverage: "Official Historic Royal Palaces history and stories",
  };
}

function shouldUseHrpBuildDate(buildDate) {
  const value = typeof buildDate === "string" ? buildDate : buildDate?.value;
  return !value || value === "Date not available" || value === "Unknown" || value === "Build date unknown";
}

function shouldReplaceCurrentUse(currentUse = "") {
  return !currentUse
    || currentUse === "Not found in public sources"
    || currentUse === "Current use not found in public sources";
}

function mergeSources(existing = [], incoming = []) {
  const byKey = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((source) => {
    const key = source.url || source.name;
    if (key) byKey.set(key, source);
  });
  return [...byKey.values()];
}
