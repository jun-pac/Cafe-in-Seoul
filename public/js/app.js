import { api } from './api.js';
import { initMap } from './map.js';
import { renderAuth, renderDetail, openAddCafeModal, renderPendingQueue } from './ui.js';
import { passesFilters } from './util.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  me: { user: null, googleClientId: null },
  capabilities: { kakao: false, ai: false },
  cafes: [],
  openCafeId: null,
};

const detailEl = $('#detail');
const map = initMap('map', { onCardClick: (cafe) => openDetail(cafe.id) });

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

function applyFilters() {
  const f = readFilters();
  const ids = new Set();
  for (const c of state.cafes) if (passesFilters(c, f)) ids.add(c.id);
  map.setFiltered(ids);
  $('#result-count').textContent = `${ids.size} / ${state.cafes.length}곳`;
}

function wireFilters() {
  const ids = ['f-multifloor', 'f-view', 'f-opennow', 'f-openlate',
    'f-size-small', 'f-size-medium', 'f-size-large', 'f-outlet'];
  ids.forEach((id) => $(`#${id}`).addEventListener('change', applyFilters));

  const bindRange = (id, out, fmt) => {
    const el = $(`#${id}`);
    const label = $(`#${out}`);
    const update = () => { label.textContent = fmt(el.value); applyFilters(); };
    el.addEventListener('input', update);
    label.textContent = fmt(el.value);
  };
  bindRange('f-price', 'f-price-val', (v) => `${Number(v).toLocaleString('ko-KR')}원 이하`);
  bindRange('f-quiet', 'f-quiet-val', (v) => (+v ? `${v}점 이상` : '전체'));
  bindRange('f-coffee', 'f-coffee-val', (v) => (+v ? `${v}점 이상` : '전체'));
  bindRange('f-restroom', 'f-restroom-val', (v) => (+v ? `${v}점 이상` : '전체'));

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
  state.cafes = await api.listCafes();
  map.setCafes(state.cafes);
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
  });
  document.body.classList.add('detail-open');
  map.setSelected(id);
  map.flyTo(cafe);
}

function closeDetail() {
  state.openCafeId = null;
  document.body.classList.remove('detail-open');
  map.setSelected(null);
}

async function handleVote(id, category, score) {
  try {
    await api.vote(id, category, score);
    await loadCafes();       // refresh scores/markers
    await openDetail(id);    // re-render detail with new averages + my vote
  } catch (e) {
    alert(e.message);
  }
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
          alert(`🤖 AI 심사: 관리자 승인 대기\n\n사유: ${created.moderation?.reason || '특별함 확인 필요'}\n\n승인 전까지는 나에게만 보여요.`);
        }
        openDetail(created.id);
      },
    });
  });
}

// ---------- boot ----------
async function boot() {
  wireFilters();
  wireAddCafe();
  await refreshMe();
  await loadCafes();
}

boot().catch((e) => {
  console.error(e);
  alert('초기화 실패: ' + e.message);
});
