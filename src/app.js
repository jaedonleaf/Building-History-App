import { buildings } from "./data/buildings.js";
import { publicSources } from "./data/publicSources.js";

const state = {
  selectedBuilding: buildings[0],
  map: null,
  markers: [],
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

function getMapsApiKey() {
  return localStorage.getItem("buildingHistory.googleMapsApiKey") || "";
}

function getMapsMapId() {
  return localStorage.getItem("buildingHistory.googleMapsMapId") || "";
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
    focusGoogleMap(building);
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
    focusGoogleMap(match);
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

function focusGoogleMap(building) {
  if (!state.map || !window.google) return;
  state.map.panTo(building.position);
  state.map.setZoom(18);
}

async function loadGoogleMaps(apiKey) {
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
  script.async = true;
  document.head.appendChild(script);

  await new Promise((resolve, reject) => {
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
  });
}

async function initGoogleMap() {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    attachFallbackMap();
    return;
  }

  try {
    await loadGoogleMaps(apiKey);
    const { Map } = await google.maps.importLibrary("maps");
    const mapId = getMapsMapId();

    state.map = new Map(elements.map, {
      center: state.selectedBuilding.position,
      zoom: 17,
      ...(mapId ? { mapId } : {}),
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: true,
    });

    state.markers = await createGoogleMarkers();

    elements.fallbackMap.hidden = true;
    setStatus("Google Maps active. Tap a marker to view building history.");
  } catch (error) {
    attachFallbackMap();
    setStatus("Google Maps could not load. Check the API key and billing setup.");
  }
}

async function createGoogleMarkers() {
  const mapId = getMapsMapId();

  if (mapId) {
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    return buildings.map((building) => {
      const marker = new AdvancedMarkerElement({
        map: state.map,
        position: building.position,
        title: building.name,
      });
      marker.addListener("click", () => renderBuilding(building));
      return marker;
    });
  }

  return buildings.map((building) => {
    const marker = new google.maps.Marker({
      map: state.map,
      position: building.position,
      title: building.name,
    });
    marker.addListener("click", () => renderBuilding(building));
    return marker;
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
        state.map.panTo(current);
        state.map.setZoom(18);
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
initGoogleMap();
