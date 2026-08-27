import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";


const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2,"0");
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const fmtTR = d => new Intl.DateTimeFormat("tr-TR",{weekday:"long",day:"numeric",month:"long"}).format(d);
const monthTR = d => new Intl.DateTimeFormat("tr-TR",{month:"long",year:"numeric"}).format(d);
const safe = s => String(s ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

let app, auth, db, functions, swRegistration=null;
let currentUser = null;
let profile = null;
let calendarCursor = new Date();
let selectedDate = today();
let entries = [];
let routines = [];
let shifts = [];
let memories = [];
let rules = [];
let learnedPatterns = [];
let unsubs = [];

const LOCAL_KEY="elog-local-v1";
let syncTimer=null;
function loadLocal(){
  try{
    const x=JSON.parse(localStorage.getItem(LOCAL_KEY)||"{}");
    entries=x.entries||entries; shifts=x.shifts||shifts; routines=x.routines||routines;
    memories=x.memories||memories; rules=x.rules||rules;
  }catch{}
}
function saveLocal(){
  try{localStorage.setItem(LOCAL_KEY,JSON.stringify({entries,shifts,routines,memories,rules}));}catch{}
}
function markSync(text,ok=true){
  const b=$("#syncBadge"); if(!b)return;
  b.textContent=(ok?"● ":"⚠ ")+text;
}
function scheduleCloudSync(){
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>flushLocalToCloud().catch(()=>{}),1200);
}
async function flushLocalToCloud(){
  if(!db||!profile?.pairId||!currentUser||currentUser.uid==="demo") return;
  const pending=entries.filter(x=>x._pending);
  for(const e of pending){
    try{
      const copy={...e}; delete copy.id; delete copy._pending;
      const ref=await addDoc(pairPath("entries"),{...copy,createdAt:serverTimestamp()});
      entries=entries.map(x=>x.id===e.id?{...x,id:ref.id,_pending:false}:x);
      saveLocal();
    }catch(err){ console.error("sync entry",err); markSync("yerelde kayıtlı",false); return; }
  }
  markSync("canlı");
}

async function initFirebase(){
  let cfg;
  try { cfg = (await import("./firebase-config.js")).firebaseConfig; }
  catch(err){ console.error(err); loadLocal(); showSetupMode(); markSync("Firebase yok, yerel",false); return false; }
  app = initializeApp(cfg);
  auth=getAuth(app);
  db=getFirestore(app);
  functions=getFunctions(app,"europe-west1");

  onAuthStateChanged(auth, async user => {
    currentUser=user;
    if(!user){ profile=null; clearListeners(); $("#authDialog").showModal(); return; }
    $("#authDialog").close();
    await ensureProfile(user);
    startRealtime();
  });
  return true;
}

function showSetupMode(){
  $("#syncBadge").textContent="● demo";
  $("#authDialog").close();
  currentUser={uid:"demo"}; profile={name:"Erol",role:"owner",pairId:"demo-pair"};
  entries=[
    {id:"1",date:today(),time:"08:30",title:"Kahvaltı",category:"food",done:true},
    {id:"2",date:today(),time:"10:00",title:"İş",category:"work",done:true,note:"Tomografi"},
    {id:"3",date:today(),time:"18:30",title:"Spor",category:"sport",done:false},
    {id:"4",date:today(),time:"21:00",title:"Nilsu ♡",category:"us",done:false}
  ];
  rules=[
    {id:"r1",name:"Pazartesi akvaryum",type:"weekday",weekday:1,action:"Şans'ın akvaryumunu temizle",active:true},
    {id:"r2",name:"Nöbet çıkışı spor yok",type:"after_shift",action:"Spor önerme",active:true},
  ];
  memories=[{id:"m1",type:"memory",title:"Kahve molası",date:today(),emoji:"☕"},{id:"m2",type:"plan",title:"Birlikte yapılacak",date:today(),emoji:"♡"}];
  shifts=[]; routines=[];
  learnedPatterns=[
    {id:"lp1",label:"Cuma günleri spor eğilimi",confidence:0.72,evidence:"Son kayıtlardaki tekrar eden spor günlerinden tahmin."}
  ];
  renderAll();
}

async function ensureProfile(user){
  const ref=doc(db,"users",user.uid); const snap=await getDoc(ref);
  if(!snap.exists()){
    profile=null;
    await openFirstSetup(user);
    return;
  }
  profile=snap.data();
}

async function openFirstSetup(user){
  return new Promise(resolve=>{
    openGeneric(`<div class="modal-head"><h3>E.log'a hoş geldin 🌿</h3></div><p>Bu hesabı bir kez tanımlayalım.</p><form id="firstSetupForm"><label>Ben<select id="setupRole"><option value="owner">Erol</option><option value="partner">Nilsu</option></select></label><label id="pairWrap" style="display:none">Erol'un Pair ID'si<input id="setupPair" placeholder="Erol'un Profil ekranında yazar"></label><button class="primary-btn full" type="submit">Devam et</button><p id="setupMsg" class="form-message"></p></form>`,()=>{
      const role=$("#setupRole"), wrap=$("#pairWrap");
      role.onchange=()=>wrap.style.display=role.value==='partner'?'block':'none';
      $("#firstSetupForm").onsubmit=async ev=>{
        ev.preventDefault(); const r=role.value; const entered=$("#setupPair").value.trim();
        if(r==='partner'&&!entered){$("#setupMsg").textContent='Erol’un Pair ID’sini yaz.';return;}
        const data={name:r==='owner'?'Erol':'Nilsu',role:r,pairId:r==='owner'?user.uid:entered,createdAt:serverTimestamp()};
        await setDoc(doc(db,'users',user.uid),data); profile=data; $("#genericDialog").close(); resolve();
      };
    });
  });
}

function clearListeners(){unsubs.forEach(fn=>fn());unsubs=[]}
function pairPath(name){return collection(db,"pairs",profile.pairId,name)}
function startRealtime(){
  clearListeners(); $("#syncBadge").textContent="● canlı";
  const bind=(name,setter,sortField="date")=>{
    const qy=query(pairPath(name),orderBy(sortField));
    unsubs.push(onSnapshot(qy,s=>{const cloud=s.docs.map(d=>({id:d.id,...d.data()})); if(name==="entries"){const pending=entries.filter(x=>x._pending); setter([...cloud,...pending]);} else setter(cloud); saveLocal(); renderAll();},err=>{console.error(err);markSync("yerelde",false);}));
  };
  bind("entries",v=>entries=v,"date"); bind("shifts",v=>shifts=v,"startDate"); bind("routines",v=>routines=v,"name"); bind("memories",v=>memories=v,"date"); bind("rules",v=>rules=v,"name");
}

function renderAll(){
  $("#todayLabel").textContent=fmtTR(new Date());
  $("#heroGreeting").textContent=`Merhaba ${profile?.name||"Erol"} 👋`;
  renderToday(); renderCalendar(); renderMemories(); renderSmart(); renderShiftMini();
}

function renderToday(){
  const list=entries.filter(e=>e.date===today()).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  const el=$("#todayTimeline");
  if(!list.length){el.innerHTML='<div class="empty">Bugün henüz kayıt yok. + Hızlı ekle ile başlayabilirsin.</div>';return;}
  el.innerHTML=list.map(e=>`<button class="timeline-item" data-entry="${e.id}" type="button"><span class="time">${safe(e.time||"--:--")}</span><span><strong>${safe(e.title)}</strong><small>${safe(e.note||categoryName(e.category))}</small></span><i class="status-dot ${e.done?'done':''}"></i></button>`).join("");
  $$('[data-entry]',el).forEach(b=>b.addEventListener('click',()=>openEntryActions(b.dataset.entry)));
}
function categoryName(c){return ({work:"İş",sport:"Spor",food:"Yemek",us:"Nilsu ♡",personal:"Kişisel",general:"Genel"})[c]||"Genel"}

function renderCalendar(){
  $("#monthTitle").textContent=monthTR(calendarCursor);
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  const first=new Date(y,m,1); const start=(first.getDay()+6)%7; const grid=[];
  for(let i=0;i<42;i++){const d=new Date(y,m,1-start+i);grid.push(d)}
  $("#calendarGrid").innerHTML=grid.map(d=>{const ds=isoDate(d);const count=entries.filter(e=>e.date===ds).length+shifts.filter(s=>s.startDate===ds).length;return `<button class="day-cell ${d.getMonth()!==m?'out':''} ${ds===today()?'today':''} ${ds===selectedDate?'selected':''}" data-date="${ds}" type="button"><span class="day-number">${d.getDate()}</span>${count?`<span class="event-dots">${'<i></i>'.repeat(Math.min(count,4))}</span>`:''}</button>`}).join("");
  $$('[data-date]').forEach(b=>b.addEventListener('click',()=>{selectedDate=b.dataset.date;renderCalendar();renderDayDetail();}));
  renderDayDetail();
}
function renderDayDetail(){
  const list=entries.filter(e=>e.date===selectedDate).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  const shift=shifts.find(s=>s.startDate===selectedDate);
  $("#calendarDayDetail").innerHTML=`<h3>${safe(new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'long',weekday:'long'}).format(new Date(selectedDate+'T12:00:00')))}</h3>${shift?`<div class="panel-row"><strong>🩻 Nöbet</strong><small>${safe(shift.startTime||'')} → ${safe(shift.endTime||'')}</small></div>`:''}${list.length?`<div class="panel-list">${list.map(e=>`<div class="panel-row"><strong>${safe(e.time)} · ${safe(e.title)}</strong><small>${safe(e.note||categoryName(e.category))}</small></div>`).join('')}</div>`:'<div class="empty">Bu gün boş görünüyor.</div>'}`;
}
function renderMemories(filter="all"){
  const list=memories.filter(m=>filter==='all'||m.type===filter).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  $("#memoryGrid").innerHTML=list.length?list.map(m=>`<article class="memory-card"><div class="emoji">${safe(m.emoji||'♡')}</div><h4>${safe(m.title)}</h4><p>${safe(m.date||'')}</p></article>`).join(''):'<div class="empty">Henüz bir şey yok.</div>';
}
function renderShiftMini(){const next=shifts.filter(s=>s.startDate>=today()).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0];$("#shiftMini").textContent=next?`${next.startDate} · ${next.startTime||''}`:'Yaklaşan nöbet yok'}

function inferPatterns(){
  const recent=entries.filter(e=>e.date).slice(-120);
  const byWeekday={};
  for(const e of recent){
    if(e.category!=='sport') continue;
    const wd=new Date(e.date+'T12:00:00').getDay();
    byWeekday[wd]=(byWeekday[wd]||0)+1;
  }
  const names=["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
  learnedPatterns=Object.entries(byWeekday)
    .filter(([,count])=>count>=3)
    .map(([wd,count])=>({id:`sport-${wd}`,label:`${names[Number(wd)]} günleri spor eğilimi`,confidence:Math.min(.95,.55+count*.07),evidence:`Son kayıtlarda bu gün ${count} kez spor kaydı var.`}));
  return learnedPatterns;
}

function getContext(){
  const now=new Date(); const weekday=now.getDay(); const t=today();
  const todayEntries=entries.filter(e=>e.date===t);
  const todayShift=shifts.find(s=>s.startDate===t);
  const previousShift=shifts.find(s=>s.endDate===t);
  const mondayRule=weekday===1 && rules.some(r=>r.active&&r.type==='weekday'&&Number(r.weekday)===1);
  const patterns=inferPatterns();
  return {weekday,todayEntries,todayShift,previousShift,mondayRule,patterns};
}
function renderSmart(){
  const c=getContext(); let title="Sana göre",text="Bugünün akışını öğreniyorum.",why="Takvim, rutin ve geçmiş davranışlarına bakıyorum.";
  if(c.previousShift){title="Nöbet çıkışı modu";text="Bugün nöbet çıkışı olduğun için spor önermiyorum. Günü daha hafif tutuyorum.";why="Kesin kural: nöbet çıkışlarında spor yapmıyorsun."}
  else if(c.mondayRule){title="Pazartesi rutini 🐟";text="Şans'ın akvaryumunu temizleme günün. Henüz listede yoksa ekleyebilirsin.";why="Kesin kural: pazartesi günleri Şans'ın akvaryumu temizleniyor."}
  else if(c.todayShift){title="Nöbet günü 🩻";text="Bugün nöbetin var. Nöbet saatlerini günün ana planında öne çıkarıyorum.";why="Takvimindeki nöbet kaydını görüyorum."}
  else if(c.todayEntries.some(e=>e.category==='sport')){title="Spor planı";text="Bugün spor kaydın var. Çakışan nöbet görünmüyor.";why="Takvimindeki spor kaydını ve nöbetlerini birlikte kontrol ettim."}
  else if(c.patterns[0]){title="Bir alışkanlık fark ettim";text=c.patterns[0].label+". Bunu henüz kesin kural saymıyorum.";why=c.patterns[0].evidence}
  $("#smartTitle").textContent=title;$("#smartText").textContent=text;$("#whyBtn").dataset.why=why;
  $("#heroSummary").textContent=c.todayEntries.length?`${c.todayEntries.length} kayıt var. Gününü sana göre düzenliyorum.`:'Bugün henüz boş. E.log rutinlerini yine de kontrol ediyor.';
}

function openEntryDialog(date=today()){$("#entryForm").reset();$("#entryDate").value=date;$("#entryTime").value=new Date().toTimeString().slice(0,5);$("#entryDialog").showModal()}
async function saveEntry(ev){
  ev.preventDefault();
  const title=$("#entryTitle").value.trim();
  if(!title) return;
  const data={
    date:$("#entryDate").value,time:$("#entryTime").value,title,
    note:$("#entryNote").value.trim(),category:$("#entryCategory").value,
    done:$("#entryDone").checked,createdBy:currentUser?.uid||"local",
    updatedAt:new Date().toISOString()
  };
  const localId="local-"+crypto.randomUUID();
  entries.push({id:localId,...data,_pending:currentUser?.uid!=="demo"});
  saveLocal(); renderAll(); $("#entryDialog").close();
  markSync(currentUser?.uid==="demo"?"yerel demo":"kaydedildi");
  if(currentUser?.uid!=="demo") scheduleCloudSync();
}
function openEntryActions(id){const e=entries.find(x=>x.id===id);if(!e)return;openGeneric(`<div class="modal-head"><h3>${safe(e.title)}</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="panel-row"><strong>${safe(e.date)} · ${safe(e.time)}</strong><small>${safe(e.note||categoryName(e.category))}</small></div><button id="toggleDone" class="primary-btn full" type="button">${e.done?'Tamamlanmadı yap':'Tamamlandı ✓'}</button><button id="deleteEntry" class="secondary-btn" type="button">Sil</button>`,()=>{
  $("#toggleDone").onclick=async()=>{if(currentUser.uid==='demo'){e.done=!e.done;renderAll()}else await updateDoc(doc(db,'pairs',profile.pairId,'entries',id),{done:!e.done});$("#genericDialog").close()};
  $("#deleteEntry").onclick=async()=>{if(currentUser.uid==='demo'){entries=entries.filter(x=>x.id!==id);renderAll()}else await deleteDoc(doc(db,'pairs',profile.pairId,'entries',id));$("#genericDialog").close()};
})}


function switchView(name){
  const target = document.getElementById(`view-${name}`);
  if(!target) return;

  $$('.view').forEach(v => v.classList.remove('active'));
  target.classList.add('active');

  $$('.nav-btn').forEach(btn => {
    const active = btn.dataset.view === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  // Sekmeye özel ekranı tazele
  if(name === 'home') renderToday();
  if(name === 'calendar') renderCalendar();
  if(name === 'eroland') renderMemories();

  window.scrollTo({top:0, behavior:'smooth'});
}

function openGeneric(html,after){$("#genericContent").innerHTML=html;$("#genericDialog").showModal();const c=$(".close-generic");if(c)c.onclick=()=>$("#genericDialog").close();after?.()}
function openModule(name){
  if(name==='shifts') openShifts();
  if(name==='routines') openRoutines();
  if(name==='stats') openStats();
  if(name==='notifications') openNotifications();
  if(name==='partner') openPartner();
  if(name==='brain') openBrain();
  if(name==='eroland') switchView('eroland');
}
function openShifts(){openGeneric(`<div class="modal-head"><h3>🩻 Nöbetlerim</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="panel-list">${shifts.length?shifts.map(s=>`<div class="panel-row"><strong>${safe(s.startDate)} · ${safe(s.type||'Nöbet')}</strong><small>${safe(s.startTime||'')} → ${safe(s.endTime||'')}</small></div>`).join(''):'<div class="empty">Henüz nöbet yok.</div>'}</div><form id="shiftForm"><div class="form-row"><label>Başlangıç<input id="shiftDate" type="date" required value="${today()}"></label><label>Saat<input id="shiftStart" type="time" required value="20:00"></label></div><div class="form-row"><label>Bitiş tarihi<input id="shiftEndDate" type="date" required value="${today()}"></label><label>Bitiş<input id="shiftEnd" type="time" required value="08:00"></label></div><button class="primary-btn full" type="submit">Nöbet ekle</button></form>`,()=>{$("#shiftForm").onsubmit=async ev=>{ev.preventDefault();const d={startDate:$("#shiftDate").value,startTime:$("#shiftStart").value,endDate:$("#shiftEndDate").value,endTime:$("#shiftEnd").value,type:'Tomografi',createdBy:currentUser.uid};if(currentUser.uid==='demo'){shifts.push({id:crypto.randomUUID(),...d});renderAll()}else {shifts.push({id:"local-"+crypto.randomUUID(),...d,_pending:true});saveLocal();renderAll();try{await addDoc(pairPath('shifts'),{...d,createdAt:serverTimestamp()});}catch(e){console.error(e);markSync("nöbet yerelde kayıtlı",false)}}$("#genericDialog").close()}})}
function openRoutines(){openGeneric(`<div class="modal-head"><h3>↻ Rutinler & Kurallar</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="panel-list">${rules.map(r=>`<div class="rule-card"><strong>${safe(r.name)}</strong><p>${safe(r.action)}</p><small>${r.active?'Aktif':'Kapalı'}</small></div>`).join('')}</div><form id="ruleForm"><label>Kural adı<input id="ruleName" placeholder="Örn. Cuma spor"></label><label>Ne yapsın?<input id="ruleAction" placeholder="Örn. Spor öner"></label><button class="primary-btn full" type="submit">Kural ekle</button></form>`,()=>{$("#ruleForm").onsubmit=async ev=>{ev.preventDefault();const d={name:$("#ruleName").value.trim(),action:$("#ruleAction").value.trim(),type:'custom',active:true};if(!d.name||!d.action)return;if(currentUser.uid==='demo'){rules.push({id:crypto.randomUUID(),...d});renderAll()}else {rules.push({id:"local-"+crypto.randomUUID(),...d,_pending:true});saveLocal();renderAll();try{await addDoc(pairPath('rules'),{...d,createdAt:serverTimestamp()});}catch(e){console.error(e);markSync("kural yerelde kayıtlı",false)}}$("#genericDialog").close()}})}
function openBrain(){
  const pats=inferPatterns();
  const exact=rules.filter(r=>r.active);
  openGeneric(`<div class="modal-head"><h3>🧠 E.log beyni</h3><button class="icon-btn close-generic" type="button">×</button></div>
  <p class="form-message">Kesin kurallar ayrı, gözlemden çıkan tahminler ayrı tutulur.</p>
  <h4>Kesin bildiklerim</h4><div class="panel-list">${exact.length?exact.map(r=>`<div class="rule-card"><strong>${safe(r.name)}</strong><p>${safe(r.action)}</p><small>Kesin kural</small></div>`).join(''):'<div class="empty">Henüz kesin kural yok.</div>'}</div>
  <h4>Tahminlerim</h4><div class="panel-list">${pats.length?pats.map(p=>`<div class="rule-card"><strong>${safe(p.label)}</strong><p>${safe(p.evidence)}</p><small>Güven: %${Math.round(p.confidence*100)}</small></div>`).join(''):'<div class="empty">Yeterli tekrar oluşunca alışkanlıkları burada göstereceğim.</div>'}</div>`);
}
function openStats(){const month=today().slice(0,7),monthEntries=entries.filter(e=>e.date?.startsWith(month)),sport=monthEntries.filter(e=>e.category==='sport').length,us=monthEntries.filter(e=>e.category==='us').length,work=monthEntries.filter(e=>e.category==='work').length;openGeneric(`<div class="modal-head"><h3>▥ Bu ay</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="stat-grid"><div class="stat"><b>${monthEntries.length}</b><span>Kayıt</span></div><div class="stat"><b>${shifts.filter(s=>s.startDate?.startsWith(month)).length}</b><span>Nöbet</span></div><div class="stat"><b>${sport}</b><span>Spor</span></div><div class="stat"><b>${us}</b><span>Nilsu ♡</span></div><div class="stat"><b>${work}</b><span>İş</span></div><div class="stat"><b>${memories.filter(m=>m.date?.startsWith(month)).length}</b><span>Anı</span></div></div>`)}
async function pushStateText(){
  if(!("Notification" in window)) return "Bu tarayıcı bildirim desteklemiyor.";
  if(Notification.permission==="granted") return "Bildirim izni açık.";
  if(Notification.permission==="denied") return "Bildirim tarayıcı ayarından engellenmiş.";
  return "Henüz bildirim izni verilmedi.";
}
function b64ToUint8(base64){
  const padding="=".repeat((4-base64.length%4)%4);
  const raw=atob((base64+padding).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function enablePushNotifications(){
  const msg=$("#pushMsg");
  try{
    if(currentUser?.uid==="demo"){msg.textContent="Demo modunda push kurulmaz.";return;}
    if(!("serviceWorker" in navigator)||!("PushManager" in window)){msg.textContent="Bu tarayıcı web push desteklemiyor.";return;}
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){msg.textContent="Bildirim izni verilmedi.";return;}
    swRegistration=swRegistration||await navigator.serviceWorker.ready;

    const fn=httpsCallable(functions,"getPushPublicKey");
    const res=await fn({});
    const publicKey=res.data?.key;
    if(!publicKey){msg.textContent="Push anahtarı backend'den alınamadı.";return;}

    let sub=await swRegistration.pushManager.getSubscription();
    if(!sub){
      sub=await swRegistration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:b64ToUint8(publicKey)
      });
    }

    const id=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(sub.endpoint))
      .then(buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,40));

    await setDoc(doc(db,"users",currentUser.uid,"pushSubscriptions",id),{
      subscription:sub.toJSON(),
      role:profile?.role||"owner",
      updatedAt:serverTimestamp()
    },{merge:true});

    msg.textContent="✓ Akıllı bildirimler bu cihazda açık.";
  }catch(err){
    console.error(err);
    msg.textContent="Bildirim kurulamadı: "+(err.message||err);
  }
}
async function openNotifications(){
  const state=await pushStateText();
  openGeneric(`<div class="modal-head"><h3>🔔 Akıllı Bildirimler</h3><button class="icon-btn close-generic" type="button">×</button></div>
  <div class="rule-card"><strong>E.log günü kontrol eder</strong><p>Nöbet çıkışında spor bildirimi göndermez; pazartesi Şans'ı, oruç gününü ve gün sonu kaydını bağlama göre hatırlatır.</p></div>
  <div class="rule-card"><strong>Nilsu görünümü</strong><p>Partner hesabında her hareket için bildirim yağdırmak yerine sakin bir günlük özet kullanılabilir.</p></div>
  <button id="enablePushBtn" class="primary-btn full" type="button">Bu cihazda bildirimleri aç</button>
  <p id="pushMsg" class="form-message">${safe(state)}</p>`,()=>{$("#enablePushBtn").onclick=enablePushNotifications;});
}
function openPartner(){openGeneric(`<div class="modal-head"><h3>♡ Nilsu görünümü</h3><button class="icon-btn close-generic" type="button">×</button></div><p>Erol'un ortak veritabanına kaydettiği günlük aktiviteler bu hesapta otomatik görünür. Partner hesabını aynı <b>pairId</b> ile eşleştirmen yeterli.</p><div class="panel-row"><strong>Pair ID</strong><small>${safe(profile?.pairId||'demo-pair')}</small></div>`)}

async function askAI(message){
  addBubble(message,'user'); $("#aiInput").value='';
  if(currentUser.uid==='demo'){const c=getContext();const reply=c.previousShift?'Bugün nöbet çıkışı olduğun için spor eklemem. Önce dinlenme, sonra hafif bir plan öneririm.':'Takvimini, nöbetlerini ve rutinlerini birlikte kontrol ettim. Bana Firebase + OpenAI bağlandığında gerçek verine göre daha ayrıntılı cevap vereceğim.';setTimeout(()=>addBubble(reply,'ai'),350);return;}
  try{const fn=httpsCallable(functions,'elogAssistant');const res=await fn({message});addBubble(res.data.reply||'Cevap alınamadı.','ai')}catch(err){
    console.error(err);
    const msg=String(err?.message||'');
    if(msg.includes('not-found')) addBubble('AI backend henüz deploy edilmemiş görünüyor. README’deki Firebase Functions adımını tamamla.','ai');
    else addBubble('AI bağlantısında hata oldu: '+msg,'ai');
  }
}
function addBubble(text,type){const d=document.createElement('div');d.className=`bubble ${type}`;d.textContent=text;$("#chat").appendChild(d);d.scrollIntoView({behavior:'smooth',block:'end'})}

async function googleLogin(){try{const provider=new GoogleAuthProvider();await signInWithPopup(auth,provider)}catch(e){$("#authMessage").textContent='Google girişi olmadı: '+e.message}}

function wire(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $$('[data-open]').forEach(b=>b.onclick=()=>openModule(b.dataset.open));
  $("#quickAddBtn").onclick=()=>openEntryDialog();$("#calendarAddBtn").onclick=()=>openEntryDialog(selectedDate);$("#entryForm").onsubmit=saveEntry;
  $$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $("#prevMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar()};
  $("#nextMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar()};
  $("#whyBtn").onclick=()=>openGeneric(`<div class="modal-head"><h3>Neden?</h3><button class="icon-btn close-generic" type="button">×</button></div><p>${safe($("#whyBtn").dataset.why||'Takvim ve rutinlerinden çıkardığım sonuca göre.')}</p>`);
  $("#smartPlanBtn").onclick=()=>{switchView('ai');askAI('Bugünkü günümü takvimim, nöbetlerim ve rutinlerime göre planla.')};
  $("#aiForm").onsubmit=e=>{e.preventDefault();const m=$("#aiInput").value.trim();if(m)askAI(m)};
  $("#learnedBtn").onclick=openBrain;
  $("#memoryAddBtn").onclick=()=>openGeneric(`<div class="modal-head"><h3>♡ Eroland'a ekle</h3><button class="icon-btn close-generic" type="button">×</button></div><form id="memoryForm"><label>Başlık<input id="memoryTitle" required placeholder="Örn. Kahve molası"></label><label>Tür<select id="memoryType"><option value="memory">Anı</option><option value="plan">Plan</option><option value="place">Yer</option></select></label><label>Emoji<input id="memoryEmoji" value="♡" maxlength="4"></label><button class="primary-btn full" type="submit">Ekle</button></form>`,()=>{$("#memoryForm").onsubmit=async ev=>{ev.preventDefault();const d={title:$("#memoryTitle").value.trim(),type:$("#memoryType").value,emoji:$("#memoryEmoji").value||'♡',date:today(),createdBy:currentUser.uid};if(currentUser.uid==='demo'){memories.push({id:crypto.randomUUID(),...d});renderMemories()}else {memories.push({id:"local-"+crypto.randomUUID(),...d,_pending:true});saveLocal();renderMemories();try{await addDoc(pairPath('memories'),{...d,createdAt:serverTimestamp()});}catch(e){console.error(e);markSync("anı yerelde kayıtlı",false)}}$("#genericDialog").close()}});
  $$('[data-memory-filter]').forEach(b=>b.onclick=()=>{$$('[data-memory-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderMemories(b.dataset.memoryFilter)});
  $("#googleLoginBtn").onclick=googleLogin;$("#logoutBtn").onclick=()=>auth&&signOut(auth);
  $("#profileBtn").onclick=()=>openGeneric(`<div class="modal-head"><h3>Profil</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="panel-row"><strong>${safe(profile?.name||'Erol')}</strong><small>${safe(profile?.role||'owner')}</small></div>`);
}

loadLocal();
wire();
renderAll();
addBubble('Merhaba. Takvimini, nöbetlerini, rutinlerini ve E.log kurallarını birlikte okuyabilirim. ✦','ai');

(async()=>{
  if("serviceWorker" in navigator){
    try{
      swRegistration=await navigator.serviceWorker.register("./sw.js?v=20260827-repaired1",{updateViaCache:"none"});
      await swRegistration.update();
      if(swRegistration.waiting) swRegistration.waiting.postMessage({type:"SKIP_WAITING"});
      navigator.serviceWorker.addEventListener("controllerchange",()=>{
        const key="elog-sw-reloaded-20260827-repaired1";
        if(sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key,"1");
        location.reload();
      });
    }catch(e){console.warn("Service worker update hatası",e);}
  }
  await initFirebase();
})();
