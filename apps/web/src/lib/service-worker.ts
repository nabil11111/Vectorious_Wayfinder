// Activate an update only on a new page load, before a driver can start another form. An update found while
// working stays waiting; the following load sees it here. API responses are never cached by this worker.
export async function registerAppWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const previous = await navigator.serviceWorker.getRegistration('/');
    if (previous?.waiting && navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      previous.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) { console.warn('Could not prepare Wayfinder for offline use.', error); }
}
