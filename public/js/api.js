// Thin fetch wrapper around the JSON API.
const json = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

export const api = {
  me: () => fetch('/api/auth/me').then(json),
  stats: () => fetch('/api/stats').then(json),
  adminAnalytics: (day) => fetch('/api/admin/analytics' + (day ? `?day=${encodeURIComponent(day)}` : '')).then(json),
  // fire-and-forget event beacon — survives navigation via sendBeacon, cookie sent automatically
  track: (type, target, label) => {
    try {
      const body = JSON.stringify({ type, target: target ?? null, label: label ?? null });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch { /* analytics must never break the app */ }
  },
  devLogin: (name) =>
    fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(json),
  googleVerify: (credential) =>
    fetch('/api/auth/google/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    }).then(json),
  register: (username, password) =>
    fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(json),
  login: (username, password) =>
    fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(json),
  updateName: (name) =>
    fetch('/api/auth/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(json),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(json),

  adminCapabilities: () => fetch('/api/admin/capabilities').then(json),
  adminSearch: (q) => fetch(`/api/admin/search?q=${encodeURIComponent(q)}`).then(json),
  adminEnrich: (payload) =>
    fetch('/api/admin/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), // { kakaoUrl } or { placeId }
    }).then(json),
  adminDraftReview: (payload) =>
    fetch('/api/admin/draft-review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json),
  adminInsights: () => fetch('/api/admin/insights').then(json),
  adminPending: () => fetch('/api/admin/pending').then(json),
  adminApprove: (id) => fetch(`/api/admin/cafes/${id}/approve`, { method: 'POST' }).then(json),
  adminReject: (id) => fetch(`/api/admin/cafes/${id}/reject`, { method: 'POST' }).then(json),

  listCafes: () => fetch('/api/cafes').then(json),
  getCafe: (id) => fetch(`/api/cafes/${id}`).then(json),
  createCafe: (formData) =>
    fetch('/api/cafes', { method: 'POST', body: formData }).then(json),
  updateCafe: (id, formData) =>
    fetch(`/api/cafes/${id}`, { method: 'PATCH', body: formData }).then(json),
  setCover: (id, url) =>
    fetch(`/api/cafes/${id}/cover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(json),

  likeCafe: (id) => fetch(`/api/cafes/${id}/like`, { method: 'POST' }).then(json),
  vote: (id, category, score) =>
    fetch(`/api/cafes/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, score }),
    }).then(json),

  addReview: (id, formData) =>
    fetch(`/api/cafes/${id}/reviews`, { method: 'POST', body: formData }).then(json),
  updateReview: (id, reviewId, formData) =>
    fetch(`/api/cafes/${id}/reviews/${reviewId}`, { method: 'PATCH', body: formData }).then(json),
  deleteReview: (id, reviewId) =>
    fetch(`/api/cafes/${id}/reviews/${reviewId}`, { method: 'DELETE' }).then(json),

  listViewspots: () => fetch('/api/viewspots').then(json),
  viewSearch: (q) => fetch(`/api/viewspots/search?q=${encodeURIComponent(q)}`).then(json),
  getViewspot: (id) => fetch(`/api/viewspots/${id}`).then(json),
  createViewspot: (formData) => fetch('/api/viewspots', { method: 'POST', body: formData }).then(json),
  updateViewspot: (id, formData) => fetch(`/api/viewspots/${id}`, { method: 'PATCH', body: formData }).then(json),
  addViewspotPhotos: (id, formData) => fetch(`/api/viewspots/${id}/photos`, { method: 'POST', body: formData }).then(json),
  deleteViewspot: (id) => fetch(`/api/viewspots/${id}`, { method: 'DELETE' }).then(json),
  viewspotPending: () => fetch('/api/viewspots/pending/list').then(json),
  approveViewspot: (id) => fetch(`/api/viewspots/${id}/approve`, { method: 'POST' }).then(json),
  rejectViewspot: (id) => fetch(`/api/viewspots/${id}/reject`, { method: 'POST' }).then(json),
  likeViewspot: (id) => fetch(`/api/viewspots/${id}/like`, { method: 'POST' }).then(json),
  addViewComment: (id, body) =>
    fetch(`/api/viewspots/${id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then(json),

  getMessages: (id) => fetch(`/api/cafes/${id}/messages`).then(json),
  postMessage: (id, payload) =>
    fetch(`/api/cafes/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), // { body, lat, lng }
    }).then(json),
};
