import assert from "node:assert/strict";
import test from "node:test";
import { getHistoricalSignificance, isHistoricallyEligible } from "../src/data/historicalSignificance.js";

test("requires at least two V1 quality fields for Explore History eligibility", () => {
  const sparseBuilding = {
    buildingName: "Ordinary Shop",
    currentUse: "Shop",
    buildDate: { value: "c. 1890" },
  };

  const result = getHistoricalSignificance(sparseBuilding);

  assert.equal(result.signals.buildYearKnown, true);
  assert.equal(result.signals.builtBefore1900, true);
  assert.deepEqual(result.qualityFields, ["buildDate"]);
  assert.equal(result.eligible, false);
});

test("allows listed buildings with enough historical quality fields", () => {
  const listedBuilding = {
    buildingName: "Old Market Hall",
    buildDate: { value: "c. 1885" },
    listedStatus: "Grade II listed building",
    sources: [{ name: "Historic England", url: "https://historicengland.org.uk/listing/the-list/list-entry/1234567" }],
  };

  const result = getHistoricalSignificance(listedBuilding);

  assert.equal(result.signals.listedBuilding, true);
  assert.equal(result.signals.historicRegistryRecord, true);
  assert.ok(result.score >= 12);
  assert.equal(result.eligible, true);
});

test("allows buildings with previous use and historical events", () => {
  const storyBuilding = {
    buildingName: "Former Station Warehouse",
    buildDate: { value: "Date not available" },
    pastUsesTimeline: [{
      dateRange: "1870s",
      useType: "Previous use",
      description: "Former railway warehouse used for goods traffic.",
    }],
    significantEvents: [{
      dateRange: "1940s",
      description: "Bomb-damage repair recorded in local archives.",
    }],
  };

  const result = getHistoricalSignificance(storyBuilding);

  assert.deepEqual(result.qualityFields, ["previousUse", "historicalEvent"]);
  assert.equal(result.eligible, true);
});

test("score above threshold does not bypass direct historical signals", () => {
  const building = {
    buildingName: "Documented Bridge",
    buildDate: { value: "c. 1973" },
    constructionContext: "road bridge",
    sources: [{ name: "Wikidata", url: "https://www.wikidata.org/wiki/Q130206" }],
  };

  assert.equal(isHistoricallyEligible(building, { threshold: 10, minimumQualityFields: 2, scores: {
    buildYearKnown: 3,
    historicalDescription: 5,
    wikiArticle: 5,
  } }), false);
});

test("does not count unsourced generated timeline text as historical description", () => {
  const weakBuilding = {
    buildingName: "Ordinary Mapped Building",
    buildDate: { value: "c. 1970" },
    timeline: [{
      period: "Date not available",
      description: "No reliable public build date has been found yet.",
    }],
    sources: [{ name: "OpenStreetMap", url: "https://www.openstreetmap.org/way/1" }],
  };

  const result = getHistoricalSignificance(weakBuilding);

  assert.equal(result.signals.historicalDescription, false);
  assert.equal(result.eligible, false);
});
