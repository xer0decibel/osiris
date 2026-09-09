# OSIRIS — handoff

*New here? Read [WELCOME.md](WELCOME.md) first — it is shorter and tells you
where to stand. This file is the reference.*

Read this before touching the map. Written across three sessions on
2026-09-08/09: the first took a cloned dashboard, added six layers, made it
work with no network and started packaging it as a bootable drive; the second
wired typed commands and the offline gazetteer; the third rebuilt the weather
surface (temperature from two models, painted rather than contoured, and a
night shade that fades), then forked, pushed, merged upstream's latest and
sent the first pull request back.

**What this is:** a fork-in-progress of
[simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) — an OSINT
situational-awareness map. MIT licensed. Upstream is *active* (commits most
days), so this diverges further every day it sits.

**State:** 78 commits on branch `feat/intel-layers` across three sessions, **pushed to
the user's fork** at github.com/xer0decibel/osiris (`origin`); the author's repo is
`upstream`. Committer identity is set repo-locally to
`xer0decibel <xer0decibel@protonmail.com>`. Pushes authenticate through Git
Credential Manager's browser sign-in; no token is stored anywhere.

**Source of truth for each part:**
- `docs/OFFLINE.md` — the offline basemap, and the path to street-level tiles
- `.env.example` — every key, and which ones the code actually reads
- memory: `~/.claude/projects/C--Users-zer0d-Claude-local/memory/`

---

## The rules that outrank convenience

1. **This repo is CRLF. Every file, no exceptions.** There is no
   `.gitattributes` to save you. Writing a patch with `\n` into a CRLF file
   produces mixed endings that make the next diff unreadable. Every patch script
   here detects the file's endings and converts before matching *and* before
   writing. Check after every edit:
   `node -e "const s=require('fs').readFileSync(F,'utf8');console.log((s.match(/(?<!\r)\n/g)||[]).length)"` — must be 0.
   Measured in session 2: `core.autocrlf=true` is set in this clone's config, and
   `git ls-files --eol` reports every file as `i/lf w/crlf` — blobs are LF, the
   checkout is CRLF. So the rule is about the working tree, and a
   `git show HEAD:file` comes out LF; convert before comparing against it.

2. **Restart the dev server when feeds start returning empty.** It degrades
   after a few hours: outbound fetches begin timing out at the connect stage
   while the *same request from a shell succeeds in milliseconds*. It looks
   exactly like a broken route or a dead upstream, and it is neither. This cost
   hours across the session before the pattern was clear. Symptom: several
   unrelated routes returning `[]` or 502 at once.

3. **New outbound routes use `lib/httpJson`, not `fetch`.** It goes through
   Node's https agent rather than undici, carries the identifying UA these
   community feeds ask for, and decodes gzip. Ask for gzip explicitly —
   `headers: { 'Accept-Encoding': 'gzip' }` — it decodes by response header but
   never requests it, which is how a route ends up pulling 11MB of JSON.

4. **Anything expensive gets `cachedSource`.** TTL cache, in-flight dedup, and
   it keeps serving the last good result when a refresh fails rather than
   emptying the map. `/api/fires` without it re-parsed 61k CSV rows on every
   miss: 19s cold, every 10 minutes.

5. **Declare a raster source's real `maxzoom`.** Providers do not always error
   past their limit. RainViewer answers `200 OK` with a grey PNG that reads
   "Zoom Level Not Supported", and MapLibre will happily paint it across the
   map. Verify a provider's ceiling by fetching tiles, not by reading docs.

---

## What exists now

Six layers added, all keyless, all toggleable, all off by default:

| Layer | Source | Note |
|---|---|---|
| Broadcast Radio | Radio Browser | ~2,500 stations by transmitter; https-only |
| Live TV | iptv-org | Country markers, not transmitters — see below |
| Precipitation Radar | RainViewer | 13 frames / 2h, animated scrubber |
| Cloud Imagery | NASA GIBS | VIIRS true colour, daily |
| Named Fire Incidents | NIFC / WFIGS | 448 US wildfires, acres + containment |
| Fire Perimeters | NIFC / WFIGS | 194 polygons, generalised to ~500m |

Plus: a real FRP-weighted fire heatmap, draggable floating windows, and the map
now opens where you are rather than in central Bulgaria.

**Offline and appliance work**, all of it aimed at the bootable-drive plan:

| Thing | Where | Note |
|---|---|---|
| Offline basemap | `public/offline/`, `lib/basemap.ts` | 2.3MB Natural Earth; whole world, no network |
| Basemap pin | `OSIRIS_BASEMAP=offline` | meta tag from the layout, read per request |
| Library updater | `tools/update-kit.mjs` | verified, resumable, never deletes before it swaps |
| Drive landing page | `usb/START-HERE.html` | one file, no build, works over `file://` |
| Packaging list | `docs/USB-APPLIANCE.md` | measured sizes, three builds, the three usage modes |
| Map glyphs | `OsirisMap.tsx`, `createGlyph` | Cameras, fire detections, named incidents, radio and TV draw lucide glyphs rasterised at 2x with a dark outline, sized by zoom; TV at 1.5x, cyan; flames stepped by FRP or containment. Every point still drawn |
| Cursor clock | header, `lib/local-time.ts` | Wall-clock time under the cursor, offline via tz-lookup + Intl; American zone names, GMT offsets elsewhere; ticks every second |
| Traffic, key banked | `/api/traffic`, `TOMTOM_API_KEY` | TomTom flow tiles proxied so the key stays server-side; layer appears only with a key; free tier 2,500 tiles/day, non-commercial. No keyless traffic exists anywhere — the data is a fleet of phones |
| Property links | region dossier, `lib/listings.ts` | Zillow rent and sale on the right-clicked spot by bounds (confirmed by the operator); Redfin by ZIP; LoopNet as city-st-zip with map view (confirmed). No listings source is free, keyless and allowed, so links, not a layer. The dossier now geocodes at street level for town, county, ZIP and state code |
| Coordinate links | popups, `coordLink` | The attack popup's source origin and every COORDS readout fly the map there, through a window hook the flight popup already used; numbers parsed and re-printed, never raw |
| Radio compact, TV PiP | `RadioPlayer.tsx`, `TvViewer.tsx` | A minimise button folds the player to one row; the TV window hides, not unmounts, while the stream is in picture-in-picture |
| Interface switches | Style Studio, `style-tokens.ts` | Bottom ticker on/off beside the pan/zoom pad; logo at half size, 12px in; tagline gone; upstream's token badge removed; Next's dev button off |
| Property lines | ArcGIS window, "Property Lines" quick-pick | There is no national parcel layer, free or paid; counties publish their own. The pick searches parcels *and taxlots* (Oregon's word; "parcels" alone never found Multnomah County) against the current view, ranks by how much of the view a layer covers, and imports the county's service. Capped at 2,000 features a view, and the window says so, so use a neighbourhood zoom. Measured: King County gives 703 polygons with addresses for a few downtown blocks; Multnomah gives 74 lots with owners for one street |
| Topographic basemap | MAP/SAT/TOPO toggle on the rail | Esri World Topo tiles, same service and terms as the imagery, keyless. The basemap effect now honours the URL it is given instead of hard-coding the imagery |
| Day/Night | `day_night`, `lib/day-night.ts` | Upstream's was one polygon of the night hemisphere from a crude terminator with no equation of time (up to 4° off). Now the sun is placed by NOAA's low-precision algorithm and the shade is painted per pixel from its elevation — clear above +3°, full below −12° (nautical twilight), a smooth ramp between — as an image source repainted every minute. The layer keeps the id `day-night-fill` because other layers are inserted relative to it |
| Surface Temperature | `wx_temp`, `/api/temperature`, `lib/isotherms.ts` | Not tiles: a 12×8 grid of current 2 m readings from Open-Meteo for the padded view snapped to a lattice (one keyless request, cached 15 min, served from any fresh covering field, one upstream call per 4s, 90s cooldown on a 429; the legend says "Provider busy · retrying" and the page retries — the free tier counts each point as a call, ~600/min, and the first 24×16 grid earned a 429 that blanked the layer silently). A padded view wider than 20° takes NOAA's GFS instead: `/api/temperature/gfs` downloads the 2 m temperature for the whole globe at 0.5° from the NOMADS filter (five 160 KB GRIB2 files per six-hourly run — forecast hours 0 to 12 — public domain, keyless), decodes them with the repo's own reader (`lib/grib2.ts`: templates 5.0/5.2/5.3, checked value-for-value against grib2class on a real file, the 1° file is a test fixture) interpolates between the two forecast hours that bracket the present, and crops on the model's own lattice (`lib/gfs.ts`; a whole-cell stride, so a pan reuses the same cells). A padded view wider than 90° asks for the whole globe at 1.5° (620 ms to contour, held until the view drops below ~12°); narrower views ask for twice their box at 0.5°. The page holds any field that still covers the view with eight cells across, so zooming inside it fetches nothing. The legend names the run. The map keeps two band faces and dissolves between them on every update (MapLibre transitions paint, not data), so a new field never snaps in, painted on the client as a picture (`lib/temperature-raster.ts`: every pixel samples the grid bilinearly, rows spaced in Mercator, quantised to its 2°C band, ~60 ms) and shown as an image source with one raster opacity for the translucency; two faces dissolve on every update. It was d3-contour polygons for most of a day — nested regions, then true bands with a containment tree — and on the globe they kept tessellating into stray triangles wherever rings touched; a picture cannot. White Natural Earth country and state borders from `public/offline/` are drawn over the colour, loaded the first time the layer is on. The legend in C and F is a draggable window like the rest and closes the layer. Within the US the field is nudged toward NOAA station readings (`/api/temperature/stations`, `lib/nws-stations.ts`, `lib/temperature-blend.ts`: inverse-distance residuals, fading at 0.8°), and the stations are drawn as labelled dots so model and thermometer can be compared. The AIRS tile layer it replaced was raw swaths and splotchy. Open-Meteo is CC BY 4.0, non-commercial free tier — feed audit |
| Auto find | ArcGIS window switch, `components/NearbyLayers.tsx`, `lib/arcgis-nearby.ts` | On, every place the map settles is searched (a union of the quick-pick subjects, scoped to the view) and a strip beside the map controls offers the top six, one click each. Closing the strip turns it off. Remembered per browser |
| One window chrome | `components/FloatingWindow.tsx` | The broadcast viewers' frame — meta bar, title row, cornered icon, actions, ✕, both rows a drag handle over `DraggablePanel` — worn by every floating window: Style Studio, pinned layer groups, Recon, Live From Space, Markets, Live Alerts, ArcGIS, World Remote, Drawing tools, Route planner, Flight watch, Region dossier, Live feed, Satellite card. Fullscreen modes keep their own overlays. The radar has no window at all: it is on or off, and animates by itself from `page.tsx` |
| TV relay, off by default | `lib/tv-relay.ts`, `api/tv/relay` | Pluto refuses browsers on any origin but its own (measured: no CORS on the redirect, `pluto.tv` only behind it). `OSIRIS_TV_RELAY=1` relays those streams through the server; unset, they are not offered. Right wherever server and viewer are the same machine, the drive included; wrong on a hosted instance, which would carry every viewer's stream |
| Analytics opt-in | `src/middleware.ts` | sends nothing unless `UMAMI_WEBSITE_ID` is set; upstream's site ID is no longer the fallback. Next's own telemetry is disabled on this machine |
| View toggles | `LayerPanel.tsx`, top of the rail | 3D/2D and MAP/SAT as one button each, showing the current state; replaced the four-segment strip at bottom-left |
| Typed commands | `lib/commands.ts`, `SearchBar.tsx` | "fires in oregon" in the search box: layer on, camera moved. Places resolve from the bundled gazetteer when the geocoder cannot be reached |

**Three decisions that look arbitrary and are not:**

- **TV is country-resolution.** iptv-org gives an ISO country code and nothing
  else. Dropping 2,570 US channels on one eyeballed centroid would invent a
  precision the source does not have.
- **Cloud imagery is true colour, not infrared** — despite IR being the more
  literal reading. GIBS' brightness-temperature renders as a muddy tan wash
  crossed by white orbital swath gaps over a dark basemap. Tiles were fetched
  and looked at before choosing. Cost: reflectance needs sun, so no night side.
- **Perimeters are generalised.** At full resolution the same 194 polygons are
  38MB. At ~500m they are 0.53MB and identical at any zoom that fits a fire.

---

## Things I got wrong, and what caught them

The useful half of this document.

- **Declared RainViewer's tile ceiling one level too high.** Probed tile sizes,
  saw z8 return 3269 bytes, and called it valid — because I was checking against
  the *256px* label size (1370) while looking at *512px* tiles, whose label is
  3269. Shipped it. **Caught by the user's screenshot** of "Zoom Level Not
  Supported" tiled across their map. Fixed by downloading the tile and *looking
  at it*. Lesson: when a byte count is the evidence, open the file.

- **Wrote 81 bare-LF lines into a CRLF file.** My anchors were single-line so
  they matched; my replacements carried `\n`. Caught by an explicit line-ending
  check, which is now rule 1.

- **A zoom `interpolate` nested inside `*`** in the `tv-glow` paint. MapLibre
  requires zoom curves to be outermost and **silently drops the layer** — no
  throw, no console error, the layer simply is not in the style. Caught by
  enumerating `getStyle().layers` instead of trusting that addLayer worked.

- **Put the drag wrapper inside a keyed component.** `TvViewer`'s panel is keyed
  by country, so switching countries would have remounted the drag state and
  snapped the window back to the corner. Caught by reasoning about the key
  before shipping, verified after by dragging then switching country.

- **Made the offline basemap invisible.** Matched dark-matter's land and
  background exactly — four points apart, which on a dark display is no
  coastline. Caught by looking at the render.

- **Cried wolf on a committed secret.** My own grep used `^\.env` and matched
  `.env.example`, printing "SENSITIVE FILE COMMITTED". Nothing was wrong.
  Verify the alarm before repeating it.

- **Silently emptied every place feature.** The basemap fetcher filtered
  properties by exact key, and Natural Earth uses `NAME` on its country layers
  but `name` on the "simple" ones. Result: the offline map shipped with **no city
  labels at all**, and the offline gazetteer knew only countries. Neither failed
  — they just had nothing to show, which is why it survived a round of "verified"
  screenshots. Found weeks-of-staring later, by accident, while testing something
  else. Property lookup is case-insensitive now. **If a filter can silently match
  nothing, make it prove it matched something.**

- **Averaged a polygon's closing vertex.** A GeoJSON ring repeats its first point
  at the end; including it in a centroid drags the result toward that corner.
  Caught by a unit test whose expected value I had worked out by hand — the test
  was right and the code was wrong, which is the good way round.

- **Nearly fixed a bug that did not exist.** The landing page *looked* clipped on
  the right in a scaled screenshot. Measuring said `scrollWidth === clientWidth`
  and zero overflowing elements. It was a screenshot artefact. Measure before
  changing, including when the evidence is your own eyes.

- **Chased a red herring for many turns.** `queryRenderedFeatures` returns 0 for
  `fires-dots` under globe projection even when the dots are plainly on screen
  and clicking them works. The click path was never broken. If a query API
  disagrees with your eyes, test the actual interaction.

### Session 2 (2026-09-09, later)

- **Inherited a centroid that passed every test and placed every country
  wrong.** The gazetteer averaged the vertices of a polygon's *first* ring. Its
  seventeen tests passed, because the fixtures were squares. Run against the real
  Natural Earth files before wiring it in, the lookup put the United States on an
  Alaskan island, Chile on Easter Island, France on Corsica, Russia on a Kuril
  island — the first ring is whichever piece the file lists first — and Kenya on
  its beach, because a vertex average follows the coastline, which is where the
  vertices are. Now the bounding-box centre of the largest outer ring; twenty
  countries printed and read afterwards. A fixture proves the code does what the
  fixture says, not what the data does. Measure on the data.

- **The Browser pane's Enter key never arrives.** Pressing Return through the
  pane's `computer` tool reaches the page as a keydown with `key: ""`, so an
  `onKeyDown` that checks for `'Enter'` never fires and the bar looks broken. It
  is not. Measured by logging keydowns at capture; proven by dispatching a real
  `KeyboardEvent('keydown', { key: 'Enter' })`, which selected the row. Clicking
  the row works through the tool; Enter has to be tested by dispatch.

- **A hidden Browser pane does not advance CSS transitions.** Changing a colour
  token and reading `getComputedStyle().color` straight after, or 700ms after,
  returned the *old* colour on every icon with `transition-colors`, and looked
  exactly like the icons not following the token. They did; the transition was
  paused because the pane was not being drawn. Measure with a temporary
  `* { transition: none !important }` in the page, then remove it.

- **A pipeline hid a failed patch from the commit gate, twice.** `node patch.mjs`
  `| tail` reports tail's exit code, and `vitest | grep` reports grep's. One
  commit landed with a syntax error, one with only half its files; both were
  caught within the minute and amended, because they were unpushed and
  minutes old. The chain now captures each step's own exit code into a
  variable and commits only when typecheck, tests and lint all pass.

- **The shell's working directory drifts back a level between calls.** A
  patch ran against `Claude_local/src/...`, found nothing, and the new files
  it was meant to wire had already landed — a minute of compile error in the
  operator's tab. Every chain now begins with an explicit `cd` into the repo.

- **A lint gate that demands equality refuses improvements.** Using an icon
  that had been an unused import dropped a file's count by one and the gate
  said no. Upstream files carry dozens of findings that are not ours; the
  gate is "no worse than the committed version", per file, not zero.

- **A guard regex matched a comment.** `\btemperature,` found
  "brightness-temperature," in a doc comment and refused a correct patch
  three times. Guards for a code token should anchor to the line.

- **A test asked the blend to do the wrong thing.** At a thermometer's own
  cell the thermometer should win; the test demanded it be outvoted there.
  Outvoting is a between-stations property, and the test now samples between.

- **A second `next dev` in the same directory refuses to start** while another
  session's is running, on any port. The pane can simply navigate to the running
  one on :3000 — it serves the same working tree, hot reload included — despite a
  hook saying it cannot be reached. Try before believing either message.

### Session 3 (2026-09-09, afternoon and evening)

- **A keyless provider's budget is spent per point, not per request.** The
  temperature field asked Open-Meteo for 384 points on every map settle, each
  settle made a new three-decimal key, and my own probes added more. Within the
  hour the address had spent its 5,000 calls; the route turned the 429 into a
  502, the page returned early, and the layer went blank with the legend
  reading "Model only" — no hint anywhere. Also: `httpJson` threw the body
  away, and the body was the useful part ("Hourly API request limit
  exceeded"). Now 96 points, a lattice-snapped view, one upstream call per 4s,
  a cooldown until the named limit resets, and the legend says so. The rule:
  when a layer can fail, the failure must be visible on the map, and an error
  body must reach the code that decides what to do about it.

- **A field on the globe is a picture, not polygons.** The temperature layer
  spent most of a day as d3-contour bands: nested regions first, then true
  bands cut from one another with a containment tree, then a fix for rings
  touching at a vertex, then a fix for an inverted area sign. Each fix was
  right and each screenshot showed the next stray triangle, because rings
  from adjacent thresholds share the field's edge and MapLibre's globe
  re-tessellates every polygon. Painting the field — sample, quantise, colour,
  one image source, one opacity — took an hour, runs twenty times faster, and
  cannot clip. When a layer is a continuous field, reach for a raster first.

- **"It keeps shifting colour" was three different things,** and only one
  of them was what it looked like. The crop was re-sampled on a stride that
  depended on the exact view, so every settle fell on different model cells
  (fixed by cropping on the model's own lattice); the source switch at 20°
  swapped a six-hour-old analysis for a current reading (fixed by fetching the
  run's forecast hours and interpolating to now); and a dissolve that waited
  on the map going idle could be cancelled first, leaving a stale face at
  full opacity under the next one (fixed by firing on the source's own load
  event, with a fallback, and at the latest on teardown). Measure each symptom
  separately; the user's one sentence does not mean one cause.

- **A validator that reuses the code under test is circular.** The polygon
  validator used the same interior-point function as the containment tree, so
  when the area sign was inverted both agreed and the count went *up* after
  the "fix". The clue was in the numbers, not the verdict: rows failing only
  along the field's top edge, with the nudge landing at 50.00001. Print the
  failing cases, not the tally.

- **The dev server dies on a config change.** A merge that touched
  `next.config.ts` made `next dev` restart and it exited instead; the user's
  tab went dark and `npm run dev` from the wrong directory gave an ENOENT for
  `package.json` in the home folder. Say which directory, every time.

- **Browser-pane verification works when the pane is fronted.** The map never
  initialises in a hidden pane, but `tabs_select` plus one screenshot makes it
  draw, and from there `__osirisMap` answers layer order, opacities, source
  coordinates and loaded state. That is how the satellite-ordering fix was
  proven rather than assumed.

---

## Open threads

- **The window refactor was verified by typecheck, lint and the suite, not by
  eye — except the ArcGIS window and the temperature legend window, which the
  operator has since used and screenshotted, and both render as designed.** Fifteen panels moved onto `FloatingWindow` in one sitting while the
  preview pane was collapsed, so none of them has been looked at since. What
  to check first: each window's drag and ✕; the collapsed-header controls that
  became window actions (Recon's full screen, Markets' and Alerts' maximise,
  Marauder's SCAN); and the live feed, which was a modal over a dimmed map and
  is now a plain window. The radar scrubber was removed afterwards at the
  user's request; the frame loop moved into page.tsx.
  Anything that sat centred with a Tailwind translate was moved to an explicit
  left, because DraggablePanel's transform overwrites a translate class.

- **Typed commands are wired, with two known edges.** The gazetteer matches
  exact, then prefix, then substring, and has no aliases, so "usa" resolves to
  Lusaka by substring while "united states" is right. Aliases (usa, uk, uae) are
  a five-line table when someone wants them. And a credential-gated layer —
  "outages" needs Cloudflare Radar — is skipped silently in `applyLayers` when
  the deployment cannot feed it; the command row gives no sign. Neither is a
  bug in what shipped; both are the next things a user will hit.

- **Two more pieces of the same idea were agreed and not built:** surfacing
  Kiwix's own full-text search across the ZIMs, and a local language model on the
  drive. The model must be **strictly grounded in the library** — retrieving and
  quoting, never answering from its own weights. A 3B model inventing a drug
  dosage on a survival drive is the one failure here that actually hurts someone.

- **The fork exists and the branch is on it** (2026-09-09, evening). The
  conversation with the author has not happened yet; the user intends to
  contribute the general fixes upstream and to carry the rest as a renamed,
  still-open fork. Open the conversation before the first PR, not with it.
- **The fires fix is cut for upstream** (2026-09-09, evening): branch
  `fix/firms-sampling` on the fork, one commit on the author's current master,
  4 files, 298 lines — the route fix plus the two-line page change that
  expands the compact payload. Built in a separate worktree at
  `../osiris-pr` (node_modules is a junction to the main checkout's) so the
  running dev server was not disturbed; the worktree stays until the PR lands.
  Gate on the author's tree: 627 tests, typecheck clean, lint no worse. The PR
  user opened it the same evening: **simplifaisoul/osiris#333**. Watch it for
  review comments; changes go on the `fix/firms-sampling` branch in `../osiris-pr`.
- **Free API keys are unclaimed.** OpenSky (flights refresh 900s → 90s) and
  Cloudflare Radar (unlocks two layers currently hidden) are the two worth
  having. Two more are banked by the operator's choice: TomTom for traffic
  (wired, dormant), and WSDOT's Highway Cameras access code — the old
  `data.wsdot.wa.gov/log/public/cameras.json` feed the camera route uses
  answers 404, so Washington State has no cameras of its own until the
  route is pointed at the keyed API (measured; the 558 "Washington" cameras
  are BC and Oregon spillover). RentCast would make rentals a layer instead
  of a link, 50 free calls a month. `N2YO_API_KEY`, `FIRMS_API_KEY` and `OSIRIS_TELEGRAM_CHANNELS` appear
  only in docs — no route reads them, signing up buys nothing.
- **Bootable USB appliance.** Live Linux + Kiwix + this dashboard. The offline
  basemap is step one. Packaging list with measured sizes:
  `docs/USB-APPLIANCE.md`. See also `docs/OFFLINE.md`; the key finding is that the
  existing style is OpenMapTiles schema, so a full-detail archive is a drop-in
  with no restyling.
- **Commercial use needs a feed audit, not a licence review.** MIT permits
  selling this. The *data* is the exposure: 687 SkylineWebcams references,
  96 YouTube, OpenSky's explicitly non-commercial licence, Esri and CARTO terms,
  and iptv-org's unauthorised rebroadcasts. The government feeds — NASA, USGS,
  NOAA, NIFC — are the clean ones. Added today: Open-Meteo (the temperature
  field) is CC BY 4.0 with a non-commercial free tier; the NWS station
  readings are public domain; Esri's topo tiles are under the same terms as
  the imagery already used; the property sites are links out, not data; and
  the Pluto relay works around Pluto's allow-list, personal use only.

---

## Current state (end of session 3, 2026-09-09, night)

**754 tests pass** (upstream's own included since the merge), typecheck clean,
lint clean on every file added here, and **no worse** on every upstream file
touched: `page.tsx` 94, `OsirisMap.tsx` 146 (down from 147), `LayerPanel.tsx`
8, `ArcGISPanel.tsx` 6 — the check to repeat after touching any of them.
Working tree clean. `feat/intel-layers` is 82 commits ahead of upstream's
master and 0 behind, pushed to the fork (`origin`), where it is the default
branch so the fork's front page shows this work; upstream's master is
`upstream`. PR #333 (the FIRMS fix) is open on upstream from the
`fix/firms-sampling` branch in the worktree `../osiris-pr`. `npm run dev` on
:3000, from the repo directory.

**Session 3 in one paragraph.** The temperature layer went from a single
Open-Meteo grid that blanked on a 429 to: a budgeted Open-Meteo field near,
NOAA GFS far (GRIB2 decoded in the repo, the run's forecast hours interpolated
to now, the whole globe once the view is wide, cropped on the model's lattice),
painted as an image rather than contoured, dissolving between updates, held
while it still covers the view, with white borders over it, a draggable
legend, and the basemap imagery underneath. The night shade became a
per-pixel twilight from a properly placed sun. Then the fork was made, the
branch pushed, upstream's two new commits merged (two conflicts, both kept
both sides), and the fires fix cut onto its own branch and sent as PR #333.

The commit chain that worked, for the next session to copy: `cd` into the
repo first; run the patch script and capture its exit code directly, not
through a pipe; typecheck; lint each touched file against `git show HEAD:`
written to a real file (`--stdin` under-reports); run the suite; commit only
if all pass, with a lint gate of "no worse", per file.

`.claude/launch.json` is untracked on purpose: it is the desktop app's dev-server
config for the Browser pane, not part of the project.

Before trusting anything here, run `node tools/fetch-offline-basemap.mjs` — the
2.3MB of basemap and gazetteer data is gitignored, so a fresh checkout has the
style but none of the data, and the offline map will be blank until you do.

The layer architecture is the thing to preserve: a route under `src/app/api/`,
a source and layers in `OsirisMap.tsx`, a fetch gated on the toggle in
`page.tsx`, an entry in `LayerPanel.tsx`. Six layers were added that way without
the pattern straining, which is a good sign for the seventh.
