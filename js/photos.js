// FoodiSpots – Fotos der Gerichte: verkleinern, offline zwischenspeichern, anzeigen
import { $, $$, BUCKET, idb, sb, state } from './core.js';
import { queuePhoto } from './sync.js';

// Fotos werden als WebP gespeichert (etwa 30–40 % kleiner als JPEG bei gleicher Qualität).
// Kann der Browser kein WebP erzeugen (manche ältere iPhones), wird es JPEG.
// Beim Neuzeichnen gehen alle Metadaten verloren – auch der Aufnahmeort.
export async function resizeImage(file, max = 1600, quality = 0.8) {
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  const encode = (type, q) => new Promise((res) => canvas.toBlob((b) => res(b), type, q));
  const webp = await encode('image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg', quality);
  if (!jpeg) throw new Error('Bild konnte nicht verarbeitet werden');
  return jpeg;
}

// Foto für ein Gericht vorbereiten: Aufnahmedatum aus dem Original lesen, dann verkleinern + Vorschaubild (~400 px)
export async function prepareDishPhoto(file) {
  const meta = window.FOODI_EXIF ? await FOODI_EXIF.read(file) : { date: null };
  const full = await resizeImage(file);
  const thumb = await resizeImage(full, 400, 0.72).catch(() => null);
  return { full, thumb, url: URL.createObjectURL(thumb || full), meta };
}

// Speichern: Dateien in IndexedDB (Schlüssel = Speicherpfad), Hochladen über die Warteschlange
export async function storeDishPhoto(dish, prepared, spotId) {
  const ext = prepared.full.type === 'image/webp' ? 'webp' : 'jpg';
  const base = `${state.groupId}/${spotId}/${dish.id}-${Date.now().toString(36)}`;
  const photo_path = `${base}.${ext}`;
  const thumb_path = prepared.thumb ? `${base}-klein.${prepared.thumb.type === 'image/webp' ? 'webp' : 'jpg'}` : null;
  await idb.put('blobs', prepared.full, photo_path);
  if (thumb_path) await idb.put('blobs', prepared.thumb, thumb_path);
  await queuePhoto(dish.id, photo_path, thumb_path, dishPaths([dish]));
}

export const dishPaths = (list) => (list || []).flatMap((d) => [d.photo_path, d.thumb_path]).filter(Boolean);

// ------------------------------------------------------------------
// Anzeigen (erst aus dem Gerätespeicher, sonst vom Server und dann merken)
// ------------------------------------------------------------------
const urlCache = new Map();
export async function photoUrl(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  let blob = await idb.get('blobs', path).catch(() => null);
  if (!blob && navigator.onLine) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (!error && data) { blob = data; idb.put('blobs', blob, path).catch(() => {}); }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  return url;
}
// <img data-path="…"> bzw. <div data-bg="…"> befüllen
export function hydratePhotos(root) {
  $$('img[data-path]', root).forEach(async (img) => {
    const url = await photoUrl(img.dataset.path);
    if (url) img.src = url; else img.alt = 'offline';
  });
  $$('[data-bg]', root).forEach(async (el) => {
    const url = await photoUrl(el.dataset.bg);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-img'); }
  });
}
// Großansicht: sofort das Vorschaubild zeigen, dann das große Foto nachladen
export async function openPhoto(dish, captionHtml = '') {
  const small = await photoUrl(dish.thumb_path);
  if (small) openLightbox(small, captionHtml);
  const full = await photoUrl(dish.photo_path);
  if (full && (!small || !$('#lightbox').classList.contains('hidden'))) openLightbox(full, captionHtml);
  else if (!small && !full) openLightbox('', captionHtml);
}
$('#lightbox-close').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); });
export function openLightbox(src, captionHtml = '') {
  const img = $('#lightbox-img');
  img.classList.toggle('hidden', !src); if (src) img.src = src;
  $('#lightbox-caption').innerHTML = captionHtml;
  $('#lightbox').classList.remove('hidden');
}
