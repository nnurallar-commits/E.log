# E.log V3 Smart

Bu sürüm V2 Google + Firestore altyapısının üstüne akıllı gün durumu, oruç modu, kesin kurallar, nöbet çıkışı mantığı, davranış örüntüsü çıkarımı ve E.log Beyni ekranını ekler.

# E.log

Kişisel takvim + öğrenen rutinler + nöbetler + Eroland + GPT asistan.

## 1) Firebase projesi oluştur
- Authentication > Email/Password aç.
- Firestore Database oluştur.
- Project settings > Web app oluştur.
- `firebase-config.example.js` dosyasını `firebase-config.js` olarak kopyala ve değerlerini doldur.

## 2) Firebase CLI
```bash
npm install -g firebase-tools
firebase login
firebase init
```
Var olan `firebase.json` dosyasını koru.

## 3) Firestore rules
```bash
firebase deploy --only firestore:rules
```

## 4) Cloud Functions + OpenAI
```bash
cd functions
npm install
cd ..
firebase functions:secrets:set OPENAI_API_KEY
firebase deploy --only functions
```

OpenAI anahtarını ASLA `script.js` içine yazma.

## 5) Hosting
```bash
firebase deploy --only hosting
```

## 6) Erol + Nilsu hesaplarını eşleştirme
İlk kullanıcı giriş yaptığında `/users/{uid}` altında `pairId = uid` oluşur.
Nilsu hesabını oluşturduktan sonra Firestore Console'dan onun `users/{uid}` belgesindeki `pairId` alanını Erol'un `pairId` değeriyle aynı yap. `role` alanını `partner` yapabilirsin.

Böylece ikiniz de `/pairs/{pairId}/...` altındaki aynı veriyi canlı görürsünüz.

## 7) Akıllı kurallar
Önerilen başlangıç kuralları:
- Pazartesi: Şans'ın akvaryumunu temizle
- Nöbet çıkışı: spor önerme
- Oruç günü: günlük önerileri oruca göre düzenle

Bunları uygulamadaki Rutinler & Kurallar bölümünden ekleyebilirsin. Daha karmaşık kurallar için `functions/index.js` içindeki bağlamı genişletebilirsin.

## 8) Push bildirimleri
`smartNotificationPlanner` saatte bir karar üretir ve `notification_queue` koleksiyonuna yazar. Gerçek telefon push'u için Firebase Cloud Messaging eklenmeli:
- FCM token'ı kullanıcı belgesine kaydet
- Firebase Admin Messaging ile queue içeriğini gönder
- iOS PWA push için HTTPS + kullanıcı izni gerekir

## Yerel deneme
Firebase config yoksa uygulama demo modunda açılır. Basit bir local server kullan:
```bash
python -m http.server 8080
```
Sonra `http://localhost:8080`.
