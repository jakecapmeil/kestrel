// The watch's own splits (the laps Garmin and COROS show natively), read from
// the original FIT file intervals.icu keeps. Its /intervals endpoint holds
// intervals.icu's re-analysis of the run, not these laps.

const REST = new Set([1, 4]); // lap intensity: rest, recovery. Not running.

async function gunzipIfNeeded(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIZES = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };

// Lap messages (global 19) of a FIT file: [{ m, s, hr, intensity }] in order.
export function fitLaps(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(8, 12)) !== '.FIT') return [];
  const end = Math.min(bytes.length - 2, dv.getUint8(0) + dv.getUint32(4, true));
  const defs = {};
  const laps = [];
  let p = dv.getUint8(0);
  while (p < end) {
    const h = dv.getUint8(p++);
    if (h & 0x80) { // compressed-timestamp data record
      const d = defs[(h >> 5) & 3];
      if (!d) break;
      p += d.size;
      continue;
    }
    const local = h & 15;
    if (h & 0x40) { // definition
      const little = dv.getUint8(p + 1) === 0;
      const global = dv.getUint16(p + 2, little);
      const n = dv.getUint8(p + 4);
      p += 5;
      const fields = [];
      let size = 0;
      for (let i = 0; i < n; i++, p += 3) {
        const f = { num: dv.getUint8(p), len: dv.getUint8(p + 1), type: dv.getUint8(p + 2) & 0x1f, at: size };
        fields.push(f);
        size += f.len;
      }
      if (h & 0x20) { const dn = dv.getUint8(p++); for (let i = 0; i < dn; i++, p += 3) size += dv.getUint8(p + 1); }
      defs[local] = { global, little, fields, size };
      continue;
    }
    const d = defs[local];
    if (!d) break;
    if (d.global === 19) {
      const lap = {};
      for (const f of d.fields) {
        if (f.len !== (SIZES[f.type] || f.len) && f.len > 4) continue;
        const o = p + f.at;
        let v = null;
        if (f.len === 1) v = dv.getUint8(o);
        else if (f.len === 2) v = dv.getUint16(o, d.little);
        else if (f.len === 4) v = dv.getUint32(o, d.little);
        if (f.num === 8) lap.s = v; // total_timer_time, ms
        else if (f.num === 9) lap.m = v; // total_distance, cm
        else if (f.num === 15) lap.hr = v;
        else if (f.num === 23) lap.intensity = v;
      }
      if (lap.s != null && lap.s !== 0xffffffff && lap.m != null && lap.m !== 0xffffffff) {
        laps.push({ m: lap.m / 100, s: lap.s / 1000, hr: lap.hr && lap.hr !== 255 ? lap.hr : null, intensity: lap.intensity });
      }
    }
    p += d.size;
  }
  return laps;
}

// Splits worth showing: the laps where the athlete was running.
export function runningSplits(rawLaps) {
  // Not running: button-press slivers, and standing around (slower than 14:00/mi).
  const real = rawLaps.filter((l) => l.m >= 50 && l.s > 0 && l.s / (l.m / 1609.344) <= 840);
  const running = real.filter((l) => !REST.has(l.intensity));
  const use = running.length >= 2 ? running : real;
  return use.slice(0, 40).map((l) => ({ m: Math.round(l.m), s: Math.round(l.s * 10) / 10, hr: l.hr, f: 1 }));
}

// TCX keeps laps as <Lap> blocks; some sources store that instead of a FIT.
export function tcxLaps(text) {
  const num = (block, tag) => { const m = block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`)); return m ? Number(m[1]) : null; };
  return [...text.matchAll(/<Lap\b[\s\S]*?<\/Lap>/g)].map(([b]) => {
    const hr = b.match(/<AverageHeartRateBpm[^>]*>\s*<Value>(\d+)</);
    return { m: num(b, 'DistanceMeters') || 0, s: num(b, 'TotalTimeSeconds') || 0, hr: hr ? Number(hr[1]) : null, intensity: /<Intensity>Resting/.test(b) ? 1 : 0 };
  });
}

// Splits from a downloaded activity file response; [] when it has none.
export async function splitsFromFile(res) {
  if (!res.ok) { console.warn('intervals file', res.status); return []; }
  const bytes = await gunzipIfNeeded(await res.arrayBuffer());
  let laps = fitLaps(bytes);
  if (!laps.length) laps = tcxLaps(new TextDecoder().decode(bytes));
  if (!laps.length) console.warn('intervals file: no laps found', bytes.length);
  return runningSplits(laps);
}
