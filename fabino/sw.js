/* Fabino: retired service worker. Removes itself so phones always load fresh files. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.registration.unregister()));
