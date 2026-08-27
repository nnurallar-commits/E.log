import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");
const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>isoDate(new Date());
const fmtTR=d=>new Intl.DateTimeFormat("tr-TR",{weekday:"long",day:"numeric",month:"long"}).format(d);
const monthTR=d=>new Intl.DateTimeFormat("tr-TR",{month:"long",year:"numeric"}).format(d);
const safe=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const time24=v=>String(v||"").replace(/\s*(AM|PM)\s*/ig,"");

let app,auth,db,functions,storage,currentUser=null,profile=null;
let calendarCursor=new Date(),selectedDate=today();
let entries=[],shifts=[],routines=[],memories=[],rules=[],dayEmojis={};
let unsubs=[],activeMemoryFilter="all";

const LOCAL="elog-stable-v2";
const EMOJI_KEY="elog-day-emojis-v2";
function sharedLocalKey(base){return `${base}-${pairId()}`}

const defaultRules=[
  {id:"rule-aquarium",name:"Pazartesi akvaryum",type:"weekday",weekday:1,action:"Şans'ın akvaryumunu temizle",active:true},
  {id:"rule-postshift",name:"Nöbet çıkışı spor yok",type:"after_shift",action:"Spor önerme",active:true}
];

function uuid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}
function pairId(){return profile?.pairId||currentUser?.uid||"local"}
function markSync(t){if($("#syncBadge"))$("#syncBadge").textContent=t}
function loadLocal(){
  try{
    const x=JSON.parse(localStorage.getItem(sharedLocalKey(LOCAL))||localStorage.getItem(LOCAL)||"{}");
    entries=x.entries||[];shifts=x.shifts||[];routines=x.routines||[];memories=x.memories||[];rules=x.rules||[];
  }catch{}
  try{dayEmojis=JSON.parse(localStorage.getItem(sharedLocalKey(EMOJI_KEY))||localStorage.getItem(EMOJI_KEY)||"{}")}catch{dayEmojis={}}
  if(!rules.length)rules=defaultRules.map(x=>({...x,_pending:true}));
}
function saveLocal(){
  localStorage.setItem(sharedLocalKey(LOCAL),JSON.stringify({entries,shifts,routines,memories,rules}));
  localStorage.setItem(sharedLocalKey(EMOJI_KEY),JSON.stringify(dayEmojis));
}
function arr(name){return ({entries,shifts,routines,memories,rules})[name]}
function setArr(name,v){if(name==="entries")entries=v;if(name==="shifts")shifts=v;if(name==="routines")routines=v;if(name==="memories")memories=v;if(name==="rules")rules=v}
function mergeCloud(name,cloud){
  const localPending=(arr(name)||[]).filter(x=>x._pending);
  const m=new Map(cloud.map(x=>[x.id,x]));
  localPending.forEach(x=>m.set(x.id,x));
  setArr(name,[...m.values()]);saveLocal();renderAll();
}

async function initFirebase(){
  try{
    const cfg=(await import("./firebase-config.js")).firebaseConfig;
    app=initializeApp(cfg);auth=getAuth(app);db=getFirestore(app);functions=getFunctions(app,"europe-west1");storage=getStorage(app);
    try{await getRedirectResult(auth)}catch{}
    onAuthStateChanged(auth,handleAuth);
  }catch(e){console.error(e);markSync("● yerel");}
}
async function handleAuth(user){
  currentUser=user;
  if(!user){profile=null;clearListeners();$("#authDialog")?.showModal();markSync("● giriş yok");return}
  $("#authDialog")?.close();
  await ensureProfile(user);
  loadLocal();
  renderAll();
  startRealtime();
  flushPending();
  syncDayEmojis();
}
async function ensureProfile(user){
  let data=null;
  try{const s=await getDoc(doc(db,"users",user.uid));if(s.exists())data=s.data()}catch{}
  if(!data){
    data=JSON.parse(localStorage.getItem("elog-profile-"+user.uid)||"null");
  }
  if(!data){
    await firstSetup(user);return;
  }
  profile=data;localStorage.setItem("elog-profile-"+user.uid,JSON.stringify(profile));
}
function firstSetup(user){
  return new Promise(resolve=>{
    openGeneric(`<div class="modal-head"><h3>E.log'a hoş geldin 🌿</h3></div>
    <form id="firstSetupForm"><label>Ben<select id="setupRole"><option value="owner">Erol</option><option value="partner">Nilsu</option></select></label>
    <label id="pairWrap" style="display:none">Erol'un Pair ID'si<input id="setupPair"></label>
    <button class="primary-btn full" type="submit">Devam et</button></form>`,()=>{
      $("#setupRole").onchange=()=>$("#pairWrap").style.display=$("#setupRole").value==="partner"?"block":"none";
      $("#firstSetupForm").onsubmit=async e=>{
        e.preventDefault();const role=$("#setupRole").value,pair=$("#setupPair").value.trim();
        if(role==="partner"&&!pair)return;
        profile={name:role==="owner"?"Erol":"Nilsu",role,pairId:role==="owner"?user.uid:pair};
        localStorage.setItem("elog-profile-"+user.uid,JSON.stringify(profile));
        try{await setDoc(doc(db,"users",user.uid),{...profile,updatedAt:serverTimestamp()},{merge:true})}catch{}
        $("#genericDialog").close();resolve();
      };
    });
  });
}
function clearListeners(){unsubs.forEach(fn=>{try{fn()}catch{}});unsubs=[]}
function pairCol(name){return collection(db,"pairs",pairId(),name)}
function pairDoc(name,id){return doc(db,"pairs",pairId(),name,id)}
function startRealtime(){
  clearListeners();
  [["entries","date"],["shifts","startDate"],["routines","name"],["memories","date"],["rules","name"]].forEach(([name,sort])=>{
    try{
      const q=query(pairCol(name),orderBy(sort));
      unsubs.push(onSnapshot(q,snap=>{mergeCloud(name,snap.docs.map(d=>({id:d.id,...d.data(),_pending:false})));markSync("● canlı")},err=>{console.warn(err);markSync("● telefonda")}));
    }catch(e){console.warn(e)}
  });
  try{
    unsubs.push(onSnapshot(pairDoc("shared","dayEmojis"),snap=>{
      if(snap.exists()){
        dayEmojis=snap.data().values||{};
        saveLocal();renderCalendar();renderDayDetail();
      }
      markSync("● canlı");
    },err=>{console.warn(err);markSync("● telefonda")}));
  }catch(e){console.warn(e)}
}
async function cloudSave(name,item){
  if(!db||!currentUser)return false;
  const clean={...item};delete clean._pending;
  try{await setDoc(pairDoc(name,item.id),{...clean,updatedAt:serverTimestamp()},{merge:true});item._pending=false;saveLocal();markSync("● canlı");return true}
  catch(e){console.warn(e);item._pending=true;saveLocal();markSync("● telefonda");return false}
}
async function flushPending(){
  for(const name of ["entries","shifts","routines","memories","rules"]){
    for(const item of (arr(name)||[]).filter(x=>x._pending))await cloudSave(name,item);
  }
}


function nextScheduledItem(){
  const now=new Date(),c=[];
  entries.forEach(e=>{
    if(!e.date||!e.time)return;
    const d=new Date(`${e.date}T${e.time}:00`);
    if(d>=now)c.push({d,title:(e.kind==="overtime"?"💼 ":"")+e.title,meta:`${formatDateTR(e.date)} · ${time24(e.time)}${e.endTime?`–${time24(e.endTime)}`:""}`});
  });
  shifts.forEach(sh=>{
    const d=new Date(`${sh.startDate}T08:30:00`);
    if(d>=now)c.push({d,title:"🩻 Nöbet",meta:`${formatDateTR(sh.startDate)} · 08:30 → ertesi gün 08:30`});
  });
  return c.sort((a,b)=>a.d-b.d)[0]||null;
}
function renderProductivityHome(){
  const a=$("#nextItemTitle"),b=$("#nextItemMeta"); if(!a||!b)return;
  const n=nextScheduledItem();
  a.textContent=n?n.title:"Yaklaşan plan yok";
  b.textContent=n?n.meta:"Hızlı ekle ile gününü oluştur.";
}
function renderAll(){
  renderProductivityHome();
  if($("#todayLabel"))$("#todayLabel").textContent=fmtTR(new Date());
  if($("#heroGreeting"))$("#heroGreeting").textContent=`Merhaba ${profile?.name||"Erol"} 👋`;
  renderToday();renderCalendar();renderMemories(activeMemoryFilter);renderSmart();renderShiftMini();checkReminders();checkShiftNotifications();
}
function categoryName(c){return ({work:"İş",sport:"Spor",food:"Yemek",us:"Nilsu ♡",personal:"Kişisel",general:"Genel"})[c]||"Genel"}
function categoryIcon(c){return ({work:"💼",sport:"🏋️",food:"🍽️",us:"❤️",personal:"✨",general:"•"})[c]||"•"}
function renderToday(){
  const el=$("#todayTimeline");if(!el)return;
  const list=entries.filter(e=>e.date===today()).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  el.innerHTML=list.length?list.map(e=>`<button class="timeline-item" data-entry="${e.id}" type="button"><span class="time">${safe(time24(e.time)||"--:--")}${e.endTime?`–${safe(time24(e.endTime))}`:""}</span><span><strong>${safe(e.title)}</strong><small>${safe(e.note||categoryName(e.category))}</small></span><i class="status-dot ${e.done?"done":""}"></i></button>`).join(""):'<div class="empty">Bugün henüz kayıt yok.</div>';
  $$("[data-entry]",el).forEach(b=>b.onclick=()=>openEntryActions(b.dataset.entry));
}
function renderCalendar(){
  if(!$("#calendarGrid"))return;
  $("#monthTitle").textContent=monthTR(calendarCursor);
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),start=(first.getDay()+6)%7,grid=[];
  for(let i=0;i<42;i++)grid.push(new Date(y,m,1-start+i));
  $("#calendarGrid").innerHTML=grid.map(d=>{
    const ds=isoDate(d),shift=shifts.find(s=>s.startDate===ds),manual=getDayEmojis(ds),icons=[];
    if(shift)icons.push("🩻");
    entries.filter(e=>e.date===ds).forEach(e=>{const ic=categoryIcon(e.category);if(ic!=="•"&&!icons.includes(ic))icons.push(ic)});
    return `<button class="day-cell ${d.getMonth()!==m?"out":""} ${ds===today()?"today":""} ${ds===selectedDate?"selected":""}" data-date="${ds}" type="button">
      <span class="day-number">${d.getDate()}</span><span class="calendar-day-icons">${[...manual,...icons].slice(0,4).map(e=>`<span>${safe(e)}</span>`).join("")}</span></button>`;
  }).join("");
  $$("[data-date]").forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;renderCalendar();renderDayDetail()});
  renderDayDetail();
}
function renderDayDetail(){
  const el=$("#calendarDayDetail");if(!el)return;
  const list=entries.filter(e=>e.date===selectedDate).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  const sh=shifts.find(s=>s.startDate===selectedDate),ems=getDayEmojis(selectedDate);
  el.innerHTML=`<div class="day-detail-head"><h3>${fmtTR(new Date(selectedDate+"T12:00:00"))}</h3><button id="dayEmojiBtn" class="text-btn" type="button">＋ Emoji</button></div>
  ${ems.length?`<div class="selected-day-emojis">${ems.map(e=>`<button data-remove-emoji="${safe(e)}" type="button">${safe(e)} ×</button>`).join("")}</div>`:""}
  ${sh?`<div class="panel-row"><strong>🩻 Nöbet</strong><small>08:30 → ertesi gün 08:30</small></div>`:""}
  ${list.length?list.map(e=>`<div class="panel-row"><strong>${safe(time24(e.time))}${e.endTime?`–${safe(time24(e.endTime))}`:""} · ${safe(e.title)}</strong><small>${safe(e.note||categoryName(e.category))}</small></div>`).join(""):'<div class="empty">Bu gün boş.</div>'}`;
  $("#dayEmojiBtn").onclick=()=>openDayEmojiPicker(selectedDate);
  $$("[data-remove-emoji]",el).forEach(b=>b.onclick=()=>removeDayEmoji(selectedDate,b.dataset.removeEmoji));
}
function getDayEmojis(date){const v=dayEmojis[date];return !v?[]:(Array.isArray(v)?v:[v])}
async function syncDayEmojis(){if(!db||!currentUser)return false;try{await setDoc(pairDoc("shared","dayEmojis"),{values:dayEmojis,updatedAt:serverTimestamp()},{merge:false});markSync("● canlı");return true}catch(e){console.warn(e);markSync("● telefonda");return false}}
function addDayEmoji(date,e){const a=getDayEmojis(date);if(a.length>=4||a.includes(e))return;a.push(e);dayEmojis[date]=a;saveLocal();renderCalendar();renderDayDetail();syncDayEmojis()}
function removeDayEmoji(date,e){const a=getDayEmojis(date).filter(x=>x!==e);if(a.length)dayEmojis[date]=a;else delete dayEmojis[date];saveLocal();renderCalendar();renderDayDetail();syncDayEmojis()}
function openDayEmojiPicker(date){
  const presets=["❤️","🥰","✨","🏋️","☕","🍽️","🎬","🎮","🌿","🩻","🐟","🎉"];
  openGeneric(`<div class="modal-head"><h3>Emoji ekle</h3><button class="icon-btn close-generic" type="button">×</button></div><div class="emoji-picker-grid">${presets.map(e=>`<button data-emoji="${e}" class="emoji-choice" type="button">${e}</button>`).join("")}</div>`,()=>{
    $$("[data-emoji]",$("#genericContent")).forEach(b=>b.onclick=()=>{addDayEmoji(date,b.dataset.emoji);$("#genericDialog").close()});
  });
}
function renderSmart(){
  if(!$("#smartTitle"))return;
  const t=today(),postShift=shifts.some(s=>s.endDate===t),monday=new Date().getDay()===1;
  let title="Sana göre",text="Günün akışını öğreniyorum.",why="Takvim ve rutinlerine bakıyorum.";
  if(postShift){title="Nöbet çıkışı modu";text="Bugün 08:30'da nöbetten çıktın. Spor önermiyorum.";why="Nöbet çıkışı kuralın aktif."}
  else if(monday){title="Pazartesi rutini 🐟";text="Şans'ın akvaryumunu temizleme günün.";why="Pazartesi rutinin aktif."}
  $("#smartTitle").textContent=title;$("#smartText").textContent=text;$("#whyBtn").dataset.why=why;
}
function renderShiftMini(){const el=$("#shiftMini");if(!el)return;const n=shifts.filter(s=>s.startDate>=today()).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0];el.textContent=n?`${n.startDate} · 08:30`:"Yaklaşan nöbet yok"}

function openEntryDialog(date=today()){$("#entryForm").reset();$("#entryDate").value=date;$("#entryTime").value=new Date().toTimeString().slice(0,5);$("#entryDialog").showModal()}
async function saveEntry(e){
  e.preventDefault();const item={id:uuid(),date:$("#entryDate").value,time:$("#entryTime").value,title:$("#entryTitle").value.trim(),note:$("#entryNote").value.trim(),category:$("#entryCategory").value,done:$("#entryDone").checked,createdBy:currentUser?.uid||"local",_pending:true};
  entries.push(item);saveLocal();renderAll();$("#entryDialog").close();await cloudSave("entries",item);
}
function openEntryActions(id){
  const e=entries.find(x=>x.id===id);if(!e)return;
  openGeneric(`<div class="modal-head"><h3>${safe(e.title)}</h3><button class="icon-btn close-generic" type="button">×</button></div><button id="toggleDone" class="primary-btn full" type="button">${e.done?"Tamamlanmadı yap":"Tamamlandı ✓"}</button><button id="deleteEntry" class="secondary-btn full" type="button">Sil</button>`,()=>{
    $("#toggleDone").onclick=async()=>{e.done=!e.done;e._pending=true;saveLocal();renderAll();await cloudSave("entries",e);$("#genericDialog").close()};
    $("#deleteEntry").onclick=async()=>{entries=entries.filter(x=>x.id!==id);saveLocal();renderAll();if(db)try{await deleteDoc(pairDoc("entries",id))}catch{}$("#genericDialog").close()};
  });
}
function shiftEndDate(date){const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+1);return isoDate(d)}
async function saveShift(date){
  if(shifts.some(x=>x.startDate===date))return;
  const item={id:uuid(),startDate:date,startTime:"08:30",endDate:shiftEndDate(date),endTime:"08:30",type:"Tomografi",createdBy:currentUser?.uid||"local",_pending:true};
  shifts.push(item);saveLocal();renderAll();await cloudSave("shifts",item);
}
function openShifts(){
  let cursor=new Date(),selected=new Set();
  openGeneric(`<div class="modal-head"><h3>🩻 Nöbetlerim</h3><button class="icon-btn close-generic" type="button">×</button></div>
  <div class="rule-card"><strong>Saatler sabit</strong><p>08:30'da başlar → ertesi gün 08:30'da biter.</p></div>
  <div class="calendar-toolbar"><button id="shiftPrev" class="icon-btn">‹</button><strong id="shiftMonth"></strong><button id="shiftNext" class="icon-btn">›</button></div>
  <div id="shiftGrid" class="shift-pick-grid"></div><button id="saveShifts" class="primary-btn full">Seçili nöbetleri kaydet</button>
  <div id="shiftList" class="panel-list"></div>`,()=>{
    const draw=()=>{const y=cursor.getFullYear(),m=cursor.getMonth(),off=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();$("#shiftMonth").textContent=monthTR(cursor);let h="";for(let i=0;i<off;i++)h+="<span></span>";for(let d=1;d<=days;d++){const ds=isoDate(new Date(y,m,d)),has=shifts.some(x=>x.startDate===ds),sel=selected.has(ds);h+=`<button class="shift-pick-day ${has?"already":""} ${sel?"chosen":""}" data-shift-date="${ds}" type="button">${d}${has?" 🩻":sel?" ✓":""}</button>`}$("#shiftGrid").innerHTML=h;$$("[data-shift-date]",$("#shiftGrid")).forEach(b=>b.onclick=()=>{if(shifts.some(x=>x.startDate===b.dataset.shiftDate))return;selected.has(b.dataset.shiftDate)?selected.delete(b.dataset.shiftDate):selected.add(b.dataset.shiftDate);draw()});drawList()};
    const drawList=()=>{$("#shiftList").innerHTML=[...shifts].sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(s=>`<div class="panel-row"><strong>${safe(s.startDate)}</strong><small>08:30 → ertesi gün 08:30</small><button data-delete-shift="${s.id}" class="text-btn">Sil</button></div>`).join("")||'<div class="empty">Henüz nöbet yok.</div>';$$("[data-delete-shift]",$("#shiftList")).forEach(b=>b.onclick=async()=>{const id=b.dataset.deleteShift;shifts=shifts.filter(x=>x.id!==id);saveLocal();renderAll();if(db)try{await deleteDoc(pairDoc("shifts",id))}catch{}draw()})};
    $("#shiftPrev").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);draw()};$("#shiftNext").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);draw()};
    $("#saveShifts").onclick=async()=>{for(const d of [...selected])await saveShift(d);selected.clear();draw()};draw();
  });
}

function memoryTypeName(t){return ({memory:"Anı",plan:"Plan",place:"Yer"})[t]||"Anı"}
function calcReminder(date,mode,custom){
  const d=new Date(date+"T12:00:00");
  if(mode==="1m")d.setMonth(d.getMonth()+1);else if(mode==="6m")d.setMonth(d.getMonth()+6);else if(mode==="1y")d.setFullYear(d.getFullYear()+1);else if(mode==="custom"&&custom)return custom;else return "";
  return isoDate(d);
}
async function uploadMedia(memoryId,files){
  const out=[];if(!files?.length)return out;
  for(const file of files){
    try{
      const r=storageRef(storage,`pairs/${pairId()}/memories/${memoryId}/${Date.now()}-${file.name}`);
      await uploadBytes(r,file);out.push({url:await getDownloadURL(r),type:file.type.startsWith("video/")?"video":"image",name:file.name});
    }catch(e){console.error("media upload",e)}
  }
  return out;
}
function renderMemories(filter="all"){
  activeMemoryFilter=filter;const grid=$("#memoryGrid");if(!grid)return;
  const list=memories.filter(m=>filter==="all"||m.type===filter).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  grid.innerHTML=list.length?list.map(m=>`<button class="memory-card memory-click" data-memory-id="${m.id}" type="button"><div class="emoji">${safe(m.emoji||"♡")}</div>${m.media?.[0]?.type==="image"?`<img class="memory-cover" src="${safe(m.media[0].url)}">`:m.media?.[0]?.type==="video"?`<video class="memory-cover" src="${safe(m.media[0].url)}" muted></video>`:""}<span class="memory-kind">${memoryTypeName(m.type)}</span><h4>${safe(m.title)}</h4><p>${safe(m.date||"")}</p>${m.reminderDate?`<small>🔔 ${safe(m.reminderDate)}</small>`:""}</button>`).join(""):'<div class="empty">Henüz bir şey yok. + Anı ile ekleyebilirsin.</div>';
  $$("[data-memory-id]",grid).forEach(b=>b.onclick=()=>openMemoryActions(b.dataset.memoryId));
}
function openMemoryForm(existing=null){
  openGeneric(`<div class="modal-head"><h3>${existing?"Düzenle":"♡ Eroland'a ekle"}</h3><button class="icon-btn close-generic" type="button">×</button></div>
  <form id="memoryForm"><label>Başlık<input id="memoryTitle" required value="${safe(existing?.title||"")}"></label>
  <label>Tür<select id="memoryType"><option value="memory">Anı</option><option value="plan">Plan</option><option value="place">Yer</option></select></label>
  <div class="form-row"><label>Tarih<input id="memoryDate" type="date" value="${safe(existing?.date||today())}"></label><label>Emoji<input id="memoryEmoji" value="${safe(existing?.emoji||"♡")}" maxlength="8"></label></div>
  <label>Not<textarea id="memoryNote" rows="3">${safe(existing?.note||"")}</textarea></label>
  <label>Fotoğraf / video<input id="memoryMedia" type="file" accept="image/*,video/*" multiple></label>
  <label>Hatırlat<select id="memoryReminder"><option value="">Hatırlatma yok</option><option value="1m">1 ay sonra</option><option value="6m">6 ay sonra</option><option value="1y">1 yıl sonra</option><option value="custom">Özel tarih</option></select></label>
  <label id="customReminderWrap" style="display:none">Hatırlatma tarihi<input id="memoryReminderCustom" type="date"></label>
  <button class="primary-btn full" type="submit">Kaydet</button><p id="memoryMsg" class="form-message"></p></form>`,()=>{
    $("#memoryType").value=existing?.type||"memory";$("#memoryReminder").onchange=()=>$("#customReminderWrap").style.display=$("#memoryReminder").value==="custom"?"block":"none";
    $("#memoryForm").onsubmit=async e=>{
      e.preventDefault();const id=existing?.id||uuid(),date=$("#memoryDate").value||today(),mode=$("#memoryReminder").value;
      $("#memoryMsg").textContent="Kaydediliyor...";
      const media=[...(existing?.media||[]),...await uploadMedia(id,[...$("#memoryMedia").files])];
      const item={id,title:$("#memoryTitle").value.trim(),type:$("#memoryType").value,emoji:$("#memoryEmoji").value||"♡",date,note:$("#memoryNote").value.trim(),media,reminderDate:calcReminder(date,mode,$("#memoryReminderCustom").value),createdBy:existing?.createdBy||currentUser?.uid||"local",_pending:true};
      const ix=memories.findIndex(x=>x.id===id);if(ix>=0)memories[ix]=item;else memories.push(item);saveLocal();renderAll();$("#genericDialog").close();await cloudSave("memories",item);
    };
  });
}
function openMemoryActions(id){
  const m=memories.find(x=>x.id===id);if(!m)return;
  openGeneric(`<div class="modal-head"><h3>${safe(m.emoji||"♡")} ${safe(m.title)}</h3><button class="icon-btn close-generic" type="button">×</button></div>${m.note?`<p>${safe(m.note)}</p>`:""}${(m.media||[]).map(x=>x.type==="video"?`<video class="memory-media" controls src="${safe(x.url)}"></video>`:`<img class="memory-media" src="${safe(x.url)}">`).join("")}<button id="editMemory" class="secondary-btn full">Düzenle</button><button id="deleteMemory" class="secondary-btn full">Sil</button>`,()=>{
    $("#editMemory").onclick=()=>{$("#genericDialog").close();openMemoryForm(m)};
    $("#deleteMemory").onclick=async()=>{memories=memories.filter(x=>x.id!==id);saveLocal();renderAll();if(db)try{await deleteDoc(pairDoc("memories",id))}catch{}$("#genericDialog").close()};
  });
}

function checkReminders(){
  const t=today();
  memories.filter(m=>m.reminderDate===t).forEach(m=>{
    const k=`elog-reminder-${m.id}-${t}`;if(localStorage.getItem(k))return;
    if("Notification" in window&&Notification.permission==="granted")new Notification("Eroland hatırlatma ♡",{body:m.title,icon:"./icon-192.png"});
    localStorage.setItem(k,"1");
  });
}
function checkShiftNotifications(){
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  shifts.forEach(s=>{const mins=(new Date(`${s.startDate}T08:30:00`)-new Date())/60000;for(const [key,min,max,msg] of [["24",1380,1440,"Yarın 08:30'da nöbetin var 🩻"],["2",60,120,"Nöbetin 08:30'da başlıyor 🩻"]]){const k=`shift-${s.id}-${key}`;if(mins>min&&mins<=max&&!localStorage.getItem(k)){new Notification("E.log",{body:msg,icon:"./icon-192.png"});localStorage.setItem(k,"1")}}});
}

function normalizeTR(x){
  return String(x||"").toLocaleLowerCase("tr-TR")
    .replace(/[’']/g,"'")
    .replace(/\s+/g," ")
    .trim();
}
function nextWeekdayDate(target){
  const now=new Date(),cur=(now.getDay()+6)%7;
  let diff=(target-cur+7)%7;
  if(diff===0)diff=7;
  const d=new Date(now);d.setDate(now.getDate()+diff);return isoDate(d);
}
function resolveNaturalDate(text){
  const x=normalizeTR(text),now=new Date();
  if(/\bbugün\b/.test(x))return today();
  if(/\byarın\b/.test(x)){const d=new Date(now);d.setDate(d.getDate()+1);return isoDate(d)}
  if(/\böbür gün\b|\böbürgun\b|\böbürgün\b/.test(x)){const d=new Date(now);d.setDate(d.getDate()+2);return isoDate(d)}
  const wd=[
    [/\b(pzt|pazartesi)\b/,0],[/\b(sal|salı)\b/,1],[/\b(çar|çarşamba)\b/,2],
    [/\b(per|perşembe)\b/,3],[/\b(cum|cuma)\b/,4],[/\b(cmt|cumartesi)\b/,5],[/\b(paz|pazar)\b/,6]
  ];
  for(const [r,i] of wd)if(r.test(x))return nextWeekdayDate(i);

  let m=x.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\b/);
  if(m){
    let y=m[3]?Number(m[3]):now.getFullYear();if(y<100)y+=2000;
    return `${y}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }
  return null;
}
function parseClockToken(token){
  const t=String(token||"").trim().replace(",",".");
  let m=t.match(/^(\d{1,2})(?:[.:](\d{1,2}))?$/);
  if(!m)return null;
  let h=Number(m[1]),min=m[2]?Number(m[2]):0;
  if(h>23||min>59)return null;
  return `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
}
function extractTimeRange(text){
  const x=normalizeTR(text);
  let m=x.match(/\b(\d{1,2}(?:[.:]\d{1,2})?)\s*(?:-|–|—|ile|den|dan|ten|tan)\s*(\d{1,2}(?:[.:]\d{1,2})?)\b/);
  if(m){
    const a=parseClockToken(m[1]),b=parseClockToken(m[2]);
    if(a&&b)return {start:a,end:b};
  }
  const tokens=[...x.matchAll(/\b\d{1,2}(?:[.:]\d{1,2})?\b/g)].map(v=>parseClockToken(v[0])).filter(Boolean);
  if(tokens.length>=2)return {start:tokens[0],end:tokens[1]};
  if(tokens.length===1)return {start:tokens[0],end:null};
  return {start:null,end:null};
}
function inferNaturalCategory(text){
  const x=normalizeTR(text);
  if(/ekstra mesai|fazla mesai|mesai/.test(x))return {category:"work",title:"Ekstra mesai"};
  if(/spor|gym|fitness|antrenman/.test(x))return {category:"sport",title:"Spor"};
  if(/kahve/.test(x))return {category:"food",title:"Kahve"};
  if(/yemek|akşam yemeği|öğle/.test(x))return {category:"food",title:"Yemek"};
  if(/nilsu|biz|buluş/.test(x))return {category:"us",title:"Nilsu ♡"};
  if(/iş|toplantı|meeting/.test(x))return {category:"work",title:"İş"};
  if(/diş|doktor|hastane/.test(x))return {category:"personal",title:"Randevu"};
  return {category:"general",title:"Plan"};
}
async function addNaturalEntryFromText(text){
  const date=resolveNaturalDate(text);
  const {start,end}=extractTimeRange(text);
  const info=inferNaturalCategory(text);
  if(!date||!start)return null;

  const item={
    id:uuid(),date,time:start,endTime:end||"",
    title:info.title,note:String(text).trim(),category:info.category,
    done:false,createdBy:currentUser?.uid||"local",_pending:true
  };
  entries.push(item);saveLocal();renderAll();
  await cloudSave("entries",item);
  return item;
}
function formatDateTR(date){
  try{return new Intl.DateTimeFormat("tr-TR",{weekday:"long",day:"numeric",month:"long"}).format(new Date(date+"T12:00:00"))}
  catch{return date}
}
function entriesForNaturalDate(text){
  const d=resolveNaturalDate(text);
  return d?entries.filter(e=>e.date===d).sort((a,b)=>(a.time||"").localeCompare(b.time||"")):[];
}
function localSmartReply(q){
  const x=normalizeTR(q),t=today(),targetDate=resolveNaturalDate(x);
  const targetEntries=entriesForNaturalDate(x);

  if(/^(selam|merhaba|hey|sa|naber)\b/.test(x))
    return `Selam ${profile?.name||""} ✦ Ne planlayalım?`;

  if((/\bne yaptım\b|\bne yaptik\b|\bne yaptım\?/.test(x))&&targetDate){
    return targetEntries.length
      ? `${formatDateTR(targetDate)}: ${targetEntries.map(e=>`${time24(e.time)}${e.endTime?`–${time24(e.endTime)}`:""} ${e.title}`).join(" · ")}`
      : `${formatDateTR(targetDate)} için kayıt görünmüyor.`;
  }

  if((/\bne yapacağım\b|\bne yapicam\b|\bne var\b|\bprogram\b|\bplanım\b/.test(x))&&targetDate){
    const sh=shifts.find(s=>s.startDate===targetDate);
    const parts=[];
    if(sh)parts.push("08:30 nöbet başlangıcı");
    parts.push(...targetEntries.map(e=>`${time24(e.time)}${e.endTime?`–${time24(e.endTime)}`:""} ${e.title}`));
    return parts.length?`${formatDateTR(targetDate)}: ${parts.join(" · ")}`:`${formatDateTR(targetDate)} için plan yok.`;
  }

  if(x.includes("ekstra mesai")||x.includes("fazla mesai")){
    const list=overtimeEntries().filter(e=>e.date>=t).sort((a,b)=>a.date.localeCompare(b.date));
    return list.length
      ? `Yaklaşan ekstra mesailerin: ${list.slice(0,5).map(e=>`${formatDateTR(e.date)} ${time24(e.time)}–${time24(e.endTime)}`).join(" · ")}`
      : "Yaklaşan ekstra mesai kaydı yok.";
  }

  if(x.includes("nöbet")){
    const future=shifts.filter(s=>s.startDate>=t).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    return future.length?`Yaklaşan nöbetlerin: ${future.slice(0,5).map(s=>`${s.startDate} 08:30`).join(" · ")}. Her nöbet ertesi gün 08:30'da bitiyor.`:"Yaklaşan nöbet kaydı yok.";
  }

  if(x.includes("spor")){
    const post=shifts.find(s=>s.endDate===t),todayShift=shifts.find(s=>s.startDate===t);
    return post?"Bugün 08:30'da nöbetten çıktığın için sporu pas geçmeni öneriyorum.":todayShift?"Bugün nöbet günün. Sporu hafif tut.":"Bugün nöbet engeli görünmüyor.";
  }

  return "Bana doğal şekilde yazabilirsin: “yarın 8.30-16 ekstra mesai”, “salı 18 spor”, “pzt ne yapacağım?” gibi.";
}
async function askAI(message){
  addBubble(message,"user");
  $("#aiInput").value="";

  const x=normalizeTR(message);
  const commandLike=/ekstra mesai|fazla mesai|mesai|spor|kahve|yemek|iş|toplantı|diş|doktor|buluş/.test(x);
  const hasActionDate=!!resolveNaturalDate(x);
  const times=extractTimeRange(x);

  if(commandLike&&hasActionDate&&times.start&&!/\b(ne yap|ne var|program|planım|ne yapt)/.test(x)){
    const item=await addNaturalEntryFromText(message);
    if(item){
      addBubble(`✓ ${formatDateTR(item.date)} için ${item.title} eklendi: ${time24(item.time)}${item.endTime?`–${time24(item.endTime)}`:""}.`,"ai");
      return;
    }
  }

  const localReply=localSmartReply(message);
  addBubble(localReply,"ai");

  try{
    if(functions){
      const fn=httpsCallable(functions,"elogAssistant");
      const res=await Promise.race([
        fn({message}),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),1800))
      ]);
      const remote=res?.data?.reply?.trim();
      if(remote&&remote!==localReply)addBubble(remote,"ai");
    }
  }catch(e){
    console.warn("AI backend yok; yerel asistan kullanılıyor.",e);
  }
}
function addBubble(text,type){const d=document.createElement("div");d.className=`bubble ${type}`;d.textContent=text;$("#chat").appendChild(d);d.scrollIntoView({behavior:"smooth",block:"end"})}


function timeOptions(selected=""){
  let out="";
  for(let h=0;h<24;h++){
    for(let m=0;m<60;m+=30){
      const v=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      out+=`<option value="${v}"${v===selected?" selected":""}>${v}</option>`;
    }
  }
  return out;
}
function overtimeEntries(){
  return entries.filter(e=>e.category==="work" && (e.kind==="overtime" || /ekstra mesai|fazla mesai/i.test(e.title||"")));
}
function openOvertime(){
  const sorted=[...overtimeEntries()].sort((a,b)=>(b.date+(b.time||"")).localeCompare(a.date+(a.time||"")));
  openGeneric(`
    <div class="modal-head">
      <div><p class="eyebrow">İŞ</p><h3>💼 Ekstra Mesai</h3></div>
      <button class="icon-btn close-generic" type="button">×</button>
    </div>

    <div class="rule-card">
      <strong>Normal nöbetten ayrı</strong>
      <p>Buraya sadece ekstra mesai saatlerini kaydet.</p>
    </div>

    <form id="overtimeForm">
      <label>Tarih
        <input id="overtimeDate" type="date" required value="${today()}">
      </label>
      <div class="form-row">
        <label>Başlangıç
          <select id="overtimeStart" required>${timeOptions("08:30")}</select>
        </label>
        <label>Bitiş
          <select id="overtimeEnd" required>${timeOptions("16:00")}</select>
        </label>
      </div>
      <label>Not
        <input id="overtimeNote" placeholder="Örn. Ekstra mesai">
      </label>
      <button class="primary-btn full" type="submit">Ekstra mesaiyi kaydet</button>
      <p id="overtimeMsg" class="form-message"></p>
    </form>

    <div class="shift-list-title">
      <strong>Kayıtlı ekstra mesailer</strong>
      <span>${sorted.length}</span>
    </div>
    <div class="panel-list">
      ${sorted.length ? sorted.map(e=>`
        <div class="panel-row overtime-row">
          <div>
            <strong>💼 ${safe(formatDateTR(e.date))}</strong>
            <small>${safe(time24(e.time))}–${safe(time24(e.endTime))}${e.note?` · ${safe(e.note)}`:""}</small>
          </div>
          <button class="text-btn delete-overtime" data-overtime-id="${e.id}" type="button">Sil</button>
        </div>
      `).join("") : '<div class="empty">Henüz ekstra mesai yok.</div>'}
    </div>
  `,()=>{
    $("#overtimeForm").onsubmit=async ev=>{
      ev.preventDefault();
      const item={
        id:uuid(),
        date:$("#overtimeDate").value,
        time:$("#overtimeStart").value,
        endTime:$("#overtimeEnd").value,
        title:"Ekstra mesai",
        note:$("#overtimeNote").value.trim(),
        category:"work",
        kind:"overtime",
        done:false,
        createdBy:currentUser?.uid||"local",
        _pending:true
      };
      entries.push(item);
      saveLocal();
      renderAll();
      $("#overtimeMsg").textContent="✓ Ekstra mesai kaydedildi.";
      await cloudSave("entries",item);
      setTimeout(()=>{ $("#genericDialog").close(); openOvertime(); },350);
    };

    $$(".delete-overtime").forEach(b=>b.onclick=async()=>{
      const id=b.dataset.overtimeId;
      entries=entries.filter(x=>x.id!==id);
      saveLocal();
      renderAll();
      if(db)try{await deleteDoc(pairDoc("entries",id))}catch{}
      $("#genericDialog").close();
      openOvertime();
    });
  });
}

function openRoutines(){openGeneric(`<div class="modal-head"><h3>↻ Rutinler & Kurallar</h3><button class="icon-btn close-generic">×</button></div>${rules.map(r=>`<div class="rule-card"><strong>${safe(r.name)}</strong><p>${safe(r.action)}</p></div>`).join("")}`)}
function openBrain(){openRoutines()}
function openStats(){openGeneric(`<div class="modal-head"><h3>▥ Bu ay</h3><button class="icon-btn close-generic">×</button></div><div class="stat-grid"><div class="stat"><b>${entries.length}</b><span>Kayıt</span></div><div class="stat"><b>${shifts.length}</b><span>Nöbet</span></div><div class="stat"><b>${memories.length}</b><span>Eroland</span></div></div>`)}
function openNotifications(){openGeneric(`<div class="modal-head"><h3>🔔 Bildirimler</h3><button class="icon-btn close-generic">×</button></div><button id="notifyBtn" class="primary-btn full">Bildirimleri aç</button>`,()=>{$("#notifyBtn").onclick=async()=>{if("Notification" in window)await Notification.requestPermission();$("#genericDialog").close()}})}
function openPartner(){openGeneric(`<div class="modal-head"><h3>♡ Nilsu görünümü</h3><button class="icon-btn close-generic">×</button></div><div class="panel-row"><strong>Pair ID</strong><small>${safe(pairId())}</small></div>`)}
function openModule(n){if(n==="shifts")openShifts();if(n==="overtime")openOvertime();if(n==="pair")openPairInfo();if(n==="routines")openRoutines();if(n==="brain")openBrain();if(n==="stats")openStats();if(n==="notifications")openNotifications();if(n==="partner")openPartner();if(n==="eroland")switchView("eroland")}
function openGeneric(html,after){$("#genericContent").innerHTML=html;$("#genericDialog").showModal();$(".close-generic")?.addEventListener("click",()=>$("#genericDialog").close());after?.()}
function switchView(name){const t=document.getElementById(`view-${name}`);if(!t)return;$$(".view").forEach(v=>v.classList.remove("active"));t.classList.add("active");$$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));if(name==="calendar")renderCalendar();if(name==="eroland")renderMemories(activeMemoryFilter);window.scrollTo(0,0)}
async function googleLogin(){const p=new GoogleAuthProvider();try{/iPhone|iPad|Android/i.test(navigator.userAgent)?await signInWithRedirect(auth,p):await signInWithPopup(auth,p)}catch(e){$("#authMessage").textContent=e.message}}

function wire(){
  $$(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $$("[data-open]").forEach(b=>b.onclick=()=>openModule(b.dataset.open));
  $("#quickAddBtn").onclick=()=>openEntryDialog();$("#calendarAddBtn").onclick=()=>openEntryDialog(selectedDate);$("#entryForm").onsubmit=saveEntry;
  $$(".close-dialog").forEach(b=>b.onclick=()=>b.closest("dialog").close());
  $("#prevMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar()};$("#nextMonth").onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar()};
  $("#whyBtn").onclick=()=>openGeneric(`<div class="modal-head"><h3>Neden?</h3><button class="icon-btn close-generic">×</button></div><p>${safe($("#whyBtn").dataset.why||"Takvimine göre.")}</p>`);
  $("#smartPlanBtn").onclick=()=>{switchView("ai");askAI("Bugünkü günümü planla")};$("#aiForm").onsubmit=e=>{e.preventDefault();const m=$("#aiInput").value.trim();if(m)askAI(m)};$("#learnedBtn").onclick=openBrain;
  $("#memoryAddBtn").onclick=()=>openMemoryForm();$$("[data-memory-filter]").forEach(b=>b.onclick=()=>{$$("[data-memory-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderMemories(b.dataset.memoryFilter)});
  $("#googleLoginBtn").onclick=googleLogin;$("#logoutBtn").onclick=()=>auth&&signOut(auth);$("#profileBtn").onclick=()=>openPartner();
}
loadLocal();wire();renderAll();addBubble("Merhaba. E.log takvimini, nöbetlerini ve Eroland kayıtlarını okuyabiliyorum. ✦","ai");initFirebase();
setInterval(()=>{flushPending();checkReminders();checkShiftNotifications()},60*60*1000);

document.addEventListener("click",e=>{
  const a=e.target.closest("[data-ai-prompt]");
  if(a){showView("ai");setTimeout(()=>askAI(a.dataset.aiPrompt),60)}
});
document.addEventListener("DOMContentLoaded",()=>{
  $("#quickPlanBtn")?.addEventListener("click",()=>$("#quickAddBtn")?.click());
  $("#quickSportBtn")?.addEventListener("click",()=>{$("#quickAddBtn")?.click();setTimeout(()=>{if($("#entryTitle"))$("#entryTitle").value="Spor"},60)});
  $("#quickMemoryBtn")?.addEventListener("click",()=>{showView("eroland");setTimeout(()=>$("#addMemoryBtn")?.click(),80)});
  $("#nextItemCard")?.addEventListener("click",()=>showView("calendar"));
  setTimeout(renderProductivityHome,300);
});

/* ===== Robust home shortcut handlers ===== */
document.addEventListener("click", function(e){
  const btn=e.target.closest("button");
  if(!btn)return;

  if(btn.id==="quickPlanBtn"){
    e.preventDefault(); e.stopPropagation();
    const q=document.getElementById("quickAddBtn");
    if(q) q.click();
    return;
  }

  if(btn.id==="quickSportBtn"){
    e.preventDefault(); e.stopPropagation();
    const q=document.getElementById("quickAddBtn");
    if(q){
      q.click();
      setTimeout(()=>{
        const t=document.getElementById("entryTitle");
        if(t){t.value="Spor";t.dispatchEvent(new Event("input",{bubbles:true}));}
      },100);
    }
    return;
  }

  if(btn.id==="quickMemoryBtn"){
    e.preventDefault(); e.stopPropagation();
    showView("eroland");
    setTimeout(()=>{
      const add=document.getElementById("addMemoryBtn");
      if(add)add.click();
    },120);
    return;
  }

  const promptBtn=btn.closest("[data-ai-prompt]");
  if(promptBtn){
    e.preventDefault(); e.stopPropagation();
    const prompt=promptBtn.dataset.aiPrompt||"";
    showView("ai");
    setTimeout(()=>{
      const inp=document.getElementById("aiInput");
      if(inp)inp.value=prompt;
      askAI(prompt);
    },120);
    return;
  }
}, true);
