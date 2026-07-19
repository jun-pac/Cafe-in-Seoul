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
export function renderAuth(el, me, { onDevLogin, onLogout, onGoogleCredential }) {
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
  if (me.googleClientId) {
    // Google Identity Services — needs only the public client ID (no secret).
    const holder = document.createElement('div');
    holder.id = 'gsiButton';
    el.appendChild(holder);
    const init = () => {
      if (!window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: me.googleClientId,
        callback: (resp) => onGoogleCredential(resp.credential),
      });
      window.google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', text: 'signin_with' });
      return true;
    };
    if (!init()) {
      const t = setInterval(() => { if (init()) clearInterval(t); }, 200);
      setTimeout(() => clearInterval(t), 6000);
    }
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'authbar';
    wrap.innerHTML = `<button class="btn btn--primary" id="devLoginBtn">로그인 (SSO 미설정 · 데모)</button>`;
    wrap.querySelector('#devLoginBtn').onclick = () => {
      const name = prompt('닉네임을 입력하세요 (데모 로그인):', '카공러');
      if (name != null) onDevLogin(name);
    };
    el.appendChild(wrap);
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
        <a class="btn btn--map naver" href="${esc(cafe.naver_url)}" target="_blank" rel="noopener">네이버 지도</a>
        <a class="btn btn--map kakao" href="${esc(cafe.kakao_url)}" target="_blank" rel="noopener">카카오 지도</a>
      </div>

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
export function openAddCafeModal(opts) {
  const { user, capabilities, onSearch, onPrefill, onPickLocation, onCancelPick, onSubmit } = opts;
  const canAutofill = user?.isAdmin && capabilities?.kakao;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h2>카페 등록</h2>
        <button class="detail__close" id="mClose">✕</button>
      </div>

      ${canAutofill ? `
      <div class="autofill">
        <div class="autofill__head">🤖 카카오 + AI 자동 채우기 <span class="muted">(관리자)</span></div>
        <div class="autofill__search">
          <input class="input" id="afQuery" placeholder="카페 이름/지역 검색 (예: 블루보틀 성수)">
          <button type="button" class="btn btn--primary" id="afSearchBtn">검색</button>
        </div>
        <div class="autofill__results" id="afResults"></div>
        <div class="autofill__ai" id="afAi" hidden></div>
      </div>` : ''}

      <p class="muted">대표사진과 아래 7개 항목은 필수입니다. (주관적 평가는 등록 후 투표로 채워집니다.)</p>
      <form class="cafeform" id="cafeForm">
        <label class="field"><span>카페 이름 *</span>
          <input class="input" name="name" required></label>
        <label class="field"><span>주소</span>
          <input class="input" name="address" placeholder="예) 서울 성동구 성수동"></label>

        <div class="field">
          <span>위치 (지도 클릭) *</span>
          <div class="loc-row">
            <input class="input" name="lat" placeholder="위도" readonly required>
            <input class="input" name="lng" placeholder="경도" readonly required>
            <button type="button" class="btn btn--ghost" id="pickBtn">지도에서 선택</button>
          </div>
          <small class="muted" id="pickHint"></small>
        </div>

        <div class="field"><span>대표사진 * <small class="muted">(파일 업로드 또는 자동 채우기 사진)</small></span>
          <input class="input" type="file" name="photo" accept="image/*">
          <input type="hidden" name="photo_url">
          <div class="photo-preview" id="photoPreview" hidden></div>
        </div>

        <div class="grid2">
          <label class="field"><span>층수 * (다층이면 2 이상)</span>
            <input class="input" type="number" name="floors" min="1" value="1" required></label>
          <label class="field"><span>면적 *</span>
            <select class="input" name="size" required>
              <option value="small">소형</option>
              <option value="medium" selected>중형 (테이블 6–15)</option>
              <option value="large">대형 (프랜차이즈급)</option>
            </select></label>
          <label class="field"><span>오픈 *</span>
            <input class="input" type="time" name="open_time" value="09:00" required></label>
          <label class="field"><span>마감 *</span>
            <input class="input" type="time" name="close_time" value="22:00" required></label>
          <label class="field"><span>콘센트 *</span>
            <select class="input" name="outlets" required>
              <option value="many">많음</option>
              <option value="some" selected>보통</option>
              <option value="few">적음</option>
              <option value="none">없음</option>
            </select></label>
          <label class="field"><span>아이스 아메리카노 가격(원) *</span>
            <input class="input" type="number" name="iced_americano_price" min="0" step="100" value="4500" required></label>
        </div>

        <label class="field checkline"><input type="checkbox" name="has_view"> <span>뷰가 좋은 편이에요 *</span></label>
        <label class="field"><span>뷰 설명 (선택)</span>
          <input class="input" name="view_note" placeholder="예) 2층 창가 한강 방향"></label>

        <div class="grid2">
          <label class="field"><span>네이버 지도 링크 *</span>
            <input class="input" name="naver_url" placeholder="비우면 이름으로 자동 생성"></label>
          <label class="field"><span>카카오 지도 링크 *</span>
            <input class="input" name="kakao_url" placeholder="비우면 이름으로 자동 생성"></label>
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

  const close = () => {
    onCancelPick?.();
    back.remove();
  };
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

  // uploading a file overrides any auto-filled photo URL
  form.photo.addEventListener('change', () => {
    if (form.photo.files[0]) {
      form.photo_url.value = '';
      preview.hidden = true;
    }
  });

  function setPhotoUrl(url) {
    form.photo_url.value = url;
    form.photo.value = '';
    preview.hidden = false;
    preview.querySelectorAll('.photo-thumb').forEach((t) =>
      t.classList.toggle('is-sel', t.dataset.url === url));
  }

  // ---- admin auto-fill ----
  if (canAutofill) {
    const qEl = back.querySelector('#afQuery');
    const resultsEl = back.querySelector('#afResults');
    const aiEl = back.querySelector('#afAi');

    const doSearch = async () => {
      const q = qEl.value.trim();
      if (!q) return;
      resultsEl.innerHTML = '<span class="muted">검색 중…</span>';
      try {
        const { results } = await onSearch(q);
        resultsEl.innerHTML = results.length
          ? results.map((r) => `
            <button type="button" class="af-result" data-id="${esc(r.id)}">
              <b>${esc(r.name)}</b> ${r.isCafe ? '' : '<span class="muted">· 카페아님?</span>'}
              <div class="muted">${esc(r.address || '')} · ${esc(r.category || '')}</div>
            </button>`).join('')
          : '<span class="muted">결과 없음</span>';
        resultsEl.querySelectorAll('.af-result').forEach((b) => {
          b.onclick = () => applyPrefill(b.dataset.id, b);
        });
      } catch (e) {
        resultsEl.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      }
    };

    const applyPrefill = async (id, btn) => {
      btn.classList.add('is-loading');
      aiEl.hidden = false;
      aiEl.innerHTML = '<span class="muted">카카오 상세 + AI 분석 중… (몇 초)</span>';
      try {
        const { suggested: s, kakao, ai, aiError } = await onPrefill(id);
        // fill discrete/objective fields
        form.name.value = s.name || '';
        form.address.value = s.address || '';
        if (s.lat != null && s.lng != null) {
          form.lat.value = Number(s.lat).toFixed(6);
          form.lng.value = Number(s.lng).toFixed(6);
        }
        form.open_time.value = s.open_time || form.open_time.value;
        form.close_time.value = s.close_time || form.close_time.value;
        form.size.value = s.size || 'medium';
        form.outlets.value = s.outlets || 'some';
        form.floors.value = s.floors || 1;
        if (s.iced_americano_price) form.iced_americano_price.value = s.iced_americano_price;
        form.naver_url.value = s.naver_url || '';
        form.kakao_url.value = s.kakao_url || '';
        form.has_view.checked = !!s.has_view;
        form.view_note.value = s.view_note || '';

        // photo chooser from kakao photos
        const photos = (kakao?.photos || []).slice(0, 8);
        preview.hidden = photos.length === 0;
        preview.innerHTML = photos.map((u, i) =>
          `<button type="button" class="photo-thumb ${i === 0 ? 'is-sel' : ''}" data-url="${esc(u)}" style="background-image:url('${esc(u)}')"></button>`).join('');
        preview.querySelectorAll('.photo-thumb').forEach((t) => (t.onclick = () => setPhotoUrl(t.dataset.url)));
        if (s.photo_url) setPhotoUrl(s.photo_url);

        renderAiPanel(aiEl, ai, kakao, aiError);
      } catch (e) {
        aiEl.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      } finally {
        btn.classList.remove('is-loading');
      }
    };

    back.querySelector('#afSearchBtn').onclick = doSearch;
    qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const name = form.name.value.trim();
    if (!form.naver_url.value.trim()) form.naver_url.value = `https://map.naver.com/v5/search/${encodeURIComponent(name)}`;
    if (!form.kakao_url.value.trim()) form.kakao_url.value = `https://map.kakao.com/?q=${encodeURIComponent(name)}`;
    if (!form.lat.value || !form.lng.value) { errEl.textContent = '지도에서 위치를 선택하세요.'; return; }
    if (!form.photo.files[0] && !form.photo_url.value) { errEl.textContent = '대표사진(파일 또는 자동 채우기)이 필요합니다.'; return; }

    const fd = new FormData(form);
    fd.set('has_view', form.has_view.checked ? 'true' : 'false');
    if (!form.photo.files[0]) fd.delete('photo'); // avoid empty file part
    try {
      await onSubmit(fd);
      close();
    } catch (err) {
      errEl.textContent = err.message || '등록 실패';
    }
  };

  return { close };
}

function pct(x) { return x == null ? '' : `${Math.round(x * 100)}%`; }

function renderAiPanel(el, ai, kakao, aiError) {
  if (!ai) {
    el.innerHTML = `<div class="ai-note">AI 분석 없음${aiError ? ` (${esc(aiError)})` : ' (OPENAI_API_KEY 미설정)'}. 카카오 기본 정보만 채웠어요.</div>`;
    return;
  }
  const conf = ai.confidence || {};
  const ev = ai.evidence || {};
  const row = (label, value, key) => `
    <div class="ai-row">
      <span class="ai-row__k">${label}</span>
      <span class="ai-row__v">${esc(value)} ${conf[key] != null ? `<i class="ai-conf">신뢰도 ${pct(conf[key])}</i>` : ''}</span>
      ${ev[key] ? `<div class="ai-ev">“${esc(ev[key])}”</div>` : ''}
    </div>`;
  el.innerHTML = `
    <div class="ai-summary">💡 ${esc(ai.summary || '')}</div>
    ${ai.study_fit != null ? `<div class="ai-fit">AI 카공적합도 추정 <b>${ai.study_fit}</b>/100</div>` : ''}
    ${kakao?.rating ? `<div class="muted">카카오 평점 ${kakao.rating} · 리뷰 ${kakao.review_count}개 · ${(kakao.strengths||[]).map((s)=>`${esc(s.name)}(${s.count})`).join(' ')}</div>` : ''}
    ${row('다층', ai.multi_floor == null ? '?' : (ai.multi_floor ? '예' : '아니오'), 'multi_floor')}
    ${row('면적', ({small:'소형',medium:'중형',large:'대형'}[ai.size] || '?'), 'size')}
    ${row('콘센트', ({many:'많음',some:'보통',few:'적음',none:'없음'}[ai.outlets] || '?'), 'outlets')}
    ${row('뷰', ai.has_view == null ? '?' : (ai.has_view ? '좋음' : '보통'), 'has_view')}
    <div class="ai-warn">⚠️ AI 추론값입니다. 저장 전에 확인/수정하세요.</div>`;
}
