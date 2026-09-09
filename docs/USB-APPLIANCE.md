# Bootable USB appliance — packaging list

A live-boot drive that is useful with no network and becomes a world view the
moment it finds one. Two halves that fail at different times: an offline
reference library that never needs a connection, and this dashboard, which needs
one for everything except the map itself.

Sizes below are marked **measured** (taken on this machine or read from the
provider's live index on 2026-09-09) or **approx** (not verified here — check
before you cut the image).

---

## The thing that reframes the problem

**OSIRIS is 41 MB.** Measured from `npm run build`:

| Component | Size | |
|---|---|---|
| `.next/standalone` — the whole server | 28 MB | measured |
| `.next/static` | 6.7 MB | measured |
| `public/` incl. the 2.3MB offline basemap | 6.4 MB | measured |
| **Total application** | **~41 MB** | measured |
| Node 22 runtime (linux-x64) | ~50 MB | approx |

So the dashboard is rounding error. On a 128 GB drive it is **0.03%** of the
capacity. Every real packaging decision is about the reference library, and the
only question that matters is which Wikipedia tier you carry.

That also means: do not compromise the library to make room for the app, and do
not bother trimming the app.

---

## Wikipedia tiers

Live from `download.kiwix.org`, latest build of each, **measured**:

| Tier | Size | Built | What you give up |
|---|---|---|---|
| `all_maxi` | 119 GB | 2026-09-08 | nothing — full text, full images |
| `all_nopic` | 49 GB | 2026-06-26 | images |
| `all_mini` | 12 GB | 2026-06-18 | images, and articles cut to intro sections |
| `top_maxi` | 7.8 GB | 2026-06-16 | the long tail; keeps images on what remains |
| `simple_all_maxi` | 3.2 GB | 2026-05-10 | full vocabulary — Simple English rewrite |
| `simple_all_nopic` | 937 MB | 2026-05-10 | images and vocabulary |

`all_mini` is the sweet spot for a survival drive: complete article *coverage*
at 12 GB. You lose depth, not breadth — every topic is present, truncated. For
"does this plant kill me", coverage beats depth.

## Reference material beyond Wikipedia

**Measured** from the Kiwix catalog:

| ZIM | Size | Why carry it |
|---|---|---|
| WikiMed Medical Encyclopedia | 2.06 GB | the single highest-value non-Wikipedia file |
| WikiMed (mini) | 0.15 GB | same, when space is desperate |
| iFixit | 3.3 GB | repair procedures with photographs |
| Wikibooks | 5.8 GB | includes practical instructional texts |
| Appropedia | 0.54 GB | appropriate technology, water, sanitation, power |
| Military Medicine | 0.07 GB | field medicine, trivially small |
| Wiktionary | 8.53 GB | skip unless translating; Simple is 0.02 GB |
| Project Gutenberg | 206 GB | do not — larger than everything else combined |

Also worth adding, not from Kiwix: **US Army field manuals** (public domain),
**Where There Is No Doctor** and **Where There Is No Dentist** (Hesperian,
freely licensed) — a few hundred MB of PDFs, disproportionate value.

---

## Three builds

### 64 GB — the realistic one
```
  Live OS + Node + Kiwix            ~3 GB    approx
  OSIRIS                            41 MB    measured
  Wikipedia all_mini                12 GB    measured
  WikiMed full                    2.06 GB    measured
  Appropedia + Military Medicine  0.61 GB    measured
  iFixit                          3.3  GB    measured
  Field manuals / Hesperian PDFs   ~1 GB     approx
  Offline map tiles (regional)     ~2 GB     approx
  ─────────────────────────────────────────
  ~24 GB used, ~40 GB free for persistence
```

### 128 GB — the good one
Swap `all_mini` for **`all_nopic` (49 GB)** and take a continental PMTiles
basemap (~10 GB). Full article text, no images, street-level maps for your
region. **~70 GB used.**

### 256 GB — the no-compromise one
**`all_maxi` (119 GB)** with images, plus a planet PMTiles basemap (~100 GB
approx). **~230 GB.** Note this leaves little persistence headroom and takes a
long time to write — and images are the least survival-critical bytes on the
drive. The 128 GB build is the better product.

---

## The boot layer

**Approx — none of this was verified here.**

- **Base:** Debian Live. Not Alpine, and not from scratch: booting reliably on
  arbitrary hardware is its own discipline and Debian has already done it.
- **Persistence:** a writable partition is mandatory. Without it every boot
  re-fetches everything the dashboard caches, which on a drive whose entire
  purpose is working offline is the wrong failure.
- **Multi-boot:** Ventoy, if you want several images on one stick.
- **Kiwix:** `kiwix-serve` on a local port; the ZIMs sit on the data partition.
- **OSIRIS:** `node server.js` from `.next/standalone`, `PORT=3000`, started by
  a systemd unit. It is already built for this — the repo's Dockerfile produces
  exactly this standalone output.
- **Secure Boot:** an unsigned custom kernel will not boot on a lot of machines
  without the user disabling it in firmware. Decide early whether you care,
  because it shapes the whole image.

---

## What actually needs building

Roughly in order of how much thinking each needs:

1. **Pin the basemap to offline in the image.** One line —
   `localStorage.setItem('osiris:basemap','offline')` — or ship a build with the
   override baked in. Otherwise the appliance probes CARTO on every cold boot.
2. **A landing page.** Booting to a browser with two bookmarks is not a product.
   One page: dashboard, library, status, and an honest "no connection" state.
3. **Connectivity awareness in the UI.** Right now offline layers just sit
   empty. The appliance should say *why* — "no connection, 6 layers waiting" —
   rather than looking broken.
4. **Street-level offline maps, if wanted.** See `OFFLINE.md`. The existing
   style is OpenMapTiles schema, so a PMTiles archive is a drop-in with no
   restyling. This is the single biggest quality jump available.
5. **The image build itself.** Scripted, reproducible, and versioned — not a
   drive someone assembled by hand once.

---

## Honest problems

- **The two halves do not reinforce each other.** Offline you have a library and
  a map with no markers. Online you have a live picture. There is no state where
  both halves are pulling their weight at once, and the pitch should not pretend
  otherwise.
- **The library goes stale.** A ZIM is a snapshot. A drive cut today is a
  snapshot of today, forever, unless someone re-images it.
- **Commercial distribution is a data problem, not a licence problem.** MIT
  covers the code. It does not cover 687 SkylineWebcams streams, OpenSky's
  explicitly non-commercial feed, Esri imagery, or iptv-org's unauthorised
  rebroadcasts. A sold appliance needs those swapped for public-domain or
  licensed equivalents. The government feeds — NASA, USGS, NOAA, NIFC — are
  already clean.
- **Write time is real.** 70 GB to a USB 3.0 stick is roughly half an hour at a
  good sustained rate, and considerably worse on cheap flash.
