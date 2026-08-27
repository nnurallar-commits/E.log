#!/usr/bin/env bash
set -e

PROJECT="e-log-2f316"

echo "🌿 E.log FINAL kuruluyor..."
echo
echo "1/5 Firebase CLI hazırlanıyor"
npm install -g firebase-tools >/dev/null 2>&1

if ! firebase projects:list >/dev/null 2>&1; then
  echo "Firebase girişi gerekiyor. Açılan bağlantıyla Google hesabına giriş yap."
  firebase login --no-localhost
fi

echo "2/5 Backend paketleri kuruluyor"
cd functions
npm install
cd ..

echo
echo "3/5 OpenAI anahtarı"
read -s -p "OpenAI API key'ini buraya yapıştır (ekranda görünmez): " OPENAI_KEY
echo

printf "%s" "$OPENAI_KEY" | firebase functions:secrets:set OPENAI_API_KEY --project "$PROJECT"

echo "4/5 Bildirim anahtarları otomatik oluşturuluyor"
VAPID_JSON=$(cd functions && npx --yes web-push generate-vapid-keys --json)
VAPID_PUBLIC=$(printf "%s" "$VAPID_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).publicKey))')
VAPID_PRIVATE=$(printf "%s" "$VAPID_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).privateKey))')

printf "%s" "$VAPID_PUBLIC" | firebase functions:secrets:set VAPID_PUBLIC_KEY --project "$PROJECT"
printf "%s" "$VAPID_PRIVATE" | firebase functions:secrets:set VAPID_PRIVATE_KEY --project "$PROJECT"

echo "5/5 Firestore kuralları + GPT + bildirim backend'i yayınlanıyor"
firebase deploy --project "$PROJECT" --only firestore:rules,functions

echo
echo "✅ E.log backend hazır."
echo "Şimdi GitHub Pages E.log'u açıp Google ile giriş yap."
echo "Daha fazla > Akıllı Bildirimler > Bu cihazda bildirimleri aç."
