import { buildings } from "./data/buildings.js";
import { areLikelySameBuilding, hasLimitedHistory, mergeBuildingHistories, normaliseBuildingHistory } from "./data/buildingHistory.js";
import { fetchOpenStreetMapBuildingsForBounds } from "./data/openStreetMap.js";
import { fetchWikidataBuildingsForBounds } from "./data/wikidata.js";

let localMapboxToken = "";
let viewportLoadTimer = 0;

const state = {
  selectedBuilding: normaliseBuildingHistory(buildings[0]),
  buildings: buildings.map(normaliseBuildingHistory),
  map: null,
  markers: [],
  userMarker: null,
};

const elements = {
  map: document.querySelector("#map"),
  fallbackMap: document.querySelector("#fallbackMap"),
  mapStatus: document.querySelector("#mapStatus"),
  buildingName: document.querySelector("#buildingName"),
  buildingAddress: document.querySelector("#buildingAddress"),
  builtDate: document.querySelector("#builtDate"),
  confidence: document.querySelector("#confidence"),
  architecturalStyle: document.querySelector("#architecturalStyle"),
  currentUse: document.querySelector("#currentUse"),
  timeline: document.querySelector("#timeline"),
  eventList: document.querySelector("#eventList"),
  limitedDataNotice: document.querySelector("#limitedDataNotice"),
  sourceList: document.querySelector("#sourceList"),
  googleMapsLink: document.querySelector("#googleMapsLink"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
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

function renderBuilding(building) {
  state.selectedBuilding = building;
  elements.buildingName.textContent = building.buildingName;
  elements.buildingAddress.textContent = building.address;
  elements.builtDate.textContent = building.buildDate.value;
  elements.confidence.textContent = building.buildDate.confidence;
  elements.architecturalStyle.textContent = building.architecturalStyle || "Not found in public sources";
  elements.currentUse.textContent = building.currentUse || "Not found in public sources";
  elements.googleMapsLink.href = buildGoogleMapsUrl(building);
  elements.limitedDataNotice.hidden = !hasLimitedHistory(building);

  elements.timeline.innerHTML = building.pastUsesTimeline
    .map((item) => `
      <li>
        <time>${escapeHtml(item.dateRange)}</time>
        <p>${escapeHtml(item.useType)}: ${escapeHtml(item.description)}</p>
        <small>${escapeHtml(item.source?.name || "Unknown source")} · ${escapeHtml(item.confidence)} confidence</small>
      </li>
    `)
    .join("") || `
      <li>
        <time>Past uses</time>
        <p>No past-use timeline found in public sources yet.</p>
      </li>
    `;

  elements.eventList.innerHTML = building.significantEvents.length
    ? building.significantEvents.map((item) => `
      <li>
        <time>${escapeHtml(item.dateRange)}</time>
        <p>${escapeHtml(item.description)}</p>
        <small>${escapeHtml(item.source?.name || "Unknown source")} · ${escapeHtml(item.confidence)} confidence</small>
      </li>
    `).join("")
    : `
      <li>
        <time>Historical events</time>
        <p>No known historical events recorded for this building.</p>
      </li>
    `;

  const renderedSources = (building.sources || [])
    .map((source) => `
      <li>
        <a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>
        <span>${escapeHtml(source.coverage)}</span>
      </li>
    `)
    .join("");

  elements.sourceList.innerHTML = renderedSources || `
    <li>
      <span>No source URL available for this record.</span>
    </li>
  `;
}

function selectById(id) {
  const building = state.buildings.find((item) => item.id === id);
  if (building) {
    renderBuilding(building);
    focusMap(building);
  }
}

function runSearch() {
  const term = elements.searchInput.value.trim().toLowerCase();
  if (!term) return;

  const match = state.buildings.find((building) => {
    return `${building.name} ${building.address}`.toLowerCase().includes(term);
  });

  if (match) {
    renderBuilding(match);
    focusMap(match);
    setStatus(`Showing ${match.name}.`);
  } else {
    setStatus("No loaded record matched. Pan or zoom the map to load more UK public records.");
  }
}

function attachFallbackMap() {
  elements.fallbackMap.setAttribute("aria-hidden", "false");
  elements.fallbackMap.querySelectorAll("[data-building-id]").forEach((button) => {
    button.addEventListener("click", () => selectById(button.dataset.buildingId));
  });
}

function focusMap(building) {
  if (!state.map) return;
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
  return nextBuildings.map((building) => {
    const markerElement = document.createElement("button");
    markerElement.className = building.buildDate.value === "Date not available"
      ? "live-map-marker live-map-marker-undated"
      : "live-map-marker";
    markerElement.type = "button";
    markerElement.setAttribute("aria-label", `Open ${building.buildingName}`);
    markerElement.addEventListener("click", () => renderBuilding(building));

    return new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([building.position.lng, building.position.lat])
      .addTo(state.map);
  });
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
    const [wikidataResult, osmResult] = await Promise.allSettled([
      fetchWikidataBuildingsForBounds(bounds),
      fetchOpenStreetMapBuildingsForBounds(bounds),
    ]);

    const results = [wikidataResult, osmResult]
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
    setStatus(`Loaded ${state.buildings.length} building records. Dates and usage are shown where public sources provide them.`);
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

function showReportState() {
  setStatus("Record flag saved locally for the next data review workflow.");
}

function initEvents() {
  elements.searchButton.addEventListener("click", runSearch);
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  elements.locateButton.addEventListener("click", locateUser);
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

await loadLocalConfig();
renderBuilding(state.selectedBuilding);
initEvents();
initMapboxMap();
