import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";


const $ = (s,r=document) => r.querySelector(s);
const $$ = (s,r=document) => [...r.querySelectorAll(s)];

const pad = n => String(n).padStart(2,"0");

const isoDate = d =>
  `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const today = () => isoDate(new Date());

const fmtTR = d =>
  new Intl.DateTimeFormat(
    "tr-TR",
    {
      weekday:"long",
      day:"numeric",
      month:"long"
    }
  ).format(d);

const monthTR = d =>
  new Intl.DateTimeFormat(
    "tr-TR",
    {
      month:"long",
      year:"numeric"
    }
  ).format(d);

const safe = s =>
  String(s ?? "").replace(
    /[&<>'"]/g,
    c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "'":"&#39;",
      '"':"&quot;"
    }[c])
  );

const time24 = v =>
  String(v || "").replace(/\s*(AM|PM)\s*/ig,"");


let app;
let auth;
let db;
let functions;
let storage;

let currentUser = null;
let profile = null;

let calendarCursor = new Date();
let selectedDate = today();

let entries = [];
let shifts = [];
let routines = [];
let memories = [];
let rules = [];
let dayEmojis = {};

let unsubs = [];
let activeMemoryFilter = "all";


const LOCAL = "elog-stable-v2";
const EMOJI_KEY = "elog-day-emojis-v2";


function sharedLocalKey(base){
  return `${base}-${pairId()}`;
}


const defaultRules = [
  {
    id:"rule-aquarium",
    name:"Pazartesi akvaryum",
    type:"weekday",
    weekday:1,
    action:"Şans'ın akvaryumunu temizle",
    active:true
  },
  {
    id:"rule-postshift",
    name:"Nöbet çıkışı spor yok",
    type:"after_shift",
    action:"Spor önerme",
    active:true
  }
];


function uuid(){
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function pairId(){
  return profile?.pairId || currentUser?.uid || "local";
}


function markSync(text){
  const badge = $("#syncBadge");

  if(badge){
    badge.textContent = text;
  }
}


function loadLocal(){

  try{

    const data = JSON.parse(
      localStorage.getItem(
        sharedLocalKey(LOCAL)
      )
      ||
      localStorage.getItem(LOCAL)
      ||
      "{}"
    );

    entries = data.entries || [];
    shifts = data.shifts || [];
    routines = data.routines || [];
    memories = data.memories || [];
    rules = data.rules || [];

  }catch(error){

    console.warn(
      "Yerel kayıtlar okunamadı:",
      error
    );

  }


  try{

    dayEmojis = JSON.parse(
      localStorage.getItem(
        sharedLocalKey(EMOJI_KEY)
      )
      ||
      localStorage.getItem(EMOJI_KEY)
      ||
      "{}"
    );

  }catch(error){

    dayEmojis = {};

  }


  if(!rules.length){

    rules = defaultRules.map(
      rule => ({
        ...rule,
        _pending:true
      })
    );

  }
}


function saveLocal(){

  localStorage.setItem(
    sharedLocalKey(LOCAL),
    JSON.stringify({
      entries,
      shifts,
      routines,
      memories,
      rules
    })
  );


  localStorage.setItem(
    sharedLocalKey(EMOJI_KEY),
    JSON.stringify(dayEmojis)
  );

}


function arr(name){

  return ({
    entries,
    shifts,
    routines,
    memories,
    rules
  })[name];

}


function setArr(name,value){

  if(name === "entries"){
    entries = value;
  }

  if(name === "shifts"){
    shifts = value;
  }

  if(name === "routines"){
    routines = value;
  }

  if(name === "memories"){
    memories = value;
  }

  if(name === "rules"){
    rules = value;
  }

}


function mergeCloud(name,cloud){

  const localPending =
    (arr(name) || [])
    .filter(item => item._pending);


  const map = new Map(
    cloud.map(
      item => [item.id,item]
    )
  );


  localPending.forEach(
    item => map.set(item.id,item)
  );


  setArr(
    name,
    [...map.values()]
  );


  saveLocal();
  renderAll();

}


/* ==========================================
   FIREBASE
========================================== */

async function initFirebase(){

  try{

    markSync("● bağlanıyor");


    const module =
      await import("./firebase-config.js");

    const cfg =
      module.firebaseConfig;


    app =
      initializeApp(cfg);


    auth =
      getAuth(app);


    db =
      getFirestore(app);


    functions =
      getFunctions(
        app,
        "europe-west1"
      );


    storage =
      getStorage(app);


    try{

      await getRedirectResult(auth);

    }catch(error){

      console.warn(
        "Redirect sonucu:",
        error
      );

    }


    onAuthStateChanged(
      auth,
      handleAuth
    );


    console.log(
      "Firebase hazır:",
      cfg.projectId
    );


  }catch(error){

    console.error(
      "Firebase başlatılamadı:",
      error
    );

    markSync("● Firebase hatası");

  }

}


async function handleAuth(user){

  currentUser = user;


  if(!user){

    profile = null;

    clearListeners();

    $("#authDialog")?.showModal();

    markSync("● giriş yok");

    return;

  }


  $("#authDialog")?.close();

  markSync("● bağlanıyor");


  try{

    await ensureProfile(user);


    loadLocal();

    renderAll();


    startRealtime();


    await flushPending();

    await syncDayEmojis();


    markSync("● canlı");


  }catch(error){

    console.error(
      "E.log Firebase başlangıç hatası:",
      error
    );

    markSync("● telefonda");

  }

}


/* ==========================================
   FIRESTORE USER PROFILE FIX
========================================== */

async function ensureProfile(user){

  let data = null;


  /*
   * 1. Önce Firestore'daki kullanıcıyı ara.
   */

  try{

    const snapshot =
      await getDoc(
        doc(
          db,
          "users",
          user.uid
        )
      );


    if(snapshot.exists()){

      data =
        snapshot.data();

    }


  }catch(error){

    console.warn(
      "Firestore profil okunamadı:",
      error
    );

  }


  /*
   * 2. Firestore boşsa telefondaki eski
   * profili kullan.
   */

  if(!data){

    try{

      data =
        JSON.parse(
          localStorage.getItem(
            "elog-profile-" + user.uid
          )
          ||
          "null"
        );


    }catch(error){

      data = null;

    }

  }


  /*
   * 3. Hiç profil yoksa ilk kurulum.
   */

  if(!data){

    await firstSetup(user);

    data = profile;

  }


  if(!data){

    throw new Error(
      "E.log profili oluşturulamadı."
    );

  }


  /*
   * 4. pairId kesinlikle boş kalmasın.
   */

  profile = {

    ...data,

    name:
      data.name
      ||
      user.displayName
      ||
      "Erol",

    pairId:
      data.pairId
      ||
      user.uid

  };


  /*
   * Telefona da kaydet.
   */

  localStorage.setItem(
    "elog-profile-" + user.uid,
    JSON.stringify(profile)
  );


  /*
   * 5. KRİTİK:
   *
   * Firestore'da users/{uid}
   * mutlaka oluşturulur.
   */

  try{

    await setDoc(

      doc(
        db,
        "users",
        user.uid
      ),

      {

        ...profile,

        uid:
          user.uid,

        email:
          user.email || "",

        displayName:
          user.displayName || "",

        photoURL:
          user.photoURL || "",

        updatedAt:
          serverTimestamp()

      },

      {
        merge:true
      }

    );


    console.log(
      "Firestore kullanıcı oluşturuldu:",
      user.uid
    );


    markSync("● bağlandı");


  }catch(error){

    console.error(
      "Firestore kullanıcı kaydı oluşturulamadı:",
      error
    );

    markSync("● telefonda");

    throw error;

  }

}


function firstSetup(user){

  return new Promise(
    resolve => {

      openGeneric(
        `
        <div class="modal-head">

          <h3>
            E.log'a hoş geldin 🌿
          </h3>

        </div>


        <form id="firstSetupForm">

          <label>

            Ben

            <select id="setupRole">

              <option value="owner">
                Erol
              </option>

              <option value="partner">
                Nilsu
              </option>

            </select>

          </label>


          <label
            id="pairWrap"
            style="display:none"
          >

            Erol'un Pair ID'si

            <input
              id="setupPair"
              autocomplete="off"
            >

          </label>


          <button
            class="primary-btn full"
            type="submit"
          >

            Devam et

          </button>

        </form>
        `,

        () => {

          const roleInput =
            $("#setupRole");


          const pairWrap =
            $("#pairWrap");


          roleInput.onchange =
            () => {

              pairWrap.style.display =
                roleInput.value === "partner"
                ? "block"
                : "none";

            };


          $("#firstSetupForm")
            .onsubmit =
            async event => {

              event.preventDefault();


              const role =
                $("#setupRole").value;


              const pair =
                $("#setupPair")
                .value
                .trim();


              if(
                role === "partner"
                &&
                !pair
              ){

                alert(
                  "Erol'un Pair ID'sini gir."
                );

                return;

              }


              profile = {

                name:
                  role === "owner"
                  ? "Erol"
                  : "Nilsu",

                role,

                pairId:
                  role === "owner"
                  ? user.uid
                  : pair

              };


              localStorage.setItem(

                "elog-profile-" + user.uid,

                JSON.stringify(profile)

              );


              try{

                await setDoc(

                  doc(
                    db,
                    "users",
                    user.uid
                  ),

                  {

                    ...profile,

                    uid:
                      user.uid,

                    email:
                      user.email || "",

                    displayName:
                      user.displayName || "",

                    photoURL:
                      user.photoURL || "",

                    updatedAt:
                      serverTimestamp()

                  },

                  {
                    merge:true
                  }

                );


                markSync(
                  "● bağlandı"
                );


              }catch(error){

                console.error(
                  "İlk kullanıcı kaydı yazılamadı:",
                  error
                );

                markSync(
                  "● telefonda"
                );

              }


              $("#genericDialog")
                .close();


              resolve();

            };

        }

      );

    }

  );

}


function clearListeners(){

  unsubs.forEach(
    unsubscribe => {

      try{

        unsubscribe();

      }catch{}

    }
  );


  unsubs = [];

}


function pairCol(name){

  return collection(
    db,
    "pairs",
    pairId(),
    name
  );

}


function pairDoc(name,id){

  return doc(
    db,
    "pairs",
    pairId(),
    name,
    id
  );

}


function startRealtime(){

  clearListeners();


  [
    ["entries","date"],
    ["shifts","startDate"],
    ["routines","name"],
    ["memories","date"],
    ["rules","name"]

  ].forEach(

    ([name,sort]) => {

      try{

        const q =
          query(
            pairCol(name),
            orderBy(sort)
          );


        const unsubscribe =
          onSnapshot(

            q,

            snapshot => {

              mergeCloud(

                name,

                snapshot.docs.map(
                  document => ({
                    id:
                      document.id,

                    ...document.data(),

                    _pending:false
                  })
                )

              );


              markSync(
                "● canlı"
              );

            },

            error => {

              console.error(
                `Firestore ${name} dinleme hatası:`,
                error
              );

              markSync(
                "● telefonda"
              );

            }

          );


        unsubs.push(
          unsubscribe
        );


      }catch(error){

        console.error(
          `Realtime ${name} başlatılamadı:`,
          error
        );

      }

    }

  );


  /*
   * Takvim emojileri
   */

  try{

    const unsubscribe =
      onSnapshot(

        pairDoc(
          "shared",
          "dayEmojis"
        ),

        snapshot => {

          if(
            snapshot.exists()
          ){

            dayEmojis =
              snapshot.data().values
              ||
              {};

            saveLocal();

            renderCalendar();

            renderDayDetail();

          }


          markSync(
            "● canlı"
          );

        },

        error => {

          console.error(
            "Emoji senkron hatası:",
            error
          );

          markSync(
            "● telefonda"
          );

        }

      );


    unsubs.push(
      unsubscribe
    );


  }catch(error){

    console.error(
      "Emoji realtime başlatılamadı:",
      error
    );

  }

}


async function cloudSave(
  name,
  item
){

  if(
    !db
    ||
    !currentUser
  ){

    return false;

  }


  const clean = {
    ...item
  };


  delete clean._pending;


  try{

    await setDoc(

      pairDoc(
        name,
        item.id
      ),

      {

        ...clean,

        updatedAt:
          serverTimestamp()

      },

      {
        merge:true
      }

    );


    item._pending =
      false;


    saveLocal();


    markSync(
      "● canlı"
    );


    return true;


  }catch(error){

    console.error(
      `Firestore ${name} yazma hatası:`,
      error
    );


    item._pending =
      true;


    saveLocal();


    markSync(
      "● telefonda"
    );


    return false;

  }

}


async function flushPending(){

  for(
    const name
    of
    [
      "entries",
      "shifts",
      "routines",
      "memories",
      "rules"
    ]
  ){

    const pending =
      (arr(name) || [])
      .filter(
        item => item._pending
      );


    for(
      const item
      of pending
    ){

      await cloudSave(
        name,
        item
      );

    }

  }

}
async function syncDayEmojis(){

  if(
    !db
    ||
    !currentUser
  ){
    return;
  }

  try{

    await setDoc(
      pairDoc(
        "shared",
        "dayEmojis"
      ),
      {
        values:
          dayEmojis,

        updatedAt:
          serverTimestamp()
      },
      {
        merge:true
      }
    );

    markSync(
      "● canlı"
    );

  }catch(error){

    console.error(
      "Takvim emojileri kaydedilemedi:",
      error
    );

    markSync(
      "● telefonda"
    );

  }

}


/* ==========================================
   GENEL KAYIT İŞLEMLERİ
========================================== */

async function addItem(
  name,
  item
){

  item.id =
    item.id
    ||
    uuid();

  item._pending =
    true;

  const list =
    arr(name);

  list.push(
    item
  );

  saveLocal();

  renderAll();
function renderShiftMini(){

  const target = $("#shiftMini");

  if(!target) return;

  const now = new Date();

  const upcoming = shifts
    .map(shift => {

      const startTime =
        time24(shift.startTime || "08:30");

      const d = new Date(
        `${shift.startDate}T${startTime}:00`
      );

      return {
        ...shift,
        _date:d
      };

    })
    .filter(shift =>
      !Number.isNaN(shift._date.getTime())
      &&
      shift._date >= now
    )
    .sort((a,b) => a._date - b._date);

  if(!upcoming.length){

    target.textContent =
      "Yaklaşan nöbet yok";

    return;
  }

  const next = upcoming[0];

  target.textContent =
    `${formatDateTR(next.startDate)} · 08:30 → ertesi gün 08:30`;
}
  await cloudSave(
    name,
    item
  );

  return item;

}


async function removeItem(
  name,
  id
){

  const list =
    arr(name);

  const index =
    list.findIndex(
      item =>
        item.id === id
    );

  if(
    index >= 0
  ){

    list.splice(
      index,
      1
    );

  }

  saveLocal();

  renderAll();


  if(
    db
    &&
    currentUser
  ){

    try{

      await deleteDoc(
        pairDoc(
          name,
          id
        )
      );

      markSync(
        "● canlı"
      );

    }catch(error){

      console.error(
        "Silme hatası:",
        error
      );

      markSync(
        "● telefonda"
      );

    }

  }

}


/* ==========================================
   SAYFA GEÇİŞLERİ
========================================== */

function showPage(name){

  $$(".page")
    .forEach(
      page => {

        page.classList.toggle(
          "active",
          page.dataset.page === name
        );

      }
    );


  $$(".nav-btn")
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset.target === name
        );

      }
    );


  if(
    name === "calendar"
  ){

    renderCalendar();

    renderDayDetail();

  }


  if(
    name === "eroland"
  ){

    renderMemories();

  }


  if(
    name === "today"
  ){

    renderToday();

  }


  if(
    name === "ai"
  ){

    renderAI();

  }

}


function bindNavigation(){

  $$(".nav-btn")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const target =
              button.dataset.target;

            if(target){

              showPage(
                target
              );

            }

          }
        );

      }
    );

}


/* ==========================================
   BUGÜN
========================================== */

function renderToday(){

  const date =
    today();


  const dateEntries =
    entries
    .filter(
      item =>
        item.date === date
    )
    .sort(
      (a,b) =>
        String(
          a.time || ""
        )
        .localeCompare(
          String(
            b.time || ""
          )
        )
    );


  const activeShift =
    shifts
    .filter(
      shift =>
        shift.startDate === date
        ||
        shift.endDate === date
    )
    .sort(
      (a,b) =>
        String(
          a.startTime || ""
        )
        .localeCompare(
          String(
            b.startTime || ""
          )
        )
    );


  const todayList =
    $("#todayList");


  if(todayList){

    if(
      !dateEntries.length
      &&
      !activeShift.length
    ){

      todayList.innerHTML =
        `
        <div class="empty-state">
          Bugün henüz kayıt yok.
        </div>
        `;

    }else{

      todayList.innerHTML =
        [

          ...activeShift.map(
            shift => {

              const title =
                shift.type === "extra"
                ? "💼 Ekstra mesai"
                : "💀 Nöbet";

              return `
                <article class="timeline-item">

                  <strong>
                    ${title}
                  </strong>

                  <span>
                    ${safe(
                      shift.startDate
                    )}
                    ${safe(
                      time24(
                        shift.startTime
                      )
                    )}
                    →
                    ${safe(
                      shift.endDate
                    )}
                    ${safe(
                      time24(
                        shift.endTime
                      )
                    )}
                  </span>

                </article>
              `;

            }
          ),

          ...dateEntries.map(
            item => `
              <article class="timeline-item">

                <strong>
                  ${safe(
                    item.title
                    ||
                    item.type
                    ||
                    "Plan"
                  )}
                </strong>

                <span>
                  ${safe(
                    time24(
                      item.time
                    )
                  )}
                </span>

              </article>
            `
          )

        ].join("");

    }

  }


  renderNextShift();

}


function renderNextShift(){

  const target =
    $("#nextShiftCard");


  if(!target){
    return;
  }


  const now =
    new Date();


  const upcoming =
    shifts
    .map(
      shift => {

        const date =
          new Date(
            `${shift.startDate}T${time24(
              shift.startTime
            ) || "00:00"}:00`
          );

        return {
          ...shift,
          _date:
            date
        };

      }
    )
    .filter(
      shift =>
        !Number.isNaN(
          shift._date.getTime()
        )
        &&
        shift._date >= now
    )
    .sort(
      (a,b) =>
        a._date - b._date
    )[0];


  if(!upcoming){

    target.innerHTML =
      `
      <div class="next-empty">
        Yaklaşan nöbet veya mesai yok.
      </div>
      `;

    return;

  }


  const isExtra =
    upcoming.type === "extra";


  target.innerHTML =
    `
    <div class="eyebrow">
      SIRADAKİ
    </div>

    <h2>
      ${isExtra
        ? "💼 Ekstra mesai"
        : "💀 Nöbet"
      }
    </h2>

    <p>
      ${safe(
        fmtTR(
          upcoming._date
        )
      )}
      ·
      ${safe(
        time24(
          upcoming.startTime
        )
      )}
      –
      ${safe(
        time24(
          upcoming.endTime
        )
      )}
    </p>
    `;

}


/* ==========================================
   TAKVİM
========================================== */

function renderCalendar(){

  const grid =
    $("#calendarGrid");

  const title =
    $("#monthTitle")


  if(
    !grid
    ||
    !title
  ){
    return;
  }


  title.textContent =
    monthTR(
      calendarCursor
    );


  grid.innerHTML =
    "";


  const year =
    calendarCursor.getFullYear();

  const month =
    calendarCursor.getMonth();


  const first =
    new Date(
      year,
      month,
      1
    );


  const mondayIndex =
    (
      first.getDay()
      +
      6
    )
    %
    7;


  const start =
    new Date(
      year,
      month,
      1 - mondayIndex
    );


  for(
    let i = 0;
    i < 42;
    i++
  ){

    const d =
      new Date(start);

    d.setDate(
      start.getDate() + i
    );


    const key =
      isoDate(d);


    const button =
      document.createElement(
        "button"
      );


    button.type =
      "button";


    button.className =
      "calendar-day";


    if(
      d.getMonth()
      !== month
    ){

      button.classList.add(
        "muted"
      );

    }


    if(
      key === today()
    ){

      button.classList.add(
        "today"
      );

    }


    if(
      key === selectedDate
    ){

      button.classList.add(
        "selected"
      );

    }


    const emojis =
      Array.isArray(
        dayEmojis[key]
      )
      ? dayEmojis[key]
      : dayEmojis[key]
        ? [dayEmojis[key]]
        : [];


    const shiftCount =
      shifts.filter(
        shift =>
          shift.startDate === key
          ||
          shift.endDate === key
      ).length;


    const entryCount =
      entries.filter(
        item =>
          item.date === key
      ).length;


    button.innerHTML =
      `
      <span class="day-number">
        ${d.getDate()}
      </span>

      ${
        emojis.length
        ?
        `
        <span class="day-emojis">
          ${emojis
            .slice(0,4)
            .map(
              emoji =>
                `<span>${safe(
                  emoji
                )}</span>`
            )
            .join("")
          }
        </span>
        `
        :
        ""
      }

      ${
        shiftCount
        ||
        entryCount
        ?
        `
        <span class="day-dots">
          ${"•".repeat(
            Math.min(
              shiftCount
              +
              entryCount,
              4
            )
          )}
        </span>
        `
        :
        ""
      }
      `;


    button.addEventListener(
      "click",
      () => {

        selectedDate =
          key;

        renderCalendar();

        renderDayDetail();

      }
    );


    grid.appendChild(
      button
    );

  }

}


function renderDayDetail(){

  const target =
    $("#calendarDayDetail")


  if(!target){
    return;
  }


  const date =
    new Date(
      `${selectedDate}T12:00:00`
    );


  const selectedEntries =
    entries.filter(
      item =>
        item.date === selectedDate
    );


  const selectedShifts =
    shifts.filter(
      shift =>
        shift.startDate === selectedDate
        ||
        shift.endDate === selectedDate
    );


  const emojis =
    Array.isArray(
      dayEmojis[selectedDate]
    )
    ? dayEmojis[selectedDate]
    : dayEmojis[selectedDate]
      ? [dayEmojis[selectedDate]]
      : [];


  let html =
    `
    <div class="day-detail-head">

      <h3>
        ${safe(
          fmtTR(date)
        )}
      </h3>

      <button
        type="button"
        id="addEmojiBtn"
        class="text-btn"
      >
        + Emoji ekle
      </button>

    </div>
    `;


  if(emojis.length){

    html +=
      `
      <div class="selected-emojis">

        ${emojis.map(
          (emoji,index) => `
            <button
              type="button"
              class="selected-emoji"
              data-emoji-index="${index}"
              title="Kaldır"
            >
              ${safe(emoji)}
            </button>
          `
        ).join("")}

      </div>
      `;

  }


  if(
    !selectedEntries.length
    &&
    !selectedShifts.length
  ){

    html +=
      `
      <div class="empty-state">
        Bu gün boş görünüyor.
      </div>
      `;

  }


  if(selectedShifts.length){

    html +=
      selectedShifts
      .map(
        shift => `
          <article class="day-record">

            <strong>
              ${
                shift.type === "extra"
                ? "💼 Ekstra mesai"
                : "💀 Nöbet"
              }
            </strong>

            <span>
              ${safe(
                shift.startDate
              )}
              ${safe(
                time24(
                  shift.startTime
                )
              )}
              →
              ${safe(
                shift.endDate
              )}
              ${safe(
                time24(
                  shift.endTime
                )
              )}
            </span>

          </article>
        `
      )
      .join("");

  }


  if(selectedEntries.length){

    html +=
      selectedEntries
      .map(
        item => `
          <article class="day-record">

            <strong>
              ${safe(
                item.title
                ||
                item.type
                ||
                "Plan"
              )}
            </strong>

            ${
              item.time
              ?
              `
              <span>
                ${safe(
                  time24(
                    item.time
                  )
                )}
              </span>
              `
              :
              ""
            }

          </article>
        `
      )
      .join("");

  }


  target.innerHTML =
    html;


  $("#addEmojiBtn")
    ?.addEventListener(
      "click",
      () => {

        openEmojiPicker(
          selectedDate
        );

      }
    );


  $$(
    "[data-emoji-index]",
    target
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        async () => {

          const index =
            Number(
              button.dataset.emojiIndex
            );


          const list =
            Array.isArray(
              dayEmojis[selectedDate]
            )
            ? [
                ...dayEmojis[selectedDate]
              ]
            : [];


          list.splice(
            index,
            1
          );


          if(list.length){

            dayEmojis[selectedDate] =
              list;

          }else{

            delete dayEmojis[
              selectedDate
            ];

          }


          saveLocal();

          renderCalendar();

          renderDayDetail();

          await syncDayEmojis();

        }
      );

    }
  );

}


/* ==========================================
   EMOJİ
========================================== */

const emojiChoices = [
  "❤️",
  "🥰",
  "✨",
  "🏋️",
  "☕",
  "🍽️",
  "🎬",
  "🎮",
  "🌿",
  "🩻",
  "🐟",
  "🎉",
  "💼",
  "💀",
  "🌙",
  "💙"
];


function openEmojiPicker(
  date
){

  const current =
    Array.isArray(
      dayEmojis[date]
    )
    ? dayEmojis[date]
    : [];


  openGeneric(
    `
    <div class="modal-head">

      <div>

        <div class="eyebrow">
          TAKVİM
        </div>

        <h3>
          Emoji ekle
        </h3>

      </div>

      <button
        type="button"
        class="icon-btn"
        data-close-generic
      >
        ×
      </button>

    </div>


    <p class="muted-text">
      ${safe(date)} için seç.
      Aynı güne en fazla 4 emoji ekleyebilirsin.
    </p>


    <div
      class="emoji-picker-grid"
      id="emojiPickerGrid"
    >

      ${emojiChoices
        .map(
          emoji => `
            <button
              type="button"
              class="emoji-choice"
              data-emoji="${safe(
                emoji
              )}"
            >
              ${safe(
                emoji
              )}
            </button>
          `
        )
        .join("")
      }

    </div>
    `,

    () => {

      $$(
        "[data-close-generic]"
      )
      .forEach(
        button => {

          button.onclick =
            () =>
              $("#genericDialog")
              ?.close();

        }
      );


      $$(
        "[data-emoji]"
      )
      .forEach(
        button => {

          button.onclick =
            async () => {

              const emoji =
                button.dataset.emoji;


              const list =
                [
                  ...current
                ];


              if(
                list.length >= 4
              ){

                alert(
                  "Bir güne en fazla 4 emoji eklenebilir."
                );

                return;

              }


              list.push(
                emoji
              );


              dayEmojis[date] =
                list;


              saveLocal();

              renderCalendar();

              renderDayDetail();


              await syncDayEmojis();


              $("#genericDialog")
                ?.close();

            };

        }
      );

    }

  );

}
/* ==========================================
   NÖBETLER
========================================== */

function timeOptions(selected=""){

  let out="";

  for(let h=0;h<24;h++){

    for(let m=0;m<60;m+=30){

      const value =
        `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

      out += `
        <option
          value="${value}"
          ${value===selected ? "selected" : ""}
        >
          ${value}
        </option>
      `;

    }

  }

  return out;

}


function openShifts(){

  const sorted =
    [...shifts]
    .sort(
      (a,b) =>
        String(b.startDate || "")
        .localeCompare(
          String(a.startDate || "")
        )
    );


  openGeneric(
    `
    <div class="modal-head">

      <div>
        <p class="eyebrow">İŞ</p>
        <h3>🩻 Nöbetlerim</h3>
      </div>

      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <div class="rule-card">

      <strong>
        24 saatlik nöbet
      </strong>

      <p>
        Başlangıç günü 08:30 →
        ertesi gün 08:30.
      </p>

    </div>


    <form id="shiftForm">

      <label>
        Nöbet başlangıç tarihi

        <input
          id="shiftDate"
          type="date"
          required
          value="${today()}"
        >
      </label>


      <button
        class="primary-btn full"
        type="submit"
      >
        Nöbeti kaydet
      </button>

      <p
        id="shiftMessage"
        class="form-message"
      ></p>

    </form>


    <div class="shift-list-title">

      <strong>
        Kayıtlı nöbetler
      </strong>

      <span>
        ${sorted.length}
      </span>

    </div>


    <div class="panel-list">

      ${
        sorted.length

        ? sorted.map(
            shift => `
              <div class="panel-row">

                <div>

                  <strong>
                    🩻 ${safe(
                      formatDateTR(
                        shift.startDate
                      )
                    )}
                  </strong>

                  <small>
                    08:30 →
                    ertesi gün 08:30
                  </small>

                </div>

                <button
                  class="text-btn delete-shift"
                  data-shift-id="${shift.id}"
                  type="button"
                >
                  Sil
                </button>

              </div>
            `
          ).join("")

        : `
          <div class="empty">
            Henüz nöbet yok.
          </div>
        `
      }

    </div>
    `,

    () => {

      $("#shiftForm").onsubmit =
        async event => {

          event.preventDefault();


          const startDate =
            $("#shiftDate").value;


          if(!startDate){
            return;
          }


          const start =
            new Date(
              `${startDate}T12:00:00`
            );


          const end =
            new Date(start);

          end.setDate(
            end.getDate()+1
          );


          const item = {

            id:uuid(),

            startDate,

            endDate:
              isoDate(end),

            startTime:"08:30",

            endTime:"08:30",

            type:"shift",

            title:"Nöbet",

            createdBy:
              currentUser?.uid
              ||
              "local",

            _pending:true

          };


          shifts.push(item);

          saveLocal();

          renderAll();


          $("#shiftMessage")
            .textContent =
            "✓ Nöbet kaydedildi.";


          await cloudSave(
            "shifts",
            item
          );


          setTimeout(
            () => {

              $("#genericDialog")
                .close();

              openShifts();

            },
            300
          );

        };


      $$(".delete-shift")
        .forEach(
          button => {

            button.onclick =
              async () => {

                const id =
                  button.dataset.shiftId;


                shifts =
                  shifts.filter(
                    shift =>
                      shift.id !== id
                  );


                saveLocal();

                renderAll();


                if(db){

                  try{

                    await deleteDoc(
                      pairDoc(
                        "shifts",
                        id
                      )
                    );

                  }catch(error){

                    console.error(
                      error
                    );

                  }

                }


                $("#genericDialog")
                  .close();

                openShifts();

              };

          }
        );

    }

  );

}


/* ==========================================
   EKSTRA MESAİ
========================================== */

function overtimeEntries(){

  return entries.filter(
    entry =>
      entry.category === "work"
      &&
      (
        entry.kind === "overtime"
        ||
        /ekstra mesai|fazla mesai/i
          .test(
            entry.title || ""
          )
      )
  );

}


function openOvertime(){

  const sorted =
    [...overtimeEntries()]
    .sort(
      (a,b) =>
        (
          b.date +
          (b.time || "")
        )
        .localeCompare(
          a.date +
          (a.time || "")
        )
    );


  openGeneric(
    `
    <div class="modal-head">

      <div>
        <p class="eyebrow">İŞ</p>
        <h3>💼 Ekstra Mesai</h3>
      </div>

      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <div class="rule-card">

      <strong>
        Normal nöbetten ayrı
      </strong>

      <p>
        Buraya sadece ekstra mesai
        saatlerini kaydet.
      </p>

    </div>


    <form id="overtimeForm">

      <label>

        Tarih

        <input
          id="overtimeDate"
          type="date"
          required
          value="${today()}"
        >

      </label>


      <div class="form-row">

        <label>

          Başlangıç

          <select
            id="overtimeStart"
            required
          >
            ${timeOptions("08:30")}
          </select>

        </label>


        <label>

          Bitiş

          <select
            id="overtimeEnd"
            required
          >
            ${timeOptions("16:00")}
          </select>

        </label>

      </div>


      <label>

        Not

        <input
          id="overtimeNote"
          placeholder="Örn. Ekstra mesai"
        >

      </label>


      <button
        class="primary-btn full"
        type="submit"
      >
        Ekstra mesaiyi kaydet
      </button>


      <p
        id="overtimeMsg"
        class="form-message"
      ></p>

    </form>


    <div class="shift-list-title">

      <strong>
        Kayıtlı ekstra mesailer
      </strong>

      <span>
        ${sorted.length}
      </span>

    </div>


    <div class="panel-list">

      ${
        sorted.length

        ? sorted.map(
            entry => `
              <div
                class="panel-row overtime-row"
              >

                <div>

                  <strong>
                    💼 ${safe(
                      formatDateTR(
                        entry.date
                      )
                    )}
                  </strong>

                  <small>

                    ${safe(
                      time24(
                        entry.time
                      )
                    )}

                    –

                    ${safe(
                      time24(
                        entry.endTime
                      )
                    )}

                    ${
                      entry.note
                      ?
                      ` · ${safe(
                        entry.note
                      )}`
                      :
                      ""
                    }

                  </small>

                </div>


                <button
                  class="text-btn delete-overtime"
                  data-overtime-id="${entry.id}"
                  type="button"
                >
                  Sil
                </button>

              </div>
            `
          ).join("")

        : `
          <div class="empty">
            Henüz ekstra mesai yok.
          </div>
        `
      }

    </div>
    `,

    () => {

      $("#overtimeForm").onsubmit =
        async event => {

          event.preventDefault();


          const item = {

            id:uuid(),

            date:
              $("#overtimeDate")
              .value,

            time:
              $("#overtimeStart")
              .value,

            endTime:
              $("#overtimeEnd")
              .value,

            title:
              "Ekstra mesai",

            note:
              $("#overtimeNote")
              .value
              .trim(),

            category:
              "work",

            kind:
              "overtime",

            done:false,

            createdBy:
              currentUser?.uid
              ||
              "local",

            _pending:true

          };


          entries.push(item);

          saveLocal();

          renderAll();


          $("#overtimeMsg")
            .textContent =
            "✓ Ekstra mesai kaydedildi.";


          await cloudSave(
            "entries",
            item
          );


          setTimeout(
            () => {

              $("#genericDialog")
                .close();

              openOvertime();

            },
            300
          );

        };


      $$(".delete-overtime")
        .forEach(
          button => {

            button.onclick =
              async () => {

                const id =
                  button.dataset
                  .overtimeId;


                entries =
                  entries.filter(
                    item =>
                      item.id !== id
                  );


                saveLocal();

                renderAll();


                if(db){

                  try{

                    await deleteDoc(
                      pairDoc(
                        "entries",
                        id
                      )
                    );

                  }catch(error){

                    console.error(
                      error
                    );

                  }

                }


                $("#genericDialog")
                  .close();

                openOvertime();

              };

          }
        );

    }

  );

}


/* ==========================================
   ORTAK E.LOG
========================================== */

function openPairInfo(){

  openGeneric(
    `
    <div class="modal-head">

      <div>

        <p class="eyebrow">
          SENKRONİZASYON
        </p>

        <h3>
          🔗 Ortak E.log
        </h3>

      </div>

      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <div class="rule-card">

      <strong>
        İki telefonda aynı veriler
      </strong>

      <p>
        İkinizin hesabında da aynı
        Ortak Kod bulunmalı.
      </p>

    </div>


    <label>

      Ortak Kod

      <input
        id="pairCodeView"
        readonly
        value="${safe(pairId())}"
      >

    </label>


    <button
      id="copyPairCode"
      class="primary-btn full"
      type="button"
    >
      Kodu kopyala
    </button>


    <hr>


    <label>

      Başka ortak koda bağlan

      <input
        id="newPairCode"
        placeholder="Ortak kodu buraya yapıştır"
      >

    </label>


    <button
      id="joinPairBtn"
      class="secondary-btn full"
      type="button"
    >
      Bu ortak koda bağlan
    </button>


    <p
      id="pairMessage"
      class="form-message"
    ></p>
    `,

    () => {

      $("#copyPairCode")
        .onclick =
        async () => {

          try{

            await navigator.clipboard
              .writeText(
                pairId()
              );

            $("#copyPairCode")
              .textContent =
              "✓ Kopyalandı";

          }catch(error){

            console.error(error);

          }

        };


      $("#joinPairBtn")
        .onclick =
        async () => {

          const code =
            $("#newPairCode")
            .value
            .trim();


          if(!code){

            $("#pairMessage")
              .textContent =
              "Ortak kodu gir.";

            return;

          }


          if(
            !currentUser
            ||
            !db
          ){

            $("#pairMessage")
              .textContent =
              "Önce Google hesabına giriş yap.";

            return;

          }


          try{

            profile = {
              ...(profile || {}),
              pairId:code
            };


            localStorage.setItem(
              "elog-profile-" +
              currentUser.uid,
              JSON.stringify(profile)
            );


            await setDoc(

              doc(
                db,
                "users",
                currentUser.uid
              ),

              {
                ...profile,
                uid:
                  currentUser.uid,
                email:
                  currentUser.email || "",
                displayName:
                  currentUser.displayName || "",
                updatedAt:
                  serverTimestamp()
              },

              {
                merge:true
              }

            );


            clearListeners();

            loadLocal();

            renderAll();

            startRealtime();


            $("#pairMessage")
              .textContent =
              "✓ Ortak E.log'a bağlandın.";


            markSync(
              "● canlı"
            );


            setTimeout(
              () =>
                location.reload(),
              700
            );


          }catch(error){

            console.error(
              "Pair bağlantı hatası:",
              error
            );


            $("#pairMessage")
              .textContent =
              "Bağlantı kurulamadı.";


            markSync(
              "● telefonda"
            );

          }

        };

    }

  );

}


/* ==========================================
   TARİH
========================================== */

function formatDateTR(value){

  if(!value){
    return "";
  }


  try{

    const date =
      new Date(
        `${value}T12:00:00`
      );


    return new Intl
      .DateTimeFormat(
        "tr-TR",
        {
          day:"numeric",
          month:"long",
          year:"numeric"
        }
      )
      .format(date);


  }catch{

    return value;

  }

}
/* ==========================================
   EROLAND
========================================== */

function renderMemories(){

  const grid = $("#memoryGrid");

  if(!grid) return;


  let list = [...memories];


  if(activeMemoryFilter !== "all"){

    list = list.filter(
      item =>
        item.type === activeMemoryFilter
    );

  }


  list.sort(
    (a,b) =>
      String(b.date || "")
      .localeCompare(
        String(a.date || "")
      )
  );


  if(!list.length){

    grid.innerHTML = `
      <div class="empty">
        Henüz burada kayıt yok. ♡
      </div>
    `;

    return;

  }


  grid.innerHTML =
    list.map(
      item => `

        <article class="memory-card">

          ${
            item.mediaURL
            ?
              item.mediaType === "video"
              ?
              `
              <video
                src="${safe(item.mediaURL)}"
                controls
                playsinline
                class="memory-media"
              ></video>
              `
              :
              `
              <img
                src="${safe(item.mediaURL)}"
                alt=""
                class="memory-media"
              >
              `
            :
            ""
          }


          <div class="memory-card-body">

            <span class="tag">
              ${
                item.type === "plan"
                ? "Plan"
                : item.type === "place"
                  ? "Yer"
                  : "Anı"
              }
            </span>


            <h3>
              ${safe(
                item.title || "Anı"
              )}
            </h3>


            ${
              item.text
              ?
              `
              <p>
                ${safe(item.text)}
              </p>
              `
              :
              ""
            }


            ${
              item.date
              ?
              `
              <small>
                ${safe(
                  formatDateTR(item.date)
                )}
              </small>
              `
              :
              ""
            }


            ${
              item.remindDate
              ?
              `
              <small>
                🔔 Hatırlatma:
                ${safe(
                  formatDateTR(
                    item.remindDate
                  )
                )}
              </small>
              `
              :
              ""
            }


            <button
              class="text-btn delete-memory"
              data-memory-id="${item.id}"
              type="button"
            >
              Sil
            </button>

          </div>

        </article>
      `
    ).join("");


  $$(".delete-memory")
    .forEach(
      button => {

        button.onclick =
          async () => {

            const id =
              button.dataset.memoryId;

            await removeItem(
              "memories",
              id
            );

            renderMemories();

          };

      }
    );

}


function openMemoryForm(){

  openGeneric(
    `
    <div class="modal-head">

      <div>
        <p class="eyebrow">
          EROLAND
        </p>

        <h3>
          ♡ Yeni kayıt
        </h3>
      </div>


      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <form id="memoryForm">

      <label>
        Tür

        <select id="memoryType">

          <option value="memory">
            Anı
          </option>

          <option value="plan">
            Plan
          </option>

          <option value="place">
            Yer
          </option>

        </select>
      </label>


      <label>
        Başlık

        <input
          id="memoryTitle"
          maxlength="100"
          required
          placeholder="Örn. İlk konserimiz"
        >
      </label>


      <label>
        Tarih

        <input
          id="memoryDate"
          type="date"
          value="${today()}"
          required
        >
      </label>


      <label>
        Not

        <textarea
          id="memoryText"
          rows="4"
          placeholder="Buraya anınızı yazabilirsiniz..."
        ></textarea>
      </label>


      <label>
        Fotoğraf veya video

        <input
          id="memoryMedia"
          type="file"
          accept="image/*,video/*"
        >
      </label>


      <label>
        Hatırlatma

        <select id="memoryReminder">

          <option value="">
            Hatırlatma yok
          </option>

          <option value="365">
            1 yıl sonra
          </option>

          <option value="180">
            6 ay sonra
          </option>

          <option value="30">
            1 ay sonra
          </option>

        </select>
      </label>


      <button
        class="primary-btn full"
        type="submit"
      >
        Kaydet
      </button>


      <p
        id="memoryMessage"
        class="form-message"
      ></p>

    </form>
    `,

    () => {

      $("#memoryForm").onsubmit =
        async event => {

          event.preventDefault();


          const message =
            $("#memoryMessage");


          message.textContent =
            "Kaydediliyor…";


          const date =
            $("#memoryDate").value;


          const reminderDays =
            Number(
              $("#memoryReminder").value
              ||
              0
            );


          let remindDate = "";


          if(reminderDays){

            const reminder =
              new Date(
                `${date}T12:00:00`
              );

            reminder.setDate(
              reminder.getDate()
              +
              reminderDays
            );

            remindDate =
              isoDate(reminder);

          }


          const item = {

            id:uuid(),

            type:
              $("#memoryType").value,

            title:
              $("#memoryTitle")
              .value
              .trim(),

            date,

            text:
              $("#memoryText")
              .value
              .trim(),

            remindDate,

            mediaURL:"",

            mediaType:"",

            createdBy:
              currentUser?.uid
              ||
              "local",

            _pending:true

          };


          const file =
            $("#memoryMedia")
            .files?.[0];


          if(
            file
            &&
            storage
            &&
            currentUser
          ){

            try{

              message.textContent =
                "Fotoğraf/video yükleniyor…";


              const path =
                `pairs/${pairId()}/memories/${item.id}-${file.name}`;


              const reference =
                storageRef(
                  storage,
                  path
                );


              await uploadBytes(
                reference,
                file
              );


              item.mediaURL =
                await getDownloadURL(
                  reference
                );


              item.mediaType =
                file.type
                .startsWith("video/")
                ? "video"
                : "image";


            }catch(error){

              console.error(
                "Medya yükleme hatası:",
                error
              );


              message.textContent =
                "Medya yüklenemedi, kayıt yine oluşturuluyor.";

            }

          }


          memories.push(item);

          saveLocal();

          renderAll();


          await cloudSave(
            "memories",
            item
          );


          message.textContent =
            "✓ Eroland'a kaydedildi.";


          setTimeout(
            () => {

              $("#genericDialog")
                .close();

              renderMemories();

            },
            400
          );

        };

    }

  );

}


/* ==========================================
   RUTİNLER
========================================== */

function openRoutines(){

  const sorted =
    [...routines]
    .sort(
      (a,b) =>
        String(a.name || "")
        .localeCompare(
          String(b.name || ""),
          "tr"
        )
    );


  openGeneric(
    `
    <div class="modal-head">

      <div>
        <p class="eyebrow">
          OTOMASYON
        </p>

        <h3>
          ↻ Rutinler
        </h3>
      </div>


      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <form id="routineForm">

      <label>
        Rutin

        <input
          id="routineName"
          required
          placeholder="Örn. Pazartesi akvaryum"
        >
      </label>


      <label>
        Gün

        <select id="routineWeekday">

          <option value="1">
            Pazartesi
          </option>

          <option value="2">
            Salı
          </option>

          <option value="3">
            Çarşamba
          </option>

          <option value="4">
            Perşembe
          </option>

          <option value="5">
            Cuma
          </option>

          <option value="6">
            Cumartesi
          </option>

          <option value="0">
            Pazar
          </option>

        </select>
      </label>


      <label>
        Saat

        <select id="routineTime">
          ${timeOptions("09:00")}
        </select>
      </label>


      <button
        class="primary-btn full"
        type="submit"
      >
        Rutini kaydet
      </button>

    </form>


    <div class="panel-list">

      ${
        sorted.length
        ?
        sorted.map(
          item => `
            <div class="panel-row">

              <div>
                <strong>
                  ${safe(item.name)}
                </strong>

                <small>
                  ${safe(
                    time24(item.time)
                  )}
                </small>
              </div>


              <button
                class="text-btn delete-routine"
                data-routine-id="${item.id}"
                type="button"
              >
                Sil
              </button>

            </div>
          `
        ).join("")
        :
        `
        <div class="empty">
          Henüz rutin yok.
        </div>
        `
      }

    </div>
    `,

    () => {

      $("#routineForm").onsubmit =
        async event => {

          event.preventDefault();


          const item = {

            id:uuid(),

            name:
              $("#routineName")
              .value
              .trim(),

            weekday:
              Number(
                $("#routineWeekday")
                .value
              ),

            time:
              $("#routineTime").value,

            active:true,

            _pending:true

          };


          routines.push(item);

          saveLocal();

          renderAll();


          await cloudSave(
            "routines",
            item
          );


          $("#genericDialog")
            .close();

          openRoutines();

        };


      $$(".delete-routine")
        .forEach(
          button => {

            button.onclick =
              async () => {

                await removeItem(
                  "routines",
                  button.dataset
                    .routineId
                );

                $("#genericDialog")
                  .close();

                openRoutines();

              };

          }
        );

    }

  );

}


/* ==========================================
   İSTATİSTİK
========================================== */

function openStats(){

  const completed =
    entries.filter(
      item => item.done
    ).length;


  const overtimeCount =
    overtimeEntries().length;


  openGeneric(
    `
    <div class="modal-head">

      <div>
        <p class="eyebrow">
          E.LOG
        </p>

        <h3>
          ▥ İstatistikler
        </h3>
      </div>

      <button
        class="icon-btn close-generic"
        type="button"
      >
        ×
      </button>

    </div>


    <div class="stats-grid">

      <div class="stat-card">
        <strong>
          ${entries.length}
        </strong>
        <span>
          Plan
        </span>
      </div>


      <div class="stat-card">
        <strong>
          ${shifts.length}
        </strong>
        <span>
          Nöbet
        </span>
      </div>


      <div class="stat-card">
        <strong>
          ${overtimeCount}
        </strong>
        <span>
          Ekstra mesai
        </span>
      </div>


      <div class="stat-card">
        <strong>
          ${memories.length}
        </strong>
        <span>
          Eroland
        </span>
      </div>


      <div class="stat-card">
        <strong>
          ${completed}
        </strong>
        <span>
          Tamamlanan
        </span>
      </div>

    </div>
    `
  );

}


/* ==========================================
   AI
========================================== */

function localAIAnswer(text){

  const queryText =
    String(text || "")
    .toLocaleLowerCase("tr-TR");


  if(
    queryText.includes("ekstra mesai")
    ||
    queryText.includes("fazla mesai")
  ){

    const list =
      overtimeEntries()
      .filter(
        item =>
          item.date >= today()
      )
      .sort(
        (a,b) =>
          String(a.date)
          .localeCompare(
            String(b.date)
          )
      );


    if(!list.length){

      return "Yaklaşan ekstra mesai kaydı yok.";

    }


    return (
      "Yaklaşan ekstra mesailerin: "
      +
      list.slice(0,5)
      .map(
        item =>
          `${formatDateTR(item.date)} ${time24(item.time)}–${time24(item.endTime)}`
      )
      .join(" · ")
    );

  }


  if(
    queryText.includes("nöbet")
  ){

    const upcoming =
      shifts
      .filter(
        shift =>
          shift.startDate >= today()
      )
      .sort(
        (a,b) =>
          String(a.startDate)
          .localeCompare(
            String(b.startDate)
          )
      );


    if(!upcoming.length){

      return "Yaklaşan nöbet kaydı yok.";

    }


    return (
      "Yaklaşan nöbetlerin: "
      +
      upcoming.slice(0,5)
      .map(
        shift =>
          `${formatDateTR(shift.startDate)} 08:30 → ertesi gün 08:30`
      )
      .join(" · ")
    );

  }


  if(
    queryText.includes("yarın")
  ){

    const d =
      new Date();

    d.setDate(
      d.getDate()+1
    );


    const date =
      isoDate(d);


    const plans =
      entries
      .filter(
        item =>
          item.date === date
      )
      .sort(
        (a,b) =>
          String(a.time || "")
          .localeCompare(
            String(b.time || "")
          )
      );


    const tomorrowShifts =
      shifts.filter(
        shift =>
          shift.startDate === date
          ||
          shift.endDate === date
      );


    if(
      !plans.length
      &&
      !tomorrowShifts.length
    ){

      return "Yarın için kayıtlı bir plan görünmüyor.";

    }


    const parts = [];


    tomorrowShifts.forEach(
      shift => {

        parts.push(
          `Nöbet: ${time24(shift.startTime || "08:30")} → ${time24(shift.endTime || "08:30")}`
        );

      }
    );


    plans.forEach(
      item => {

        parts.push(
          `${time24(item.time)} ${item.title}`
        );

      }
    );


    return (
      "Yarın: "
      +
      parts.join(" · ")
    );

  }


  if(
    queryText.includes("bugün")
  ){

    const plans =
      entries
      .filter(
        item =>
          item.date === today()
      )
      .sort(
        (a,b) =>
          String(a.time || "")
          .localeCompare(
            String(b.time || "")
          )
      );


    if(!plans.length){

      return "Bugün için kayıtlı bir plan görünmüyor.";

    }


    return (
      "Bugünkü planın: "
      +
      plans.map(
        item =>
          `${time24(item.time)} ${item.title}`
      )
      .join(" · ")
    );

  }


  if(
    queryText.includes("boş saat")
  ){

    return "Takvimindeki kayıtları kullanarak boşluklarını kontrol edebilirim. Önce plan, nöbet ve ekstra mesailerinin doğru kaydedildiğinden emin ol.";

  }


  return "Bana nöbetini, ekstra mesaini, bugünü veya yarını sorabilirsin.";

}


function addChatMessage(
  role,
  text
){

  const chat =
    $("#chat");


  if(!chat){
    return;
  }


  const div =
    document.createElement(
      "div"
    );


  div.className =
    `chat-message ${role}`;


  div.textContent =
    text;


  chat.appendChild(div);


  chat.scrollTop =
    chat.scrollHeight;

}


async function askAI(text){

  const clean =
    String(text || "")
    .trim();


  if(!clean){
    return;
  }


  addChatMessage(
    "user",
    clean
  );


  try{

    if(functions){

      const callable =
        httpsCallable(
          functions,
          "elogAI"
        );


      const result =
        await callable({
          message:clean,
          context:{
            entries,
            shifts,
            routines,
            rules,
            today:today()
          }
        });


      const answer =
        result?.data?.answer;


      if(answer){

        addChatMessage(
          "assistant",
          answer
        );

        return;

      }

    }

  }catch(error){

    console.warn(
      "Cloud AI kullanılamadı:",
      error
    );

  }


  addChatMessage(
    "assistant",
    localAIAnswer(clean)
  );

}


function renderAI(){

  const chat =
    $("#chat");


  if(
    chat
    &&
    !chat.children.length
  ){

    addChatMessage(
      "assistant",
      "Merhaba. Bugününü, nöbetlerini ve ekstra mesailerini birlikte takip edebiliriz. ✦"
    );

  }

}
/* ==========================================
   MODAL
========================================== */

function openGeneric(html,onOpen){

  const dialog =
    $("#genericDialog");

  const content =
    $("#genericContent");

  if(!dialog || !content){
    return;
  }

  content.innerHTML = html;

  $$(".close-generic",content)
    .forEach(button => {

      button.onclick = () =>
        dialog.close();

    });

  if(!dialog.open){
    dialog.showModal();
  }

  if(onOpen){
    onOpen();
  }
}


/* ==========================================
   PLAN / HIZLI EKLE
========================================== */

function openEntryForm(
  presetTitle="",
  presetCategory="general"
){

  const dialog =
    $("#entryDialog");

  if(!dialog){
    return;
  }


  $("#entryDate").value =
    selectedDate || today();

  $("#entryTime").value =
    "12:00";

  $("#entryTitle").value =
    presetTitle;

  $("#entryNote").value =
    "";

  $("#entryDone").checked =
    false;


  const category =
    $("#entryCategory");

  if(category){

    category.value =
      presetCategory;

  }


  if(!dialog.open){

    dialog.showModal();

  }


  setTimeout(
    () =>
      $("#entryTitle")
      ?.focus(),
    100
  );

}


/* ==========================================
   ANA EKRAN SIRADAKİ
========================================== */

function nextScheduledItem(){

  const now =
    new Date();

  const candidates = [];


  entries.forEach(
    entry => {

      if(
        !entry.date
        ||
        !entry.time
      ){
        return;
      }


      const d =
        new Date(
          `${entry.date}T${time24(entry.time)}:00`
        );


      if(
        !Number.isNaN(
          d.getTime()
        )
        &&
        d >= now
      ){

        candidates.push({

          date:d,

          title:
            entry.kind === "overtime"
            ? "💼 Ekstra Mesai"
            : entry.title || "Plan",

          meta:
            `${formatDateTR(entry.date)} · ${time24(entry.time)}${entry.endTime ? `–${time24(entry.endTime)}` : ""}`

        });

      }

    }
  );


  shifts.forEach(
    shift => {

      if(!shift.startDate){
        return;
      }


      const startTime =
        time24(
          shift.startTime
          ||
          "08:30"
        );


      const d =
        new Date(
          `${shift.startDate}T${startTime}:00`
        );


      if(
        !Number.isNaN(
          d.getTime()
        )
        &&
        d >= now
      ){

        candidates.push({

          date:d,

          title:"🩻 Nöbet",

          meta:
            `${formatDateTR(shift.startDate)} · 08:30 → ertesi gün 08:30`

        });

      }

    }
  );


  return candidates
    .sort(
      (a,b) =>
        a.date - b.date
    )[0]
    ||
    null;

}


function renderProductivityHome(){

  const title =
    $("#nextItemTitle");

  const meta =
    $("#nextItemMeta");


  if(
    !title
    ||
    !meta
  ){
    return;
  }


  const next =
    nextScheduledItem();


  if(next){

    title.textContent =
      next.title;

    meta.textContent =
      next.meta;

  }else{

    title.textContent =
      "Yaklaşan plan yok";

    meta.textContent =
      "Hızlı ekle ile gününü oluştur.";

  }

}


/* ==========================================
   BUGÜN AKIŞI
========================================== */

function renderTodayTimeline(){

  const target =
    $("#todayTimeline");

  if(!target){
    return;
  }


  const date =
    today();


  const list = [];


  entries
    .filter(
      entry =>
        entry.date === date
    )
    .forEach(
      entry => {

        list.push({

          time:
            time24(entry.time),

          title:
            entry.kind === "overtime"
            ? "💼 Ekstra Mesai"
            : entry.title || "Plan",

          endTime:
            time24(entry.endTime),

          note:
            entry.note || ""

        });

      }
    );


  shifts
    .filter(
      shift =>
        shift.startDate === date
    )
    .forEach(
      () => {

        list.push({

          time:"08:30",

          endTime:"08:30",

          title:"🩻 Nöbet",

          note:"Ertesi gün 08:30 çıkış"

        });

      }
    );


  list.sort(
    (a,b) =>
      String(a.time || "")
      .localeCompare(
        String(b.time || "")
      )
  );


  if(!list.length){

    target.innerHTML =
      `
      <div class="empty">
        Bugün kayıtlı plan yok.
      </div>
      `;

    return;

  }


  target.innerHTML =
    list.map(
      item => `
        <div class="timeline-row">

          <div class="timeline-time">

            ${safe(
              item.time || "--:--"
            )}

          </div>


          <div class="timeline-content">

            <strong>
              ${safe(item.title)}
            </strong>

            ${
              item.endTime
              ?
              `
              <small>
                ${safe(item.time)}
                –
                ${safe(item.endTime)}
              </small>
              `
              :
              ""
            }

            ${
              item.note
              ?
              `
              <small>
                ${safe(item.note)}
              </small>
              `
              :
              ""
            }

          </div>

        </div>
      `
    ).join("");

}


/* ==========================================
   EROLAND FİLTRE
========================================== */

function bindMemoryFilters(){

  $$("[data-memory-filter]")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            activeMemoryFilter =
              button.dataset
                .memoryFilter
              ||
              "all";


            $$("[data-memory-filter]")
              .forEach(
                item =>
                  item.classList
                    .toggle(
                      "active",
                      item === button
                    )
              );


            renderMemories();

          }
        );

      }
    );

}


/* ==========================================
   GENEL RENDER
========================================== */

function renderAll(){

  const greeting =
    $("#heroGreeting");


  if(greeting){

    greeting.textContent =
      `Merhaba ${profile?.name || "Erol"} 👋`;

  }


  const todayLabel =
    $("#todayLabel");


  if(todayLabel){

    todayLabel.textContent =
      fmtTR(
        new Date()
      );

  }


  renderProductivityHome();
renderShiftMini();
  renderTodayTimeline();

  renderCalendar();

  renderDayDetail();

  renderMemories();

  renderAI();

}


/* ==========================================
   MODÜL BUTONLARI
========================================== */

function openModule(name){

  if(name === "shifts"){

    openShifts();
    return;

  }


  if(name === "overtime"){

    openOvertime();
    return;

  }


  if(name === "pair"){

    openPairInfo();
    return;

  }


  if(name === "routines"){

    openRoutines();
    return;

  }


  if(name === "stats"){

    openStats();
    return;

  }


  if(name === "brain"){

    openGeneric(
      `
      <div class="modal-head">

        <div>
          <p class="eyebrow">
            E.LOG
          </p>

          <h3>
            🧠 E.log beyni
          </h3>
        </div>

        <button
          class="icon-btn close-generic"
          type="button"
        >
          ×
        </button>

      </div>

      <div class="rule-card">

        <strong>
          Seni tanıyan bilgiler
        </strong>

        <p>
          E.log; planlarını, nöbetlerini,
          ekstra mesailerini ve rutinlerini
          kullanarak cevap verir.
        </p>

      </div>
      `
    );

    return;

  }


  if(name === "notifications"){

    openGeneric(
      `
      <div class="modal-head">

        <h3>
          🔔 Akıllı Bildirimler
        </h3>

        <button
          class="icon-btn close-generic"
          type="button"
        >
          ×
        </button>

      </div>

      <div class="rule-card">

        <strong>
          Bildirimler
        </strong>

        <p>
          Telefon bildirim izni verildiğinde
          yaklaşan plan ve mesailer için
          bildirim kullanılabilir.
        </p>

      </div>

      <button
        id="notificationPermissionBtn"
        class="primary-btn full"
        type="button"
      >
        Bildirim izni ver
      </button>
      `,

      () => {

        $("#notificationPermissionBtn")
          .onclick =
          async () => {

            if(
              !("Notification" in window)
            ){

              alert(
                "Bu cihaz bildirimleri desteklemiyor."
              );

              return;

            }


            const result =
              await Notification
                .requestPermission();


            $("#notificationPermissionBtn")
              .textContent =
              result === "granted"
              ? "✓ Bildirim izni verildi"
              : "Bildirim izni verilmedi";

          };

      }

    );

    return;

  }


  if(name === "partner"){

    openPairInfo();

  }

}


/* ==========================================
   EVENTLER
========================================== */

function bindEvents(){

  /*
   * Alt menü
   */

  $$(".nav-btn")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const view =
              button.dataset.view;


            if(!view){
              return;
            }


            $$(".view")
              .forEach(
                section =>
                  section.classList
                    .toggle(
                      "active",
                      section.id ===
                      `view-${view}`
                    )
              );


            $$(".nav-btn")
              .forEach(
                nav =>
                  nav.classList
                    .toggle(
                      "active",
                      nav === button
                    )
              );


            if(view === "calendar"){

              renderCalendar();
              renderDayDetail();

            }


            if(view === "eroland"){

              renderMemories();

            }


            if(view === "ai"){

              renderAI();

            }

          }
        );

      }
    );


  /*
   * data-open butonları
   */

  document.addEventListener(
    "click",
    event => {

      const button =
        event.target
          .closest(
            "[data-open]"
          );


      if(!button){
        return;
      }


      const name =
        button.dataset.open;


      if(name){

        openModule(name);

      }

    }
  );


  /*
   * Hızlı ekle
   */

  $("#quickAddBtn")
    ?.addEventListener(
      "click",
      () =>
        openEntryForm()
    );


  $("#calendarAddBtn")
    ?.addEventListener(
      "click",
      () =>
        openEntryForm()
    );


  /*
   * PLAN
   */

  $("#quickPlanBtn")
    ?.addEventListener(
      "click",
      () =>
        openEntryForm(
          "",
          "general"
        )
    );


  /*
   * SPOR
   */

  $("#quickSportBtn")
    ?.addEventListener(
      "click",
      () =>
        openEntryForm(
          "Spor",
          "sport"
        )
    );


  /*
   * ANI
   */

  $("#quickMemoryBtn")
    ?.addEventListener(
      "click",
      () => {

        const nav =
          $(
            '.nav-btn[data-view="eroland"]'
          );


        nav?.click();


        setTimeout(
          openMemoryForm,
          100
        );

      }
    );


  $("#memoryAddBtn")
    ?.addEventListener(
      "click",
      openMemoryForm
    );


  /*
   * Sıradaki kart
   */

  $("#nextItemCard")
    ?.addEventListener(
      "click",
      () => {

        $(
          '.nav-btn[data-view="calendar"]'
        )
        ?.click();

      }
    );


  /*
   * Tek dokunuşla sor
   */

  document.addEventListener(
    "click",
    event => {

      const button =
        event.target
          .closest(
            "[data-ai-prompt]"
          );


      if(!button){
        return;
      }


      const prompt =
        button.dataset
          .aiPrompt;


      $(
        '.nav-btn[data-view="ai"]'
      )
      ?.click();


      setTimeout(
        () =>
          askAI(prompt),
        100
      );

    }
  );


  /*
   * AI form
   */

  $("#aiForm")
    ?.addEventListener(
      "submit",
      async event => {

        event.preventDefault();


        const input =
          $("#aiInput");


        const text =
          input.value
          .trim();


        if(!text){
          return;
        }


        input.value =
          "";


        await askAI(text);

      }
    );


  /*
   * Aktivite kaydet
   */

  $("#entryForm")
    ?.addEventListener(
      "submit",
      async event => {

        event.preventDefault();


        const item = {

          id:uuid(),

          date:
            $("#entryDate")
              .value,

          time:
            time24(
              $("#entryTime")
                .value
            ),

          category:
            $("#entryCategory")
              .value,

          title:
            $("#entryTitle")
              .value
              .trim(),

          note:
            $("#entryNote")
              .value
              .trim(),

          done:
            $("#entryDone")
              .checked,

          createdBy:
            currentUser?.uid
            ||
            "local",

          _pending:true

        };


        entries.push(item);

        saveLocal();

        renderAll();


        $("#entryDialog")
          .close();


        await cloudSave(
          "entries",
          item
        );

      }
    );


  /*
   * Entry dialog kapat
   */

  $$(".close-dialog")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          event => {

            event.preventDefault();

            $("#entryDialog")
              ?.close();

          }
        );

      }
    );


  /*
   * Takvim önceki ay
   */

  $("#prevMonth")
    ?.addEventListener(
      "click",
      () => {

        calendarCursor =
          new Date(
            calendarCursor
              .getFullYear(),

            calendarCursor
              .getMonth()-1,

            1
          );


        renderCalendar();

      }
    );


  /*
   * Takvim sonraki ay
   */

  $("#nextMonth")
    ?.addEventListener(
      "click",
      () => {

        calendarCursor =
          new Date(
            calendarCursor
              .getFullYear(),

            calendarCursor
              .getMonth()+1,

            1
          );


        renderCalendar();

      }
    );


  /*
   * Google giriş
   */

  $("#googleLoginBtn")
    ?.addEventListener(
      "click",
      async () => {

        if(!auth){
          return;
        }


        const provider =
          new GoogleAuthProvider();


        try{

          await signInWithPopup(
            auth,
            provider
          );


        }catch(error){

          console.warn(
            "Popup giriş başarısız:",
            error
          );


          try{

            await signInWithRedirect(
              auth,
              provider
            );


          }catch(redirectError){

            console.error(
              "Google giriş başarısız:",
              redirectError
            );


            const message =
              $("#authMessage");


            if(message){

              message.textContent =
                "Google girişi açılamadı.";

            }

          }

        }

      }
    );


  /*
   * Çıkış
   */

  $("#logoutBtn")
    ?.addEventListener(
      "click",
      async () => {

        if(auth){

          await signOut(auth);

        }

      }
    );


  /*
   * Profil butonu
   */

  $("#profileBtn")
    ?.addEventListener(
      "click",
      () => {

        openPairInfo();

      }
    );


  bindMemoryFilters();

}


/* ==========================================
   SERVICE WORKER
========================================== */

async function registerServiceWorker(){

  if(
    !("serviceWorker" in navigator)
  ){
    return;
  }


  try{

    const registrations =
      await navigator
        .serviceWorker
        .getRegistrations();


    for(
      const registration
      of registrations
    ){

      await registration.update();

    }


    await navigator
      .serviceWorker
      .register(
        "./sw.js"
      );


  }catch(error){

    console.warn(
      "Service worker:",
      error
    );

  }

}


/* ==========================================
   BAŞLAT
========================================== */

async function boot(){

  loadLocal();

  bindEvents();

  renderAll();

  await registerServiceWorker();

  await initFirebase();

}


boot();
