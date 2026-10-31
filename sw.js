// Change VERSION whenever any app-shell file changes. IndexedDB is independent.
const VERSION = '2.2.1';
const PREFIX = `english-flow-shell:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = PREFIX + VERSION;
const ASSETS = ['./','./index.html','./styles.css','./app.js','./transcript.js','./fingerprint.js','./learning-player.js', './phrasebook.js','./inline-subtitles.js','./core.js','./listening.js','./queue.js','./i18n.js','./gestures.js','./db.js','./backup.js','./manifest.json','./icon-192.png','./icon-512.png'];
const assetUrls = new Set(ASSETS.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  // All-or-nothing: an incomplete release never becomes the active shell.
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))));
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    // Never touch IndexedDB, audio Blobs, or caches belonging to another app.
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin) return;
  const scope=new URL(self.registration.scope);
  if(!url.pathname.startsWith(scope.pathname)) return;
  if(request.mode==='navigate' && (url.pathname===scope.pathname || url.pathname===scope.pathname+'index.html')){
    event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(new URL('./index.html',scope).href))||fetch(request)));
  }else if(assetUrls.has(url.href)){
    event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(request))||fetch(request)));
  }
});
