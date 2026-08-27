const CACHE='elog-v4';
const FILES=['./','./index.html','./style.css','./script.js','./manifest.json','./firebase-config.js','./notification-config.js'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));
});

self.addEventListener('activate',e=>{
  e.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
        return res;
      })
      .catch(()=>caches.match(e.request))
  );
});

// Firebase Cloud Messaging background notifications.
// Firebase config is public web-app configuration, not a secret.
try{
  importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: "AIzaSyA642NY42_ospJmzhYpiBQt6HcEK_JOt4w",
    authDomain: "e-log-2f316.firebaseapp.com",
    projectId: "e-log-2f316",
    storageBucket: "e-log-2f316.firebasestorage.app",
    messagingSenderId: "846487456126",
    appId: "1:846487456126:web:2fa3c565b7bde7aae20b2f"
  });

  const messaging=firebase.messaging();

  messaging.onBackgroundMessage(payload=>{
    const title=payload.notification?.title || payload.data?.title || 'E.log';
    const body=payload.notification?.body || payload.data?.body || 'Yeni bir hatırlatma var.';
    self.registration.showNotification(title,{
      body,
      icon:'./icons/icon-192.png',
      badge:'./icons/icon-192.png',
      data:{url:payload.data?.url || './'}
    });
  });

  self.addEventListener('notificationclick',event=>{
    event.notification.close();
    const target=event.notification.data?.url || './';
    event.waitUntil(
      clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
        for(const client of list){
          if('focus' in client){
            client.navigate(target).catch(()=>{});
            return client.focus();
          }
        }
        return clients.openWindow ? clients.openWindow(target) : undefined;
      })
    );
  });
}catch(err){
  console.warn('FCM service worker başlatılamadı',err);
}
