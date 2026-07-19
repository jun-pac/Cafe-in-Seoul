import { declutter, CARD_W, CARD_H } from './declutter.js';
import { esc, img } from './util.js';

// Minimal light OSM basemap: CARTO Positron (light_all) raster tiles — clean,
// airy grayscale. No API key required.
const STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
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
  let cardScale = Number(localStorage.getItem('cardScale')) || 1;
  const container = map.getContainer();
  container.style.setProperty('--card-scale', cardScale);
  let pickMode = false;
  let pickMarker = null;
  let onPick = null;

  function buildCard(item, kind) {
    const el = document.createElement('div');
    el.className = 'cafe-card' + (kind === 'view' ? ' cafe-card--view' : '');
    const scoreHtml = kind === 'view'
      ? '<span class="cafe-card__tag">VIEW</span>'
      : `<span class="cafe-card__score" title="카공 종합점수 (0–100): 다층·콘센트·면적·뷰·영업시간 + 집단지성 투표">${item.score}</span>`;
    el.innerHTML = `
      <div class="cafe-card__photo" style="background-image:url('${esc(img(item.photo_url))}')">
        ${scoreHtml}
        <span class="cafe-card__badge" hidden></span>
        <span class="cafe-card__pending">심사중</span>
      </div>
      <div class="cafe-card__name">${esc(item.name)}</div>
      <div class="cafe-card__tip"></div>`;
    if (kind === 'cafe') el.classList.toggle('is-pending', item.status === 'pending');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onCardClick?.(item, kind);
    });
    return el;
  }

  // upsert markers of a given kind; removes stale ones of the same kind only
  function setItems(items, kind) {
    const incoming = new Set(items.map((c) => c.id));
    for (const [id, ent] of entries) {
      if (ent.kind === kind && !incoming.has(id)) { ent.marker.remove(); entries.delete(id); }
    }
    for (const item of items) {
      const existing = entries.get(item.id);
      if (existing) {
        existing.item = item;
        const sc = existing.el.querySelector('.cafe-card__score');
        if (sc) sc.textContent = item.score;
        // reflect edits to the representative photo / name without a full reload
        existing.el.querySelector('.cafe-card__photo').style.backgroundImage = `url('${esc(img(item.photo_url))}')`;
        existing.el.querySelector('.cafe-card__name').textContent = item.name;
        if (kind === 'cafe') existing.el.classList.toggle('is-pending', item.status === 'pending');
        continue;
      }
      const el = buildCard(item, kind);
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([item.lng, item.lat]).addTo(map);
      entries.set(item.id, { item, kind, marker, el, badgeEl: el.querySelector('.cafe-card__badge') });
    }
    scheduleRefresh();
  }
  const setCafes = (cafes) => setItems(cafes, 'cafe');
  const setViewspots = (spots) => setItems(spots.map((s) => ({ ...s, score: s.score ?? 55 })), 'view');

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
      const p = map.project([ent.item.lng, ent.item.lat]);
      // cafes always outrank view-spots in overlaps (big offset), then by score
      items.push({ id, score: (ent.kind === 'cafe' ? 100000 : 0) + ent.item.score, x: p.x, y: p.y });
    }
    const decision = declutter(items, { width: size.width, height: size.height }, CARD_W * cardScale, CARD_H * cardScale);
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

  // scale the photo cards independently of map zoom (persisted)
  function setCardScale(delta) {
    cardScale = Math.min(1.8, Math.max(0.6, Math.round((cardScale + delta) * 10) / 10));
    container.style.setProperty('--card-scale', cardScale);
    localStorage.setItem('cardScale', String(cardScale));
    scheduleRefresh();
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

  return { map, setCafes, setViewspots, setFiltered, setSelected, refresh, flyTo, enablePick, disablePick, setCardScale };
}
