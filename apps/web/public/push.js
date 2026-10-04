// Shown by the browser when Wayfinder is in the background (spec 031). The page itself may already be frozen.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Wayfinder', {
    body: data.body || '',
    tag: data.tag,
    data: { link: data.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.link) || '/';
  const target = new URL(raw, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const open of windows) {
      if (new URL(open.url).origin === self.location.origin) {
        const focused = open.focus();
        return open.navigate ? focused.then(() => open.navigate(target.href)) : focused;
      }
    }
    return self.clients.openWindow(target.href);
  }));
});
