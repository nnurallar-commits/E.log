const CACHE="elog-pwa-20260831-photo-cloud-v4";
const SHELL=["./","./index.html","./style.css","./script.js","./manifest.json","./favicon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon.png","./elog-heart.png","./woohoo-heart.png","./eroland-us.png","./firebase-config.js"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin===location.origin){
    event.respondWith(caches.match(event.request).then(cached=>{const fresh=fetch(event.request).then(resp=>{if(resp&&resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return resp}).catch(()=>cached||caches.match("./index.html"));return cached||fresh}));
    return;
  }
  if(["www.gstatic.com","unpkg.com"].includes(url.hostname)){
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{if(resp&&resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return resp})));
  }
});
