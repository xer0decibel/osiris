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

1. ~~Pin the basemap to offline in the image.~~ **Done.** Set
   `OSIRIS_BASEMAP=offline` in the image's environment. Read on every request, so
   the same image flips without rebuilding; a human can still override per-tab
   with `?basemap=online`.
   `OSIRIS_TV_RELAY=1` can go in the same environment: on the drive the server
   and the viewer are the same laptop, so relaying Pluto TV through it costs
   nobody else anything. Leave it unset only on a hosted, shared instance. See
   `.env.example`.
2. ~~A landing page.~~ **Done** — `usb/START-HERE.html`. One self-contained file,
   no build step, no external anything; works over `file://` on a dead network.
   It adapts to where it is opened: one run command on a desktop, and on a phone
   a note that the dashboard cannot run there at all.
3. **Connectivity awareness in the UI.** Right now offline layers just sit
   empty. The appliance should say *why* — "no connection, 6 layers waiting" —
   rather than looking broken.
4. **Street-level offline maps, if wanted.** See `OFFLINE.md`. The existing
   style is OpenMapTiles schema, so a PMTiles archive is a drop-in with no
   restyling. This is the single biggest quality jump available.
5. **The image build itself.** Scripted, reproducible, and versioned — not a
   drive someone assembled by hand once.

---

## Three ways to use one drive

The drive should not only be bootable. Most of the time the machine in front of
you is already running, and asking someone to reboot a working computer to read
a first-aid page is a bad trade.

### Mode 1 — boot it
The full appliance. For a machine that is off, that is not yours, or that you do
not trust. Everything below is available.

### Mode 2 — plug into a running computer
No install, no reboot, no admin rights.

- **Kiwix** ships portable builds for Windows, macOS and Linux. Run the binary
  straight off the drive; point it at the ZIMs on the same drive.
- **OSIRIS** runs the same way *if a Node runtime is carried on the drive*:
  `node .next/standalone/server.js`, then open localhost:3000. The build is 41MB
  and the runtime ~50MB, so all three platforms fit in about 150MB. No install,
  nothing written to the host.

### Mode 3 — plug into a phone
This is the one with real limits, and they are worth knowing before you design
around it.

**A USB flash drive has no processor.** It cannot serve anything. It presents
files, and the host does the rest. So on a phone:

- **PDFs and single self-contained HTML files** open fine — Files on iOS, any
  file manager on Android. This is why the field manuals and Hesperian books
  earn their place: they work everywhere, with nothing installed.
- **ZIM files need a reader.** The Kiwix apps for Android and iOS can open a ZIM
  from external storage, so the library works — but only if that app is already
  installed. Install it *before* you need it.
- **OSIRIS cannot run.** No Node, no server. A phone can only read files.

So the phone mode is the reference library, not the dashboard. Plan the content
accordingly: anything that must be readable on an unprepared phone should exist
as a PDF, not only inside a ZIM.

### What USB-C actually buys you

Nothing technical — it is a connector. What it buys is *reach*: modern phones,
tablets and laptops with no adapter. Get a **dual-connector drive (USB-C on one
end, USB-A on the other)**, because the machine you need in an emergency is as
likely to be a decade-old desktop as a new phone.

Do care about **USB 3.2 and a drive with real sustained write speed**. Writing
70GB to cheap flash is an afternoon.

### The partitioning that makes all three work

This is the part with a hard constraint.

**Use Ventoy.** Writing an ISO to a stick with `dd` typically leaves it
unreadable as ordinary storage on Windows — which kills modes 2 and 3. Ventoy
was built for exactly this: it creates a large data partition you can both drop
bootable ISOs into *and* use as a normal drive.

**Format the data partition exFAT, not FAT32.** FAT32 has a **4GB maximum file
size**, and the Wikipedia ZIMs are 12–119GB. FAT32 cannot hold a single one of
them. exFAT is readable by Windows, macOS, Linux, Android and iOS.

Suggested layout:

```
  Ventoy data partition (exFAT)
    /ISO/            live image, for mode 1
    /START-HERE.html an index that works by double-click, no server
    /docs/           PDFs — field manuals, Hesperian
    /zim/            Kiwix library
    /portable/       Kiwix binaries + Node runtimes, win/mac/linux
    /osiris/         the 41MB standalone build
  Persistence partition (ext4)
    live-boot writes here
```

### Why it cannot open itself

Autorun from removable media is dead, deliberately. Windows disabled it for USB
drives in 2011 — an `autorun.inf` on a stick will not launch anything. macOS
never had it, and neither iOS nor Android will run anything from a drive. This is
not an oversight to work around: autorun-from-USB was among the most effective
malware vectors ever built, and is how Stuxnet spread.

So the drive gets exactly one shot at being obvious, and it is spent on:

- **`START-HERE.html` at the root**, where it cannot be missed
- **a volume label** — `OSIRIS-KIT` — so the drive announces itself in the file
  manager before anything is opened

The booted image is the exception. There you own the session, so the browser can
open the page on login.

`START-HERE.html` is doing real work in that list: it is the only thing that
functions identically in all three modes, with nothing installed and nothing
running. It should be a plain file with relative links — no build step, no
JavaScript that matters, no server.

## Keeping it current

Three different things go stale at three different rates, and they want three
different answers.

### The live layers — already handled
Fires, flights, weather, radio, TV, maritime, quakes. Every one polls whenever
there is a connection. Nothing to build, nothing to schedule, nothing to
configure. Plug in a network and they fill in.

### The library — `tools/update-kit.mjs`
Kiwix rebuilds its archives roughly monthly and puts the build date in the
filename, so spotting a stale one is string comparison.

```
node tools/update-kit.mjs --library /path/to/zim            # report only
node tools/update-kit.mjs --library /path/to/zim --update   # fetch them
```

Built around one rule: **the drive must never be less capable after an update
than before it.** Everything else follows.

- Downloads to `.partial`, verifies the published SHA-256, and only then swaps
  it in. The old archive is not deleted until the new one is on disk and
  correct. Delete first, and a transfer that dies at 80% leaves a survival drive
  with no encyclopedia — the worst outcome this thing has.
- Refuses when free space is short, rather than stranding it half done. Holding
  both copies briefly is the price of never holding neither.
- Reports by default; downloads only when asked, and anything over 2GB needs an
  explicit `--yes`. A 49GB transfer started unattended on a tethered phone is
  not a favour.
- Resumes rather than restarts — the mirror supports Range, so a link that drops
  at 40GB does not mean starting again.
- Skips any archive with no published checksum, because an unverified archive is
  not an upgrade.

This was tested against the real mirror, including the failure path: a
deliberately corrupted resume was caught by the checksum, the partial was
discarded, and the existing archive survived untouched.

On the appliance, schedule the **check** and leave the download to a person —
a systemd timer running without `--update`, surfacing a notice. Automatic
checking is helpful; automatic multi-gigabyte downloading is not.

### The OS and the application — deliberately manual
Neither is touched by that script, and neither should be updated unattended on a
device you may be depending on. An automatic `git pull` and rebuild can turn a
working drive into a brick, and you would not find out until the moment you
needed it. Update those on a desk, verify the thing still boots and still
renders, and re-image.

## Honest problems

- **The two halves do not reinforce each other.** Offline you have a library and
  a map with no markers. Online you have a live picture. There is no state where
  both halves are pulling their weight at once, and the pitch should not pretend
  otherwise.
- **The library goes stale** — though `update-kit` now answers this wherever
  there is a connection and enough free space. With neither, a ZIM is a snapshot
  of the day the drive was cut, forever.
- **Commercial distribution is a data problem, not a licence problem.** MIT
  covers the code. It does not cover 687 SkylineWebcams streams, OpenSky's
  explicitly non-commercial feed, Esri imagery, or iptv-org's unauthorised
  rebroadcasts. A sold appliance needs those swapped for public-domain or
  licensed equivalents. The government feeds — NASA, USGS, NOAA, NIFC — are
  already clean.
- **Write time is real.** 70 GB to a USB 3.0 stick is roughly half an hour at a
  good sustained rate, and considerably worse on cheap flash.
