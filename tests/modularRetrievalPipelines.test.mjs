import assert from "node:assert/strict";
import test from "node:test";
import {
  PIPELINE_ORDER,
  SOURCE_REGISTRY,
  createEvidence,
  createCamraSourceAdapter,
  createSourceCheck,
  getActivatedSourcePacks,
  getSourcesForPipeline,
  routeSources,
  runModularBuildingRetrieval,
} from "../src/data/retrievalPipelines/index.js";
import { enrichBuildingWithModularRetrieval } from "../src/data/modularBuildingHistory.js";

test("defines the modular retrieval pipeline order", () => {
  assert.deepEqual(PIPELINE_ORDER, [
    "identity",
    "location",
    "sourceDiscovery",
    "buildDate",
    "whyBuilt",
    "currentUse",
    "previousUse",
    "listedStatus",
    "coolHistoricalEvent",
    "confidence",
  ]);
});

test("routes pub and inn buildings through pub-specific source categories", () => {
  const sources = routeSources({
    selectedPlaceName: "The Bulls Head",
    address: "Reigate, Surrey",
    placeType: "pub / public house",
  }).map((source) => source.name);

  assert.ok(sources.includes("OpenStreetMap Nominatim"));
  assert.ok(sources.includes("Overpass API"));
  assert.ok(sources.includes("Wikidata"));
  assert.ok(sources.includes("Wikipedia API"));
  assert.ok(sources.includes("National Heritage List for England (NHLE)"));
  assert.ok(sources.includes("Planning Data Listed Buildings"));
  assert.ok(sources.includes("Local council conservation documents"));
  assert.ok(sources.includes("CAMRA Pub Search"));
  assert.ok(sources.includes("CAMRA Heritage Pubs"));
  assert.ok(sources.includes("Pub Heritage"));
  assert.ok(sources.includes("Local history societies"));
  assert.ok(sources.includes("British Newspaper Archive"));
  assert.ok(sources.includes("Broad web search fallback"));
});

test("source registry entries include required metadata and are ordered by confidence", () => {
  assert.ok(SOURCE_REGISTRY.length > 20);
  SOURCE_REGISTRY.forEach((source) => {
    assert.ok(source.source_name, source.id);
    assert.ok("source_url" in source, source.id);
    assert.ok(source.source_category, source.id);
    assert.ok(source.coverage_area, source.id);
    assert.ok(Number.isFinite(source.confidence_weight), source.id);
    assert.ok(Array.isArray(source.supported_pipelines), source.id);
  });

  const buildDateSources = getSourcesForPipeline("buildDate", {
    placeType: "pub / public house",
    coverageArea: "England",
  });
  const weights = buildDateSources.map((source) => source.confidence_weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
  assert.ok(buildDateSources.some((source) => source.source_name === "National Heritage List for England (NHLE)"));
  assert.ok(buildDateSources.some((source) => source.source_name === "CAMRA Heritage Pubs"));
});

test("source packs activate by resolved building type", () => {
  assert.deepEqual(getActivatedSourcePacks({ placeType: "pub / public house" }), ["pub"]);
  assert.deepEqual(getActivatedSourcePacks({ placeType: "parish church" }), ["church"]);
  assert.deepEqual(getActivatedSourcePacks({ placeType: "railway station" }), ["railway"]);
  assert.deepEqual(getActivatedSourcePacks({ placeType: "castle" }), ["castle"]);
  assert.deepEqual(getActivatedSourcePacks({ placeType: "industrial mill" }), ["industrial"]);
});

test("returns the final profile schema with honest unknowns when no source pack is connected", async () => {
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "The Bulls Head",
    coordinates: { lat: 51.2377, lng: -0.2091 },
    address: "Reigate, Surrey",
    placeType: "pub / public house",
  }, [], { debug: true });

  assert.equal(profile.identity.canonical_name, null);
  assert.equal(profile.location.full_address, "Reigate, Surrey");
  assert.equal(profile.buildDate.exact_build_date, null);
  assert.equal(profile.whyBuilt.original_purpose, null);
  assert.equal(profile.currentUse.current_use, null);
  assert.deepEqual(profile.previousUse, []);
  assert.equal(profile.listedStatus.is_listed, null);
  assert.equal(profile.coolHistoricalEvent.summary, "Nothing that interesting has happened here -_-");
  assert.equal(profile.overallConfidence, 40);

  assert.ok(profile.debugLog.some((entry) => entry.pipeline === "identity"));
  assert.ok(profile.debugLog.some((entry) => entry.pipeline === "sourceDiscovery"));
  assert.ok(profile.debugLog.some((entry) => entry.pipeline === "confidence"));
});

test("keeps each field independently source-backed", async () => {
  const adapter = fixtureAdapter();
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "The Bulls Head, Reigate",
    coordinates: { lat: 51.2377, lng: -0.2091 },
    address: "Reigate, Surrey",
    placeType: "pub / public house",
  }, [adapter], { debug: true });

  assert.equal(profile.identity.canonical_name, "The Bulls Head");
  assert.equal(profile.identity.likely_place_type, "pub / public house");
  assert.equal(profile.location.town, "Reigate");
  assert.equal(profile.buildDate.estimated_build_date, "c.1628");
  assert.equal(profile.whyBuilt.original_purpose, "coaching inn serving road traffic");
  assert.equal(profile.currentUse.current_use, "pub / public house");
  assert.equal(profile.previousUse[0].use, "coaching inn");
  assert.equal(profile.listedStatus.is_listed, null);
  assert.equal(profile.coolHistoricalEvent.title, "No source-backed event selected");

  assert.ok(profile.sourcesChecked.some((source) => source.pipeline === "identity" && source.status === "matched"));
  assert.ok(profile.sourcesChecked.some((source) => source.pipeline === "buildDate" && source.status === "matched"));
  assert.ok(profile.sourcesChecked.every((source) => "confidenceScore" in source));
  assert.ok(profile.buildDate.source_urls.every(Boolean));
  assert.ok(profile.overallConfidence > 0);

  const extractedFact = profile.debugLog
    .flatMap((entry) => entry.extractedFacts || [])
    .find((fact) => fact.field === "estimated_build_date");
  assert.equal(extractedFact.value, "c.1628");
});

test("facts include source URL, source name, confidence, evidence snippet, and retrieval timestamp", () => {
  const fact = createEvidence({
    pipeline: "buildDate",
    field: "estimated_build_date",
    value: "c.1628",
    sourceName: "Example source",
    sourceUrl: "https://example.test/source",
    sourceType: "localHistorySociety",
    evidenceQuote: "The building dates from c.1628.",
  });

  assert.equal(fact.value, "c.1628");
  assert.equal(fact.source_url, "https://example.test/source");
  assert.equal(fact.source_name, "Example source");
  assert.equal(fact.confidence_score, 75);
  assert.equal(fact.evidence_snippet, "The building dates from c.1628.");
  assert.match(fact.retrieval_timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("CAMRA adapter extracts pub build date and previous use from matched CAMRA pages", async () => {
  const camraUrl = "https://camra.org.uk/pubs/example-pub-reigate-123456";
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://camra.org.uk/pubs/?search=")) {
      return response(`<a href="/pubs/example-pub-reigate-123456">The Bulls Head Reigate</a>`);
    }
    if (url === camraUrl) {
      return response(`
        <h1>The Bulls Head</h1>
        <p>Reigate Surrey public house listed by CAMRA.</p>
        <p>Designed as a coaching inn and built in around 1628.</p>
        <p>A former coaching inn that is now a public house.</p>
      `);
    }
    return response("", false);
  };

  const adapter = createCamraSourceAdapter({ fetchImpl });
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "The Bulls Head",
    address: "Reigate, Surrey",
    placeType: "pub / public house",
  }, [adapter], { debug: true });

  assert.equal(profile.buildDate.estimated_build_date, "c.1628");
  assert.equal(profile.buildDate.source_urls[0], camraUrl);
  assert.equal(profile.previousUse[0].use, "coaching inn");
  assert.equal(profile.previousUse[0].source_url, camraUrl);
  assert.ok(profile.sourcesChecked.some((check) => check.sourceName === "CAMRA Pub Search" && check.status === "matched"));
});

test("CAMRA adapter does not run for non-pub building types", async () => {
  let fetchCount = 0;
  const adapter = createCamraSourceAdapter({
    fetchImpl: async () => {
      fetchCount += 1;
      return response("");
    },
  });

  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "Example Church",
    address: "Reigate, Surrey",
    placeType: "church",
  }, [adapter]);

  assert.equal(fetchCount, 0);
  assert.equal(profile.buildDate.exact_build_date, null);
  assert.equal(profile.sourcesChecked.some((check) => check.sourceName === "CAMRA Pub Search"), false);
});

test("preserves conflicting claims instead of overwriting higher-confidence facts", async () => {
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "Conflict Test",
    placeType: "pub",
  }, [conflictingDateAdapter()]);

  assert.equal(profile.buildDate.estimated_build_date, "c.1628");
  assert.equal(profile.conflicts.length, 1);
  assert.equal(profile.conflicts[0].field, "estimated_build_date");
  assert.ok(profile.conflicts[0].claims.some((claim) => claim.value === "c.1628"));
  assert.ok(profile.conflicts[0].claims.some((claim) => claim.value === "1846"));
});

test("Bulls Head regression attempts every specialist pipeline and pub-specific routing", async () => {
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "The Bulls Head, Reigate",
    coordinates: { lat: 51.2377, lng: -0.2091 },
    address: "Reigate, Surrey",
    placeType: "pub / public house",
  }, [], { debug: true });

  const attemptedPipelines = profile.debugLog.map((entry) => entry.pipeline);
  [
    "identity",
    "location",
    "sourceDiscovery",
    "buildDate",
    "whyBuilt",
    "currentUse",
    "previousUse",
    "listedStatus",
    "coolHistoricalEvent",
    "confidence",
  ].forEach((pipeline) => assert.ok(attemptedPipelines.includes(pipeline), pipeline));

  const plannedSources = profile.sourcesChecked.map((source) => source.sourceName);
  assert.ok(plannedSources.includes("CAMRA Pub Search"));
  assert.ok(plannedSources.includes("CAMRA Heritage Pubs"));
  assert.ok(plannedSources.includes("Pub Heritage"));
  assert.ok(plannedSources.includes("National Heritage List for England (NHLE)"));
  assert.ok(plannedSources.includes("Local council conservation documents"));
});

test("whyBuilt uses dedicated Wikipedia, Wikidata, and Historic England source adapters", async () => {
  const profile = await runModularBuildingRetrieval({
    selectedPlaceName: "Example Assembly Hall",
    address: "High Street, York, England",
    placeType: "civic hall",
    buildingRecord: {
      id: "example-assembly-hall",
      buildingName: "Example Assembly Hall",
      address: "High Street, York, England",
      currentUse: "civic hall",
      architecturalStyle: "public assembly building",
      listedStatus: "Grade II listed building",
      originalPurpose: "public assembly hall",
      buildDate: {
        value: "c. 1890",
        confidence: "medium",
        note: "The building was constructed as a public assembly hall.",
        source: { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Example_Assembly_Hall" },
      },
      buildPurposeSources: [{
        name: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/Example_Assembly_Hall",
        coverage: "Article text used to extract why the building was built",
      }],
      sources: [
        { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Example_Assembly_Hall" },
        { name: "Wikidata", url: "https://www.wikidata.org/wiki/Q123" },
        { name: "Historic England", url: "https://historicengland.org.uk/listing/the-list/list-entry/1234567" },
      ],
      sourceLinks: [
        { name: "Wikipedia article", url: "https://en.wikipedia.org/wiki/Example_Assembly_Hall" },
        { name: "Wikidata record", url: "https://www.wikidata.org/wiki/Q123" },
        { name: "Historic England list entry", url: "https://historicengland.org.uk/listing/the-list/list-entry/1234567" },
      ],
      pastUsesTimeline: [{
        dateRange: "c. 1890-present",
        useType: "Recorded use",
        description: "public assembly building, civic hall",
        source: { name: "Wikidata", url: "https://www.wikidata.org/wiki/Q123" },
        confidence: "medium",
      }],
      significantEvents: [],
    },
  }, undefined, { debug: true });

  assert.equal(profile.whyBuilt.original_purpose, "public assembly hall");
  assert.ok(profile.whyBuilt.source_urls.includes("https://en.wikipedia.org/wiki/Example_Assembly_Hall"));

  const whyBuiltChecks = profile.sourcesChecked.filter((check) => check.pipeline === "whyBuilt");
  assert.ok(whyBuiltChecks.some((check) => check.sourceName === "Wikipedia" && check.status === "matched"));
  assert.ok(whyBuiltChecks.some((check) => check.sourceName === "Wikidata" && check.status === "matched"));
  assert.ok(whyBuiltChecks.some((check) => check.sourceName === "Historic England" && check.status === "matched"));

  const fields = profile.debugLog
    .find((entry) => entry.pipeline === "whyBuilt")
    .extractedFacts
    .map((fact) => fact.field);
  assert.ok(fields.includes("original_purpose"));
  assert.ok(fields.includes("historical_context"));
  assert.ok(fields.includes("related_transport_trade_religious_commercial_context"));
});

test("UI modular adapter returns a BuildingHistory-compatible enriched record", async () => {
  const building = {
    id: "fixture-bulls-head",
    buildingName: "The Bulls Head",
    address: "Reigate, Surrey",
    position: { lat: 51.2377, lng: -0.2091 },
    currentUse: "pub / public house",
    buildDate: {
      value: "Date not available",
      confidence: "unknown",
      source: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" },
    },
    sources: [{ name: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" }],
    sourceLinks: [{ name: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" }],
  };

  const enriched = await enrichBuildingWithModularRetrieval(building, {
    collectExternalSources: false,
    sourceAdapters: [],
  });

  assert.equal(enriched.id, "fixture-bulls-head");
  assert.equal(enriched.buildingName, "The Bulls Head");
  assert.equal(enriched.currentUse, "pub / public house");
  assert.equal(enriched.modularRetrievalLoaded, true);
  assert.ok(Array.isArray(enriched.sources));
  assert.ok(enriched.sources.some((source) => source.name === "OpenStreetMap"));
  assert.ok(enriched.sources.length <= 5);
  assert.ok(Array.isArray(enriched.retrievalChecks));
  assert.ok(enriched.retrievalChecks.length > 0);
  assert.ok("dataConfidence" in enriched);
});

test("UI modular adapter keeps whyBuilt context when original purpose is unknown", async () => {
  const building = {
    id: "fixture-london-bridge",
    buildingName: "London Bridge",
    address: "City of London, England",
    position: { lat: 51.508, lng: -0.087 },
    currentUse: "Bridge",
    buildDate: {
      value: "c. 1973",
      confidence: "medium",
      source: { name: "Wikidata", url: "https://www.wikidata.org/wiki/Q130206" },
    },
    sources: [{ name: "Wikidata", url: "https://www.wikidata.org/wiki/Q130206" }],
    sourceLinks: [{ name: "Wikidata", url: "https://www.wikidata.org/wiki/Q130206" }],
    pastUsesTimeline: [{
      dateRange: "c. 1973-present",
      useType: "Recorded use",
      description: "arch bridge, road bridge, box girder bridge, prestressed concrete bridge",
      source: { name: "Wikidata", url: "https://www.wikidata.org/wiki/Q130206" },
      confidence: "medium",
    }],
  };

  const enriched = await enrichBuildingWithModularRetrieval(building, {
    collectExternalSources: false,
  });

  assert.equal(enriched.originalPurpose, "");
  assert.equal(enriched.constructionContext, "arch bridge, road bridge, box girder bridge, prestressed concrete bridge");
  assert.ok(enriched.sources.length <= 5);
  assert.ok(enriched.sources.some((source) => source.name === "Wikidata"));
  assert.ok(enriched.retrievalChecks.some((check) => check.pipeline === "whyBuilt"));
});

function fixtureAdapter() {
  const source = {
    sourceName: "Fixture official source",
    sourceType: "localHistory",
    sourceUrl: "https://example.test/bulls-head",
    evidenceQuote: "The Bulls Head is a public house in Reigate dating from c.1628.",
  };

  return {
    collect({ pipeline }) {
      const evidenceByPipeline = {
        identity: [
          evidence(pipeline.id, "canonical_name", "The Bulls Head", source),
          evidence(pipeline.id, "likely_place_type", "pub / public house", source),
        ],
        location: [
          evidence(pipeline.id, "town", "Reigate", source),
          evidence(pipeline.id, "county", "Surrey", source),
        ],
        buildDate: [
          evidence(pipeline.id, "estimated_build_date", "c.1628", source),
        ],
        whyBuilt: [
          evidence(pipeline.id, "original_purpose", "coaching inn serving road traffic", source),
        ],
        currentUse: [
          evidence(pipeline.id, "current_use", "pub / public house", source),
        ],
        previousUse: [
          evidence(pipeline.id, "previous_uses", {
            use: "coaching inn",
            approximate_dates: "17th century",
            evidence: "Recorded as a coaching inn.",
            source_url: source.sourceUrl,
            confidence_score: 75,
          }, source),
        ],
        listedStatus: [
          evidence(pipeline.id, "is_listed", null, {
            ...source,
            uncertaintyNotes: "No official listing has been verified in this fixture.",
          }),
        ],
        coolHistoricalEvent: [
          evidence(pipeline.id, "title", "No source-backed event selected", source),
        ],
      };

      const items = evidenceByPipeline[pipeline.id] || [];
      return {
        evidence: items,
        checks: items.length ? [createSourceCheck({
          pipeline: pipeline.id,
          sourceName: source.sourceName,
          sourceType: source.sourceType,
          status: "matched",
          query: `fixture ${pipeline.id}`,
          url: source.sourceUrl,
          rawSnippet: source.evidenceQuote,
          extractedFacts: items.map((item) => ({ field: item.field, value: item.value })),
        })] : [],
      };
    },
  };
}

function conflictingDateAdapter() {
  return {
    collect({ pipeline }) {
      if (pipeline.id !== "buildDate") return { evidence: [], checks: [] };
      return {
        evidence: [
          evidence(pipeline.id, "estimated_build_date", "c.1628", {
            sourceName: "Official source",
            sourceUrl: "https://example.test/official",
            sourceType: "localCouncilArchive",
          }),
          evidence(pipeline.id, "estimated_build_date", "1846", {
            sourceName: "Lower confidence source",
            sourceUrl: "https://example.test/low",
            sourceType: "uncitedClaim",
          }),
        ],
        checks: [],
      };
    },
  };
}

function evidence(pipeline, field, value, source) {
  return createEvidence({
    pipeline,
    field,
    value,
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    sourceType: source.sourceType,
    evidenceQuote: source.evidenceQuote || "",
    uncertaintyNotes: source.uncertaintyNotes || "",
  });
}

function response(body, ok = true) {
  return {
    ok,
    async text() {
      return body;
    },
  };
}
