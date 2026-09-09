# To the next Wizard

Hello. You've inherited something good, and you're inheriting it mid-sentence.

This is OSIRIS — a map that watches the world. It was someone else's project
before it was ours; we cloned it, found a bug that had been quietly throwing away
96.8% of NASA's fire detections, and then kept going. Radio you can listen to.
Television from a hundred and forty countries. Precipitation radar that animates.
Fires that actually look like fires. Then we taught it to work with no network at
all, because the plan is a bootable drive you could hand to someone in a place
where the internet is a rumour.

## Three things before you touch anything

1. **Read `HANDOFF.md`.** All of it. It is the real document; this one is just
   the door.
2. **Run `node tools/fetch-offline-basemap.mjs`.** The basemap data is gitignored.
   Without it the offline map is a black rectangle and you will think you broke
   something.
3. **If feeds start coming back empty, restart the dev server before you debug
   the route.** It rots after a few hours. This cost me hours; it need not cost
   you any.

## What I got wrong, so you don't have to

I shipped a zoom limit one level too high because I compared a byte count against
the wrong reference and never opened the file. The user's screenshot caught it. I
filtered map properties by exact key and silently emptied every place feature, so
the offline map had no city labels at all — and I had called it verified, from
screenshots, because nothing failed. It just had nothing to show.

Both mistakes have the same shape: **I trusted a signal instead of looking at the
thing.** The rule already written in the rig's memory is *measure, never assume*.
I can tell you from a long night's experience that it applies to your own
evidence too, not just to other people's code.

When you're unsure, open the file. Fetch the tile and look at it. Print the
number. It is almost always cheaper than being wrong.

## About the person you're working with

They're generous — the first instinct on finding a bug was that the fix should go
back upstream, so everyone benefits. They'd rather have nine honest commits than
one big one, so the original author can take whichever pieces are useful. They
ask short questions that turn out to be load-bearing: *why does it default to
Bulgaria?* was three real problems in a trench coat.

Tell them the truth, including when the truth is "that can't be done" — autorun
from USB, or a small model that shouldn't be trusted with a drug dosage. They
take it well and the work gets better for it.

## The thing I left unfinished

`src/lib/commands.ts` parses "fires in oregon" into a layer toggle and a camera
move, resolves places offline, and has seventeen passing tests. **Nothing calls
it.** It needs wiring into `SearchBar`. Please do that before it rots — it's a
good piece of work waiting for a doorway.

After that: Kiwix full-text search, then a local model that is only ever allowed
to quote the library and never to answer from its own weights.

---

Seventeen commits. Six hundred and forty-nine tests. Nothing pushed yet.

The map opens where you are now, instead of in a Bulgarian field. That one's my
favourite.

Have fun. Measure things. Be honest about what broke.

— the Wizard before you, 2026-09-09

---

*P.S. from the next one, later the same day:* the doorway is built. Type
"fires in oregon" and it does what the letter above promised; type "kenya" with
the network unplugged and the map still goes there. The parser also learnt where
countries actually are — see HANDOFF's session 2 notes for how a fully tested
piece of code put France on Corsica. Twenty-one commits. Six hundred and
fifty-five tests. Still nothing pushed; that is now the loose end. Kiwix search
and the library-only model remain as they were left.
