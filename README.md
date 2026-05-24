# Building History App

A map-centered prototype for exploring the history of nearby buildings.

## What is built

- Mobile-first map interface.
- Google Maps JavaScript API integration path.
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

## Enable Google Maps

Create a Google Maps Platform API key with the Maps JavaScript API enabled, then run this in the browser console for the local prototype:

```js
localStorage.setItem("buildingHistory.googleMapsApiKey", "YOUR_API_KEY");
location.reload();
```

If you create a Google Cloud map ID, the app will use Advanced Markers:

```js
localStorage.setItem("buildingHistory.googleMapsMapId", "YOUR_MAP_ID");
location.reload();
```

For production, move the key handling into environment configuration and restrict the key by HTTP referrer in Google Cloud Console.

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
