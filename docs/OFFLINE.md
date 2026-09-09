# Running OSIRIS without a connection

The shipped basemap is CARTO's. Its style file is local, but the only vector
source, the glyphs and the sprite are all remote — so with no network the map
renders nothing at all. Not a coarse map: a black rectangle.

This adds a basemap that resolves entirely to files on disk, so the dashboard is
still a map when it is offline, and still the full intelligence picture the
moment it finds a connection.

## What works, and when

| | offline | online |
|---|---|---|
| Basemap (coastlines, borders, lakes, cities) | ✅ from disk | ✅ CARTO, far more detail |
| Every intelligence layer — fires, flights, radio, TV, weather, maritime, quakes | ❌ empty | ✅ unchanged |

The two are independent. Choosing the offline basemap does not disable, throttle
or alter a single data layer; they are separate live feeds that simply have
nothing to say until there is a network. Boot on a plane and you get a world map
with no markers; connect at the hotel and it fills in, with no reload and no
setting to change.

## Fetching the assets

```
node tools/fetch-offline-basemap.mjs
```

About 2.3MB into `public/offline` — Natural Earth geometry plus SDF glyph atlases
for the two fontstacks the offline style uses. The output is gitignored because
it is regenerable public-domain data; the style that consumes it is committed.

## How the basemap is chosen

Decided synchronously, before the map is constructed, in `src/lib/basemap.ts`.
It cannot be decided any later: `setStyle` tears down every source and layer, and
this map adds around a hundred of them on style load. It cannot wait on a network
probe either — that stalls exactly the machine with no network to answer.

In order of precedence:

1. An explicit override — `?basemap=offline`, or `setBasemapOverride('offline')`
2. `navigator.onLine === false`
3. CARTO having failed on a recent previous load (remembered for 30 minutes)
4. Otherwise online

A probe runs *after* the map is up and changes nothing about that load. It only
records whether the CDN answered, so the next start chooses correctly — which is
why a machine that boots with no network gets the offline basemap on its first
frame rather than after one failed render.

For an appliance or a bootable image, pin it and skip the guessing:

```js
localStorage.setItem('osiris:basemap', 'offline')
```

## What the offline basemap is not

Natural Earth is world-to-country scale. You get coastlines, national borders,
first-level administrative lines, major lakes and populated places. You do not
get roads, buildings or street names — zoom into a city and it is crude, because
110m source data has nothing finer to give.

That is the right trade for a global situational-awareness view at 2.3MB. It is
the wrong trade if you need street-level detail offline.

## Upgrading to street-level offline

The existing style's source layers — `landcover`, `water`, `boundary`,
`transportation`, `place`, `building` and the rest — are the **OpenMapTiles
schema**. That matters: an OpenMapTiles-format vector tile archive is a drop-in
replacement, and the existing 93-layer dark style renders it unchanged. No
restyling.

To do it:

1. Obtain or build an OpenMapTiles-schema archive — `tilemaker` builds one from
   an OSM extract, or use a prebuilt regional file.
2. Add [`pmtiles`](https://github.com/protomaps/PMTiles) and register its
   protocol with MapLibre, alongside the terrain protocol already registered in
   `OsirisMap.tsx`.
3. Point a copy of `dark-matter-style.json` at `pmtiles://…` and serve the glyphs
   locally as the offline style already does.

Budget by area: a country is typically 0.2–2GB, a continent 5–20GB, the planet
around 100GB. Which is why the default is 2.3MB of Natural Earth.

## Licensing

Natural Earth is public domain. Open Sans is Apache-2.0; the files fetched are
prebuilt SDF atlases of it. OpenStreetMap-derived tiles, if you go that route,
are ODbL and require attribution — but unlike CARTO's hosted tiles or Esri's
imagery, they carry no commercial restriction.
