# E.log REPAIRED

Bu sürümde:
- Oruç bölümü tamamen kaldırıldı.
- Aktivite kayıtları önce telefona/localStorage'a kaydedilir, sonra Firestore'a senkronlanır.
- Firebase hata verirse kayıt kaybolmaz.
- Senkron hatası üstte görünür.
- Tek service worker kullanılır, mobil cache sürümü yenilendi.
- iPhone/PWA ikonu gerçek E.log wordmark olarak değiştirildi.
- Sekme geçişleri korunur.
- Firestore canlı dinleyici hata verirse uygulama yerel kayıtlarla çalışmaya devam eder.

GitHub'a bu paketin içindekileri mevcut dosyaların üzerine yükleyip Commit changes yap.
