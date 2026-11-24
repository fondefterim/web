// Web defterinin internetsiz açılması için: defterin kendi dosyaları cihazda saklanır.
// Yalnızca sitenin kendi dosyaları saklanır; kullanıcının kayıtları burada değil, IndexedDB'dedir.
// Yeni sürüm yayınlanınca SURUM değiştirilir; eski kopya silinir.
const SURUM = 'defter-2026-11-24f';
const DOSYALAR = [
  './', './index.html', './defter.css', './defter.js', './depo.js', './manifest.webmanifest',
  './img/simge-192.png', './img/simge-512.png',
  '../stil.css', '../hesap.js', '../ice-aktar.js', '../pdf-ekstre.js', '../fon-listesi.js', '../veri.js',
  '../vendor/pdfjs/pdf.min.mjs', '../vendor/pdfjs/pdf.worker.min.mjs',
  '../favicon.ico', '../img/simge.svg', '../apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SURUM);
    // Tarayıcının kendi önbelleği atlanır; her sürümde dosyaların en yenisi alınır.
    await c.addAll(DOSYALAR.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SURUM && k.startsWith('defter-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fon listesi gibi dış istekler olduğu gibi geçer
  e.respondWith((async () => {
    const c = await caches.open(SURUM);
    if (req.mode === 'navigate' && url.pathname.startsWith(new URL('./', self.location).pathname)) {
      // Defter sayfası her zaman saklı kopyadan açılır (sayfa ve kodu aynı sürümden olsun diye).
      // Yeni sürüm, tarayıcı sw.js'i yeniden kontrol edince arka planda iner.
      const page = await c.match('./index.html');
      if (page) return page;
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (err) { return Response.error(); }
  })());
});
