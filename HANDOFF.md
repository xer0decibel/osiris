# OSIRIS — handoff

*New here? Read [WELCOME.md](WELCOME.md) first — it is shorter and tells you
where to stand. This file is the reference.*

Read this before touching the map. Written across one very long session,
2026-09-08/09, which took a cloned dashboard, added six layers, made it work
with no network, and started packaging it as a bootable drive.

**What this is:** a fork-in-progress of
[simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) — an OSINT
situational-awareness map. MIT licensed. Upstream is *active* (commits most
days), so this diverges further every day it sits.

**State:** 10 commits on branch `feat/intel-layers`, **nothing pushed anywhere**.
`origin` is upstream's repo and is not writable by us. Committer identity is set
repo-locally to `xer0decibel <xer0decibel@protonmail.com>`.

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
| Offline commands | `lib/commands.ts` | **built and tested, not wired — see open threads** |

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

---

## Open threads

- **`lib/commands.ts` is orphaned — start here.** The parser turns "fires in
  oregon" into a layer toggle plus a camera move, resolves places from the
  bundled gazetteer with no network, and has 17 tests. Nothing calls it. It needs
  wiring into `SearchBar` (`components/SearchBar.tsx`, which today only geocodes
  through Nominatim and so does nothing offline) and a `setActiveLayers` path
  from `page.tsx`. Committed unused code rots; this is the first thing to finish.

- **Two more pieces of the same idea were agreed and not built:** surfacing
  Kiwix's own full-text search across the ZIMs, and a local language model on the
  drive. The model must be **strictly grounded in the library** — retrieving and
  quoting, never answering from its own weights. A 3B model inventing a drug
  dosage on a survival drive is the one failure here that actually hurts someone.

- **Nothing is pushed.** Needs a fork or a new repo (see the session notes) and
  a Personal Access Token — GitHub no longer takes passwords over HTTPS.
- **The fires fix deserves its own upstream PR.** 3 files, 292 lines, a real bug
  with hard numbers, and it helps every existing user. Best first contribution;
  much better odds than one 2,585-line PR of seven features.
- **Free API keys are unclaimed.** OpenSky (flights refresh 900s → 90s) and
  Cloudflare Radar (unlocks two layers currently hidden) are the two worth
  having. `N2YO_API_KEY`, `FIRMS_API_KEY` and `OSIRIS_TELEGRAM_CHANNELS` appear
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
  NOAA, NIFC — are the clean ones.

---

## Current state (end of session 1, 2026-09-09)

**649 tests pass**, typecheck clean, lint clean on every file added here. Working
tree clean, 16 commits on `feat/intel-layers`, nothing pushed. `npm run dev` on
:3000.

Before trusting anything here, run `node tools/fetch-offline-basemap.mjs` — the
2.3MB of basemap and gazetteer data is gitignored, so a fresh checkout has the
style but none of the data, and the offline map will be blank until you do.

The layer architecture is the thing to preserve: a route under `src/app/api/`,
a source and layers in `OsirisMap.tsx`, a fetch gated on the toggle in
`page.tsx`, an entry in `LayerPanel.tsx`. Six layers were added that way without
the pattern straining, which is a good sign for the seventh.
