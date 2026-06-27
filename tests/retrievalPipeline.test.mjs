import assert from "node:assert/strict";
import test from "node:test";
import { retrieveBuildingProfile } from "../src/data/retrievalPipeline.js";

test("retrieves a verified profile for The Bulls Head, Reigate without cross-building contamination", async () => {
  const profile = await retrieveBuildingProfile("The Bulls Head, Reigate");

  assert.equal(profile.canonicalName, "The Bulls Head");
  assert.equal(profile.location, "Reigate, Surrey");
  assert.equal(profile.type, "pub / public house");
  assert.equal(profile.currentUse, "pub / public house");

  assert.equal(profile.buildDate.value, "c. 1628");
  assert.match(profile.buildDate.source.url, /thebullsheadreigate\.co\.uk/);

  assert.equal(profile.historicalUse.value, "");
  assert.match(profile.historicalUse.fallback, /No verified previous or historical use/);

  assert.ok(profile.checkedSources.length >= 4);
  assert.ok(profile.checkedSources.some((source) => source.category === "OpenStreetMap"));
  assert.ok(profile.checkedSources.some((source) => source.category === "Wikidata"));
  assert.ok(profile.checkedSources.some((source) => source.category === "Historic England/NHLE"));
  assert.ok(profile.checkedSources.some((source) => source.category === "Official venue website" && source.status === "matched"));
  assert.ok(profile.checkedSources.some((source) => source.category === "Pub history directory"));

  assert.ok(profile.sourceUrls.some((url) => /openstreetmap\.org/.test(url)));
  assert.ok(profile.sourceUrls.some((url) => /wikidata\.org/.test(url)));
  assert.ok(profile.sourceUrls.some((url) => /historicengland\.org\.uk/.test(url)));
  assert.ok(profile.sourceUrls.some((url) => /thebullsheadreigate\.co\.uk/.test(url)));

  assert.ok(profile.confidenceScore >= 80);

  const serialised = JSON.stringify(profile).toLowerCase();
  assert.doesNotMatch(serialised, /barnes/);
  assert.doesNotMatch(serialised, /jazz/);
  assert.doesNotMatch(serialised, /1846/);
});
