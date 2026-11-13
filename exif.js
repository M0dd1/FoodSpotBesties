/* Minimaler EXIF-Leser für JPEG-Fotos: Aufnahmeort (GPS) und Aufnahmedatum.
 * Liest nur den Dateianfang, keine externe Bibliothek nötig.
 * Ergebnis: { lat, lng, date: 'YYYY-MM-DD', time: 'HH:MM' } – fehlende Werte sind null.
 */
(() => {
'use strict';

async function read(file) {
  const empty = { lat: null, lng: null, date: null, time: null };
  try {
    if (!file || !/jpe?g/i.test(file.type || file.name || '')) return { ...empty, ...fromFileDate(file) };
    const buf = await file.slice(0, 512 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return { ...empty, ...fromFileDate(file) };
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
        const res = parseTiff(v, off + 10);
        return { ...empty, ...res };
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break; // Bilddaten erreicht
      off += 2 + size;
    }
  } catch (e) { /* defekte oder ungewöhnliche Datei: einfach nichts übernehmen */ }
  return empty;
}

// Fallback ohne EXIF: kein Datum raten (lastModified ist oft das Kopierdatum)
function fromFileDate() { return {}; }

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  if (u16(2) !== 42) return {};

  const readIfd = (ifdOff) => {
    const out = {};
    if (!ifdOff || start + ifdOff + 2 > v.byteLength) return out;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (start + e + 12 > v.byteLength) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const bytes = (sizes[type] || 1) * count;
      const valOff = bytes <= 4 ? e + 8 : u32(e + 8);
      out[tag] = { type, count, valOff };
    }
    return out;
  };
  const ascii = (ent) => {
    let s = '';
    for (let i = 0; i < ent.count - 1; i++) {
      const p = start + ent.valOff + i;
      if (p >= v.byteLength) break;
      s += String.fromCharCode(v.getUint8(p));
    }
    return s;
  };
  const rationals = (ent) => {
    const r = [];
    for (let i = 0; i < ent.count; i++) {
      const o = ent.valOff + i * 8;
      const den = u32(o + 4);
      r.push(den ? u32(o) / den : 0);
    }
    return r;
  };
  const dms = (a) => a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600;

  const res = {};
  const ifd0 = readIfd(u32(4));

  // Aufnahmedatum: DateTimeOriginal (Exif-IFD), sonst DateTime (IFD0)
  let dt = null;
  if (ifd0[0x8769]) {
    const exifIfd = readIfd(u32(ifd0[0x8769].valOff));
    if (exifIfd[0x9003]) dt = ascii(exifIfd[0x9003]);
    else if (exifIfd[0x9004]) dt = ascii(exifIfd[0x9004]);
  }
  if (!dt && ifd0[0x0132]) dt = ascii(ifd0[0x0132]);
  const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (m && m[1] !== '0000') { res.date = `${m[1]}-${m[2]}-${m[3]}`; res.time = `${m[4]}:${m[5]}`; }

  // GPS
  if (ifd0[0x8825]) {
    const g = readIfd(u32(ifd0[0x8825].valOff));
    if (g[2] && g[4]) {
      let lat = dms(rationals(g[2])), lng = dms(rationals(g[4]));
      const latRef = g[1] ? String.fromCharCode(v.getUint8(start + g[1].valOff)) : 'N';
      const lngRef = g[3] ? String.fromCharCode(v.getUint8(start + g[3].valOff)) : 'E';
      if (latRef === 'S') lat = -lat;
      if (lngRef === 'W') lng = -lng;
      if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
        res.lat = lat; res.lng = lng;
      }
    }
  }
  return res;
}

window.FOODI_EXIF = { read };
})();
