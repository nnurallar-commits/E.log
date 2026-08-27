const CACHE="elog-final-v1";
const FILES=["./","./index.html","./style.css","./script.js","./manifest.json","./firebase-config.js"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener("activate", e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    return r;
  }).catch(()=>caches.match(e.request)));
});
self.addEventListener("push", event => {
  let data={title:"E.log",body:"Yeni bir hatırlatma var.",url:"./"};
  try { data={...data,...event.data.json()}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,
    icon:"./icons/icon-192.png",
    badge:"./icons/icon-192.png",
    data:{url:data.url||"./"}
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url=event.notification.data?.url||"./";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){ if("focus" in client) return client.focus(); }
    return clients.openWindow ? clients.openWindow(url) : undefined;
  }));
});
