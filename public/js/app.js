import { api } from './api.js';
import { initMap } from './map.js';
import { renderAuth, renderDetail, openAddCafeModal, openEditCafeModal, renderPendingQueue, initChat,
  renderViewDetail, openViewModal } from './ui.js';
import { passesFilters, esc } from './util.js';
import { icon } from './icons.js';
import { t, getLang, setLang, onLangChange, applyStaticI18n } from './i18n.js';

const $ = (sel) => document.querySelector(sel);

// PWA: register the service worker so the app is installable ("add to home screen")
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA is optional */ });
}

const state = {
  me: { user: null, googleClientId: null },
  capabilities: { kakao: false, ai: false },
  cafes: [],
  viewspots: [],
  openCafeId: null,
  openViewId: null,
};

const detailEl = $('#detail');
let map;
try {
  if (typeof maplibregl === 'undefined') throw new Error('maplibre-gl not loaded');
  map = initMap('map', {
    onCardClick: (item, kind) => (kind === 'view' ? openViewDetail(item.id) : openDetail(item.id)),
  });
} catch (e) {
  // Fail loud, not blank: if the map library can't load, say so instead of a white screen.
  const m = document.getElementById('map');
  if (m) m.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#555;font:14px/1.7 system-ui,sans-serif">'
    + '지도를 불러오지 못했습니다.<br>네트워크를 확인하고 페이지를 새로고침 해주세요.<br>'
    + '<span style="color:#999;font-size:12px">(map library failed to load)</span></div>';
  throw e;
}

// ---------- filters ----------
function readFilters() {
  return {
    multiFloor: $('#f-multifloor').checked,
    hasView: $('#f-view').checked,
    rainOk: $('#f-rainok').checked,
    openNow: $('#f-opennow').checked,
    openLate: $('#f-openlate').checked,
    liked: $('#f-liked').checked,
    minSize: $('#f-size').value || null,
    minOutlet: $('#f-outlet').value || null,
    maxPrice: Number($('#f-price').value),
    minQuiet: Number($('#f-quiet').value),
    minCoffee: Number($('#f-coffee').value),
    minRestroom: Number($('#f-restroom').value),
  };
}

const FILTER_IDS = ['show-cafes', 'show-views', 'f-multifloor', 'f-view', 'f-rainok', 'f-opennow', 'f-openlate',
  'f-size', 'f-outlet',
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
  let cafeCount = 0, viewCount = 0;
  if (showCafes) for (const c of state.cafes) if (passesFilters(c, f)) { ids.add(c.id); cafeCount++; }
  if (showViews) for (const v of state.viewspots) if (!f.liked || v.liked) { ids.add(v.id); viewCount++; }
  map.setFiltered(ids);
  $('#result-count').textContent = `${t('show.cafes.short')} ${cafeCount} · ${t('show.views.short')} ${viewCount}`;
  saveFilters();
}

function wireFilters() {
  const ids = ['show-cafes', 'show-views', 'f-multifloor', 'f-view', 'f-rainok', 'f-opennow', 'f-openlate', 'f-liked',
    'f-size', 'f-outlet'];
  ids.forEach((id) => $(`#${id}`).addEventListener('change', (e) => {
    if (id === 'f-liked' && e.target.checked && !state.me.user) { // login-gated feature
      e.target.checked = false;
      alert(t('f.liked.loginNeeded'));
      openAuthModal();
      return;
    }
    applyFilters();
    api.track('filter', id, e.target.type === 'checkbox' ? (e.target.checked ? 'on' : 'off') : e.target.value);
  }));

  const bindRange = (id, out, fmt) => {
    const el = $(`#${id}`);
    const label = $(`#${out}`);
    const update = () => { label.textContent = fmt(el.value); applyFilters(); };
    el.addEventListener('input', update);
    label.textContent = fmt(el.value);
  };
  const priceFmt = (v) => (getLang() === 'ko' ? `${Number(v).toLocaleString('ko-KR')}원 이하` : `≤ ₩${Number(v).toLocaleString('en-US')}`);
  const ratingFmt = (v) => (+v ? (getLang() === 'ko' ? `${v}점 이상` : `${v}+`) : (getLang() === 'ko' ? '전체' : 'Any'));
  bindRange('f-price', 'f-price-val', priceFmt);
  bindRange('f-quiet', 'f-quiet-val', ratingFmt);
  bindRange('f-coffee', 'f-coffee-val', ratingFmt);
  bindRange('f-restroom', 'f-restroom-val', ratingFmt);

  $('#f-reset').addEventListener('click', () => {
    ['f-multifloor', 'f-view', 'f-rainok', 'f-opennow', 'f-openlate', 'f-liked'].forEach((id) => ($(`#${id}`).checked = false));
    $('#f-size').value = '';
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
    const [cafes, viewspots] = await Promise.all([api.adminPending(), api.viewspotPending()]);
    renderPendingQueue(el, { cafes, viewspots }, {
      onOpenCafe: (id) => openDetail(id),
      onOpenView: (id) => openViewDetail(id),
      onApproveCafe: async (id) => { await api.adminApprove(id); await loadCafes(); await refreshPendingQueue(); },
      onRejectCafe: async (id) => { await api.adminReject(id); await loadCafes(); await refreshPendingQueue(); if (state.openCafeId === id) closeDetail(); },
      onApproveView: async (id) => { await api.approveViewspot(id); await loadCafes(); await refreshPendingQueue(); },
      onRejectView: async (id) => { await api.rejectViewspot(id); await loadCafes(); await refreshPendingQueue(); if (state.openViewId === id) closeDetail(); },
    });
  } catch { el.hidden = true; }
}

// ---------- detail ----------
async function openDetail(id) {
  const cafe = await api.getCafe(id);
  api.track('open_cafe', id, cafe.name);
  state.openCafeId = id;
  renderDetail(detailEl, cafe, {
    user: state.me.user,
    onVote: (category, score) => handleVote(id, category, score),
    onAddReview: (fd) => handleAddReview(id, fd),
    onClose: closeDetail,
    onEdit: (action) => handleAdminEdit(id, cafe, action),
    onLike: async () => { const r = await api.likeCafe(id); api.track('like', id, cafe.name); loadCafes(); return r; },
    onSetCover: (url) => handleSetCover(id, url),
    onDeleteStory: async (reviewId) => { await api.deleteReview(id, reviewId); await loadCafes(); await openDetail(id); },
    onEditStory: async (reviewId, fd) => { await api.updateReview(id, reviewId, fd); await loadCafes(); await openDetail(id); },
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
  api.track('open_view', id, spot.name);
  state.openViewId = id;
  state.openCafeId = null;
  state.chatCleanup?.();
  state.chatCleanup = null;
  renderViewDetail(detailEl, spot, {
    user: state.me.user,
    onAddComment: (body) => handleViewComment(id, body),
    onEdit: () => handleViewEdit(id, spot),
    onDelete: () => handleViewDelete(id),
    onAddPhotos: async (fd) => { await api.addViewspotPhotos(id, fd); await loadCafes(); await openViewDetail(id); },
    onLike: async () => { const r = await api.likeViewspot(id); api.track('like', id, spot.name); loadCafes(); return r; }, // refresh card/declutter in bg
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
  if (!confirm('이 사진을 삭제할까요?')) return;
  try { await api.deleteViewspot(id); closeDetail(); await loadCafes(); }
  catch (e) { alert(e.message); }
}
function wireAddView() {
  $('#addViewBtn').innerHTML = `${icon('view', 15)}<span class="tb__label">${t('nav.addView')}</span>`;
  $('#addViewBtn').addEventListener('click', () => {
    if (!state.me.user) { alert('사진을 올리려면 로그인이 필요합니다.'); return; }
    openViewModal({
      mode: 'create',
      onSearch: (q) => api.viewSearch(q),
      onPickLocation: (cb) => map.enablePick(({ lng, lat }) => cb(lng, lat)),
      onCancelPick: () => map.disablePick(),
      onSubmit: async (fd) => {
        const created = await api.createViewspot(fd);
        map.disablePick();
        await loadCafes();
        if (created.pending) alert('제안이 접수되었습니다.\n\n운영자 승인 후 지도에 표시됩니다.');
        openViewDetail(created.id);
      },
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
  if (action === 'remove') { // soft-delete: status→rejected, hidden from map but row kept
    try { await api.adminReject(id); await loadCafes(); closeDetail(); }
    catch (e) { alert(e.message); }
    return;
  }
  openEditCafeModal(cafe, {
    onSave: async (patch) => {
      await api.updateCafe(id, patch);
      await loadCafes();
      await openDetail(id);
    },
    onDraftReview: (payload) => api.adminDraftReview(payload),
  });
}

async function handleAddReview(id, fd) {
  try {
    await api.addReview(id, fd); // admin upload may set the cover → refresh card + detail
    await loadCafes();
    await openDetail(id);
  } catch (e) {
    alert(e.message);
  }
}

async function handleSetCover(id, url) {
  try {
    await api.setCover(id, url);
    await loadCafes();     // update the map card's representative photo
    await openDetail(id);  // update the detail hero
  } catch (e) {
    alert(e.message);
  }
}

// ---------- auth ----------
// The login/account UI lives in a centered modal (openAuthModal). refreshMe just
// keeps the header's account button in sync with login state.
async function refreshMe() {
  state.me = await api.me();
  state.capabilities = { kakao: false, ai: false };
  if (state.me.user) { // any logged-in user can propose cafes/view-spots (kakao autofill too)
    state.capabilities = await api.adminCapabilities().catch(() => state.capabilities);
  }
  const authBtn = $('#authBtn');
  const u = state.me.user;
  authBtn.classList.toggle('is-in', !!u);
  authBtn.title = u ? (u.name + (u.isAdmin ? ' · admin' : '')) : (getLang() === 'ko' ? '로그인' : 'Log in');
  authBtn.innerHTML = u
    ? `<span class="tb__avatar">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`
    : `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  // any logged-in user can add/propose (non-admins go to the pending queue)
  $('#addCafeBtn').hidden = !u;
  $('#addViewBtn').hidden = !u;
}

// ---------- add cafe ----------
function wireAddCafe() {
  $('#addCafeBtn').addEventListener('click', () => {
    if (!state.me.user) {
      alert('카페를 제안하려면 로그인이 필요합니다.');
      return;
    }
    openAddCafeModal({
      user: state.me.user,
      capabilities: state.capabilities,
      onSearch: (q) => api.adminSearch(q),
      onEnrich: (payload) => api.adminEnrich(payload),
      onDraftReview: (payload) => api.adminDraftReview(payload),
      onPickLocation: (cb) => map.enablePick(({ lng, lat }) => cb(lng, lat)),
      onCancelPick: () => map.disablePick(),
      onSubmit: async (fd) => {
        const created = await api.createCafe(fd);
        map.disablePick();
        await loadCafes();
        if (created.pending) {
          alert('제안이 접수되었습니다.\n\n운영자 승인 후 지도에 표시됩니다. (승인 전까지는 나에게만 보여요.)');
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
  $('#addCafeBtn').innerHTML = `${icon('plus', 15)}<span class="tb__label">${t('nav.addCafe')}</span>`;
  $('#addViewBtn').innerHTML = `${icon('view', 15)}<span class="tb__label">${t('nav.addView')}</span>`;
  ['f-price', 'f-quiet', 'f-coffee', 'f-restroom'].forEach((id) => $(`#${id}`).dispatchEvent(new Event('input')));
  await refreshMe();               // re-render auth bar in the new language
  applyFilters();                  // result text
  await refreshPendingQueue();
  if (state.openCafeId) await openDetail(state.openCafeId);
  else if (state.openViewId) await openViewDetail(state.openViewId);
}

// ---------- header chrome: login modal, chrome height, detail resize/swipe ----------
function openAuthModal() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal modal--auth"><div class="modal__head"><h2>${getLang() === 'ko' ? '계정' : 'Account'}</h2><button class="detail__close" id="authClose">${icon('x', 16)}</button></div><div id="authBody"></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#authClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const done = async () => {
    close(); await refreshMe();
    if (state.openCafeId) await openDetail(state.openCafeId);
    else if (state.openViewId) await openViewDetail(state.openViewId);
  };
  renderAuth(back.querySelector('#authBody'), state.me, {
    onGoogleCredential: async (c) => { try { await api.googleVerify(c); await done(); } catch (e) { alert('Google 로그인 실패: ' + e.message); } },
    onLocalLogin: async (u, p) => { await api.login(u, p); await done(); },
    onRegister: async (u, p) => { await api.register(u, p); await done(); },
    onLogout: async () => { await api.logout(); await done(); },
    onEditName: async () => {
      const name = prompt('표시할 닉네임을 입력하세요', state.me.user?.name || '');
      if (name == null || !name.trim()) return;
      try { await api.updateName(name.trim()); await done(); } catch (e) { alert(e.message); }
    },
  });
  // admins get an insights button (signups / activity / visits)
  if (state.me.user?.isAdmin) {
    const b = document.createElement('button');
    b.className = 'btn btn--ghost sm';
    b.style.cssText = 'margin-top:14px;width:100%';
    b.innerHTML = `${icon('shield', 14)} ${getLang() === 'ko' ? '관리자 통계' : 'Admin insights'}`;
    b.onclick = () => { close(); openInsightsModal(); };
    back.querySelector('#authBody').appendChild(b);
  }
}

async function openInsightsModal() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const ko = getLang() === 'ko';
  back.innerHTML = `<div class="modal modal--insights"><div class="modal__head"><h2>${ko ? '관리자 통계' : 'Admin insights'}</h2><button class="detail__close" id="inClose">${icon('x', 16)}</button></div><div id="inBody"><p class="muted">${ko ? '불러오는 중…' : 'Loading…'}</p></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#inClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  try {
    const [d, a] = await Promise.all([api.adminInsights(), api.adminAnalytics()]);
    const stat = (n, label) => `<div class="in-stat"><b>${n}</b><span>${label}</span></div>`;
    const row = (label, n) => `<div class="in-row">${esc(label)}<span class="in-when">${n}</span></div>`;
    const A = { pageview: ko ? '페이지뷰' : 'Pageview', open_cafe: ko ? '카페 열람' : 'Open cafe', open_view: ko ? '뷰맛집 열람' : 'Open view', filter: ko ? '필터' : 'Filter', search: ko ? '검색' : 'Search', like: ko ? '따봉' : 'Like', add_cafe: ko ? '카페 제안' : 'Add cafe', add_view: ko ? '뷰맛집 제안' : 'Add view', lang: ko ? '언어변경' : 'Lang', locate: ko ? '내 위치' : 'Locate', install: ko ? '앱설치' : 'Install' };
    const hhmm = (s) => esc((s || '').slice(11, 16));
    back.querySelector('#inBody').innerHTML = `
      <div class="in-stats">
        ${stat(a.today.visitors, ko ? '오늘 방문자(고유)' : 'Visitors today')}
        ${stat(a.today.pageviews, ko ? '페이지뷰' : 'Pageviews')}
        ${stat(a.today.botPageviews, ko ? '봇 조회' : 'Bot views')}
        ${stat(d.visits.total, ko ? '누적(구지표)' : 'Legacy total')}
        ${stat(d.users.total, ko ? '가입 유저' : 'Users')}
        ${stat(d.content.cafes, ko ? '카페' : 'Cafes')}
        ${stat(d.content.viewspots, ko ? '뷰맛집' : 'View spots')}
      </div>
      ${a.today.countries.length ? `<h4 class="in-h4">${ko ? '국가별 방문자' : 'Visitors by country'}</h4><div class="in-list">${a.today.countries.map((c) => row(c.country || '?', c.n)).join('')}</div>` : ''}
      <h4 class="in-h4">${ko ? '오늘 행동' : 'Actions today'}</h4>
      <div class="in-list">${a.actions.length ? a.actions.map((x) => row(A[x.type] || x.type, x.n)).join('') : `<p class="muted">${ko ? '아직 없음' : 'none yet'}</p>`}</div>
      ${a.topCafes.length ? `<h4 class="in-h4">${ko ? '많이 본 카페' : 'Top cafes'}</h4><div class="in-list">${a.topCafes.map((x) => row(x.label || '?', x.n)).join('')}</div>` : ''}
      ${a.topViews.length ? `<h4 class="in-h4">${ko ? '많이 본 뷰맛집' : 'Top view spots'}</h4><div class="in-list">${a.topViews.map((x) => row(x.label || '?', x.n)).join('')}</div>` : ''}
      ${a.topSearches.length ? `<h4 class="in-h4">${ko ? '검색어' : 'Searches'}</h4><div class="in-list">${a.topSearches.map((x) => row(x.label || '?', x.n)).join('')}</div>` : ''}
      <h4 class="in-h4">${ko ? '방문자별 (한 명 vs 여러 명 구분)' : 'Per visitor'} <small class="muted">${a.sessions.length}</small></h4>
      <div class="in-list">${a.sessions.length ? a.sessions.map((s) => `<div class="in-row"><b>${esc(s.country || '?')} · ${esc(s.ip || '?')}</b>${s.user_id ? ' <span class="admin-badge">로그인</span>' : ''} <span class="muted">${s.pageviews}pv · ${s.events}${ko ? '행동' : 'ev'}</span><span class="in-when">${hhmm(s.first_seen)}–${hhmm(s.last_seen)}</span></div>`).join('') : `<p class="muted">${ko ? '없음' : 'none'}</p>`}</div>
      <h4 class="in-h4">${ko ? '최근 활동 (실시간)' : 'Recent activity'}</h4>
      <div class="in-list in-feed">${a.recent.length ? a.recent.map((e) => `<div class="in-row ${e.is_bot ? 'is-bot' : ''}"><span class="ev-type">${esc(e.type)}</span> <span class="muted">${esc(e.label || e.target || '')}</span><span class="in-when">${hhmm(e.ts)} ${esc(e.country || '')}${e.is_bot ? ' 🤖' : ''}${e.is_admin ? ' 👑' : ''}</span></div>`).join('') : `<p class="muted">${ko ? '없음' : 'none'}</p>`}</div>
      <h4 class="in-h4">${ko ? '가입 유저' : 'Signups'}</h4>
      <div class="in-list">${d.users.recent.map((u) => `<div class="in-row"><b>${esc(u.name || u.provider_id)}</b>${u.is_admin ? ' <span class="admin-badge">ADMIN</span>' : ''} <span class="muted">${esc(u.provider)}</span><span class="in-when">${esc((u.created_at || '').slice(0, 10))}</span></div>`).join('')}</div>`;
  } catch (e) { back.querySelector('#inBody').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// keep the detail panel anchored right below the (variable-height) header
function measureChrome() {
  const chrome = $('#chrome');
  const set = () => document.documentElement.style.setProperty('--chrome-h', `${chrome.offsetHeight}px`);
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(chrome);
  window.addEventListener('resize', set);
}

function wireChrome() {
  $('#authBtn').addEventListener('click', openAuthModal);
  measureChrome();

  // "상세" toggle → show/hide the advanced filter row
  const moreBtn = $('#filterMore');
  const adv = $('#filteradv');
  moreBtn.addEventListener('click', () => {
    const show = adv.hidden;
    adv.hidden = !show;
    moreBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    setTimeout(() => { try { map.map.resize(); } catch { /* */ } }, 60); // header grew → re-fit map
  });

  // desktop: drag the detail panel's left edge to resize width (persisted)
  const root = document.documentElement;
  try { const w = localStorage.getItem('detailW'); if (w) root.style.setProperty('--detail-w', w); } catch { /* */ }
  const handle = $('#detailResize');
  let sx = 0, sw = 0;
  const rw = () => parseInt(getComputedStyle(root).getPropertyValue('--detail-w'), 10) || 420;
  const onMove = (e) => {
    const w = Math.max(320, Math.min(window.innerWidth * 0.82, sw + (sx - e.clientX)));
    root.style.setProperty('--detail-w', `${w}px`);
  };
  const onUp = () => {
    document.body.classList.remove('detail-resizing'); handle.classList.remove('dragging');
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
    try { localStorage.setItem('detailW', `${rw()}px`); } catch { /* */ }
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); sx = e.clientX; sw = rw();
    document.body.classList.add('detail-resizing'); handle.classList.add('dragging');
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });

  // mobile: swipe the detail sheet down to dismiss (only when its content is at the top).
  // Touch events (not pointer) so we can preventDefault the native scroll/refresh reliably.
  const detail = $('#detail');
  const scroller = () => detail.querySelector('.detail__scroll');
  let startY = null, dragging = false, moved = 0;
  detail.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 760) { startY = null; return; }
    const sc = scroller();
    if (sc && sc.scrollTop > 2) { startY = null; return; } // mid-scroll → let it scroll
    startY = e.touches[0].clientY; dragging = false; moved = 0;
  }, { passive: true });
  detail.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { if (dragging) { moved = 0; detail.style.transform = ''; } return; } // upward → normal
    const sc = scroller();
    if (sc && sc.scrollTop > 0) return; // scrolled during the gesture → abort dismiss
    if (!dragging && dy > 8) { dragging = true; document.body.classList.add('detail-dragging'); }
    if (dragging) {
      moved = dy;
      detail.style.transform = `translateY(${moved}px)`;
      if (e.cancelable) e.preventDefault(); // block native pull/scroll while dragging
    }
  }, { passive: false });
  const endSwipe = () => {
    if (startY == null) return;
    document.body.classList.remove('detail-dragging');
    detail.style.transform = '';
    if (dragging && moved > 90) closeDetail();
    startY = null; dragging = false; moved = 0;
  };
  detail.addEventListener('touchend', endSwipe);
  detail.addEventListener('touchcancel', endSwipe);
}

// mobile: offer "install as app" (Chrome prompt, or an iOS Safari hint)
function initInstallPrompt() {
  try {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone) return; // already installed
    if (localStorage.getItem('installDismissed')) return; // dismissed → never again
    const last = Number(localStorage.getItem('installShownAt') || 0); // else at most once / 14 days
    if (last && Date.now() - last < 14 * 864e5) return;
  } catch { return; }
  const markShown = () => { try { localStorage.setItem('installShownAt', String(Date.now())); } catch { /* */ } };
  const banner = (inner) => {
    markShown();
    const bar = document.createElement('div');
    bar.className = 'install-banner';
    bar.innerHTML = `<div class="install-msg">${icon('coffee', 16)} ${inner}</div><button class="install-x" aria-label="닫기">${icon('x', 15)}</button>`;
    document.body.appendChild(bar);
    bar.querySelector('.install-x').onclick = () => { bar.remove(); try { localStorage.setItem('installDismissed', '1'); } catch { /* */ } };
    return bar;
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const ko = getLang() === 'ko';
    const bar = banner(`<span>${ko ? '앱으로 설치하고 더 편하게 쓰세요' : 'Install as an app'}</span> <button class="btn btn--primary sm install-go">${ko ? '설치' : 'Install'}</button>`);
    bar.querySelector('.install-go').onclick = async () => { e.prompt(); await e.userChoice; bar.remove(); };
  });
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua)) {
    setTimeout(() => banner(getLang() === 'ko' ? '공유 → "홈 화면에 추가"로 앱처럼 쓰세요' : 'Share → "Add to Home Screen" to install'), 2500);
  }
}

// clip-free hover/tap tooltips for any [data-tip] element (criteria transparency)
function initTooltips() {
  let tipEl = null;
  const show = (target) => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip-pop'; document.body.appendChild(tipEl); }
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    const r = target.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
    let top = r.bottom + 7;
    if (top + th > window.innerHeight - 8) top = r.top - th - 7; // flip up if no room below
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => { if (tipEl) tipEl.style.display = 'none'; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) hide(); });
  document.addEventListener('click', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) { show(el); setTimeout(hide, 2600); } }); // tap on mobile
  window.addEventListener('scroll', hide, true);
}

async function boot() {
  applyStaticI18n();
  initTooltips();
  initInstallPrompt();
  $('#langToggle').textContent = getLang() === 'ko' ? 'EN' : 'KO';
  $('#langToggle').onclick = () => setLang(getLang() === 'ko' ? 'en' : 'ko');
  onLangChange(() => rerenderI18n());
  $('#addCafeBtn').innerHTML = `${icon('plus', 15)}<span class="tb__label">${t('nav.addCafe')}</span>`;
  wireFilters();
  loadFilters();     // restore saved filter toggles before first apply
  wireChrome();      // header popovers, detail resize, mobile swipe
  wireCardZoom();
  wireAddCafe();
  wireAddView();
  await refreshMe();
  await loadCafes();
  loadStats();
}

async function loadStats() {
  try {
    const s = await api.stats();
    const el = document.getElementById('visitStat');
    if (el) el.textContent = `${t('stat.today')} ${s.today} · ${t('stat.total')} ${s.total}`;
  } catch { /* non-critical */ }
}

boot().catch((e) => {
  console.error(e);
  alert('초기화 실패: ' + e.message);
});
