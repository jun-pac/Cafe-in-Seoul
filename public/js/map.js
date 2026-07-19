import { declutter } from './declutter.js';
import { esc } from './util.js';

// Minimal dark OSM basemap: CARTO dark_matter raster tiles — pure-black
// aesthetic to match the design system. No API key required.
const STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

export function initMap(containerId, { onCardClick }) {
  const map = new maplibregl.Map({
    container: containerId,
    style: STYLE,
    center: [126.986, 37.556], // Seoul
    zoom: 12,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  const entries = new Map(); // id -> { cafe, marker, el, imgEl, badgeEl }
  let visibleSet = null; // Set of ids passing filters (null = all)
  let selectedId = null;
  let pickMode = false;
  let pickMarker = null;
  let onPick = null;

  function buildCard(cafe) {
    const el = document.createElement('div');
    el.className = 'cafe-card';
    el.innerHTML = `
      <div class="cafe-card__photo" style="background-image:url('${esc(cafe.photo_url)}')">
        <span class="cafe-card__score">${cafe.score}</span>
        <span class="cafe-card__badge" hidden></span>
        <span class="cafe-card__pending">심사중</span>
      </div>
      <div class="cafe-card__name">${esc(cafe.name)}</div>
      <div class="cafe-card__tip"></div>`;
    el.classList.toggle('is-pending', cafe.status === 'pending');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onCardClick?.(cafe);
    });
    return el;
  }

  function setCafes(cafes) {
    // remove markers no longer present
    const incoming = new Set(cafes.map((c) => c.id));
    for (const [id, ent] of entries) {
      if (!incoming.has(id)) {
        ent.marker.remove();
        entries.delete(id);
      }
    }
    for (const cafe of cafes) {
      const existing = entries.get(cafe.id);
      if (existing) {
        existing.cafe = cafe;
        existing.el.querySelector('.cafe-card__score').textContent = cafe.score;
        existing.el.classList.toggle('is-pending', cafe.status === 'pending');
        continue;
      }
      const el = buildCard(cafe);
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([cafe.lng, cafe.lat])
        .addTo(map);
      entries.set(cafe.id, {
        cafe,
        marker,
        el,
        badgeEl: el.querySelector('.cafe-card__badge'),
      });
    }
    scheduleRefresh();
  }

  function setFiltered(ids) {
    visibleSet = ids; // Set or null
    scheduleRefresh();
  }

  function setSelected(id) {
    selectedId = id;
    for (const [eid, ent] of entries) ent.el.classList.toggle('is-selected', eid === id);
  }

  function refresh() {
    const size = map.getContainer().getBoundingClientRect();
    const items = [];
    for (const [id, ent] of entries) {
      const inFilter = !visibleSet || visibleSet.has(id);
      if (!inFilter) {
        ent.el.style.display = 'none';
        continue;
      }
      const p = map.project([ent.cafe.lng, ent.cafe.lat]);
      items.push({ id, score: ent.cafe.score, x: p.x, y: p.y });
    }
    const decision = declutter(items, { width: size.width, height: size.height });
    for (const [id, ent] of entries) {
      const d = decision.get(id);
      if (!d || !d.visible) {
        if (visibleSet && !visibleSet.has(id)) continue; // already hidden above
        ent.el.style.display = 'none';
        continue;
      }
      ent.el.style.display = '';
      if (d.absorbed > 0) {
        ent.badgeEl.hidden = false;
        ent.badgeEl.textContent = `+${d.absorbed}`;
      } else {
        ent.badgeEl.hidden = true;
      }
      ent.el.classList.toggle('is-selected', id === selectedId);
    }
  }

  let raf = 0;
  function scheduleRefresh() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      refresh();
    });
  }

  // Declutter only when movement settles (not every frame). During a drag the
  // markers still follow the map via MapLibre's own transform; we just re-resolve
  // overlaps on release, which keeps panning smooth.
  map.on('moveend', scheduleRefresh);
  map.on('zoomend', scheduleRefresh);
  map.on('resize', scheduleRefresh);
  map.on('load', scheduleRefresh);

  function flyTo(cafe) {
    map.flyTo({ center: [cafe.lng, cafe.lat], zoom: Math.max(map.getZoom(), 15), speed: 0.8 });
  }

  // --- location pick mode (for the "add cafe" form) ---
  function enablePick(cb) {
    pickMode = true;
    onPick = cb;
    map.getCanvas().style.cursor = 'crosshair';
  }
  function disablePick() {
    pickMode = false;
    onPick = null;
    map.getCanvas().style.cursor = '';
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  }
  map.on('click', (e) => {
    if (!pickMode) return;
    const { lng, lat } = e.lngLat;
    if (!pickMarker) {
      const el = document.createElement('div');
      el.className = 'pick-pin';
      pickMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' });
    }
    pickMarker.setLngLat([lng, lat]).addTo(map);
    onPick?.({ lng, lat });
  });

  return { map, setCafes, setFiltered, setSelected, refresh, flyTo, enablePick, disablePick };
}
