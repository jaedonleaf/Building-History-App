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
