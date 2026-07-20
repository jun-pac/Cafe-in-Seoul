import { declutter, CARD_W, CARD_H } from './declutter.js';
import { esc, img, thumb } from './util.js';
import { icon } from './icons.js';

// Minimal light OSM basemap: CARTO Positron (light_all) raster tiles - clean,
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
    minZoom: 6.2,              // can't zoom out wider than ~the Korean peninsula
    maxBounds: [[124.0, 32.6], [132.6, 39.3]], // keep panning within South Korea (Jeju ↔ DMZ, west sea ↔ Ulleung/Dokdo)
    attributionControl: { compact: true },
    dragRotate: false,        // north is ALWAYS up
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate?.disableRotation?.(); // kill the two-finger twist on mobile (keep pinch-zoom)
  map.keyboard?.disableRotation?.();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  // "locate me" button (asks permission, centers on the user) — makes GPS actually useful
  if (maplibregl.GeolocateControl) {
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    }), 'bottom-right');
  }

  const entries = new Map(); // id -> { cafe, marker, el, imgEl, badgeEl }
  let visibleSet = null; // Set of ids passing filters (null = all)
  let selectedId = null;
  // default one tick smaller on mobile (narrower screens are cramped)
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 760;
  let cardScale = Number(localStorage.getItem('cardScale')) || (isMobile ? 0.85 : 1);
  const container = map.getContainer();
  container.style.setProperty('--card-scale', cardScale);
  let pickMode = false;
  let pickMarker = null;
  let onPick = null;

  function buildCard(item, kind) {
    const el = document.createElement('div');
    el.className = 'cafe-card' + (kind === 'view' ? ' cafe-card--view' : '');
    const scoreHtml = kind === 'view'
      ? `<span class="cafe-card__tag">VIEW</span><span class="cafe-card__likes" title="따봉">${icon('thumbsUp', 10)} <b>${item.likes || 0}</b></span>`
      : `<span class="cafe-card__score" title="카공 종합점수 (0-100): 다층·콘센트·면적·뷰·영업시간 + 집단지성 투표">${item.score}</span>`;
    el.innerHTML = `
      <div class="cafe-card__photo" style="background-image:url('${esc(img(thumb(item.photo_url)))}')">
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
    // "+N" badge → reveal the cards hidden underneath this survivor
    const badge = el.querySelector('.cafe-card__badge');
    badge.style.cursor = 'pointer';
    badge.title = '겹친 카페 보기';
    badge.addEventListener('click', (e) => { e.stopPropagation(); toggleCluster(item.id, el); });
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
        // move the marker if the location was edited (e.g. viewspot re-search)
        if (existing.item.lat !== item.lat || existing.item.lng !== item.lng) {
          existing.marker.setLngLat([item.lng, item.lat]);
        }
        existing.item = item;
        const sc = existing.el.querySelector('.cafe-card__score');
        if (sc) sc.textContent = item.score;
        const lk = existing.el.querySelector('.cafe-card__likes b');
        if (lk) lk.textContent = item.likes || 0;
        // reflect edits to the representative photo / name without a full reload
        existing.el.querySelector('.cafe-card__photo').style.backgroundImage = `url('${esc(img(thumb(item.photo_url)))}')`;
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
  // view-spots survive overlaps by 따봉(like) count (cafes still always outrank them)
  const setViewspots = (spots) => setItems(spots.map((s) => ({ ...s, score: s.likes ?? 0 })), 'view');

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
        if (clusterFor === id) closeCluster(); // survivor got absorbed → drop its popup
        ent.el.style.display = 'none';
        continue;
      }
      ent.el.style.display = '';
      if (d.absorbed > 0) {
        ent.badgeEl.hidden = false;
        ent.badgeEl.textContent = `+${d.absorbed}`;
        ent.absorbedIds = d.absorbedIds;
      } else {
        ent.badgeEl.hidden = true;
        ent.absorbedIds = null;
        if (clusterFor === id) closeCluster(); // its cluster dissolved (e.g. zoomed in)
      }
      ent.el.classList.toggle('is-selected', id === selectedId);
    }
  }

  // ---- "+N" cluster reveal: list the survivor + the cards it absorbed ----------
  let clusterPop = null;
  let clusterFor = null;
  function closeCluster() {
    if (clusterPop) { clusterPop.remove(); clusterPop = null; }
    clusterFor = null;
  }
  function toggleCluster(id, anchorEl) {
    if (clusterFor === id) { closeCluster(); return; }
    closeCluster();
    const ent = entries.get(id);
    if (!ent || !ent.absorbedIds || !ent.absorbedIds.length) return;
    const members = [ent, ...ent.absorbedIds.map((aid) => entries.get(aid)).filter(Boolean)];
    const pop = document.createElement('div');
    pop.className = 'cluster-pop';
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.innerHTML = `<div class="cluster-pop__head">이 위치에 ${members.length}곳</div>`
      + members.map((m) => `
        <button type="button" class="cluster-pop__row" data-id="${esc(m.item.id)}">
          <span class="cluster-pop__thumb" style="background-image:url('${esc(img(thumb(m.item.photo_url)))}')"></span>
          <span class="cluster-pop__name">${esc(m.item.name)}</span>
          ${m.kind === 'view' ? '<span class="cluster-pop__tag">VIEW</span>'
            : `<span class="cluster-pop__score">${m.item.score}</span>`}
        </button>`).join('');
    anchorEl.appendChild(pop);
    clusterPop = pop;
    clusterFor = id;
    pop.querySelectorAll('.cluster-pop__row').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = entries.get(b.dataset.id);
        closeCluster();
        if (m) onCardClick?.(m.item, m.kind);
      });
    });
  }

  let raf = 0;
  function scheduleRefresh() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      refresh();
    });
  }

  // Re-resolve overlaps while moving, but THROTTLED (~14fps) - markers follow the
  // map natively every frame; only their show/hide needs updating, and decluttering
  // 50+ cards every frame is what bogs down weaker phones. moveend does the final pass.
  let lastDeclutter = 0;
  const onMoveThrottled = () => {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (now - lastDeclutter >= 70) { lastDeclutter = now; scheduleRefresh(); }
  };
  map.on('move', onMoveThrottled);
  map.on('moveend', scheduleRefresh);
  map.on('zoomend', scheduleRefresh);
  map.on('resize', scheduleRefresh);
  map.on('load', scheduleRefresh);
  map.on('movestart', closeCluster); // don't leave a stale popup floating mid-pan

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
