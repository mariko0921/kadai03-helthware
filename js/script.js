// =====================================================
// script.js : 画面の処理
// =====================================================
import { auth, provider } from "./firebase.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { MOODS, saveMood } from "./mood.js";

// ログイン中のユーザーのuid（未ログインなら null）
let currentUid = null;

// ---------- 画面の要素を取得 ----------
const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const loginBtn = document.querySelector("#login-btn");
const logoutBtn = document.querySelector("#logout-btn");
const userName = document.querySelector("#user-name");
const userUid = document.querySelector("#user-uid");

// ---------- ① ログイン ----------
// ボタンを押すとGoogleのログイン画面がポップアップで開く
loginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
    // 成功しても、ここでは画面を切り替えない（③ に任せる）
  } catch (error) {
    console.error("ログイン失敗:", error.code, error.message);
    alert("ログインできませんでした: " + error.code);
  }
});

// ---------- ② ログアウト ----------
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

// ---------- ③ ログイン状態の監視 ----------
// ログイン・ログアウト・ページ再読み込みのたびに自動で呼ばれる
// user が入っていれば「ログイン中」、null なら「未ログイン」
onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
  if (user) {
    userName.textContent = user.displayName;
    userUid.textContent = user.uid; // ← このuidがDBの保存場所の鍵になる
    loginView.hidden = true;
    appView.hidden = false;
  } else {
    loginView.hidden = false;
    appView.hidden = true;
  }
});

// ---------- ④ 気分のワンタップ記録（Create） ----------
const moodButtons = document.querySelector("#mood-buttons");
const moodMessage = document.querySelector("#mood-message");

// MOODS の中身からボタンを自動で作る（選択肢を増やしてもHTMLの修正が不要）
for (const [code, info] of Object.entries(MOODS)) {
  const btn = document.createElement("button");
  btn.className = "mood-btn";
  btn.dataset.mood = code; // <button data-mood="relaxed"> のようにコードを持たせる
  btn.innerHTML = `<span class="mood-emoji">${info.emoji}</span>${info.label}`;
  moodButtons.appendChild(btn);
}

// ボタンが押されたら保存
moodButtons.addEventListener("click", async (e) => {
  const btn = e.target.closest(".mood-btn");
  if (!btn || !currentUid) return;

  const mood = btn.dataset.mood;
  try {
    await saveMood(currentUid, mood);
    moodMessage.textContent = `「${MOODS[mood].label}」を記録しました`;
  } catch (error) {
    // ルールで拒否されると error.code が "PERMISSION_DENIED" になる
    console.error("保存失敗:", error);
    moodMessage.textContent = "記録できませんでした: " + error.message;
  }
});
