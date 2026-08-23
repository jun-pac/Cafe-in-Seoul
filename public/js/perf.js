// Real-user performance beacon — sent once per page load, right after the map's
// markers render. Captures what a visitor actually experiences (TTFB, LCP, time to
// interactive map, marker count) and posts it to /api/perf for the admin 성능 tab.
// Fire-and-forget; failures are swallowed so this never affects the page.

let lcp = 0;
try {
  // buffered:true replays the LCP entries that fired before this ran
  new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = e.startTime; })
    .observe({ type: 'largest-contentful-paint', buffered: true });
} catch { /* not supported → lcp stays 0 (omitted) */ }

let sent = false;
export function reportPerf(markers) {
  if (sent) return; sent = true;
  const fire = () => {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      const body = {
        ttfb: nav ? nav.responseStart : null,
        dcl: nav ? nav.domContentLoadedEventEnd : null,
        load: nav ? (nav.loadEventEnd || nav.domComplete) : null,
        lcp: lcp || null,
        mapReady: Math.round(performance.now()), // ms from nav start to markers on screen
        markers,
        nav: nav ? nav.type : '',
      };
      const json = JSON.stringify(body);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/perf', new Blob([json], { type: 'application/json' }));
      else fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true });
    } catch { /* ignore */ }
  };
  // let LCP and onload settle before sampling
  if (document.readyState === 'complete') setTimeout(fire, 1000);
  else window.addEventListener('load', () => setTimeout(fire, 1000), { once: true });
}
