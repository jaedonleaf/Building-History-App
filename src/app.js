import { buildings } from "./data/buildings.js";
import { publicSources } from "./data/publicSources.js";

const state = {
  selectedBuilding: buildings[0],
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
  timeline: document.querySelector("#timeline"),
  sourceList: document.querySelector("#sourceList"),
  googleMapsLink: document.querySelector("#googleMapsLink"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  locateButton: document.querySelector("#locateButton"),
  reportButton: document.querySelector("#reportButton"),
};

function getMapboxToken() {
  return localStorage.getItem("buildingHistory.mapboxToken") || "";
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

function renderBuilding(building) {
  state.selectedBuilding = building;
  elements.buildingName.textContent = building.name;
  elements.buildingAddress.textContent = building.address;
  elements.builtDate.textContent = building.built;
  elements.confidence.textContent = building.confidence;
  elements.googleMapsLink.href = buildGoogleMapsUrl(building);

  elements.timeline.innerHTML = building.timeline
    .map((item) => `
      <li>
        <time>${item.period}</time>
        <p>${item.description}</p>
      </li>
    `)
    .join("");

  elements.sourceList.innerHTML = building.sources
    .map((sourceId) => {
      const source = publicSources.find((item) => item.id === sourceId);
      if (!source) return "";
      return `
        <li>
          <a href="${source.url}" target="_blank" rel="noreferrer">${source.name}</a>
          <span>${source.coverage}</span>
        </li>
      `;
    })
    .join("");
}

function selectById(id) {
  const building = buildings.find((item) => item.id === id);
  if (building) {
    renderBuilding(building);
    focusMap(building);
  }
}

function runSearch() {
  const term = elements.searchInput.value.trim().toLowerCase();
  if (!term) return;

  const match = buildings.find((building) => {
    return `${building.name} ${building.address}`.toLowerCase().includes(term);
  });

  if (match) {
    renderBuilding(match);
    focusMap(match);
    setStatus(`Showing ${match.name}.`);
  } else {
    setStatus("No local prototype record matched. Live data adapters will handle wider searches.");
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

    state.markers = createMapboxMarkers();
    elements.fallbackMap.hidden = true;
    setStatus("Mapbox map active. Tap a marker to view building history.");
  } catch (error) {
    attachFallbackMap();
    setStatus("Mapbox could not load. Check the access token and allowed URLs.");
  }
}

function createMapboxMarkers() {
  return buildings.map((building) => {
    const markerElement = document.createElement("button");
    markerElement.className = "live-map-marker";
    markerElement.type = "button";
    markerElement.setAttribute("aria-label", `Open ${building.name}`);
    markerElement.addEventListener("click", () => renderBuilding(building));

    return new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([building.position.lng, building.position.lat])
      .addTo(state.map);
  });
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

renderBuilding(state.selectedBuilding);
initEvents();
initMapboxMap();
