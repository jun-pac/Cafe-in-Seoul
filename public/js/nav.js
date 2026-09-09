// Central Back-button coordinator for the map SPA.
//
// Overlays (the detail panel, the view-spot photo viewer, a full-screen lightbox) form a
// stack. The browser / hardware Back button closes the TOP overlay first, one per press,
// and only leaves the app once every overlay is closed. At the map base, the first Back is
// caught and shows a "press again to exit" hint instead of navigating away — the closest a
// web app can get to a native back-to-exit confirm (browsers don't allow a blocking dialog
// that cancels a Back navigation).
//
// URL/query handling is left to the caller (app.js setUrl) — this module only manages the
// history *depth* (one entry per overlay) and which teardown runs on each Back.

const layers = [];        // [{ close }] — top of stack = last opened overlay
let popping = false;      // true only while we are tearing an overlay down in response to a Back
let armed = false;        // base exit-guard armed (a second Back within the window will leave)
let exitHint = null;      // callback that shows the "press again to exit" toast

function onPop() {
  if (layers.length) {                 // an overlay is open → this Back closes the top one
    popping = true;
    try { layers.pop().close(); } catch (e) { /* teardown must never trap the user */ }
    finally { popping = false; }
    return;
  }
  if (!armed) {                        // at the map base: catch the first Back, stay in the app
    armed = true;
    try { history.pushState({ nav: 0 }, ''); } catch { /* history unavailable */ }
    try { exitHint && exitHint(); } catch { /* ignore */ }
    setTimeout(() => { armed = false; }, 2000);
  } else {                             // a second Back within the window → really leave
    armed = false;
    window.removeEventListener('popstate', onPop);
    try { history.back(); } catch { /* ignore */ }
  }
}

// Call once at startup. `hint` shows the exit toast. Pushes one sentinel entry so the very
// first Back at the map base is caught (not an instant exit).
export function initNav(hint) {
  exitHint = hint;
  try { history.pushState({ nav: 0 }, ''); } catch { /* history unavailable */ }
  window.addEventListener('popstate', onPop);
}

// Open an overlay: register its teardown and add one history entry.
export function pushLayer(close) {
  layers.push({ close });
  try { history.pushState({ nav: layers.length }, ''); } catch { /* ignore */ }
}

// Switch the *content* of the top overlay without adding a history entry (e.g. the view
// viewer → its detail panel, or re-rendering the same detail). Falls back to a push if
// nothing is open yet.
export function swapLayer(close) {
  if (!layers.length) return pushLayer(close);
  layers[layers.length - 1].close = close;
}

// User-initiated close (X button, swipe-down, backdrop tap): drive teardown through Back so
// the history stack stays in sync (the popstate handler runs the registered teardown).
export function closeTop() {
  if (layers.length && !popping) { try { history.back(); } catch { /* ignore */ } }
}

export function isPopping() { return popping; }
export function overlayDepth() { return layers.length; }

// test seam: reset internal state (used by the node unit test only)
export function __reset() { layers.length = 0; popping = false; armed = false; exitHint = null; }
