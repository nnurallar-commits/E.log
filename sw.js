const VERSION="20260828-emoji-picker2";
const CACHE=`elog-${VERSION}`;
const OFFLINE_FILES=[
  "./",
  "./index.html?v="+VERSION,
  "./style.css?v="+VERSION,
  "./script.js?v="+VERSION,
  "./manifest.json?v="+VERSION,
  "./firebase-config.js"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        OFFLINE_FILES.map(url =>
          cache.add(new Request(url, {cache:"reload"})).catch(()=>null)
        )
      )
    )
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith("elog-") && key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if(event.data?.type==="SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if(event.request.method!=="GET") return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  // HTML, JS, CSS and SW-related assets are always network-first.
  const important =
    event.request.mode==="navigate" ||
    /\.(?:js|css|html|json)$/.test(url.pathname);

  if(important){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(event.request,{cache:"no-store"});
        if(fresh && fresh.ok){
          const cache=await caches.open(CACHE);
          cache.put(event.request,fresh.clone()).catch(()=>{});
        }
        return fresh;
      }catch{
        return (await caches.match(event.request)) ||
               (await caches.match("./index.html?v="+VERSION)) ||
               Response.error();
      }
    })());
    return;
  }

  // Images/icons: cache-first, background refresh.
  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    const network=fetch(event.request).then(async fresh=>{
      if(fresh && fresh.ok){
        const cache=await caches.open(CACHE);
        cache.put(event.request,fresh.clone()).catch(()=>{});
      }
      return fresh;
    }).catch(()=>null);
    return cached || await network || Response.error();
  })());
});

self.addEventListener("push", event => {
  let data={title:"E.log",body:"Yeni bir hatırlatma var.",url:"./"};
  try{ data={...data,...event.data.json()}; }catch{}
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
  event.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if("focus" in client) return client.focus();
      }
      return clients.openWindow ? clients.openWindow(url) : undefined;
    })
  );
});
