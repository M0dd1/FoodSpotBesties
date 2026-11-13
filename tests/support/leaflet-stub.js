// Nur für lokale Testläufe ohne Internet: kleiner Ersatz für Leaflet 1.9 (nur was FoodiSpots benutzt).
// In GitHub Actions wird das echte Leaflet aus node_modules verwendet.
(() => {
  class Point {
    constructor(x, y) { this.x = x; this.y = y; }
    add(p) { return new Point(this.x + p.x, this.y + p.y); }
    distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y); }
  }
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  const ll = (a, b) => (a instanceof LatLng ? a : Array.isArray(a) ? new LatLng(a[0], a[1]) : typeof a === 'object' ? new LatLng(a.lat, a.lng) : new LatLng(a, b));
  class Bounds {
    constructor(pts) { this.s = Math.min(...pts.map((p) => p.lat)); this.n = Math.max(...pts.map((p) => p.lat)); this.w = Math.min(...pts.map((p) => p.lng)); this.e = Math.max(...pts.map((p) => p.lng)); }
    pad(r) { const dh = (this.n - this.s) * r, dw = (this.e - this.w) * r; const b = Object.create(Bounds.prototype); Object.assign(b, { s: this.s - dh, n: this.n + dh, w: this.w - dw, e: this.e + dw }); return b; }
    contains(p) { p = ll(p); return p.lat >= this.s && p.lat <= this.n && p.lng >= this.w && p.lng <= this.e; }
    center() { return new LatLng((this.s + this.n) / 2, (this.w + this.e) / 2); }
  }
  const evented = (o) => { o._h = {}; o.on = function (n, f) { n.split(' ').forEach((k) => (this._h[k] ||= []).push(f)); return this; }; o.off = function () { return this; }; o.fire = function (n, e = {}) { (this._h[n] || []).forEach((f) => f({ ...e, target: this })); return this; }; return o; };

  function proj(lat, lng, z) { const s = 256 * 2 ** z, x = (lng + 180) / 360 * s, sin = Math.sin(lat * Math.PI / 180); return new Point(x, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s); }
  function unproj(p, z) { const s = 256 * 2 ** z; const lng = p.x / s * 360 - 180; const n = Math.PI - 2 * Math.PI * p.y / s; return new LatLng(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng); }

  class Map {
    constructor(el) {
      evented(this); this._el = typeof el === 'string' ? document.getElementById(el) : el;
      this._el.classList.add('leaflet-container'); this._el.style.overflow = 'hidden';
      if (getComputedStyle(this._el).position === 'static') this._el.style.position = 'relative';
      this._pane = document.createElement('div'); this._pane.style.cssText = 'position:absolute;inset:0'; this._el.appendChild(this._pane);
      this._c = new LatLng(51, 10); this._z = 6; this._layers = new Set();
      this._el.addEventListener('click', (e) => { if (e.target.closest('.leaflet-marker-icon')) return; this.fire('click', { latlng: this._evLL(e) }); });
      this._el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.fire('contextmenu', { latlng: this._evLL(e) }); });
    }
    _evLL(e) { const r = this._el.getBoundingClientRect(); return this.containerPointToLatLng(new Point(e.clientX - r.left, e.clientY - r.top)); }
    _size() { return new Point(this._el.clientWidth || 390, this._el.clientHeight || 600); }
    containerPointToLatLng(p) { const c = proj(this._c.lat, this._c.lng, this._z), s = this._size(); return unproj(new Point(c.x + p.x - s.x / 2, c.y + p.y - s.y / 2), this._z); }
    latLngToLayerPoint(a) { a = ll(a); const p = proj(a.lat, a.lng, this._z), c = proj(this._c.lat, this._c.lng, this._z), s = this._size(); return new Point(p.x - c.x + s.x / 2, p.y - c.y + s.y / 2); }
    layerPointToLatLng(p) { return this.containerPointToLatLng(p); }
    setView(c, z) { this._c = ll(c); if (z != null) this._z = Math.round(z); this._redraw(); this.fire('zoomstart'); this.fire('moveend'); return this; }
    getCenter() { return this._c; } getZoom() { return this._z; }
    getBounds() { const s = this._size(); return new Bounds([this.containerPointToLatLng(new Point(0, 0)), this.containerPointToLatLng(s)]); }
    fitBounds(b, o = {}) { let z = o.maxZoom ?? 18; const c = b.center(); this._c = c; while (z > 1) { this._z = z; const tl = this.latLngToLayerPoint([b.n, b.w]), br = this.latLngToLayerPoint([b.s, b.e]); const s = this._size(); if (tl.x >= 0 && tl.y >= 0 && br.x <= s.x && br.y <= s.y) break; z--; } this._z = z; this._redraw(); this.fire('moveend'); return this; }
    invalidateSize() { this._redraw(); return this; }
    addLayer(l) { l.addTo(this); return this; } removeLayer(l) { l.remove(); return this; } hasLayer(l) { return this._layers.has(l); }
    getContainer() { return this._el; }
    remove() { this._el.innerHTML = ''; }
    _redraw() { for (const l of this._layers) l._draw?.(); }
  }
  class Layer { addTo(t) { this._map = t instanceof Map ? t : t._map; this._group = t instanceof Map ? null : t; (this._group?._items || this._map._layers).add(this); this._map._layers.add(this); this._draw(); return this; } remove() { this._el?.remove(); this._el = null; this._map?._layers.delete(this); this._group?._items.delete(this); this._map = null; return this; } _draw() {} }
  class TileLayer extends Layer {}
  class LayerGroup extends Layer {
    constructor() { super(); this._items = new Set(); }
    addTo(m) { this._map = m; m._layers.add(this); return this; }
    addLayer(l) { l.addTo(this); return this; } removeLayer(l) { l.remove(); return this; } hasLayer(l) { return this._items.has(l); }
    clearLayers() { [...this._items].forEach((l) => l.remove()); return this; }
  }
  class Marker extends Layer {
    constructor(latlng, o = {}) { super(); evented(this); this._ll = ll(latlng); this.options = o; }
    _draw() {
      if (!this._map) return;
      if (!this._el) {
        this._el = document.createElement('div'); this._el.className = 'leaflet-marker-icon';
        if (this.options.title) this._el.title = this.options.title;
        const ic = this.options.icon; this._el.innerHTML = ic?.options?.html ?? '<div class="leaflet-default-marker" style="width:20px;height:30px;background:#36c;border-radius:50%"></div>';
        this._el.style.cssText = 'position:absolute;cursor:pointer';
        this._el.addEventListener('click', (e) => { e.stopPropagation(); this.fire('click', { originalEvent: e }); });
        this._map._pane.appendChild(this._el);
        if (this.options.draggable) this.dragging = { enable() {}, disable() {} };
      }
      const p = this._map.latLngToLayerPoint(this._ll), a = this.options.icon?.options?.iconAnchor || [10, 30];
      this._el.style.left = (p.x - a[0]) + 'px'; this._el.style.top = (p.y - a[1]) + 'px'; this._el.style.zIndex = Math.round(p.y + (this.options.zIndexOffset || 0) / 100);
    }
    setLatLng(l) { this._ll = ll(l); this._draw(); return this; } getLatLng() { return this._ll; }
    setZIndexOffset(z) { this.options.zIndexOffset = z; this._draw(); return this; }
    getElement() { return this._el; } bindTooltip() { return this; }
  }
  class Path extends Layer { constructor() { super(); evented(this); } }
  window.L = {
    version: 'stub', Point, LatLng,
    map: (el, o) => new Map(el, o), tileLayer: () => new TileLayer(), layerGroup: () => new LayerGroup(),
    marker: (a, o) => new Marker(a, o), divIcon: (o) => ({ options: o }), circleMarker: () => new Path(), polyline: () => new Path(),
    latLng: (a, b) => ll(a, b), latLngBounds: (pts) => new Bounds(pts.map((p) => ll(p))), point: (x, y) => new Point(x, y),
    control: { zoom: () => ({ addTo() { return this; } }) },
    DomEvent: { stopPropagation(e) { e?.originalEvent?.stopPropagation?.(); } },
  };
})();
