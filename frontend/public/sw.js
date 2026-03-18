// Service Worker — handles incoming push events and notification clicks

self.addEventListener('push', event => {
  let data = { title: 'VAPID Test', body: 'New notification' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/icon-192.png',
      timestamp: data.timestamp || Date.now(),
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(c => c.url.includes(target));
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});
