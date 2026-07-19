import { api } from './api.js';
import { initMap } from './map.js';
import { renderAuth, renderDetail, openAddCafeModal, openEditCafeModal, renderPendingQueue, initChat,
  renderViewDetail, openViewModal } from './ui.js';
import { passesFilters } from './util.js';
import { icon } from './icons.js';
import { t, getLang, setLang, onLangChange, applyStaticI18n } from './i18n.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  me: { user: null, googleClientId: null },
  capabilities: { kakao: false, ai: false },
  cafes: [],
  viewspots: [],
  openCafeId: null,
  openViewId: null,
};

const detailEl = $('#detail');
const map = initMap('map', {
  onCardClick: (item, kind) => (kind === 'view' ? openViewDetail(item.id) : openDetail(item.id)),
});

// ---------- filters ----------
function readFilters() {
  const sizes = new Set(
    ['small', 'medium', 'large'].filter((s) => $(`#f-size-${s}`).checked)
  );
  return {
    multiFloor: $('#f-multifloor').checked,
    hasView: $('#f-view').checked,
    openNow: $('#f-opennow').checked,
    openLate: $('#f-openlate').checked,
    sizes,
    minOutlet: $('#f-outlet').value || null,
    maxPrice: Number($('#f-price').value),
    minQuiet: Number($('#f-quiet').value),
    minCoffee: Number($('#f-coffee').value),
    minRestroom: Number($('#f-restroom').value),
  };
}

const FILTER_IDS = ['show-cafes', 'show-views', 'f-multifloor', 'f-view', 'f-opennow', 'f-openlate',
  'f-size-small', 'f-size-medium', 'f-size-large', 'f-outlet',
  'f-price', 'f-quiet', 'f-coffee', 'f-restroom'];

function saveFilters() {
  const s = {};
  for (const id of FILTER_IDS) { const el = $(`#${id}`); s[id] = el.type === 'checkbox' ? el.checked : el.value; }
  try { localStorage.setItem('filters', JSON.stringify(s)); } catch { /* ignore */ }
}
function loadFilters() {
  let s; try { s = JSON.parse(localStorage.getItem('filters') || 'null'); } catch { return; }
  if (!s) return;
  for (const id of FILTER_IDS) {
    const el = $(`#${id}`); if (!el || !(id in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[id]; else el.value = s[id];
  }
  ['f-price', 'f-quiet', 'f-coffee', 'f-restroom'].forEach((id) => $(`#${id}`).dispatchEvent(new Event('input')));
}

function applyFilters() {
  const f = readFilters();
  const showCafes = $('#show-cafes').checked;
  const showViews = $('#show-views').checked;
  const ids = new Set();
  let cafeCount = 0;
  if (showCafes) for (const c of state.cafes) if (passesFilters(c, f)) { ids.add(c.id); cafeCount++; }
  if (showViews) for (const v of state.viewspots) ids.add(v.id);
  map.setFiltered(ids);
  $('#result-count').textContent = `${t('show.cafes')} ${cafeCount} · ${t('show.views')} ${showViews ? state.viewspots.length : 0}`;
  saveFilters();
}

function wireFilters() {
  const ids = ['show-cafes', 'show-views', 'f-multifloor', 'f-view', 'f-opennow', 'f-openlate',
    'f-size-small', 'f-size-medium', 'f-size-large', 'f-outlet'];
  ids.forEach((id) => $(`#${id}`).addEventListener('change', applyFilters));

  const bindRange = (id, out, fmt) => {
    const el = $(`#${id}`);
    const label = $(`#${out}`);
    const update = () => { label.textContent = fmt(el.value); applyFilters(); };
    el.addEventListener('input', update);
    label.textContent = fmt(el.value);
  };
  const priceFmt = (v) => (getLang() === 'ko' ? `${Number(v).toLocaleString('ko-KR')}원 이하` : `≤ ₩${Number(v).toLocaleString('en-US')}`);
  const ratingFmt = (v) => (+v ? (getLang() === 'ko' ? `${v}점 이상` : `${v}+`) : t('f.outlet.all'));
  bindRange('f-price', 'f-price-val', priceFmt);
  bindRange('f-quiet', 'f-quiet-val', ratingFmt);
  bindRange('f-coffee', 'f-coffee-val', ratingFmt);
  bindRange('f-restroom', 'f-restroom-val', ratingFmt);

  $('#f-reset').addEventListener('click', () => {
    ['f-multifloor', 'f-view', 'f-opennow', 'f-openlate',
     'f-size-small', 'f-size-medium', 'f-size-large'].forEach((id) => ($(`#${id}`).checked = false));
    $('#f-outlet').value = '';
    $('#f-price').value = 8000; $('#f-price').dispatchEvent(new Event('input'));
    ['f-quiet', 'f-coffee', 'f-restroom'].forEach((id) => {
      $(`#${id}`).value = 0; $(`#${id}`).dispatchEvent(new Event('input'));
    });
    applyFilters();
  });
}

// ---------- data ----------
async function loadCafes() {
  const [cafes, views] = await Promise.all([api.listCafes(), api.listViewspots()]);
  state.cafes = cafes;
  state.viewspots = views;
  map.setCafes(cafes);
  map.setViewspots(views);
  applyFilters();
  await refreshPendingQueue();
}

async function refreshPendingQueue() {
  const el = document.getElementById('pendingQueue');
  if (!state.me.user?.isAdmin) { el.hidden = true; el.innerHTML = ''; return; }
  try {
    const pending = await api.adminPending();
    renderPendingQueue(el, pending, {
      onOpen: (id) => openDetail(id),
      onApprove: async (id) => { await api.adminApprove(id); await loadCafes(); },
      onReject: async (id) => { await api.adminReject(id); await loadCafes(); if (state.openCafeId === id) closeDetail(); },
    });
  } catch { el.hidden = true; }
}

// ---------- detail ----------
async function openDetail(id) {
  const cafe = await api.getCafe(id);
  state.openCafeId = id;
  renderDetail(detailEl, cafe, {
    user: state.me.user,
    onVote: (category, score) => handleVote(id, category, score),
    onAddReview: (fd) => handleAddReview(id, fd),
    onClose: closeDetail,
    onEdit: (action) => handleAdminEdit(id, cafe, action),
  });
  // (re)mount the GPS-gated chat for this cafe
  state.chatCleanup?.();
  state.chatCleanup = initChat(document.getElementById('chatBox'), cafe, { user: state.me.user, api });
  document.body.classList.add('detail-open');
  map.setSelected(id);
  map.flyTo(cafe);
}

function closeDetail() {
  state.openCafeId = null;
  state.openViewId = null;
  state.chatCleanup?.();
  state.chatCleanup = null;
  document.body.classList.remove('detail-open');
  map.setSelected(null);
}

// ---- view-spots ----
async function openViewDetail(id) {
  const spot = await api.getViewspot(id);
  state.openViewId = id;
  state.openCafeId = null;
  state.chatCleanup?.();
  state.chatCleanup = null;
  renderViewDetail(detailEl, spot, {
    user: state.me.user,
    onAddComment: (body) => handleViewComment(id, body),
    onEdit: () => handleViewEdit(id, spot),
    onDelete: () => handleViewDelete(id),
    onClose: closeDetail,
  });
  document.body.classList.add('detail-open');
  map.setSelected(id);
  map.flyTo(spot);
}
async function handleViewComment(id, body) {
  await api.addViewComment(id, body);
  await openViewDetail(id);
}
function handleViewEdit(id, spot) {
  openViewModal({
    mode: 'edit', spot,
    onSearch: (q) => api.viewSearch(q),
    onPickLocation: (cb) => map.enablePick(({ lng, lat }) => cb(lng, lat)),
    onCancelPick: () => map.disablePick(),
    onSubmit: async (fd) => { await api.updateViewspot(id, fd); map.disablePick(); await loadCafes(); await openViewDetail(id); },
  });
}
async function handleViewDelete(id) {
  if (!confirm('이 뷰 맛집을 삭제할까요?')) return;
  try { await api.deleteViewspot(id); closeDetail(); await loadCafes(); }
  catch (e) { alert(e.message); }
}
function wireAddView() {
  $('#addViewBtn').innerHTML = `${icon('view', 15)} ${t('nav.addView')}`;
  $('#addViewBtn').addEventListener('click', () => {
    if (!state.me.user) { alert('뷰 맛집을 등록하려면 로그인이 필요합니다.'); return; }
    openViewModal({
      mode: 'create',
      onSearch: (q) => api.viewSearch(q),
      onPickLocation: (cb) => map.enablePick(({ lng, lat }) => cb(lng, lat)),
      onCancelPick: () => map.disablePick(),
      onSubmit: async (fd) => { const created = await api.createViewspot(fd); map.disablePick(); await loadCafes(); openViewDetail(created.id); },
    });
  });
}

// returns the new aggregate so the vote row updates IN PLACE (no panel reload).
// markers refresh silently in the background.
async function handleVote(id, category, score) {
  const agg = await api.vote(id, category, score);
  loadCafes(); // fire-and-forget: updates card scores without touching the open panel
  return agg;
}

async function handleAdminEdit(id, cafe, action) {
  if (action === 'approve') {
    try { await api.adminApprove(id); await loadCafes(); await openDetail(id); }
    catch (e) { alert(e.message); }
    return;
  }
  openEditCafeModal(cafe, {
    onSave: async (patch) => {
      await api.updateCafe(id, patch);
      await loadCafes();
      await openDetail(id);
    },
  });
}

async function handleAddReview(id, fd) {
  try {
    await api.addReview(id, fd);
    await openDetail(id);
  } catch (e) {
    alert(e.message);
  }
}

// ---------- auth ----------
async function refreshMe() {
  state.me = await api.me();
  state.capabilities = { kakao: false, ai: false };
  if (state.me.user?.isAdmin) {
    state.capabilities = await api.adminCapabilities().catch(() => state.capabilities);
  }
  const afterAuthChange = async () => {
    await refreshMe();
    if (state.openCafeId) await openDetail(state.openCafeId);
  };
  renderAuth($('#auth'), state.me, {
    onGoogleCredential: async (credential) => {
      try { await api.googleVerify(credential); await afterAuthChange(); }
      catch (e) { alert('Google 로그인 실패: ' + e.message); }
    },
    onLocalLogin: async (u, p) => { await api.login(u, p); await afterAuthChange(); },
    onRegister: async (u, p) => { await api.register(u, p); await afterAuthChange(); },
    onLogout: async () => { await api.logout(); await afterAuthChange(); },
    onEditName: async () => {
      const name = prompt('표시할 닉네임을 입력하세요', state.me.user?.name || '');
      if (name == null || !name.trim()) return;
      try { await api.updateName(name.trim()); await afterAuthChange(); }
      catch (e) { alert(e.message); }
    },
  });
}

// ---------- add cafe ----------
function wireAddCafe() {
  $('#addCafeBtn').addEventListener('click', () => {
    if (!state.me.user) {
      alert('카페를 등록하려면 로그인이 필요합니다.');
      return;
    }
    openAddCafeModal({
      user: state.me.user,
      capabilities: state.capabilities,
      onSearch: (q) => api.adminSearch(q),
      onEnrich: (payload) => api.adminEnrich(payload),
      onPickLocation: (cb) => map.enablePick(({ lng, lat }) => cb(lng, lat)),
      onCancelPick: () => map.disablePick(),
      onSubmit: async (fd) => {
        const created = await api.createCafe(fd);
        map.disablePick();
        await loadCafes();
        if (created.status === 'pending') {
          alert(`AI 심사 결과: 관리자 승인 대기\n\n사유: ${created.moderation?.reason || '특별함 확인 필요'}\n\n승인 전까지는 나에게만 보여요.`);
        }
        openDetail(created.id);
      },
    });
  });
}

// ---------- boot ----------
function wireCardZoom() {
  $('#cardBigger').innerHTML = icon('plus', 16);
  $('#cardSmaller').innerHTML = icon('minus', 16);
  $('#cardBigger').onclick = () => map.setCardScale(+0.15);
  $('#cardSmaller').onclick = () => map.setCardScale(-0.15);
}

async function rerenderI18n() {
  applyStaticI18n();
  $('#langToggle').textContent = getLang() === 'ko' ? 'EN' : 'KO';
  $('#addCafeBtn').innerHTML = `${icon('plus', 15)} ${t('nav.addCafe')}`;
  $('#addViewBtn').innerHTML = `${icon('view', 15)} ${t('nav.addView')}`;
  ['f-price', 'f-quiet', 'f-coffee', 'f-restroom'].forEach((id) => $(`#${id}`).dispatchEvent(new Event('input')));
  await refreshMe();               // re-render auth bar in the new language
  applyFilters();                  // result text
  await refreshPendingQueue();
  if (state.openCafeId) await openDetail(state.openCafeId);
  else if (state.openViewId) await openViewDetail(state.openViewId);
}

async function boot() {
  applyStaticI18n();
  $('#langToggle').textContent = getLang() === 'ko' ? 'EN' : 'KO';
  $('#langToggle').onclick = () => setLang(getLang() === 'ko' ? 'en' : 'ko');
  onLangChange(() => rerenderI18n());
  $('#addCafeBtn').innerHTML = `${icon('plus', 15)} ${t('nav.addCafe')}`;
  wireFilters();
  loadFilters();     // restore saved filter toggles before first apply
  wireCardZoom();
  wireAddCafe();
  wireAddView();
  await refreshMe();
  await loadCafes();
}

boot().catch((e) => {
  console.error(e);
  alert('초기화 실패: ' + e.message);
});
