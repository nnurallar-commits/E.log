const CACHE="elog-20260908-pastel12-logo-v3";
const SHELL=["./","./index.html","./style.css","./script.js","./manifest.json","./elog-logo-pastel-v3-32.png","./elog-logo-pastel-v3-180.png","./elog-logo-pastel-v3-192.png","./elog-logo-pastel-v3-512.png","./elog-heart.png","./woohoo-heart.png","./eroland-us.png","./firebase-config.js"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin===location.origin){
    const isFreshCritical=url.pathname.endsWith("/index.html")||url.pathname.endsWith("/style.css")||url.pathname.endsWith("/script.js")||url.pathname.endsWith("/");
    if(isFreshCritical){
      event.respondWith(fetch(event.request).then(resp=>{if(resp&&resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return resp}).catch(()=>caches.match(event.request).then(x=>x||caches.match("./index.html"))));
    }else{
      event.respondWith(caches.match(event.request).then(cached=>{const fresh=fetch(event.request).then(resp=>{if(resp&&resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return resp}).catch(()=>cached||caches.match("./index.html"));return cached||fresh}));
    }
    return;
  }
  if(["www.gstatic.com","unpkg.com"].includes(url.hostname)){
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{if(resp&&resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return resp})));
  }
});
