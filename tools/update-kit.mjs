#!/usr/bin/env node
/**
 * OSIRIS — update the offline library when there is a connection.
 *
 * Kiwix rebuilds its archives roughly monthly and puts the build date in the
 * filename, so working out what is stale is just string comparison. Actually
 * replacing a 49GB file on a drive someone may be relying on is the part that
 * needs care.
 *
 * ── The rule this is built around ──
 * The drive must never be less capable after an update than before it. Every
 * decision below follows from that:
 *
 *   · Download to `.partial`, verify, *then* swap. The old archive is not
 *     deleted until the new one is on disk and its checksum matches. Delete
 *     first and a download that dies at 80% leaves a survival drive with no
 *     encyclopedia — the worst outcome this thing has.
 *   · Refuse when free space is short. Holding both copies briefly is the price
 *     of never holding neither. Better to decline than to strand it half done.
 *   · Check by default, download only when asked. A 49GB transfer started
 *     unattended on a tethered phone is not a favour.
 *   · Resume rather than restart. The server supports Range; a link that drops
 *     at 40GB must not mean starting again.
 *
 * ── What this does not touch ──
 * Not the operating system, and not the application code. On a device you may
 * depend on, an unattended `git pull` and rebuild can turn a working drive into
 * a brick with no way to tell until you need it. Update those deliberately, on
 * a desk, and verify before you rely on them.
 *
 * The live layers — fires, flights, weather, radio, TV — need none of this.
 * They already refresh whenever there is a connection.
 *
 *   node tools/update-kit.mjs --library /path/to/zim            # report only
 *   node tools/update-kit.mjs --library /path/to/zim --update   # do it
 *   node tools/update-kit.mjs --library /path/to/zim --update --yes
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const BASE = 'https://download.kiwix.org/zim/';
/** Directories on the mirror worth scanning for a newer build. */
const SECTIONS = ['wikipedia', 'other', 'wikibooks', 'wiktionary', 'ifixit', 'gutenberg', 'zimgit'];

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const value = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };

const LIBRARY = value('--library');
const DO_UPDATE = flag('--update');
const ASSUME_YES = flag('--yes');

/** Above this, a download is not started without an explicit --yes. */
const CONFIRM_OVER_BYTES = 2 * 1024 ** 3;
/** Kept free after the swap, so the drive never ends up completely full. */
const SPACE_MARGIN_BYTES = 1024 ** 3;

const GB = b => {
  if (!Number.isFinite(b) || b <= 0) return '0';
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GB';
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MB';
  return Math.round(b / 1024) + ' KB';
};

function req(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OSIRIS-update-kit/1.0', ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 5) return reject(new Error('too many redirects'));
        return resolve(req(new URL(res.headers.location, url).toString(), headers, redirects + 1));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function text(url) {
  const res = await req(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode}`); }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/** `wikipedia_en_all_nopic_2026-06.zim` → base `wikipedia_en_all_nopic`, date `2026-06`. */
function split(name) {
  const m = name.match(/^(.*)_(\d{4}-\d{2})\.zim$/);
  return m ? { base: m[1], date: m[2] } : { base: name.replace(/\.zim$/, ''), date: null };
}

async function remoteIndex() {
  const index = new Map();
  for (const section of SECTIONS) {
    let html;
    try { html = await text(BASE + section + '/'); }
    catch { continue; } // a section that is unreachable is not fatal
    const re = /<a href="([^"]+\.zim)">[^<]*<\/a>\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+([\d.]+[KMGT]?)/g;
    let m;
    while ((m = re.exec(html))) {
      const [, file, size] = m;
      const { base, date } = split(file);
      if (!date) continue;
      const prev = index.get(base);
      if (!prev || date > prev.date) index.set(base, { file, date, size, section });
    }
  }
  return index;
}

function localArchives(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.zim'))
    .map(f => ({ file: f, ...split(f), bytes: fs.statSync(path.join(dir, f)).size }));
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((res, rej) => {
    const rs = fs.createReadStream(file);
    rs.on('data', d => hash.update(d));
    rs.on('end', res);
    rs.on('error', rej);
  });
  return hash.digest('hex');
}

/** Resumes from whatever is already in `.partial`. */
async function download(url, partial, onProgress) {
  let from = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  const res = await req(url, from ? { Range: `bytes=${from}-` } : {});

  if (from && res.statusCode === 200) {
    // The server ignored the range and is sending the whole file again.
    fs.rmSync(partial, { force: true });
    from = 0;
  } else if (from && res.statusCode !== 206) {
    res.resume();
    throw new Error(`resume refused: HTTP ${res.statusCode}`);
  } else if (!from && res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode}`);
  }

  const total = from + Number(res.headers['content-length'] || 0);
  let done = from;
  let lastTick = 0;

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(partial, { flags: from ? 'a' : 'w' });
    res.on('data', c => {
      done += c.length;
      const now = Date.now();
      if (now - lastTick > 2000) { lastTick = now; onProgress(done, total); }
    });
    res.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    res.pipe(ws);
  });

  return { bytes: done, resumedFrom: from };
}

async function main() {
  if (!LIBRARY) {
    console.error('usage: node tools/update-kit.mjs --library <dir> [--update] [--yes]');
    process.exit(2);
  }
  if (!fs.existsSync(LIBRARY)) {
    console.error(`library not found: ${LIBRARY}`);
    process.exit(2);
  }

  const local = localArchives(LIBRARY);
  if (!local.length) { console.log('no .zim archives found — nothing to update'); return; }

  process.stdout.write('checking for newer builds… ');
  let remote;
  try { remote = await remoteIndex(); }
  catch (e) { console.error(`\ncould not reach the mirror: ${e.message}\nnothing was changed.`); process.exit(1); }
  console.log(`${remote.size} known\n`);

  const stale = [];
  for (const a of local) {
    const r = remote.get(a.base);
    if (!r) { console.log(`  ?  ${a.file} — not on the mirror, leaving alone`); continue; }
    if (!a.date || r.date > a.date) {
      console.log(`  ↑  ${a.base}  ${a.date ?? 'undated'} → ${r.date}  (${r.size})`);
      stale.push({ local: a, remote: r });
    } else {
      console.log(`  ✓  ${a.base}  ${a.date}`);
    }
  }

  if (!stale.length) { console.log('\neverything is current.'); return; }
  if (!DO_UPDATE) {
    console.log(`\n${stale.length} archive(s) have newer builds. Re-run with --update to fetch them.`);
    return;
  }

  for (const { local: a, remote: r } of stale) {
    const url = `${BASE}${r.section}/${r.file}`;
    const dest = path.join(LIBRARY, r.file);
    const partial = dest + '.partial';
    console.log(`\n${r.file}`);

    let expected;
    try { expected = (await text(url + '.sha256')).trim().split(/\s+/)[0]; }
    catch {
      console.log('  no published checksum — skipped, because an unverified archive is not an upgrade');
      continue;
    }

    let size = 0;
    try {
      const head = await req(url, { Range: 'bytes=0-0' });
      head.resume();
      const cr = head.headers['content-range'];
      size = cr ? Number(cr.split('/')[1]) : 0;
    } catch { /* fall through with 0 */ }

    /* The old archive is still on disk and stays there until the swap, so the
       drive needs room for both at once. That is the cost of never being left
       with neither. */
    const free = freeBytes(LIBRARY);
    if (size && free !== null && free < size + SPACE_MARGIN_BYTES) {
      console.log(`  not enough room: needs ${GB(size)} beside the current copy, ${GB(free)} free — skipped`);
      continue;
    }

    if (size > CONFIRM_OVER_BYTES && !ASSUME_YES) {
      console.log(`  ${GB(size)} download. Re-run with --yes to allow transfers this large.`);
      continue;
    }

    try {
      const { resumedFrom } = await download(url, partial, (d, t) => {
        const pct = t ? ((d / t) * 100).toFixed(1) : '?';
        process.stdout.write(`\r  ${GB(d)} / ${GB(t)}  ${pct}%      `);
      });
      process.stdout.write('\r' + ' '.repeat(70) + '\r');
      if (resumedFrom) console.log(`  resumed from ${GB(resumedFrom)}`);

      process.stdout.write('  verifying… ');
      const actual = await sha256Of(partial);
      if (actual !== expected) {
        fs.rmSync(partial, { force: true });
        console.log('FAILED — checksum mismatch. Partial file discarded, existing archive untouched.');
        continue;
      }
      console.log('ok');

      // Swap, then remove the old one. Never the other way round.
      fs.renameSync(partial, dest);
      if (a.file !== r.file) fs.rmSync(path.join(LIBRARY, a.file), { force: true });
      console.log(`  updated → ${r.file}`);
    } catch (e) {
      console.log(`\n  failed: ${e.message}`);
      console.log('  the partial download was kept; re-run to resume. Existing archive untouched.');
    }
  }
}

main().catch(e => { console.error('update failed:', e.message); process.exit(1); });
