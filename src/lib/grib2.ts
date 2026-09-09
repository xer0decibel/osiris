/**
 * OSIRIS — a GRIB2 reader for the one shape of file the map asks for.
 *
 * NOAA publishes its global models as GRIB2, and its NOMADS filter hands back
 * a single field of one file — 2 m temperature for the whole globe in 160 KB.
 * There is no gridded global temperature anywhere keyless that is not either
 * this or a picture of this, so the map reads it.
 *
 * This is not a general GRIB2 library. It reads edition 2, a regular
 * latitude/longitude grid (grid template 3.0), and the three packings NOAA
 * uses for surface fields: simple (5.0), complex (5.2) and complex with
 * spatial differencing (5.3), which is what the GFS temperature files carry.
 * Anything else throws, naming what it saw, rather than guessing.
 *
 * Written from the WMO template definitions and checked against an
 * independent decoder on a real GFS file; see grib2.test.ts.
 */

export interface Grib2Grid {
  /** Columns, along longitude. */
  ni: number;
  /** Rows, along latitude. */
  nj: number;
  /** First point, degrees. */
  lat1: number;
  lon1: number;
  /** Increments, degrees; dLat is signed by scan direction (negative for north-to-south). */
  dLon: number;
  dLat: number;
}

export interface Grib2Field {
  /** Discipline / parameter category / parameter number: 0/0/0 is temperature in Kelvin. */
  discipline: number;
  category: number;
  parameter: number;
  /** Fixed surface type and scaled value: 103 / 2 is 2 m above ground. */
  levelType: number;
  levelValue: number;
  /** Reference (run) time, ISO. */
  referenceTime: string;
  /** Forecast hours past the reference time. */
  forecastHours: number;
  grid: Grib2Grid;
  /** Row-major from the first point, one per grid cell; NaN where missing. */
  values: Float32Array;
}

class Reader {
  constructor(private readonly b: Uint8Array, public pos = 0) {}
  u8(at: number) { return this.b[at]; }
  u16(at: number) { return (this.b[at] << 8) | this.b[at + 1]; }
  u32(at: number) { return ((this.b[at] << 24) >>> 0) + (this.b[at + 1] << 16) + (this.b[at + 2] << 8) + this.b[at + 3]; }
  i16(at: number) { const v = this.u16(at); return v & 0x8000 ? -(v & 0x7fff) : v; }
  /** GRIB's signed integers are sign-magnitude, not two's complement. */
  i32(at: number) { const v = this.u32(at); return v & 0x80000000 ? -(v & 0x7fffffff) : v; }
  f32(at: number) { return new DataView(this.b.buffer, this.b.byteOffset + at, 4).getFloat32(0); }
  u64(at: number) { return this.u32(at) * 2 ** 32 + this.u32(at + 4); }
  ascii(at: number, n: number) { return String.fromCharCode(...this.b.subarray(at, at + n)); }
}

/** Reads unsigned integers of any width from a bit offset. */
class Bits {
  private bit = 0;
  constructor(private readonly b: Uint8Array, byteOffset: number) { this.bit = byteOffset * 8; }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.bit >> 3];
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  /** Sign-magnitude, first bit the sign. */
  readSigned(n: number): number {
    const sign = this.read(1);
    const mag = this.read(n - 1);
    return sign ? -mag : mag;
  }
  get byteOffset() { return this.bit >> 3; }
}

interface Section { number: number; start: number; length: number }

function sections(r: Reader, messageStart: number, messageLength: number): Section[] {
  const out: Section[] = [];
  let p = messageStart + 16;
  const end = messageStart + messageLength - 4; // the "7777" trailer
  while (p < end) {
    const length = r.u32(p), number = r.u8(p + 4);
    if (length < 5) throw new Error(`GRIB2: bad section length ${length} at ${p}`);
    out.push({ number, start: p, length });
    p += length;
  }
  if (r.ascii(end, 4) !== '7777') throw new Error('GRIB2: message does not end in 7777');
  return out;
}

function readGrid(r: Reader, s: Section): Grib2Grid {
  const template = r.u16(s.start + 12);
  if (template !== 0) throw new Error(`GRIB2: grid template 3.${template} is not a latitude/longitude grid`);
  const ni = r.u32(s.start + 30), nj = r.u32(s.start + 34);
  const lat1 = r.i32(s.start + 46) / 1e6, lon1 = r.u32(s.start + 50) / 1e6;
  const dLon = r.u32(s.start + 63) / 1e6, dj = r.u32(s.start + 67) / 1e6;
  const scan = r.u8(s.start + 71);
  if (scan & 0x80) throw new Error('GRIB2: east-to-west scanning is not handled');
  if (scan & 0x20) throw new Error('GRIB2: column-major scanning is not handled');
  const dLat = scan & 0x40 ? dj : -dj; // bit 2 set: south to north
  return { ni, nj, lat1, lon1, dLon, dLat };
}

function readProduct(r: Reader, s: Section): { category: number; parameter: number; levelType: number; levelValue: number; forecastHours: number } {
  const template = r.u16(s.start + 7);
  if (template > 1 && template !== 8) throw new Error(`GRIB2: product template 4.${template} is not handled`);
  const unit = r.u8(s.start + 17);
  const raw = r.u32(s.start + 18);
  const hours = unit === 0 ? raw / 60 : unit === 1 ? raw : unit === 2 ? raw * 24 : unit === 10 ? raw * 3 : unit === 11 ? raw * 6 : unit === 12 ? raw * 12 : unit === 13 ? raw / 3600 : NaN;
  const scale = r.u8(s.start + 23), scaled = r.u32(s.start + 24);
  return { category: r.u8(s.start + 9), parameter: r.u8(s.start + 10), levelType: r.u8(s.start + 22), levelValue: scaled / 10 ** (scale === 255 ? 0 : scale), forecastHours: hours };
}

function unpackSimple(r: Reader, s5: Section, s7: Section, n: number): Float32Array {
  const R = r.f32(s5.start + 11), E = r.i16(s5.start + 15), D = r.i16(s5.start + 17), bits = r.u8(s5.start + 19);
  const out = new Float32Array(n);
  const scale = 2 ** E / 10 ** D, base = R / 10 ** D;
  if (bits === 0) { out.fill(base); return out; }
  const br = new Bits(r['b'], s7.start + 5);
  for (let i = 0; i < n; i++) out[i] = base + br.read(bits) * scale;
  return out;
}

/** Templates 5.2 and 5.3: values in groups, each with its own reference and width, optionally as differences. */
function unpackComplex(r: Reader, s5: Section, s7: Section, n: number, differenced: boolean): Float32Array {
  const R = r.f32(s5.start + 11), E = r.i16(s5.start + 15), D = r.i16(s5.start + 17), bits = r.u8(s5.start + 19);
  const missingMode = r.u8(s5.start + 22);
  if (missingMode > 1) throw new Error('GRIB2: secondary missing values are not handled');
  const ng = r.u32(s5.start + 31);
  const refWidth = r.u8(s5.start + 35), widthBits = r.u8(s5.start + 36);
  const refLength = r.u32(s5.start + 37), lengthInc = r.u8(s5.start + 41), lastLength = r.u32(s5.start + 42), lengthBits = r.u8(s5.start + 46);
  const order = differenced ? r.u8(s5.start + 47) : 0;
  const extraBytes = differenced ? r.u8(s5.start + 48) : 0;

  const br = new Bits(r['b'], s7.start + 5);
  const initial: number[] = [];
  let minsd = 0;
  if (order > 0) {
    for (let i = 0; i < order; i++) initial.push(br.readSigned(extraBytes * 8));
    minsd = br.readSigned(extraBytes * 8);
  }

  const refs = new Array<number>(ng), widths = new Array<number>(ng), lengths = new Array<number>(ng);
  for (let g = 0; g < ng; g++) refs[g] = br.read(bits);
  {
    // Each block of group descriptors starts on a byte boundary.
    const b2 = new Bits(r['b'], br.byteOffset + ((br['bit'] & 7) ? 1 : 0));
    for (let g = 0; g < ng; g++) widths[g] = refWidth + b2.read(widthBits);
    const b3 = new Bits(r['b'], b2.byteOffset + ((b2['bit'] & 7) ? 1 : 0));
    for (let g = 0; g < ng; g++) lengths[g] = refLength + lengthInc * b3.read(lengthBits);
    lengths[ng - 1] = lastLength;
    const b4 = new Bits(r['b'], b3.byteOffset + ((b3['bit'] & 7) ? 1 : 0));

    const raw = new Float64Array(n);
    const missing = new Uint8Array(n);
    let i = 0;
    for (let g = 0; g < ng && i < n; g++) {
      const w = widths[g], len = lengths[g], ref = refs[g];
      const allOnesRef = bits > 0 && ref === 2 ** bits - 1;
      const allOnes = w > 0 ? 2 ** w - 1 : -1;
      for (let k = 0; k < len && i < n; k++, i++) {
        const v = w > 0 ? b4.read(w) : 0;
        if (missingMode === 1 && ((w === 0 && allOnesRef) || (w > 0 && v === allOnes))) { missing[i] = 1; raw[i] = 0; continue; }
        raw[i] = ref + v;
      }
    }
    if (i !== n) throw new Error(`GRIB2: groups describe ${i} values, grid has ${n}`);

    if (order === 1) {
      let last = 0, seeded = false, j = 0;
      for (; j < n; j++) if (!missing[j]) { raw[j] = initial[0]; last = raw[j]; seeded = true; j++; break; }
      if (seeded) for (; j < n; j++) if (!missing[j]) { raw[j] = raw[j] + minsd + last; last = raw[j]; }
    } else if (order === 2) {
      let seeded = 0, prev1 = 0, prev2 = 0, j = 0;
      for (; j < n && seeded < 2; j++) if (!missing[j]) { raw[j] = initial[seeded]; prev2 = prev1; prev1 = raw[j]; seeded++; }
      if (seeded === 2) for (; j < n; j++) if (!missing[j]) { raw[j] = raw[j] + minsd + 2 * prev1 - prev2; prev2 = prev1; prev1 = raw[j]; }
    } else if (order > 2) {
      throw new Error(`GRIB2: spatial differencing of order ${order} is not handled`);
    }

    const out = new Float32Array(n);
    const scale = 2 ** E / 10 ** D, base = R / 10 ** D;
    for (let k = 0; k < n; k++) out[k] = missing[k] ? NaN : base + raw[k] * scale;
    return out;
  }
}

/** Every field in the file, in order. A NOMADS filter answer holds one. */
export function readGrib2(bytes: Uint8Array): Grib2Field[] {
  const r = new Reader(bytes);
  const fields: Grib2Field[] = [];
  let o = 0;
  while (o + 16 <= bytes.length) {
    if (r.ascii(o, 4) !== 'GRIB') throw new Error(`GRIB2: no GRIB marker at ${o}`);
    const edition = r.u8(o + 7);
    if (edition !== 2) throw new Error(`GRIB edition ${edition} is not handled`);
    const discipline = r.u8(o + 6);
    const length = r.u64(o + 8);
    const secs = sections(r, o, length);
    const s1 = secs.find(s => s.number === 1);
    if (!s1) throw new Error('GRIB2: no identification section');
    const referenceTime = `${String(r.u16(s1.start + 12)).padStart(4, '0')}-${String(r.u8(s1.start + 14)).padStart(2, '0')}-${String(r.u8(s1.start + 15)).padStart(2, '0')}T${String(r.u8(s1.start + 16)).padStart(2, '0')}:${String(r.u8(s1.start + 17)).padStart(2, '0')}:00Z`;

    // Sections 3–7 may repeat within a message; each 7 closes one field.
    let grid: Grib2Grid | null = null, product: ReturnType<typeof readProduct> | null = null, s5: Section | null = null, bitmap: Section | null = null;
    for (const s of secs) {
      if (s.number === 3) grid = readGrid(r, s);
      else if (s.number === 4) product = readProduct(r, s);
      else if (s.number === 5) s5 = s;
      else if (s.number === 6) bitmap = s;
      else if (s.number === 7) {
        if (!grid || !product || !s5) throw new Error('GRIB2: data section before its grid, product or representation');
        if (bitmap && r.u8(bitmap.start + 5) !== 255) throw new Error('GRIB2: bitmapped fields are not handled');
        const n = grid.ni * grid.nj;
        const template = r.u16(s5.start + 9);
        const values = template === 0 ? unpackSimple(r, s5, s, n)
          : template === 2 ? unpackComplex(r, s5, s, n, false)
          : template === 3 ? unpackComplex(r, s5, s, n, true)
          : (() => { throw new Error(`GRIB2: data template 5.${template} is not handled`); })();
        fields.push({ discipline, ...product, referenceTime, grid, values });
      }
    }
    o += length;
  }
  return fields;
}
