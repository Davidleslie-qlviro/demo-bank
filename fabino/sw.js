/* Fabino service worker: needed so phones treat the page as an installable app.
   It does NOT cache anything, so customers always get the latest prices and files. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
