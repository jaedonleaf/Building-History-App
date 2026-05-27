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

The app queries Wikidata and OpenStreetMap for buildings in the current visible map area. Zoom in and pan anywhere in the UK to load records with coordinates and public tags. Wikidata contributes inception dates and structured fields such as recorded use, heritage designation, architect, and significant events. OpenStreetMap contributes all mapped buildings in the visible area, including name, address, current use, former use, lifecycle, and date tags where available.

The app displays as many public building records as the connected sources provide for the visible area. It does not invent build dates: where no reliable public date is found, the building is labelled `Date not available` and shown with a distinct marker. Wider date coverage requires additional adapters for EPC construction age bands, council planning portals, Historic England/NHLE, Historic Environment Scotland, Cadw, Northern Ireland records, Ordnance Survey datasets, and Land Registry sources where licensing permits.

Build date source priority:

1. Wikidata `inception` (`P571`) for structured public records.
2. OpenStreetMap dated building tags: `start_date`, `building:year`, `year_built`, `construction_date`, and `built`.
3. Future adapters should add EPC construction age bands and official heritage/council record dates where available.

Recorded usage timeline sources:

- Wikidata contributes current/recorded use (`P366`), building type (`P31`), opening date (`P1619`), architect (`P84`), heritage status (`P1435`), and significant events (`P793`) with dates where qualifiers exist.
- OpenStreetMap contributes current mapped use tags such as `building`, `building:use`, `amenity`, `shop`, `office`, `tourism`, `leisure`, `historic`, and `heritage`.
- OpenStreetMap also contributes former/lifecycle clues such as `old_name`, `former:*`, `was:*`, `disused:*`, `abandoned:*`, `demolished:*`, and `ruins:*`.
- Wikipedia intro extracts are loaded only when a selected building has a matched article, and only sentences with historically meaningful associations are added to Significant Events.
- Mapbox reverse geocoding is used only when a selected OpenStreetMap footprint has no usable name/address. The app labels this as a nearby address, not an official building name.

Many public sources do not provide exact start/end dates for every use. The app labels those entries as undated or approximate rather than inventing dates.

## Enrichment model

Source adapters return source-specific records, then `src/data/buildingHistory.js` normalises them into one `BuildingHistory` object. The normaliser:

- chooses a title using official/listed name, common name, address, then map label;
- scores build dates by source priority and confidence;
- merges likely matches using coordinates plus name/address overlap;
- keeps conflicting build-date claims in `conflictingSourceData`;
- keeps source attribution on timeline and event entries;
- provides fallback text when public records are limited.
