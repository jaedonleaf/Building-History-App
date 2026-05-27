export async function enrichUnnamedBuildingWithMapboxAddress(building, accessToken) {
  if (!shouldReverseGeocode(building) || !accessToken) return building;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", building.position.lng);
  url.searchParams.set("latitude", building.position.lat);
  url.searchParams.set("country", "gb");
  url.searchParams.set("types", "address,street,postcode,place");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url);
    if (!response.ok) return markAttempted(building);

    const data = await response.json();
    const feature = data.features?.[0];
    const address = feature?.properties?.full_address || feature?.properties?.name || feature?.place_name || "";
    if (!address) return markAttempted(building);

    return {
      ...building,
      buildingName: `Building near ${address}`,
      name: `Building near ${address}`,
      address,
      mapboxAddressLoaded: true,
      matchConfidence: "low",
      sources: mergeSources(building.sources, [{
        name: "Mapbox Geocoding",
        url: "https://docs.mapbox.com/api/search/geocoding/",
        coverage: "Nearest reverse-geocoded address for unnamed mapped building footprint",
      }]),
      sourceLinks: mergeSources(building.sourceLinks, [{
        name: "Mapbox Geocoding",
        url: "https://docs.mapbox.com/api/search/geocoding/",
        coverage: "Nearest reverse-geocoded address for unnamed mapped building footprint",
      }]),
    };
  } catch (error) {
    return markAttempted(building);
  }
}

function shouldReverseGeocode(building) {
  return !building.mapboxAddressLoaded
    && building.position
    && /^Mapped building$/i.test(building.buildingName);
}

function markAttempted(building) {
  return { ...building, mapboxAddressLoaded: true };
}

function mergeSources(existing = [], incoming = []) {
  const byKey = new Map();
  [...existing, ...incoming].forEach((source) => {
    const key = source.url || source.name;
    if (key) byKey.set(key, source);
  });
  return [...byKey.values()];
}
