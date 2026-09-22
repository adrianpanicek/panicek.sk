export async function countVisitor() {
  try {
    const key = 'portfolio:visitor';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    const response = await fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        path: location.pathname,
        referrer: document.referrer.split(/[?#]/)[0] || '',
      }),
      keepalive: true,
    });
    if (!response.ok) return;
    const { visitors } = await response.json();
    if (!Number.isSafeInteger(visitors) || visitors < 1) return;
    const counter = document.createElement('span');
    counter.id = 'visitor-count';
    counter.textContent = `visitors: ${visitors.toLocaleString()}`;
    document.querySelector('footer')?.append(counter);
  } catch {}
}
