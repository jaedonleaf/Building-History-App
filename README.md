# Building History App

A map-centered prototype for exploring the history of nearby buildings.

## What is built

- Mobile-first map interface.
- Mapbox GL JS map integration path.
- Local fallback map so the prototype runs without an API key.
- Tappable building pins.
- Building timeline panel.
- Public-record source registry for planning, heritage, land, archive, and company records.
- "Open in Google Maps" deep link for the selected building.
- UK-wide live loading of structured public building records for the visible map area.

## Run locally

Open `index.html` in a browser, or serve the folder:

```powershell
npx serve .
```

## Enable Mapbox

Create a Mapbox public access token, then run this in the browser console for the local prototype:

```js
localStorage.setItem("buildingHistory.mapboxToken", "YOUR_MAPBOX_PUBLIC_TOKEN");
location.reload();
```

You can also set a custom Mapbox style:

```js
localStorage.setItem("buildingHistory.mapboxStyle", "mapbox://styles/mapbox/streets-v12");
location.reload();
```

For production, move token handling into environment configuration and restrict the token by URL in Mapbox.

## Data direction

The current app uses sample records. The next step is to replace those with adapters for public data sources:

- Historic England list entries.
- Local council planning portals.
- HM Land Registry property information.
- Ordnance Survey building/address data.
- Local archive catalogues.
- Companies House registered office history.
- Newspaper/archive references where licensing allows.

Some sources have APIs, some require user-driven search links, and some have licensing limits. The app should store source attribution and confidence for every historical claim.

## UK-wide record loading

The app queries Wikidata and OpenStreetMap for buildings in the current visible map area. Zoom in and pan anywhere in the UK to load records with coordinates and an approximate build date where one exists in the public source. Wikidata contributes inception dates and structured fields such as recorded use, heritage designation, architect, and significant events. OpenStreetMap contributes buildings with tags such as `start_date`, `building:year`, `year_built`, `construction_date`, and mapped use tags.

The app only displays live public records that include an approximate build date. This avoids showing buildings with empty or misleading date fields. Wider coverage requires additional adapters for EPC construction age bands, council planning portals, Historic England/NHLE, Historic Environment Scotland, Cadw, Northern Ireland records, Ordnance Survey datasets, and Land Registry sources where licensing permits.

Build date source priority:

1. Wikidata `inception` (`P571`) for structured public records.
2. OpenStreetMap dated building tags: `start_date`, `building:year`, `year_built`, `construction_date`, and `built`.
3. Future adapters should add EPC construction age bands and official heritage/council record dates where available.
