// Thin fetch wrapper around the JSON API.
const json = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

export const api = {
  me: () => fetch('/api/auth/me').then(json),
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
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(json),

  adminCapabilities: () => fetch('/api/admin/capabilities').then(json),
  adminSearch: (q) => fetch(`/api/admin/search?q=${encodeURIComponent(q)}`).then(json),
  adminEnrich: (payload) =>
    fetch('/api/admin/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), // { kakaoUrl } or { placeId }
    }).then(json),
  adminPending: () => fetch('/api/admin/pending').then(json),
  adminApprove: (id) => fetch(`/api/admin/cafes/${id}/approve`, { method: 'POST' }).then(json),
  adminReject: (id) => fetch(`/api/admin/cafes/${id}/reject`, { method: 'POST' }).then(json),

  listCafes: () => fetch('/api/cafes').then(json),
  getCafe: (id) => fetch(`/api/cafes/${id}`).then(json),
  createCafe: (formData) =>
    fetch('/api/cafes', { method: 'POST', body: formData }).then(json),

  vote: (id, category, score) =>
    fetch(`/api/cafes/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, score }),
    }).then(json),

  addReview: (id, formData) =>
    fetch(`/api/cafes/${id}/reviews`, { method: 'POST', body: formData }).then(json),
};
