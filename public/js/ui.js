import {
  SIZE_LABEL, OUTLET_LABEL, DEFS, won, hoursText, isOpenNow, weeklyHours, esc, img, haversineKm,
} from './util.js';
import { icon } from './icons.js';

const VOTE_CATS = [
  { key: 'coffee', label: '커피맛', icon: 'coffee', def: DEFS.coffee },
  { key: 'quiet', label: '조용함', icon: 'quiet', def: DEFS.quiet },
  { key: 'restroom', label: '화장실 청결', icon: 'clean', def: DEFS.restroom },
];

function stars(avg) {
  if (avg == null) return '<span class="muted">평가 없음</span>';
  return `<b>${avg.toFixed(1)}</b> / 5`;
}

// ---- Auth bar -------------------------------------------------------------
export function renderAuth(el, me, { onLogout, onGoogleCredential, onLocalLogin, onRegister, onEditName }) {
  el.innerHTML = '';
  if (me.user) {
    const wrap = document.createElement('div');
    wrap.className = 'authbar';
    const badge = me.user.isAdmin ? '<span class="admin-badge">관리자</span>' : '';
    wrap.innerHTML = `<span class="authbar__who">${icon('user', 15)} <span class="authbar__name" id="editNameBtn" title="닉네임 변경">${esc(me.user.name)}</span> ${badge}</span>
      <button class="btn btn--ghost" id="logoutBtn" title="로그아웃">${icon('logout', 15)}</button>`;
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
    or.textContent = '또는 아이디로 로그인';
    box.appendChild(or);
  }

  const form = document.createElement('form');
  form.className = 'loginform';
  form.innerHTML = `
    <input class="input" name="username" placeholder="아이디" autocomplete="username">
    <input class="input" name="password" type="password" placeholder="비밀번호" autocomplete="current-password">
    <div class="loginform__row">
      <button type="submit" class="btn btn--primary" id="loginBtn">로그인</button>
      <button type="button" class="btn btn--ghost" id="registerBtn">회원가입</button>
    </div>
    <div class="err" id="loginErr"></div>`;
  const errEl = form.querySelector('#loginErr');
  const creds = () => ({ u: form.elements.username.value.trim(), p: form.elements.password.value });
  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const { u, p } = creds();
    if (!u || !p) { errEl.textContent = '아이디와 비밀번호를 입력하세요.'; return; }
    try { await onLocalLogin(u, p); } catch (err) { errEl.textContent = err.message; }
  };
  form.querySelector('#registerBtn').onclick = async () => {
    errEl.textContent = '';
    const { u, p } = creds();
    if (!u || !p) { errEl.textContent = '가입할 아이디와 비밀번호(4자+)를 입력하세요.'; return; }
    try { await onRegister(u, p); } catch (err) { errEl.textContent = err.message; }
  };
  box.appendChild(form);
  el.appendChild(box);
}

// ---- Admin pending queue --------------------------------------------------
export function renderPendingQueue(el, cafes, { onApprove, onReject, onOpen }) {
  if (!cafes.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="pending-queue__title">${icon('shield', 14)} 심사 대기 <b>${cafes.length}</b></div>`;
  for (const c of cafes) {
    const row = document.createElement('div');
    row.className = 'pending-item';
    row.innerHTML = `
      <button type="button" class="pending-item__name" title="상세 보기">${esc(c.name)}</button>
      <div class="pending-item__reason">${esc(c.moderation_reason || '사유 미기재')}</div>
      <div class="pending-item__actions">
        <button class="btn btn--primary pill sm" data-a="ok">승인</button>
        <button class="btn btn--ghost pill sm" data-a="no">거절</button>
      </div>`;
    row.querySelector('.pending-item__name').onclick = () => onOpen(c.id);
    row.querySelector('[data-a="ok"]').onclick = () => onApprove(c.id);
    row.querySelector('[data-a="no"]').onclick = () => { if (confirm(`'${c.name}' 거절(삭제)할까요?`)) onReject(c.id); };
    el.appendChild(row);
  }
}

// ---- Detail panel ---------------------------------------------------------
export function renderDetail(el, cafe, { user, onVote, onAddReview, onClose, onEdit }) {
  const openNow = isOpenNow(cafe);
  const floorTxt = cafe.multi_floor ? `${cafe.floors}층 (다층)` : '단층';
  const viewTxt = cafe.has_view ? (cafe.view_note ? `뷰 좋음 · ${esc(cafe.view_note)}` : '뷰 좋음') : '뷰 별로';

  const gallery = (cafe.gallery && cafe.gallery.length) ? cafe.gallery : [cafe.photo_url].filter(Boolean);

  el.innerHTML = `
    <button class="detail__close" title="닫기">${icon('x', 16)}</button>
    <div class="detail__scroll">
      <div class="detail__hero">
        <div class="carousel__img" id="carImg"></div>
        ${gallery.length > 1 ? `
          <button class="carousel__nav prev" id="carPrev" aria-label="이전">${icon('chevronLeft', 22)}</button>
          <button class="carousel__nav next" id="carNext" aria-label="다음">${icon('chevronRight', 22)}</button>
          <div class="carousel__count" id="carCount"></div>` : ''}
        <div class="detail__scorebig" title="카공 종합점수">${cafe.score}<small>SCORE</small></div>
      </div>
      <div class="detail__body">
        <h2 class="detail__name">${esc(cafe.name)}</h2>
        <div class="detail__addr">${esc(cafe.address || '')}</div>
        ${cafe.status === 'pending' ? `<div class="detail__pending">${icon('shield', 14)} 심사 대기중 <span class="muted">— ${esc(cafe.moderation_reason || '관리자 확인 필요')}</span></div>` : ''}
        ${user?.isAdmin ? `<div class="detail__adminrow"><button class="btn btn--ghost sm" id="editCafeBtn">${icon('edit', 14)} 수정</button>${cafe.status === 'pending' ? '<button class="btn btn--primary sm" id="approveCafeBtn">승인</button>' : ''}</div>` : ''}

        <div class="detail__hoursrow">
          <button class="detail__hours ${openNow ? 'is-open' : 'is-closed'}" id="hoursToggle" ${weeklyHours(cafe) ? '' : 'disabled'}>
            <span class="dot"></span>${openNow ? 'OPEN NOW' : 'CLOSED'} · ${esc(hoursText(cafe))}${weeklyHours(cafe) ? ` ${icon('chevronDown', 12)}` : ''}
          </button>
          ${weeklyHours(cafe) ? `<div class="weekhours" id="weekHours" hidden>${weeklyHours(cafe).map((d) => `<div class="weekhours__row ${d.isToday ? 'is-today' : ''}"><span>${d.label}</span><span>${esc(d.text)}</span></div>`).join('')}</div>` : ''}
        </div>

        <div class="chips">
          <span class="chip" title="${esc(DEFS.floors)}">${icon('floors', 14)} ${esc(floorTxt)}</span>
          <span class="chip" title="${esc(DEFS.size)}">${icon('size', 14)} ${SIZE_LABEL[cafe.size] || cafe.size}</span>
          <span class="chip" title="${esc(DEFS.outlets)}">${icon('outlet', 14)} 콘센트 ${OUTLET_LABEL[cafe.outlets] || cafe.outlets}</span>
          <span class="chip" title="${esc(DEFS.view)}">${icon('view', 14)} ${esc(viewTxt)}</span>
          <span class="chip" title="${esc(DEFS.price)}">${icon('price', 14)} 아메리카노 ${won(cafe.iced_americano_price)}</span>
        </div>

        <div class="detail__links">
          ${cafe.naver_url ? `<a class="btn btn--map naver" href="${esc(cafe.naver_url)}" target="_blank" rel="noopener">네이버 지도</a>` : ''}
          ${cafe.kakao_url ? `<a class="btn btn--map kakao" href="${esc(cafe.kakao_url)}" target="_blank" rel="noopener">카카오 지도</a>` : ''}
        </div>

        ${cafe.review_summary ? `<div class="detail__aisum"><div class="detail__aisum-h">${icon('ai', 15)} <b>리뷰 요약</b></div><p>${esc(cafe.review_summary)}</p></div>` : ''}

        <h3 class="detail__h3">집단지성 평가 <small>1–5</small></h3>
        <div class="votes"></div>

        <h3 class="detail__h3">이야기 <small class="muted" id="revCount"></small></h3>
        <div class="storyform" id="storyform"></div>
        <div class="stories"></div>

        <h3 class="detail__h3">동네 토크 <small>${icon('gps', 12)} GPS 1KM 이내만 참여</small></h3>
        <div class="chat" id="chatBox"></div>
      </div>
    </div>`;

  el.querySelector('.detail__close').onclick = onClose;
  el.querySelector('#editCafeBtn')?.addEventListener('click', () => onEdit?.('edit'));
  el.querySelector('#approveCafeBtn')?.addEventListener('click', () => onEdit?.('approve'));
  el.querySelector('#hoursToggle')?.addEventListener('click', () => {
    const w = el.querySelector('#weekHours'); if (w) w.hidden = !w.hidden;
  });

  // photo carousel (representative + all story photos)
  let ci = 0;
  const carImg = el.querySelector('#carImg');
  const carCount = el.querySelector('#carCount');
  const showImg = () => {
    carImg.style.backgroundImage = `url('${esc(img(gallery[ci] || ''))}')`;
    if (carCount) carCount.textContent = `${ci + 1} / ${gallery.length}`;
  };
  showImg();
  el.querySelector('#carPrev')?.addEventListener('click', () => { ci = (ci - 1 + gallery.length) % gallery.length; showImg(); });
  el.querySelector('#carNext')?.addEventListener('click', () => { ci = (ci + 1) % gallery.length; showImg(); });

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
          <span class="vote__label">${icon(cat.icon)} ${cat.label}
            <span class="info" title="${esc(cat.def)}">${icon('info', 13)}</span></span>
          <span class="vote__avg">${stars(avg)} <span class="muted">(${n})</span></span>
        </div>
        <div class="vote__stars" role="group" aria-label="${cat.label} 투표">
          ${[1, 2, 3, 4, 5].map((v) =>
            `<button class="star ${mine >= v ? 'on' : ''}" data-v="${v}" aria-label="${v}점">${icon('star', 22)}</button>`).join('')}
        </div>`;
      row.querySelectorAll('.star').forEach((b) => {
        b.onclick = async () => {
          if (!user) return alert('투표하려면 로그인이 필요합니다.');
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
      <textarea class="input" id="stBody" rows="3" placeholder="이 카페에 얽힌 이야기를 자유롭게 남겨보세요. 사진도 여러 장 올릴 수 있어요."></textarea>
      <div class="photo-picker" id="stPicker"></div>
      <div class="storyform__row">
        <button class="btn btn--primary sm" id="stSubmit">올리기</button>
      </div>`;
    const stPicker = createPhotoPicker(formEl.querySelector('#stPicker'), {});
    formEl.querySelector('#stSubmit').onclick = async () => {
      const body = formEl.querySelector('#stBody').value.trim();
      const { files, count } = stPicker.getManifest();
      if (!body && !count) return alert('이야기나 사진을 올려주세요.');
      const fd = new FormData();
      fd.append('body', body);
      files.forEach((f) => fd.append('photos', f));
      const btn = formEl.querySelector('#stSubmit');
      btn.disabled = true; btn.textContent = '올리는 중…';
      try { await onAddReview(fd); } finally { btn.disabled = false; btn.textContent = '올리기'; }
    };
  } else {
    formEl.innerHTML = `<p class="muted">이야기를 남기려면 로그인하세요.</p>`;
  }
}

// ---- Admin edit modal (curate any cafe's fields) --------------------------
export function openEditCafeModal(cafe, { onSave }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const sel = (v, o) => (v === o ? 'selected' : '');
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head"><h2>카페 수정</h2><button class="detail__close" id="eClose">${icon('x', 16)}</button></div>
      <form class="cafeform" id="editForm">
        <label class="field"><span>이름</span><input class="input" name="name" value="${esc(cafe.name)}"></label>
        <label class="field"><span>주소</span><input class="input" name="address" value="${esc(cafe.address || '')}"></label>
        <label class="field"><span>대표사진 URL</span><input class="input" name="photo_url" value="${esc(cafe.photo_url || '')}"></label>
        <div class="grid2">
          <label class="field"><span>층수 (다층이면 2+) <span class="info" title="${esc(DEFS.floors)}">${icon('info', 12)}</span></span><input class="input" type="number" min="1" name="floors" value="${esc(cafe.floors)}"></label>
          <label class="field"><span>면적 <span class="info" title="${esc(DEFS.size)}">${icon('info', 12)}</span></span><select class="input" name="size">
            <option value="small" ${sel(cafe.size, 'small')}>소형 (5개 이하)</option>
            <option value="medium" ${sel(cafe.size, 'medium')}>중형 (6–15)</option>
            <option value="large" ${sel(cafe.size, 'large')}>대형 (16+)</option></select></label>
          <label class="field"><span>콘센트 <span class="info" title="${esc(DEFS.outlets)}">${icon('info', 12)}</span></span><select class="input" name="outlets">
            <option value="many" ${sel(cafe.outlets, 'many')}>대부분 있음</option>
            <option value="some" ${sel(cafe.outlets, 'some')}>일부 있음</option>
            <option value="few" ${sel(cafe.outlets, 'few')}>드물게 있음</option>
            <option value="none" ${sel(cafe.outlets, 'none')}>없음</option></select></label>
          <label class="field"><span>아이스아메리카노(원)</span><input class="input" type="number" min="0" step="100" name="iced_americano_price" value="${esc(cafe.iced_americano_price)}"></label>
          <label class="field"><span>오픈</span><input class="input" type="time" name="open_time" value="${esc(cafe.open_time)}"></label>
          <label class="field"><span>마감</span><input class="input" type="time" name="close_time" value="${esc(cafe.close_time === '00:00' ? '00:00' : cafe.close_time)}"></label>
        </div>
        <label class="field checkline"><input type="checkbox" name="has_view" ${cafe.has_view ? 'checked' : ''}> <span>뷰 좋음</span></label>
        <label class="field"><span>뷰 설명</span><input class="input" name="view_note" value="${esc(cafe.view_note || '')}"></label>
        <div class="grid2">
          <label class="field"><span>네이버 링크</span><input class="input" name="naver_url" value="${esc(cafe.naver_url || '')}"></label>
          <label class="field"><span>카카오 링크</span><input class="input" name="kakao_url" value="${esc(cafe.kakao_url || '')}"></label>
        </div>
        <label class="field"><span>리뷰 요약</span><textarea class="input" rows="2" name="review_summary">${esc(cafe.review_summary || '')}</textarea></label>
        <div class="modal__foot"><span class="err" id="eErr"></span><button type="submit" class="btn btn--primary">저장</button></div>
      </form>
    </div>`;
  document.body.appendChild(back);
  const form = back.querySelector('#editForm');
  const close = () => back.remove();
  back.querySelector('#eClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const patch = {
      name: form.elements.name.value, address: form.elements.address.value, photo_url: form.elements.photo_url.value,
      floors: form.elements.floors.value, size: form.elements.size.value, outlets: form.elements.outlets.value,
      iced_americano_price: form.elements.iced_americano_price.value, open_time: form.elements.open_time.value,
      close_time: form.elements.close_time.value, has_view: form.elements.has_view.checked,
      view_note: form.elements.view_note.value, naver_url: form.elements.naver_url.value,
      kakao_url: form.elements.kakao_url.value, review_summary: form.elements.review_summary.value,
    };
    try { await onSave(patch); close(); }
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
      msgsEl.innerHTML = '<div class="muted chat__empty">아직 대화가 없어요. 이 근처라면 첫 메시지를 남겨보세요.</div>';
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
    if (!user) { gateEl.innerHTML = '<div class="muted">참여하려면 로그인하세요.</div>'; return; }
    if (verified) {
      gateEl.innerHTML = `
        <div class="chat__input">
          <input class="input" id="chatInput" placeholder="메시지 입력 (1km 인증됨)" maxlength="500">
          <button class="btn btn--primary pill sm" id="chatSend">전송</button>
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
        <button class="btn btn--ghost pill sm" id="chatVerify">${icon('gps', 14)} 1km 이내 인증하고 참여</button>
        <div class="chat__err" id="chatErr"></div>`;
      gateEl.querySelector('#chatVerify').onclick = verify;
    }
  }

  function verify() {
    const errEl = gateEl.querySelector('#chatErr');
    if (!navigator.geolocation) { errEl.textContent = '이 기기는 위치 정보를 지원하지 않아요.'; return; }
    errEl.textContent = '위치 확인 중…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const km = haversineKm(lat, lng, cafe.lat, cafe.lng);
        if (km <= 1.0) { verified = { lat, lng }; renderGate(); }
        else errEl.textContent = `카페에서 ${km.toFixed(1)}km 떨어져 있어요. 1km 이내에서 참여할 수 있어요.`;
      },
      () => { errEl.textContent = '위치 권한이 필요해요.'; },
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
    : `<p class="muted">아직 이야기가 없어요. 첫 이야기를 남겨보세요!</p>`;
}

// ---- Reusable photo picker (reorderable; first = cover/representative) -----
export function createPhotoPicker(container, { onChange } = {}) {
  let items = []; // { kind:'file'|'url', file?, url?, obj? }
  const MAX = 10;
  function render() {
    container.innerHTML = items.map((it, i) => `
      <div class="pp-item ${i === 0 ? 'is-cover' : ''}" data-i="${i}">
        <div class="pp-img" style="background-image:url('${it.kind === 'url' ? esc(img(it.url)) : it.obj}')"></div>
        ${i === 0 ? '<span class="pp-cover">대표</span>' : ''}
        <div class="pp-ops">
          <button type="button" data-op="left" title="앞으로" ${i === 0 ? 'disabled' : ''}>${icon('chevronLeft', 12)}</button>
          <button type="button" data-op="right" title="뒤로" ${i === items.length - 1 ? 'disabled' : ''}>${icon('chevronRight', 12)}</button>
          <button type="button" data-op="del" title="삭제">${icon('x', 12)}</button>
        </div>
      </div>`).join('') +
      (items.length < MAX ? `<label class="pp-add" title="사진 추가">${icon('plus', 20)}<input type="file" accept="image/*" multiple hidden></label>` : '');

    const addInput = container.querySelector('.pp-add input');
    if (addInput) addInput.onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    container.querySelectorAll('.pp-item').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('[data-op="left"]').onclick = () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } };
      el.querySelector('[data-op="right"]').onclick = () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } };
      el.querySelector('[data-op="del"]').onclick = () => { items.splice(i, 1); render(); };
    });
    onChange?.(items.length);
  }
  function addFiles(fileList) {
    for (const f of [...fileList]) { if (items.length >= MAX) break; items.push({ kind: 'file', file: f, obj: URL.createObjectURL(f) }); }
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
        <h2>카페 등록</h2>
        <button class="detail__close" id="mClose">${icon('x', 16)}</button>
      </div>

      <form class="cafeform" id="cafeForm">
        <div class="formsec">
          <div class="formsec__title">1. 카페 찾기</div>
          <input type="hidden" name="kakao_place_id">
          <input type="hidden" name="hours_json">
          ${canFetch ? `
          <div class="field"><span>카페 이름으로 검색 <small class="muted">→ 후보 선택 시 AI가 자동으로 채웁니다</small></span>
            <div class="autofill__search">
              <input class="input" id="afQuery" placeholder="예) 블루보틀 성수" autocomplete="off">
              <button type="button" class="btn btn--primary" id="afSearchBtn">${icon('search', 14)} 검색</button>
            </div>
          </div>
          <div class="autofill__results" id="afResults"></div>
          <div class="fetch-status" id="fetchStatus" hidden></div>
          <details class="manual">
            <summary>직접 입력 / 링크 붙여넣기</summary>
            <label class="field"><span>카페 이름 *</span><input class="input" name="name"></label>
            <label class="field"><span>카카오 지도 링크 *</span>
              <div class="autofill__search"><input class="input" name="kakao_url" placeholder="https://place.map.kakao.com/... 또는 공유 링크">
                <button type="button" class="btn btn--ghost" id="fetchBtn">가져오기</button></div></label>
            <label class="field"><span>네이버 지도 링크 <small class="muted">(선택)</small></span><input class="input" name="naver_url"></label>
          </details>` : `
          <label class="field"><span>카페 이름 *</span><input class="input" name="name" required></label>
          <label class="field"><span>카카오 지도 링크 * <small class="muted">(실제 장소 링크)</small></span>
            <input class="input" name="kakao_url" placeholder="https://place.map.kakao.com/..."></label>
          <label class="field"><span>네이버 지도 링크 <small class="muted">(선택)</small></span>
            <input class="input" name="naver_url"></label>`}
        </div>

        <div class="formsec">
          <div class="formsec__title">2. 가져온 정보 (수정 가능)</div>
          <label class="field"><span>주소</span>
            <input class="input" name="address" placeholder="예) 서울 성동구 성수동"></label>

          <div class="field">
            <span>위치 * <small class="muted">(가져오기 또는 지도 클릭)</small></span>
            <div class="loc-row">
              <input class="input" name="lat" placeholder="위도" readonly required>
              <input class="input" name="lng" placeholder="경도" readonly required>
              <button type="button" class="btn btn--ghost" id="pickBtn">지도에서 선택</button>
            </div>
            <small class="muted" id="pickHint"></small>
          </div>

          <div class="field"><span>사진 * <small class="muted">(첫 번째가 대표사진 · 화살표로 순서 변경)</small></span>
            <div class="photo-picker" id="photoPicker"></div>
          </div>

          <div class="grid2">
            <label class="field"><span>오픈 *</span>
              <input class="input" type="time" name="open_time" value="09:00" required></label>
            <label class="field"><span>마감 *</span>
              <input class="input" type="time" name="close_time" value="22:00" required></label>
            <label class="field"><span>아이스 아메리카노 가격(원) *</span>
              <input class="input" type="number" name="iced_americano_price" min="0" step="100" value="4500" required></label>
          </div>

          <label class="field"><span>리뷰 AI 요약 <small class="muted">(수정 가능)</small></span>
            <textarea class="input" name="review_summary" rows="3" placeholder="카카오 리뷰를 AI가 요약해줍니다."></textarea></label>
        </div>

        <div class="formsec">
          <div class="formsec__title">3. 직접 판단 (카공 핵심)</div>
          <div class="grid2">
            <label class="field"><span>층수 * <span class="info" title="${esc(DEFS.floors)}">${icon('info', 12)}</span></span>
              <input class="input" type="number" name="floors" min="1" value="1" required></label>
            <label class="field"><span>면적 * <span class="info" title="${esc(DEFS.size)}">${icon('info', 12)}</span></span>
              <select class="input" name="size" required>
                <option value="small">소형 (테이블 5개 이하)</option>
                <option value="medium" selected>중형 (테이블 6–15)</option>
                <option value="large">대형 (16개 이상)</option>
              </select></label>
            <label class="field"><span>콘센트 * <span class="info" title="${esc(DEFS.outlets)}">${icon('info', 12)}</span></span>
              <select class="input" name="outlets" required>
                <option value="many">대부분 있음</option>
                <option value="some" selected>일부 있음</option>
                <option value="few">드물게 있음</option>
                <option value="none">없음</option>
              </select></label>
          </div>
          <label class="field checkline"><input type="checkbox" name="has_view"> <span>뷰가 좋은 편이에요 <span class="info" title="${esc(DEFS.view)}">${icon('info', 12)}</span></span></label>
          <label class="field"><span>뷰 설명 (선택)</span>
            <input class="input" name="view_note" placeholder="예) 2층 창가 한강 방향"></label>
        </div>

        <div class="modal__foot">
          <span class="err" id="formErr"></span>
          <button type="submit" class="btn btn--primary">등록하기</button>
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
    hint.textContent = '지도를 클릭해 위치를 지정하세요...';
    onPickLocation((lng, lat) => {
      form.elements.lat.value = lat.toFixed(6);
      form.elements.lng.value = lng.toFixed(6);
      hint.textContent = `선택됨: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
    if (!form.elements.kakao_url.value.trim()) { errEl.textContent = '카카오 지도 링크는 필수입니다.'; return; }
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
