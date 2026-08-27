# E.log V4 — GPT + Akıllı Push 🌿🧠🔔

Bu paket V3'ün üstüne gerçek OpenAI backend'i ve Firebase Cloud Messaging push bildirimlerini ekler.

## V4'te ne var?

- Google ile giriş
- Erol + Nilsu Pair ID senkronu
- Canlı Firestore takvim
- Nöbetler / Eroland / rutinler
- Oruç günü ve enerji durumu
- Nöbet çıkışında spor önermeme
- Pazartesi Şans'ın akvaryum rutini
- Öğrenilen spor örüntüleri + "Neden?"
- **Gerçek E.log AI:** Firestore verisini backend'den okuyup OpenAI Responses API'ye gönderir
- **Gerçek push altyapısı:** FCM token kaydı + arka planda bildirim
- Erol için akıllı rutin bildirimleri
- Nilsu için spam olmayan tek günlük özet

---

# 1) GitHub

Bu ZIP içindeki dosyaları mevcut `E.log` reposundaki dosyaların üzerine yükle ve commit et.

`firebase-config.js` zaten E-log Firebase projen için ayarlı.

---

# 2) Firebase CLI

Bilgisayarında Node.js kurulu olmalı.

Terminal / PowerShell:

```bash
npm install -g firebase-tools
firebase login
```

Sonra ZIP'i çıkardığın E.log klasöründe:

```bash
firebase use --add
```

Listeden Firebase projesi olarak:

```text
e-log-2f316
```

seç.

Alias sorarsa:

```text
default
```

yazabilirsin.

---

# 3) Function paketlerini kur

Proje klasöründe:

```bash
cd functions
npm install
cd ..
```

---

# 4) OpenAI API anahtarını GİZLİ secret olarak koy

OpenAI API anahtarını hiçbir JS dosyasına ve GitHub'a yazma.

Proje kökünde:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

Terminal sana değeri sorunca OpenAI API key'ini yapıştır.

Sonra:

```bash
firebase deploy --only functions
```

Başarılı olunca `elogAssistant` ve `smartNotificationPlanner` fonksiyonları `europe-west1` bölgesinde deploy edilmiş olacak.

> Cloud Functions / Scheduler kurulumu Firebase projesinde billing planı isteyebilir. Firebase isterse projeyi Blaze planına geçirmek gerekir. Kullanım ücretleri Firebase/OpenAI hesabına aittir.

---

# 5) Firestore güvenlik kurallarını deploy et

```bash
firebase deploy --only firestore:rules
```

Bu sürümde `/users/{uid}/devices` FCM tokenlarını sadece o Google hesabının okuyup yazmasına izin verir.

---

# 6) Web Push VAPID key

Firebase Console:

**Project settings → Cloud Messaging → Web Push certificates**

`Generate key pair` de.

Gösterilen **PUBLIC key** değerini kopyala.

`notification-config.js` dosyasını aç:

```js
export const vapidKey = "";
```

şunu yap:

```js
export const vapidKey = "BURAYA_FIREBASE_PUBLIC_VAPID_KEY";
```

Bu VAPID public key gizli değildir. GitHub'da bulunabilir.

Dosyayı GitHub'a commit et.

---

# 7) GitHub Pages'i yenile

E.log'u aç:

```text
https://nnurallar-commits.github.io/E.log/
```

Hard refresh:

Windows:
```text
Ctrl + F5
```

Telefon:
sayfayı kapatıp tekrar açabilirsin.

---

# 8) Push bildirimini aç

E.log:

**Daha fazla → 🔔 Akıllı Bildirimler → Bu cihazda bildirimleri aç**

Tarayıcı izin ister. İzin ver.

Erol kendi telefonunda bunu kendi Google hesabıyla yapmalı.
Nilsu da kendi telefonunda isterse açabilir.

### Erol'a gelebilecek örnekler

- Pazartesi 09:00 → `Şans'ın akvaryum günü 🐟`
- Nöbet günü → nöbet hatırlatması
- Nöbet çıkışı → dinlenme modu, spor hatırlatması gönderilmez
- Oruç günü → E.log oruç modunu hatırlar
- Gün 21:00'de hâlâ boşsa → kısa gün sonu kayıt hatırlatması

### Nilsu tarafı

Gün E.log'a kaydedilmişse akşam tek bir özet gelebilir. Her aktivitede bildirim göndermez.

---

# 9) GPT testi

E.log → **AI**

Şunları dene:

```text
Bugünkü günümü planla.
```

```text
Neden bugün spor önermiyorsun?
```

Nilsu hesabından:

```text
Erol bugün ne yaptı?
```

```text
Erol bu hafta hangi gün nöbetçi?
```

AI, Firestore'daki ortak pair verisine dayanır. Uygulamada olmayan şeyi olmuş gibi söylememesi için sistem talimatı vardır.

---

# ÖNEMLİ

## OpenAI key

Şunlara ASLA koyma:

- `script.js`
- `firebase-config.js`
- `notification-config.js`
- GitHub Secrets dışında public repo dosyaları

OpenAI key yalnızca:

```text
Firebase Secret Manager → OPENAI_API_KEY
```

olarak tutulur.

## Erol'un kişisel ChatGPT geçmişi

OpenAI API, Erol'un normal ChatGPT hesabındaki geçmiş sohbetleri veya ChatGPT Memory verisini otomatik olarak E.log'a açmaz. E.log'un ana hafızası Firestore'dur.

---

# Dosyalar

- `index.html` — arayüz
- `style.css` — E.log sage green tasarım
- `script.js` — Firebase, GPT çağrısı, FCM cihaz kaydı
- `sw.js` — PWA + arka plan FCM
- `firebase-config.js` — public Firebase web config
- `notification-config.js` — public VAPID key
- `firestore.rules` — güvenlik
- `functions/index.js` — OpenAI backend + akıllı bildirim motoru
- `functions/package.json` — backend bağımlılıkları
- `firebase.json` — Firebase proje yapılandırması
