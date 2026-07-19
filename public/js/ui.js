import {
  sizeLabel, outletLabel, def, won, hoursText, isOpenNow, weeklyHours, esc, img, haversineKm,
} from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const VOTE_CATS = [
  { key: 'coffee', icon: 'coffee' },
  { key: 'quiet', icon: 'quiet' },
  { key: 'restroom', icon: 'clean' },
];

function stars(avg) {
  if (avg == null) return `<span class="muted">${t('vote.none')}</span>`;
  return `<b>${avg.toFixed(1)}</b> / 5`;
}

// ---- Auth bar -------------------------------------------------------------
export function renderAuth(el, me, { onLogout, onGoogleCredential, onLocalLogin, onRegister, onEditName }) {
  el.innerHTML = '';
  if (me.user) {
    const wrap = document.createElement('div');
    wrap.className = 'authbar';
    const badge = me.user.isAdmin ? `<span class="admin-badge">${t('auth.admin')}</span>` : '';
    wrap.innerHTML = `<span class="authbar__who">${icon('user', 15)} <span class="authbar__name" id="editNameBtn" title="${t('auth.editName')}">${esc(me.user.name)}</span> ${badge}</span>
      <button class="btn btn--ghost" id="logoutBtn" title="${t('auth.logout')}">${icon('logout', 15)}</button>`;
    wrap.querySelector('#logoutBtn').onclick = onLogout;
    wrap.querySelector('#editNameBtn').onclick = onEditName;
    el.appendChild(wrap);
    return;
  }

  const box = document.createElement('div');
  box.className = 'loginbox';

  if (me.googleClientId) {
    const holder = document.createElement('div');
    holder.id = 'gsiButton';
    box.appendChild(holder);
    const init = () => {
      if (!window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: me.googleClientId,
        callback: (resp) => onGoogleCredential(resp.credential),
      });
      window.google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', text: 'signin_with', width: 260 });
      return true;
    };
    if (!init()) {
      const t = setInterval(() => { if (init()) clearInterval(t); }, 200);
      setTimeout(() => clearInterval(t), 6000);
    }
    const or = document.createElement('div');
    or.className = 'login-or';
    or.textContent = t('auth.or');
    box.appendChild(or);
  }

  const form = document.createElement('form');
  form.className = 'loginform';
  form.innerHTML = `
    <input class="input" name="username" placeholder="${t('auth.id')}" autocomplete="username">
    <input class="input" name="password" type="password" placeholder="${t('auth.pw')}" autocomplete="current-password">
    <div class="loginform__row">
      <button type="submit" class="btn btn--primary" id="loginBtn">${t('auth.login')}</button>
      <button type="button" class="btn btn--ghost" id="registerBtn">${t('auth.register')}</button>
    </div>
    <div class="err" id="loginErr"></div>`;
  const errEl = form.querySelector('#loginErr');
  const creds = () => ({ u: form.elements.username.value.trim(), p: form.elements.password.value });
  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const { u, p } = creds();
    if (!u || !p) { errEl.textContent = t('auth.needId'); return; }
    try { await onLocalLogin(u, p); } catch (err) { errEl.textContent = err.message; }
  };
  form.querySelector('#registerBtn').onclick = async () => {
    errEl.textContent = '';
    const { u, p } = creds();
    if (!u || !p) { errEl.textContent = t('auth.needReg'); return; }
    try { await onRegister(u, p); } catch (err) { errEl.textContent = err.message; }
  };
  box.appendChild(form);
  el.appendChild(box);
}

// ---- Admin pending queue --------------------------------------------------
export function renderPendingQueue(el, cafes, { onApprove, onReject, onOpen }) {
  if (!cafes.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="pending-queue__title">${icon('shield', 14)} ${t('pending.title')} <b>${cafes.length}</b></div>`;
  for (const c of cafes) {
    const row = document.createElement('div');
    row.className = 'pending-item';
    row.innerHTML = `
      <button type="button" class="pending-item__name">${esc(c.name)}</button>
      <div class="pending-item__reason">${esc(c.moderation_reason || t('pending.noReason'))}</div>
      <div class="pending-item__actions">
        <button class="btn btn--primary pill sm" data-a="ok">${t('pending.approve')}</button>
        <button class="btn btn--ghost pill sm" data-a="no">${t('pending.reject')}</button>
      </div>`;
    row.querySelector('.pending-item__name').onclick = () => onOpen(c.id);
    row.querySelector('[data-a="ok"]').onclick = () => onApprove(c.id);
    row.querySelector('[data-a="no"]').onclick = () => { if (confirm(`'${c.name}' 거절(삭제)할까요?`)) onReject(c.id); };
    el.appendChild(row);
  }
}

// The modal overlay covers the map, so "pick on map" must temporarily hide the
// modal, show a banner, let the user click the map, then restore the modal.
function pickLocationFlow(back, { onPickLocation, onCancelPick, onPicked }) {
  back.style.display = 'none';
  const banner = document.createElement('div');
  banner.className = 'pickbanner';
  banner.innerHTML = `<span>${icon('gps', 15)} ${t('view.clickMap')}</span><button type="button" id="pickCancel">${t('common.cancel')}</button>`;
  document.body.appendChild(banner);
  const done = () => { banner.remove(); back.style.display = ''; };
  banner.querySelector('#pickCancel').onclick = () => { onCancelPick?.(); done(); };
  onPickLocation((lng, lat) => { onPicked(lng, lat); onCancelPick?.(); done(); });
}

// ---- Lightbox (full-screen photo viewer) ----------------------------------
export function openLightbox(photos, start = 0) {
  if (!photos || !photos.length) return;
  let i = start;
  const back = document.createElement('div');
  back.className = 'lightbox';
  back.innerHTML = `
    <button class="lightbox__close" aria-label="닫기">${icon('x', 20)}</button>
    ${photos.length > 1 ? `<button class="lightbox__nav prev" aria-label="이전">${icon('chevronLeft', 30)}</button>
    <button class="lightbox__nav next" aria-label="다음">${icon('chevronRight', 30)}</button>` : ''}
    <img class="lightbox__img" alt="">
    ${photos.length > 1 ? '<div class="lightbox__count"></div>' : ''}`;
  const imgEl = back.querySelector('.lightbox__img');
  const countEl = back.querySelector('.lightbox__count');
  const show = () => { imgEl.src = img(photos[i]); if (countEl) countEl.textContent = `${i + 1} / ${photos.length}`; };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const go = (d) => { i = (i + d + photos.length) % photos.length; show(); };
  back.querySelector('.lightbox__close').onclick = close;
  back.querySelector('.lightbox__nav.prev')?.addEventListener('click', () => go(-1));
  back.querySelector('.lightbox__nav.next')?.addEventListener('click', () => go(1));
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  show();
}

// ---- Detail panel ---------------------------------------------------------
export function renderDetail(el, cafe, { user, onVote, onAddReview, onClose, onEdit }) {
  const openNow = isOpenNow(cafe);
  const floorTxt = cafe.multi_floor ? `${cafe.floors}${t('unit.floor')} · ${t('detail.multiFloor')}` : t('detail.singleFloor');
  const viewTxt = cafe.has_view ? (cafe.view_note ? `${t('detail.viewGood')} · ${esc(cafe.view_note)}` : t('detail.viewGood')) : t('detail.viewMeh');

  const gallery = (cafe.gallery && cafe.gallery.length) ? cafe.gallery : [cafe.photo_url].filter(Boolean);

  el.innerHTML = `
    <button class="detail__close" title="닫기">${icon('x', 16)}</button>
    <div class="detail__scroll">
      <div class="detail__hero">
        <div class="carousel__img" id="carImg" role="button" title="${t('detail.zoom')}"></div>
        ${gallery.length > 1 ? `<div class="carousel__count">${icon('camera', 12)} ${gallery.length}</div>` : ''}
        <div class="detail__scorebig" title="${esc(t('score.tip'))}">${cafe.score}<small>SCORE</small></div>
      </div>
      <div class="detail__body">
        <h2 class="detail__name">${esc(cafe.name)}</h2>
        <div class="detail__addr">${esc(cafe.address || '')}</div>
        ${cafe.status === 'pending' ? `<div class="detail__pending">${icon('shield', 14)} ${t('detail.pending')} <span class="muted">${cafe.moderation_reason ? '— ' + esc(cafe.moderation_reason) : ''}</span></div>` : ''}
        ${user?.isAdmin ? `<div class="detail__adminrow"><button class="btn btn--ghost sm" id="editCafeBtn">${icon('edit', 14)} ${t('detail.edit')}</button>${cafe.status === 'pending' ? `<button class="btn btn--primary sm" id="approveCafeBtn">${t('detail.approve')}</button>` : ''}</div>` : ''}

        <div class="detail__hoursrow">
          <button class="detail__hours ${openNow ? 'is-open' : 'is-closed'}" id="hoursToggle" ${weeklyHours(cafe) ? '' : 'disabled'}>
            <span class="dot"></span>${openNow ? t('detail.open') : t('detail.closed')} · ${esc(hoursText(cafe))}${weeklyHours(cafe) ? ` ${icon('chevronDown', 12)}` : ''}
          </button>
          ${weeklyHours(cafe) ? `<div class="weekhours" id="weekHours" hidden>${weeklyHours(cafe).map((d) => `<div class="weekhours__row ${d.isToday ? 'is-today' : ''}"><span>${d.label}</span><span>${esc(d.text)}</span></div>`).join('')}</div>` : ''}
        </div>

        <div class="chips">
          <span class="chip" title="${esc(def('floors'))}">${icon('floors', 14)} ${esc(floorTxt)}</span>
          <span class="chip" title="${esc(def('size'))}">${icon('size', 14)} ${esc(sizeLabel(cafe.size))}</span>
          <span class="chip" title="${esc(def('outlets'))}">${icon('outlet', 14)} ${t('f.outlet')} ${esc(outletLabel(cafe.outlets))}</span>
          <span class="chip" title="${esc(def('view'))}">${icon('view', 14)} ${esc(viewTxt)}</span>
          <span class="chip" title="${esc(def('price'))}">${icon('price', 14)} ${t('detail.americano')} ${won(cafe.iced_americano_price)}</span>
        </div>

        <div class="detail__links">
          ${cafe.naver_url ? `<a class="btn btn--map naver" href="${esc(cafe.naver_url)}" target="_blank" rel="noopener">${t('detail.naver')}</a>` : ''}
          ${cafe.kakao_url ? `<a class="btn btn--map kakao" href="${esc(cafe.kakao_url)}" target="_blank" rel="noopener">${t('detail.kakao')}</a>` : ''}
        </div>

        ${cafe.review_summary ? `<div class="detail__aisum"><div class="detail__aisum-h">${icon('ai', 15)} <b>${t('detail.reviewSummary')}</b></div><p>${esc(cafe.review_summary)}</p></div>` : ''}

        ${gallery.length > 1 ? `<h3 class="detail__h3">${t('detail.photos')} <small class="muted">${gallery.length}</small></h3>
        <div class="photo-grid" id="photoGrid"></div>` : ''}

        <h3 class="detail__h3">${t('detail.rating')} <small>1–5</small></h3>
        <div class="votes"></div>

        <h3 class="detail__h3">${t('detail.stories')} <small class="muted" id="revCount"></small></h3>
        <div class="storyform" id="storyform"></div>
        <div class="stories"></div>

        <h3 class="detail__h3">${t('detail.chat')} <small>${icon('gps', 12)} ${t('detail.chat.hint')}</small></h3>
        <div class="chat" id="chatBox"></div>
      </div>
    </div>`;

  el.querySelector('.detail__close').onclick = onClose;
  el.querySelector('#editCafeBtn')?.addEventListener('click', () => onEdit?.('edit'));
  el.querySelector('#approveCafeBtn')?.addEventListener('click', () => onEdit?.('approve'));
  el.querySelector('#hoursToggle')?.addEventListener('click', () => {
    const w = el.querySelector('#weekHours'); if (w) w.hidden = !w.hidden;
  });

  // hero = representative photo; click → lightbox. Grid below shows all photos.
  const carImg = el.querySelector('#carImg');
  carImg.style.backgroundImage = `url('${esc(img(gallery[0] || ''))}')`;
  carImg.addEventListener('click', () => openLightbox(gallery, 0));
  const grid = el.querySelector('#photoGrid');
  if (grid) {
    grid.innerHTML = gallery.map((u, i) =>
      `<button type="button" class="pg-item" data-i="${i}" style="background-image:url('${esc(img(u))}')"></button>`).join('');
    grid.querySelectorAll('.pg-item').forEach((b) => (b.onclick = () => openLightbox(gallery, +b.dataset.i)));
  }

  // votes — update the row in place on click (no full panel reload)
  const votesEl = el.querySelector('.votes');
  for (const cat of VOTE_CATS) {
    const row = document.createElement('div');
    row.className = 'vote';
    const paint = () => {
      const avg = cafe.votes.averages[cat.key];
      const n = cafe.votes.counts[cat.key] || 0;
      const mine = cafe.myVotes?.[cat.key] || 0;
      row.innerHTML = `
        <div class="vote__head">
          <span class="vote__label">${icon(cat.icon)} ${t(`vote.${cat.key}`)}
            <span class="info" title="${esc(def(cat.key))}">${icon('info', 13)}</span></span>
          <span class="vote__avg">${stars(avg)} <span class="muted">(${n})</span></span>
        </div>
        <div class="vote__stars" role="group" aria-label="${t(`vote.${cat.key}`)}">
          ${[1, 2, 3, 4, 5].map((v) =>
            `<button class="star ${mine >= v ? 'on' : ''}" data-v="${v}" aria-label="${v}">${icon('star', 22)}</button>`).join('')}
        </div>`;
      row.querySelectorAll('.star').forEach((b) => {
        b.onclick = async () => {
          if (!user) return alert(t('vote.loginNeeded'));
          try {
            const v = Number(b.dataset.v);
            const agg = await onVote(cat.key, v);      // { averages, counts }
            if (agg) cafe.votes = agg;
            cafe.myVotes = { ...(cafe.myVotes || {}), [cat.key]: v };
            paint();
          } catch (e) { alert(e.message); }
        };
      });
    };
    paint();
    votesEl.appendChild(row);
  }

  // stories (Instagram-style: text + multiple photos)
  const reviews = cafe.reviews || [];
  el.querySelector('#revCount').textContent = reviews.length ? `${reviews.length}` : '';
  renderStories(el.querySelector('.stories'), reviews);

  // story composer
  const formEl = el.querySelector('#storyform');
  if (user) {
    formEl.innerHTML = `
      <textarea class="input" id="stBody" rows="3" placeholder="${esc(t('story.placeholder'))}"></textarea>
      <div class="photo-picker" id="stPicker"></div>
      <div class="storyform__row">
        <button class="btn btn--primary sm" id="stSubmit">${t('story.post')}</button>
      </div>`;
    const stPicker = createPhotoPicker(formEl.querySelector('#stPicker'), {});
    formEl.querySelector('#stSubmit').onclick = async () => {
      const body = formEl.querySelector('#stBody').value.trim();
      const { files, count } = stPicker.getManifest();
      if (!body && !count) return alert(t('story.need'));
      const fd = new FormData();
      fd.append('body', body);
      files.forEach((f) => fd.append('photos', f));
      const btn = formEl.querySelector('#stSubmit');
      btn.disabled = true; btn.textContent = t('story.posting');
      try { await onAddReview(fd); } finally { btn.disabled = false; btn.textContent = t('story.post'); }
    };
  } else {
    formEl.innerHTML = `<p class="muted">${t('story.loginNeeded')}</p>`;
  }
}

// ---- Admin edit modal (curate any cafe's fields) --------------------------
export function openEditCafeModal(cafe, { onSave }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const sel = (v, o) => (v === o ? 'selected' : '');
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head"><h2>${t('modal.editCafe')}</h2><button class="detail__close" id="eClose">${icon('x', 16)}</button></div>
      <form class="cafeform" id="editForm">
        <label class="field"><span>${t('modal.name')}</span><input class="input" name="name" value="${esc(cafe.name)}"></label>
        <label class="field"><span>${t('modal.address')}</span><input class="input" name="address" value="${esc(cafe.address || '')}"></label>
        <div class="field"><span>${t('modal.photo')} <small class="muted">${t('modal.photoHint')}</small></span>
          <div class="photo-picker" id="editPhotoPicker"></div></div>
        <div class="grid2">
          <label class="field"><span>${t('modal.floors')} <span class="info" title="${esc(def('floors'))}">${icon('info', 12)}</span></span><input class="input" type="number" min="1" name="floors" value="${esc(cafe.floors)}"></label>
          <label class="field"><span>${t('modal.area')} <span class="info" title="${esc(def('size'))}">${icon('info', 12)}</span></span><select class="input" name="size">
            <option value="small" ${sel(cafe.size, 'small')}>${t('size.small')}</option>
            <option value="medium" ${sel(cafe.size, 'medium')}>${t('size.medium')}</option>
            <option value="large" ${sel(cafe.size, 'large')}>${t('size.large')}</option></select></label>
          <label class="field"><span>${t('modal.outlet')} <span class="info" title="${esc(def('outlets'))}">${icon('info', 12)}</span></span><select class="input" name="outlets">
            <option value="many" ${sel(cafe.outlets, 'many')}>${t('outlet.many')}</option>
            <option value="some" ${sel(cafe.outlets, 'some')}>${t('outlet.some')}</option>
            <option value="few" ${sel(cafe.outlets, 'few')}>${t('outlet.few')}</option>
            <option value="none" ${sel(cafe.outlets, 'none')}>${t('outlet.none')}</option></select></label>
          <label class="field"><span>${t('modal.price')}</span><input class="input" type="number" min="0" step="100" name="iced_americano_price" value="${esc(cafe.iced_americano_price)}"></label>
          <label class="field"><span>${t('modal.open')}</span><input class="input" type="time" name="open_time" value="${esc(cafe.open_time)}"></label>
          <label class="field"><span>${t('modal.close')}</span><input class="input" type="time" name="close_time" value="${esc(cafe.close_time === '00:00' ? '00:00' : cafe.close_time)}"></label>
        </div>
        <label class="field checkline"><input type="checkbox" name="has_view" ${cafe.has_view ? 'checked' : ''}> <span>${t('modal.viewGood')}</span></label>
        <label class="field"><span>${t('modal.viewNote')}</span><input class="input" name="view_note" value="${esc(cafe.view_note || '')}"></label>
        <div class="grid2">
          <label class="field"><span>${t('modal.naverLink')}</span><input class="input" name="naver_url" value="${esc(cafe.naver_url || '')}"></label>
          <label class="field"><span>${t('modal.kakaoLink')}</span><input class="input" name="kakao_url" value="${esc(cafe.kakao_url || '')}"></label>
        </div>
        <label class="field"><span>${t('modal.aiSummary')}</span><textarea class="input" rows="2" name="review_summary">${esc(cafe.review_summary || '')}</textarea></label>
        <div class="modal__foot"><span class="err" id="eErr"></span><button type="submit" class="btn btn--primary">${t('modal.save')}</button></div>
      </form>
    </div>`;
  document.body.appendChild(back);
  const form = back.querySelector('#editForm');
  const picker = createPhotoPicker(back.querySelector('#editPhotoPicker'), {});
  // load ALL of the cafe's photos (representative set + user story photos) so any
  // can be picked as the cover — not just the imported cafe_photos.
  const editPhotos = (cafe.gallery && cafe.gallery.length) ? cafe.gallery
    : (cafe.photos && cafe.photos.length) ? cafe.photos : [cafe.photo_url].filter(Boolean);
  picker.addUrls(editPhotos);
  const close = () => back.remove();
  back.querySelector('#eClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { manifest, files, count } = picker.getManifest();
    if (!count) { back.querySelector('#eErr').textContent = '사진을 한 장 이상 남겨주세요.'; return; }
    const fd = new FormData();
    const setF = (k, v) => fd.set(k, v);
    setF('name', form.elements.name.value);
    setF('address', form.elements.address.value);
    setF('floors', form.elements.floors.value);
    setF('size', form.elements.size.value);
    setF('outlets', form.elements.outlets.value);
    setF('iced_americano_price', form.elements.iced_americano_price.value);
    setF('open_time', form.elements.open_time.value);
    setF('close_time', form.elements.close_time.value);
    setF('has_view', form.elements.has_view.checked ? 'true' : 'false');
    setF('view_note', form.elements.view_note.value);
    setF('naver_url', form.elements.naver_url.value);
    setF('kakao_url', form.elements.kakao_url.value);
    setF('review_summary', form.elements.review_summary.value);
    setF('photo_manifest', JSON.stringify(manifest));
    files.forEach((f) => fd.append('photos', f));
    try { await onSave(fd); close(); }
    catch (err) { back.querySelector('#eErr').textContent = err.message || '저장 실패'; }
  };
  return { close };
}

// ---- GPS-gated per-cafe chat ----------------------------------------------
// Anyone reads; to post you must verify you're within 1km via Geolocation.
// Returns a cleanup fn that stops polling (call before re-init / on close).
export function initChat(root, cafe, { user, api }) {
  let verified = null;   // { lat, lng } once confirmed within 1km
  let stopped = false;

  root.innerHTML = `
    <div class="chat__msgs" id="chatMsgs"><div class="muted">불러오는 중…</div></div>
    <div class="chat__gate" id="chatGate"></div>`;
  const msgsEl = root.querySelector('#chatMsgs');
  const gateEl = root.querySelector('#chatGate');

  function renderMsgs(list) {
    if (!list.length) {
      msgsEl.innerHTML = `<div class="muted chat__empty">${t('chat.empty')}</div>`;
      return;
    }
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 40;
    msgsEl.innerHTML = list.map((m) => `
      <div class="chat__msg">
        <div class="chat__meta"><span class="chat__who">${esc(m.user_name)}</span>
          <span class="chat__t">${esc((m.created_at || '').slice(11, 16))}</span></div>
        <div class="chat__body">${esc(m.body)}</div>
      </div>`).join('');
    if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function load() {
    try {
      const { messages } = await api.getMessages(cafe.id);
      if (!stopped) renderMsgs(messages);
    } catch { /* keep last */ }
  }

  function renderGate() {
    if (!user) { gateEl.innerHTML = `<div class="muted">${t('chat.loginNeeded')}</div>`; return; }
    if (verified) {
      gateEl.innerHTML = `
        <div class="chat__input">
          <input class="input" id="chatInput" placeholder="${esc(t('chat.input'))}" maxlength="500">
          <button class="btn btn--primary pill sm" id="chatSend">${t('chat.send')}</button>
        </div>
        <div class="chat__err" id="chatErr"></div>`;
      const input = gateEl.querySelector('#chatInput');
      const errEl = gateEl.querySelector('#chatErr');
      const send = async () => {
        const body = input.value.trim();
        if (!body) return;
        errEl.textContent = '';
        try {
          await api.postMessage(cafe.id, { body, lat: verified.lat, lng: verified.lng });
          input.value = '';
          await load();
        } catch (e) {
          errEl.textContent = e.message;
          if (/떨어져/.test(e.message)) { verified = null; renderGate(); }
        }
      };
      gateEl.querySelector('#chatSend').onclick = send;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    } else {
      gateEl.innerHTML = `
        <button class="btn btn--ghost pill sm" id="chatVerify">${icon('gps', 14)} ${t('chat.verify')}</button>
        <div class="chat__err" id="chatErr"></div>`;
      gateEl.querySelector('#chatVerify').onclick = verify;
    }
  }

  function verify() {
    const errEl = gateEl.querySelector('#chatErr');
    if (!navigator.geolocation) { errEl.textContent = t('chat.needGeo'); return; }
    errEl.textContent = t('chat.locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const km = haversineKm(lat, lng, cafe.lat, cafe.lng);
        if (km <= 1.0) { verified = { lat, lng }; renderGate(); }
        else errEl.textContent = `카페에서 ${km.toFixed(1)}km 떨어져 있어요. 1km 이내에서 참여할 수 있어요.`;
      },
      () => { errEl.textContent = t('chat.needPerm'); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  renderGate();
  load();
  const timer = setInterval(load, 5000);
  return () => { stopped = true; clearInterval(timer); };
}

export function renderStories(el, reviews) {
  el.innerHTML = reviews.length
    ? reviews.map((r) => {
        const photos = r.photos && r.photos.length ? r.photos : (r.photo_url ? [r.photo_url] : []);
        return `
      <div class="story">
        <div class="story__head"><b>${esc(r.user_name)}</b>
          <span class="muted">${esc((r.created_at || '').slice(0, 10))}</span></div>
        ${r.body ? `<div class="story__body">${esc(r.body)}</div>` : ''}
        ${photos.length ? `<div class="story__photos">${photos.map((u) => `<img class="story__photo" src="${esc(img(u))}" loading="lazy" alt="">`).join('')}</div>` : ''}
      </div>`;
      }).join('')
    : `<p class="muted">${t('story.empty')}</p>`;
}

// ---- View-spot detail (lighter: name + photos + comments) -----------------
export function renderViewDetail(el, spot, { user, onAddComment, onEdit, onDelete, onClose }) {
  const gallery = (spot.photos && spot.photos.length) ? spot.photos : [spot.photo_url].filter(Boolean);
  el.innerHTML = `
    <button class="detail__close" title="닫기">${icon('x', 16)}</button>
    <div class="detail__scroll">
      <div class="detail__hero detail__hero--view">
        <div class="carousel__img" id="carImg" role="button" title="${t('detail.zoom')}"></div>
        ${gallery.length > 1 ? `<div class="carousel__count">${icon('camera', 12)} ${gallery.length}</div>` : ''}
        <div class="detail__viewtag">${icon('view', 13)} VIEW</div>
      </div>
      <div class="detail__body">
        <h2 class="detail__name">${esc(spot.name)}</h2>
        ${spot.canEdit ? `<div class="detail__adminrow"><button class="btn btn--ghost sm" id="vEdit">${icon('edit', 14)} ${t('detail.edit')}</button><button class="btn btn--ghost sm" id="vDel">${t('detail.delete')}</button></div>` : ''}
        ${gallery.length > 1 ? `<h3 class="detail__h3">${t('detail.photos')} <small class="muted">${gallery.length}</small></h3><div class="photo-grid" id="photoGrid"></div>` : ''}
        <h3 class="detail__h3">${t('comment.header')} <small class="muted" id="cCount"></small></h3>
        <div class="commentform" id="commentform"></div>
        <div class="comments"></div>
      </div>
    </div>`;
  el.querySelector('.detail__close').onclick = onClose;
  el.querySelector('#vEdit')?.addEventListener('click', onEdit);
  el.querySelector('#vDel')?.addEventListener('click', onDelete);

  const carImg = el.querySelector('#carImg');
  carImg.style.backgroundImage = `url('${esc(img(gallery[0] || ''))}')`;
  carImg.addEventListener('click', () => openLightbox(gallery, 0));
  const grid = el.querySelector('#photoGrid');
  if (grid) {
    grid.innerHTML = gallery.map((u, i) => `<button type="button" class="pg-item" data-i="${i}" style="background-image:url('${esc(img(u))}')"></button>`).join('');
    grid.querySelectorAll('.pg-item').forEach((b) => (b.onclick = () => openLightbox(gallery, +b.dataset.i)));
  }

  const comments = spot.comments || [];
  el.querySelector('#cCount').textContent = comments.length ? `${comments.length}` : '';
  el.querySelector('.comments').innerHTML = comments.length
    ? comments.map((c) => `<div class="story"><div class="story__head"><b>${esc(c.user_name)}</b><span class="muted">${esc((c.created_at || '').slice(0, 10))}</span></div><div class="story__body">${esc(c.body)}</div></div>`).join('')
    : `<p class="muted">${t('comment.empty')}</p>`;
  const cf = el.querySelector('#commentform');
  if (user) {
    cf.innerHTML = `<textarea class="input" id="cBody" rows="2" placeholder="${esc(t('comment.placeholder'))}"></textarea>
      <div class="storyform__row"><button class="btn btn--primary sm" id="cSubmit">${t('comment.post')}</button></div>`;
    cf.querySelector('#cSubmit').onclick = async () => {
      const b = cf.querySelector('#cBody').value.trim();
      if (!b) return;
      await onAddComment(b);
    };
  } else {
    cf.innerHTML = `<p class="muted">${t('comment.loginNeeded')}</p>`;
  }
}

// ---- View-spot create/edit modal ------------------------------------------
export function openViewModal({ mode = 'create', spot, onSearch, onPickLocation, onCancelPick, onSubmit }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const locSet = spot && spot.lat != null;
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head"><h2>${mode === 'edit' ? t('modal.editView') : t('modal.addView')}</h2>
        <button class="detail__close" id="vClose">${icon('x', 16)}</button></div>
      <p class="muted">${t('modal.viewIntro')}</p>
      <form class="cafeform" id="viewForm">
        <div class="field"><span>${t('modal.placeName')} * <small class="muted">${t('view.nameHint')}</small></span>
          <div class="autofill__search">
            <input class="input" name="name" id="vName" placeholder="${t('view.namePlaceholder')}" value="${esc(spot?.name || '')}" autocomplete="off">
            <button type="button" class="btn btn--ghost" id="vSearchBtn">${icon('search', 14)} ${t('modal.search')}</button>
          </div></div>
        <div class="autofill__results" id="vResults"></div>
        <div class="field"><span>${t('modal.location')} *</span>
          <div class="viewloc">
            <span class="viewloc__status ${locSet ? 'is-set' : ''}" id="vLocStatus">${locSet ? t('view.locSet') : t('view.locNone')}</span>
            <button type="button" class="btn btn--ghost sm" id="vPick">${t('modal.pickOnMap')}</button>
          </div>
          <small class="muted" id="vHint"></small>
          <input type="hidden" name="lat" value="${spot ? esc(spot.lat) : ''}">
          <input type="hidden" name="lng" value="${spot ? esc(spot.lng) : ''}"></div>
        <div class="field"><span>${t('modal.photo')} * <small class="muted">${t('modal.photoHint')}</small></span>
          <div class="photo-picker" id="vPicker"></div></div>
        <div class="modal__foot"><span class="err" id="vErr"></span>
          <button type="submit" class="btn btn--primary">${mode === 'edit' ? t('modal.save') : t('modal.submit')}</button></div>
      </form>
    </div>`;
  document.body.appendChild(back);
  const form = back.querySelector('#viewForm');
  const hint = back.querySelector('#vHint');
  const errEl = back.querySelector('#vErr');
  const resultsEl = back.querySelector('#vResults');
  const locStatus = back.querySelector('#vLocStatus');
  const picker = createPhotoPicker(back.querySelector('#vPicker'), {});
  if (spot?.photos?.length) picker.addUrls(spot.photos);
  const close = () => { onCancelPick?.(); back.remove(); };
  back.querySelector('#vClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  const setLoc = (lat, lng, label) => {
    form.elements.lat.value = Number(lat).toFixed(6);
    form.elements.lng.value = Number(lng).toFixed(6);
    locStatus.textContent = label || t('view.locSet');
    locStatus.classList.add('is-set');
  };

  const doSearch = async () => {
    const q = form.elements.name.value.trim();
    if (!q) { errEl.textContent = t('view.needName'); return; }
    errEl.textContent = '';
    resultsEl.innerHTML = `<span class="muted">${t('modal.searching')}</span>`;
    try {
      const { results } = await onSearch(q);
      resultsEl.innerHTML = results.length
        ? results.map((r) => `<button type="button" class="af-result" data-lat="${r.lat}" data-lng="${r.lng}" data-name="${esc(r.name)}">
            <b>${esc(r.name)}</b><div class="muted">${esc(r.address || '')} · ${esc(r.category || '')}</div></button>`).join('')
        : `<span class="muted">${t('modal.noResult')}</span>`;
      resultsEl.querySelectorAll('.af-result').forEach((b) => {
        b.onclick = () => {
          form.elements.name.value = b.dataset.name;
          setLoc(b.dataset.lat, b.dataset.lng, b.dataset.name);
          resultsEl.innerHTML = '';
        };
      });
    } catch (e) { resultsEl.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  back.querySelector('#vSearchBtn').onclick = doSearch;
  back.querySelector('#vName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

  back.querySelector('#vPick').onclick = () => {
    pickLocationFlow(back, { onPickLocation, onCancelPick, onPicked: (lng, lat) => setLoc(lat, lng) });
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    if (!form.elements.name.value.trim()) { errEl.textContent = t('view.needName'); return; }
    if (!form.elements.lat.value || !form.elements.lng.value) { errEl.textContent = t('view.needLoc'); return; }
    const { manifest, files, count } = picker.getManifest();
    if (!count) { errEl.textContent = t('view.needPhoto'); return; }
    const fd = new FormData();
    fd.set('name', form.elements.name.value);
    fd.set('lat', form.elements.lat.value);
    fd.set('lng', form.elements.lng.value);
    fd.set('photo_manifest', JSON.stringify(manifest));
    files.forEach((f) => fd.append('photos', f));
    try { await onSubmit(fd); close(); } catch (err) { errEl.textContent = err.message || '실패'; }
  };
  return { close };
}

// ---- Reusable photo picker (reorderable; first = cover/representative) -----
export function createPhotoPicker(container, { onChange } = {}) {
  let items = []; // { kind:'file'|'url', file?, url?, obj? }
  let dragFrom = null;
  const MAX = 10;
  container.classList.add('photo-picker');

  function move(from, to) {
    if (from == null || from === to || to < 0 || to >= items.length) return;
    const [m] = items.splice(from, 1);
    items.splice(to, 0, m);
    render();
  }
  function render() {
    const tiles = items.map((it, i) => `
      <div class="pp-item ${i === 0 ? 'is-cover' : ''}" data-i="${i}" draggable="true" title="${i === 0 ? t('pp.isCover') : t('pp.makeCover')}">
        <div class="pp-img" style="background-image:url('${it.kind === 'url' ? esc(img(it.url)) : it.obj}')"></div>
        ${i === 0 ? `<span class="pp-cover">${icon('star', 11)} ${t('pp.cover')}</span>` : `<span class="pp-hovercover">${t('pp.makeCoverShort')}</span>`}
        <button type="button" class="pp-del" title="${t('detail.delete')}">${icon('x', 12)}</button>
      </div>`).join('');
    const addTile = items.length < MAX
      ? `<label class="pp-add" title="${t('pp.add')}">${icon('plus', 20)}<input type="file" accept="image/*" multiple hidden></label>`
      : '';
    container.innerHTML = tiles + addTile + `<div class="pp-hint">${items.length ? t('pp.hint') : t('pp.hintEmpty')}</div>`;

    const addInput = container.querySelector('.pp-add input');
    if (addInput) addInput.onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    container.querySelectorAll('.pp-item').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('.pp-del').onclick = (e) => { e.stopPropagation(); items.splice(i, 1); render(); };
      el.addEventListener('click', () => move(i, 0)); // click a photo → make it the cover
      el.addEventListener('dragstart', (e) => { dragFrom = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* */ } });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragFrom = null; });
      el.addEventListener('dragover', (e) => { if (dragFrom != null) { e.preventDefault(); el.classList.add('drop-target'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => { if (dragFrom != null) { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop-target'); move(dragFrom, i); } });
    });
    onChange?.(items.length);
  }
  function addFiles(fileList) {
    for (const f of [...fileList]) { if (items.length >= MAX) break; if (!/^image\//.test(f.type)) continue; items.push({ kind: 'file', file: f, obj: URL.createObjectURL(f) }); }
    render();
  }
  function addUrls(urls) {
    for (const u of urls || []) { if (items.length >= MAX) break; if (!items.some((it) => it.kind === 'url' && it.url === u)) items.push({ kind: 'url', url: u }); }
    render();
  }
  function getManifest() {
    return {
      manifest: items.map((it) => (it.kind === 'file' ? 'file' : `url:${it.url}`)),
      files: items.filter((it) => it.kind === 'file').map((it) => it.file),
      count: items.length,
    };
  }

  // drag image FILES from the desktop onto the whole picker
  container.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); container.classList.add('pp-filedrop'); }
  });
  container.addEventListener('dragleave', (e) => { if (e.target === container) container.classList.remove('pp-filedrop'); });
  container.addEventListener('drop', (e) => {
    container.classList.remove('pp-filedrop');
    if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
  });

  render();
  return { addFiles, addUrls, getManifest, get count() { return items.length; } };
}

// ---- Add-cafe modal -------------------------------------------------------
// Flow: human enters name + Naver/Kakao links → "카카오 링크로 가져오기" fetches
// location / photos / hours / americano price / AI review summary → human edits
// the rest (floors/size/outlets/view) and saves. No fake links are generated.
export function openAddCafeModal(opts) {
  const { user, capabilities, onSearch, onEnrich, onPickLocation, onCancelPick, onSubmit } = opts;
  const canFetch = user?.isAdmin && capabilities?.kakao;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h2>${t('modal.addCafe')}</h2>
        <button class="detail__close" id="mClose">${icon('x', 16)}</button>
      </div>

      <form class="cafeform" id="cafeForm">
        <div class="formsec">
          <div class="formsec__title">1. ${t('modal.find')}</div>
          <input type="hidden" name="kakao_place_id">
          <input type="hidden" name="hours_json">
          ${canFetch ? `
          <div class="field"><span>${t('modal.searchByName')} <small class="muted">${t('modal.searchHint')}</small></span>
            <div class="autofill__search">
              <input class="input" id="afQuery" placeholder="Blue Bottle Seongsu" autocomplete="off">
              <button type="button" class="btn btn--primary" id="afSearchBtn">${icon('search', 14)} ${t('modal.search')}</button>
            </div>
          </div>
          <div class="autofill__results" id="afResults"></div>
          <div class="fetch-status" id="fetchStatus" hidden></div>
          <details class="manual">
            <summary>${t('modal.manual')}</summary>
            <label class="field"><span>${t('modal.name')} *</span><input class="input" name="name"></label>
            <label class="field"><span>${t('modal.kakaoLink')} *</span>
              <div class="autofill__search"><input class="input" name="kakao_url" placeholder="https://place.map.kakao.com/...">
                <button type="button" class="btn btn--ghost" id="fetchBtn">${t('modal.fetch')}</button></div></label>
            <label class="field"><span>${t('modal.naverLink')}</span><input class="input" name="naver_url"></label>
          </details>` : `
          <label class="field"><span>${t('modal.name')} *</span><input class="input" name="name" required></label>
          <label class="field"><span>${t('modal.kakaoLink')} *</span>
            <input class="input" name="kakao_url" placeholder="https://place.map.kakao.com/..."></label>
          <label class="field"><span>${t('modal.naverLink')}</span>
            <input class="input" name="naver_url"></label>`}
        </div>

        <div class="formsec">
          <div class="formsec__title">2. ${t('modal.fetched')}</div>
          <label class="field"><span>${t('modal.address')}</span>
            <input class="input" name="address"></label>

          <div class="field">
            <span>${t('modal.location')} *</span>
            <div class="loc-row">
              <input class="input" name="lat" readonly required>
              <input class="input" name="lng" readonly required>
              <button type="button" class="btn btn--ghost" id="pickBtn">${t('modal.pickOnMap')}</button>
            </div>
            <small class="muted" id="pickHint"></small>
          </div>

          <div class="field"><span>${t('modal.photo')} * <small class="muted">${t('modal.photoHint')}</small></span>
            <div class="photo-picker" id="photoPicker"></div>
          </div>

          <div class="grid2">
            <label class="field"><span>${t('modal.open')} *</span>
              <input class="input" type="time" name="open_time" value="09:00" required></label>
            <label class="field"><span>${t('modal.close')} *</span>
              <input class="input" type="time" name="close_time" value="22:00" required></label>
            <label class="field"><span>${t('modal.price')} *</span>
              <input class="input" type="number" name="iced_americano_price" min="0" step="100" value="4500" required></label>
          </div>

          <label class="field"><span>${t('modal.aiSummary')} <small class="muted">(${t('modal.editable')})</small></span>
            <textarea class="input" name="review_summary" rows="3"></textarea></label>
        </div>

        <div class="formsec">
          <div class="formsec__title">3. ${t('modal.judge')}</div>
          <div class="grid2">
            <label class="field"><span>${t('modal.floors')} * <span class="info" title="${esc(def('floors'))}">${icon('info', 12)}</span></span>
              <input class="input" type="number" name="floors" min="1" value="1" required></label>
            <label class="field"><span>${t('modal.area')} * <span class="info" title="${esc(def('size'))}">${icon('info', 12)}</span></span>
              <select class="input" name="size" required>
                <option value="small">${t('size.small')}</option>
                <option value="medium" selected>${t('size.medium')}</option>
                <option value="large">${t('size.large')}</option>
              </select></label>
            <label class="field"><span>${t('modal.outlet')} * <span class="info" title="${esc(def('outlets'))}">${icon('info', 12)}</span></span>
              <select class="input" name="outlets" required>
                <option value="many">${t('outlet.many')}</option>
                <option value="some" selected>${t('outlet.some')}</option>
                <option value="few">${t('outlet.few')}</option>
                <option value="none">${t('outlet.none')}</option>
              </select></label>
          </div>
          <label class="field checkline"><input type="checkbox" name="has_view"> <span>${t('modal.viewGood')} <span class="info" title="${esc(def('view'))}">${icon('info', 12)}</span></span></label>
          <label class="field"><span>${t('modal.viewNote')}</span>
            <input class="input" name="view_note"></label>
        </div>

        <div class="modal__foot">
          <span class="err" id="formErr"></span>
          <button type="submit" class="btn btn--primary">${t('modal.submit')}</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(back);
  const form = back.querySelector('#cafeForm');
  const hint = back.querySelector('#pickHint');
  const errEl = back.querySelector('#formErr');
  const picker = createPhotoPicker(back.querySelector('#photoPicker'), {});

  const close = () => { onCancelPick?.(); back.remove(); };
  back.querySelector('#mClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  back.querySelector('#pickBtn').onclick = () => {
    pickLocationFlow(back, {
      onPickLocation, onCancelPick,
      onPicked: (lng, lat) => {
        form.elements.lat.value = lat.toFixed(6);
        form.elements.lng.value = lng.toFixed(6);
        hint.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      },
    });
  };

  function applyFetched(data) {
    const f = data.fetched || {};
    form.elements.kakao_place_id.value = data.placeId || '';
    if (f.kakao_place_url) form.elements.kakao_url.value = f.kakao_place_url; // canonical real link
    if (f.address) form.elements.address.value = f.address;
    if (f.lat != null && f.lng != null) {
      form.elements.lat.value = Number(f.lat).toFixed(6);
      form.elements.lng.value = Number(f.lng).toFixed(6);
      hint.textContent = `카카오에서 위치 가져옴: ${Number(f.lat).toFixed(5)}, ${Number(f.lng).toFixed(5)}`;
    }
    if (f.open_time) form.elements.open_time.value = f.open_time;
    if (f.close_time) form.elements.close_time.value = f.close_time === '24:00' ? '00:00' : f.close_time;
    if (f.hours_json) form.elements.hours_json.value = f.hours_json; // per-weekday schedule
    if (f.iced_americano_price) form.elements.iced_americano_price.value = f.iced_americano_price;
    if (data.review_summary) form.elements.review_summary.value = data.review_summary;

    picker.addUrls((f.photos || []).slice(0, 8)); // add fetched photos to the picker (reorderable)

    const st = back.querySelector('#fetchStatus');
    st.hidden = false;
    const km = f.iced_americano_price ? `${f.americano_menu_name || '아메리카노'} ${Number(f.iced_americano_price).toLocaleString('ko-KR')}원` : '';
    st.innerHTML = `
      <div class="ai-summary">${icon('ai', 14)} ${esc(data.review_summary || '리뷰 요약 없음')}</div>
      ${(data.keywords||[]).length ? `<div class="kw">${data.keywords.map((k)=>`<span class="kw__t">#${esc(k)}</span>`).join('')}</div>` : ''}
      <div class="muted">카카오 평점 ${f.rating ?? '?'} · 리뷰 ${f.review_count ?? 0}개 ${km ? '· '+esc(km) : ''}
        ${(f.strengths||[]).slice(0,4).map((s)=>`${esc(s.name)}(${s.count})`).join(' ')}</div>
      ${data.aiError ? `<div class="ai-note">AI 요약 실패: ${esc(data.aiError)}</div>` : ''}
      <div class="ai-warn">${icon('info', 13)} 가져온 값 확인 후 층수/면적/콘센트/뷰는 직접 채워주세요.</div>`;
  }

  if (canFetch) {
    const fetchBtn = back.querySelector('#fetchBtn');
    const statusEl = back.querySelector('#fetchStatus');
    const doFetch = async () => {
      const kakaoUrl = form.elements.kakao_url.value.trim();
      if (!kakaoUrl) { errEl.textContent = '카카오 지도 링크를 먼저 입력하세요.'; return; }
      errEl.textContent = '';
      fetchBtn.disabled = true;
      statusEl.hidden = false;
      statusEl.innerHTML = '<span class="muted">카카오 상세 + AI 요약 가져오는 중… (몇 초)</span>';
      try {
        const data = await onEnrich({ kakaoUrl });
        applyFetched(data);
      } catch (e) {
        statusEl.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      } finally {
        fetchBtn.disabled = false;
      }
    };
    fetchBtn.onclick = doFetch;

    // primary flow: search by name → pick a candidate → fill name+link → AI enrich
    const qEl = back.querySelector('#afQuery');
    const resultsEl = back.querySelector('#afResults');
    const doSearch = async () => {
      const q = qEl.value.trim();
      if (!q) return;
      resultsEl.innerHTML = '<span class="muted">검색 중…</span>';
      try {
        const { results } = await onSearch(q);
        resultsEl.innerHTML = results.length
          ? results.map((r) => `
            <button type="button" class="af-result" data-url="${esc(r.place_url)}" data-name="${esc(r.name)}">
              <b>${esc(r.name)}</b> ${r.isCafe ? '' : '<span class="muted">· 카페아님?</span>'}
              <div class="muted">${esc(r.address || '')} · ${esc(r.category || '')}</div>
            </button>`).join('')
          : '<span class="muted">결과 없음</span>';
        resultsEl.querySelectorAll('.af-result').forEach((b) => {
          b.onclick = () => {
            form.elements.name.value = b.dataset.name;
            form.elements.kakao_url.value = b.dataset.url;
            resultsEl.innerHTML = `<div class="muted">선택됨: <b>${esc(b.dataset.name)}</b> — 정보 가져오는 중…</div>`;
            doFetch();
          };
        });
      } catch (e) {
        resultsEl.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      }
    };
    back.querySelector('#afSearchBtn').onclick = doSearch;
    qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    if (!form.elements.name.value.trim()) { errEl.textContent = '카페를 검색해 선택하거나 이름을 입력하세요.'; return; }
    if (!form.elements.kakao_url.value.trim() && !form.elements.naver_url.value.trim()) { errEl.textContent = t('modal.needLink'); return; }
    if (!form.elements.lat.value || !form.elements.lng.value) { errEl.textContent = '위치를 가져오거나 지도에서 선택하세요.'; return; }
    const { manifest, files, count } = picker.getManifest();
    if (!count) { errEl.textContent = '사진을 한 장 이상 추가하세요 (첫 번째가 대표).'; return; }

    const fd = new FormData(form);
    fd.set('has_view', form.elements.has_view.checked ? 'true' : 'false');
    fd.set('photo_manifest', JSON.stringify(manifest));
    files.forEach((f) => fd.append('photos', f));
    try {
      await onSubmit(fd);
      close();
    } catch (err) {
      errEl.textContent = err.message || '등록 실패';
    }
  };

  return { close };
}
