# E.log Gerçek AI

Bu sürümde `script.js` gerçek `/api/ai` endpoint'ine bağlanır.
API anahtarı istemci koduna yazılmaz.

## Vercel ile çalıştırma
1. Bu klasörü GitHub repo'na yükle.
2. Vercel'de repo'yu Import et.
3. Project Settings > Environment Variables bölümüne:
   - `OPENAI_API_KEY` = kendi OpenAI API anahtarın
   - isteğe bağlı `OPENAI_MODEL` = `gpt-5.6-luna`
4. Deploy et.

GitHub Pages `/api/ai` çalıştıramaz. Bu yüzden gerçek AI için uygulamanın
Vercel deployment linkini kullanmalısın. Backend bağlı değilse E.log otomatik
olarak eski yerel cevap sistemine düşer.

API anahtarını `script.js`, `index.html`, `firebase-config.js` veya GitHub
Secrets dışındaki herkese açık bir dosyaya ASLA yazma.
