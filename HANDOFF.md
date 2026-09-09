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

- **A second `next dev` in the same directory refuses to start** while another
  session's is running, on any port. The pane can simply navigate to the running
  one on :3000 — it serves the same working tree, hot reload included — despite a
  hook saying it cannot be reached. Try before believing either message.

---

## Open threads

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

## Current state (end of session 2, 2026-09-09)

**655 tests pass**, typecheck clean, lint clean on every file added here.
`page.tsx` carries 95 lint findings that are upstream's; the count is unchanged
by anything done here, which is the check to repeat after touching it. Working
tree clean, 21 commits on `feat/intel-layers`, nothing pushed. `npm run dev` on
:3000.

`.claude/launch.json` is untracked on purpose: it is the desktop app's dev-server
config for the Browser pane, not part of the project.

Before trusting anything here, run `node tools/fetch-offline-basemap.mjs` — the
2.3MB of basemap and gazetteer data is gitignored, so a fresh checkout has the
style but none of the data, and the offline map will be blank until you do.

The layer architecture is the thing to preserve: a route under `src/app/api/`,
a source and layers in `OsirisMap.tsx`, a fetch gated on the toggle in
`page.tsx`, an entry in `LayerPanel.tsx`. Six layers were added that way without
the pattern straining, which is a good sign for the seventh.
