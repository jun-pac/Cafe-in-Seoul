import {
  SIZE_LABEL, OUTLET_LABEL, won, hoursText, isOpenNow, esc,
} from './util.js';

const VOTE_CATS = [
  { key: 'coffee', label: '커피맛', icon: '☕' },
  { key: 'quiet', label: '조용함', icon: '🔇' },
  { key: 'restroom', label: '화장실 청결', icon: '🚻' },
];

function stars(avg) {
  if (avg == null) return '<span class="muted">평가 없음</span>';
  return `<b>${avg.toFixed(1)}</b> / 5`;
}

// ---- Auth bar -------------------------------------------------------------
export function renderAuth(el, me, { onLogout, onGoogleCredential, onLocalLogin, onRegister }) {
  el.innerHTML = '';
  if (me.user) {
    const wrap = document.createElement('div');
    wrap.className = 'authbar';
    const badge = me.user.isAdmin ? '<span class="admin-badge">관리자</span>' : '';
    wrap.innerHTML = `<span class="authbar__who">👤 ${esc(me.user.name)} ${badge}</span>
      <button class="btn btn--ghost" id="logoutBtn">로그아웃</button>`;
    wrap.querySelector('#logoutBtn').onclick = onLogout;
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
  const creds = () => ({ u: form.username.value.trim(), p: form.password.value });
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
  el.innerHTML = `<div class="pending-queue__title">🛡️ 심사 대기 <b>${cafes.length}</b></div>`;
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
export function renderDetail(el, cafe, { user, onVote, onAddReview, onClose }) {
  const openNow = isOpenNow(cafe);
  const floorTxt = cafe.multi_floor ? `${cafe.floors}층 (다층)` : '단층';
  const viewTxt = cafe.has_view ? (cafe.view_note ? `뷰 좋음 · ${esc(cafe.view_note)}` : '뷰 좋음') : '뷰 별로';

  el.innerHTML = `
    <button class="detail__close" title="닫기">✕</button>
    <div class="detail__hero" style="background-image:url('${esc(cafe.photo_url)}')">
      <div class="detail__scorebig" title="카공 종합점수">${cafe.score}<small>점</small></div>
    </div>
    <div class="detail__body">
      <h2 class="detail__name">${esc(cafe.name)}</h2>
      <div class="detail__addr">${esc(cafe.address || '')}</div>
      ${cafe.status === 'pending' ? `<div class="detail__pending">🛡️ 심사 대기중 <span class="muted">— ${esc(cafe.moderation_reason || '관리자 확인 필요')}</span></div>` : ''}

      <div class="detail__hours ${openNow ? 'is-open' : 'is-closed'}">
        <span class="dot"></span>${openNow ? '영업중' : '영업종료'} · ${esc(hoursText(cafe))}
      </div>

      <div class="chips">
        <span class="chip">🏢 ${esc(floorTxt)}</span>
        <span class="chip">📐 ${SIZE_LABEL[cafe.size] || cafe.size}</span>
        <span class="chip">🔌 ${OUTLET_LABEL[cafe.outlets] || cafe.outlets}</span>
        <span class="chip">🪟 ${esc(viewTxt)}</span>
        <span class="chip">🧊 아메리카노 ${won(cafe.iced_americano_price)}</span>
      </div>

      <div class="detail__links">
        ${cafe.naver_url ? `<a class="btn btn--map naver" href="${esc(cafe.naver_url)}" target="_blank" rel="noopener">네이버 지도</a>` : ''}
        ${cafe.kakao_url ? `<a class="btn btn--map kakao" href="${esc(cafe.kakao_url)}" target="_blank" rel="noopener">카카오 지도</a>` : ''}
      </div>

      ${cafe.review_summary ? `<div class="detail__aisum">🤖 <b>리뷰 요약</b><p>${esc(cafe.review_summary)}</p></div>` : ''}

      <h3 class="detail__h3">집단지성 평가 <small>1–5 투표</small></h3>
      <div class="votes"></div>

      <h3 class="detail__h3">후기 <small class="muted" id="revCount"></small></h3>
      <div class="reviews"></div>
      <div class="reviewform"></div>
    </div>`;

  el.querySelector('.detail__close').onclick = onClose;

  // votes
  const votesEl = el.querySelector('.votes');
  for (const cat of VOTE_CATS) {
    const avg = cafe.votes.averages[cat.key];
    const n = cafe.votes.counts[cat.key] || 0;
    const mine = cafe.myVotes?.[cat.key] || 0;
    const row = document.createElement('div');
    row.className = 'vote';
    row.innerHTML = `
      <div class="vote__head">
        <span class="vote__label">${cat.icon} ${cat.label}</span>
        <span class="vote__avg">${stars(avg)} <span class="muted">(${n})</span></span>
      </div>
      <div class="vote__stars" role="group" aria-label="${cat.label} 투표">
        ${[1, 2, 3, 4, 5].map((v) =>
          `<button class="star ${mine >= v ? 'on' : ''}" data-v="${v}">${mine >= v ? '★' : '☆'}</button>`).join('')}
      </div>`;
    row.querySelectorAll('.star').forEach((b) => {
      b.onclick = () => {
        if (!user) return alert('투표하려면 로그인이 필요합니다.');
        onVote(cat.key, Number(b.dataset.v));
      };
    });
    votesEl.appendChild(row);
  }

  // reviews
  const reviews = cafe.reviews || [];
  el.querySelector('#revCount').textContent = reviews.length ? `${reviews.length}개` : '';
  const revEl = el.querySelector('.reviews');
  renderReviews(revEl, reviews);

  // review form
  const formEl = el.querySelector('.reviewform');
  if (user) {
    formEl.innerHTML = `
      <textarea class="input" id="revBody" rows="2" placeholder="커피맛, 분위기, 콘센트 자리 등 자유롭게..."></textarea>
      <div class="reviewform__row">
        <label class="btn btn--ghost filepick">📷 사진<input type="file" id="revPhoto" accept="image/*" hidden></label>
        <span class="muted" id="revFileName"></span>
        <button class="btn btn--primary" id="revSubmit">후기 등록</button>
      </div>`;
    const fileInput = formEl.querySelector('#revPhoto');
    fileInput.onchange = () => {
      formEl.querySelector('#revFileName').textContent = fileInput.files[0]?.name || '';
    };
    formEl.querySelector('#revSubmit').onclick = async () => {
      const body = formEl.querySelector('#revBody').value.trim();
      const file = fileInput.files[0];
      if (!body && !file) return alert('후기 내용이나 사진을 입력하세요.');
      const fd = new FormData();
      fd.append('body', body);
      if (file) fd.append('photo', file);
      await onAddReview(fd);
    };
  } else {
    formEl.innerHTML = `<p class="muted">후기를 남기려면 로그인하세요.</p>`;
  }
}

export function renderReviews(revEl, reviews) {
  revEl.innerHTML = reviews.length
    ? reviews.map((r) => `
      <div class="review">
        <div class="review__head"><b>${esc(r.user_name)}</b>
          <span class="muted">${esc((r.created_at || '').slice(0, 10))}</span></div>
        ${r.body ? `<div class="review__body">${esc(r.body)}</div>` : ''}
        ${r.photo_url ? `<img class="review__photo" src="${esc(r.photo_url)}" alt="">` : ''}
      </div>`).join('')
    : `<p class="muted">아직 후기가 없어요. 첫 후기를 남겨보세요!</p>`;
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
        <button class="detail__close" id="mClose">✕</button>
      </div>

      <form class="cafeform" id="cafeForm">
        <div class="formsec">
          <div class="formsec__title">1. 직접 입력</div>
          <label class="field"><span>카페 이름 *</span>
            <input class="input" name="name" required></label>
          <label class="field"><span>네이버 지도 링크 <small class="muted">(선택 · 실제 장소 링크)</small></span>
            <input class="input" name="naver_url" placeholder="https://naver.me/... 또는 map.naver.com 장소 링크"></label>
          <label class="field"><span>카카오 지도 링크 * <small class="muted">(실제 장소 링크)</small></span>
            <input class="input" name="kakao_url" placeholder="https://place.map.kakao.com/... 또는 공유 링크"></label>
          <input type="hidden" name="kakao_place_id">
          ${canFetch ? `
          <div class="fetch-row">
            <button type="button" class="btn btn--primary" id="fetchBtn">🤖 카카오 링크로 정보 가져오기</button>
            <button type="button" class="linkbtn" id="findLinkBtn">🔎 검색으로 링크 찾기</button>
          </div>
          <div class="finder" id="finder" hidden>
            <div class="autofill__search">
              <input class="input" id="afQuery" placeholder="카페 이름/지역 (예: 블루보틀 성수)">
              <button type="button" class="btn btn--ghost" id="afSearchBtn">검색</button>
            </div>
            <div class="autofill__results" id="afResults"></div>
          </div>
          <div class="fetch-status" id="fetchStatus" hidden></div>` :
          (user?.isAdmin ? '<div class="ai-note">KAKAO_API_KEY 미설정 — 링크 자동 가져오기 비활성화. 수동 입력만 가능.</div>' : '')}
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

          <div class="field"><span>대표사진 * <small class="muted">(가져온 사진 선택 또는 파일 업로드)</small></span>
            <input class="input" type="file" name="photo" accept="image/*">
            <input type="hidden" name="photo_url">
            <div class="photo-preview" id="photoPreview" hidden></div>
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
            <label class="field"><span>층수 * (다층이면 2 이상)</span>
              <input class="input" type="number" name="floors" min="1" value="1" required></label>
            <label class="field"><span>면적 *</span>
              <select class="input" name="size" required>
                <option value="small">소형</option>
                <option value="medium" selected>중형 (테이블 6–15)</option>
                <option value="large">대형 (프랜차이즈급)</option>
              </select></label>
            <label class="field"><span>콘센트 *</span>
              <select class="input" name="outlets" required>
                <option value="many">많음</option>
                <option value="some" selected>보통</option>
                <option value="few">적음</option>
                <option value="none">없음</option>
              </select></label>
          </div>
          <label class="field checkline"><input type="checkbox" name="has_view"> <span>뷰가 좋은 편이에요</span></label>
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
  const preview = back.querySelector('#photoPreview');

  const close = () => { onCancelPick?.(); back.remove(); };
  back.querySelector('#mClose').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  back.querySelector('#pickBtn').onclick = () => {
    hint.textContent = '지도를 클릭해 위치를 지정하세요...';
    onPickLocation((lng, lat) => {
      form.lat.value = lat.toFixed(6);
      form.lng.value = lng.toFixed(6);
      hint.textContent = `선택됨: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    });
  };

  form.photo.addEventListener('change', () => {
    if (form.photo.files[0]) { form.photo_url.value = ''; preview.hidden = true; }
  });

  function setPhotoUrl(url) {
    form.photo_url.value = url;
    form.photo.value = '';
    preview.hidden = false;
    preview.querySelectorAll('.photo-thumb').forEach((t) => t.classList.toggle('is-sel', t.dataset.url === url));
  }

  function applyFetched(data) {
    const f = data.fetched || {};
    form.kakao_place_id.value = data.placeId || '';
    if (f.kakao_place_url) form.kakao_url.value = f.kakao_place_url; // canonical real link
    if (f.address) form.address.value = f.address;
    if (f.lat != null && f.lng != null) {
      form.lat.value = Number(f.lat).toFixed(6);
      form.lng.value = Number(f.lng).toFixed(6);
      hint.textContent = `카카오에서 위치 가져옴: ${Number(f.lat).toFixed(5)}, ${Number(f.lng).toFixed(5)}`;
    }
    if (f.open_time) form.open_time.value = f.open_time;
    if (f.close_time) form.close_time.value = f.close_time === '24:00' ? '00:00' : f.close_time;
    if (f.iced_americano_price) form.iced_americano_price.value = f.iced_americano_price;
    if (data.review_summary) form.review_summary.value = data.review_summary;

    const photos = (f.photos || []).slice(0, 8);
    preview.hidden = photos.length === 0;
    preview.innerHTML = photos.map((u, i) =>
      `<button type="button" class="photo-thumb ${i === 0 ? 'is-sel' : ''}" data-url="${esc(u)}" style="background-image:url('${esc(u)}')"></button>`).join('');
    preview.querySelectorAll('.photo-thumb').forEach((t) => (t.onclick = () => setPhotoUrl(t.dataset.url)));
    if (photos[0]) setPhotoUrl(photos[0]);

    const st = back.querySelector('#fetchStatus');
    st.hidden = false;
    const km = f.iced_americano_price ? `${f.americano_menu_name || '아메리카노'} ${Number(f.iced_americano_price).toLocaleString('ko-KR')}원` : '';
    st.innerHTML = `
      <div class="ai-summary">💡 ${esc(data.review_summary || '리뷰 요약 없음')}</div>
      ${(data.keywords||[]).length ? `<div class="kw">${data.keywords.map((k)=>`<span class="kw__t">#${esc(k)}</span>`).join('')}</div>` : ''}
      <div class="muted">카카오 평점 ${f.rating ?? '?'} · 리뷰 ${f.review_count ?? 0}개 ${km ? '· '+esc(km) : ''}
        ${(f.strengths||[]).slice(0,4).map((s)=>`${esc(s.name)}(${s.count})`).join(' ')}</div>
      ${data.aiError ? `<div class="ai-note">AI 요약 실패: ${esc(data.aiError)}</div>` : ''}
      <div class="ai-warn">⚠️ 가져온 값 확인 후 층수/면적/콘센트/뷰는 직접 채워주세요.</div>`;
  }

  if (canFetch) {
    const fetchBtn = back.querySelector('#fetchBtn');
    const statusEl = back.querySelector('#fetchStatus');
    const doFetch = async () => {
      const kakaoUrl = form.kakao_url.value.trim();
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

    // optional finder: search → pick to fill name + real kakao link
    const finder = back.querySelector('#finder');
    const qEl = back.querySelector('#afQuery');
    const resultsEl = back.querySelector('#afResults');
    back.querySelector('#findLinkBtn').onclick = () => { finder.hidden = !finder.hidden; if (!finder.hidden) qEl.focus(); };
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
            if (!form.name.value.trim()) form.name.value = b.dataset.name;
            form.kakao_url.value = b.dataset.url;
            finder.hidden = true;
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
    if (!form.kakao_url.value.trim()) { errEl.textContent = '카카오 지도 링크는 필수입니다.'; return; }
    if (!form.lat.value || !form.lng.value) { errEl.textContent = '위치를 가져오거나 지도에서 선택하세요.'; return; }
    if (!form.photo.files[0] && !form.photo_url.value) { errEl.textContent = '대표사진(파일 또는 가져온 사진)이 필요합니다.'; return; }

    const fd = new FormData(form);
    fd.set('has_view', form.has_view.checked ? 'true' : 'false');
    if (!form.photo.files[0]) fd.delete('photo');
    try {
      await onSubmit(fd);
      close();
    } catch (err) {
      errEl.textContent = err.message || '등록 실패';
    }
  };

  return { close };
}
