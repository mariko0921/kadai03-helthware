// =====================================================
// script.js : 画面の処理
// =====================================================
import { auth, provider } from "./firebase.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  MOODS,
  saveMood,
  watchRecentMoods,
  todayString,
  updateMood,
  deleteMood,
} from "./mood.js";

// ログイン中のユーザーのuid（未ログインなら null）
let currentUid = null;

// 気分の監視をやめるための関数（watchRecentMoods の戻り値を入れておく）
let stopWatchingMoods = null;

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

    // ログインしたら、自分の気分データの監視を開始
    stopWatchingMoods = watchRecentMoods(user.uid, renderMoods);
  } else {
    // ログアウトしたら監視をやめる
    // （やめないと、権限がないのに読もうとしてエラーになる）
    if (stopWatchingMoods) {
      stopWatchingMoods();
      stopWatchingMoods = null;
    }
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

// ---------- ⑤ 気分の表示（Read） ----------
const todayMood = document.querySelector("#today-mood");
const moodHistory = document.querySelector("#mood-history");

// タイムスタンプ（ミリ秒）→ "11/26 14:32"
function formatTime(ms) {
  if (!ms) return "--:--";
  const d = new Date(ms);
  return d.toLocaleString("ja-JP", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// 気分コード → "🍃 リラックス"（想定外のコードでも落ちないように）
function moodText(code) {
  const info = MOODS[code];
  return info ? `${info.emoji} ${info.label}` : "不明な記録";
}

// watchRecentMoods から、データが変わるたびに呼ばれる
function renderMoods(list) {
  // --- 今日の気分：今日の日付の記録のうち、いちばん新しいもの ---
  const today = todayString();
  const latestToday = list.find((item) => item.date === today);

  if (latestToday) {
    todayMood.textContent = `${moodText(latestToday.mood)}（${formatTime(latestToday.recordedAt)}）`;
  } else {
    // 記録は任意なので、責めない表現にする
    todayMood.textContent = "まだ記録はありません";
  }

  // --- 履歴：新しい順に一覧表示 ---
  moodHistory.innerHTML = "";
  if (list.length === 0) {
    moodHistory.innerHTML = `<li class="muted">記録がまだありません</li>`;
    return;
  }
  for (const item of list) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.id = item.id; // Step 5（更新・削除）で使う
    // 変更済みなら目印を付ける
    const editedMark = item.updatedAt ? `<span class="muted">（変更済み）</span>` : "";

    // 付け替え用の小さな気分ボタン（最初は隠しておく）
    const choices = Object.entries(MOODS)
      .map(([code, info]) =>
        `<button class="choice-btn" data-action="choose" data-mood="${code}" title="${info.label}">${info.emoji}</button>`)
      .join("");

    li.innerHTML = `
      <div class="history-row">
        <span class="history-time">${formatTime(item.recordedAt)}</span>
        <span class="history-mood">${moodText(item.mood)}${editedMark}</span>
        <span class="history-actions">
          <button class="link-btn" data-action="edit">変更</button>
          <button class="link-btn danger" data-action="delete">削除</button>
        </span>
      </div>
      <div class="history-choices" hidden>${choices}</div>
    `;
    moodHistory.appendChild(li);
  }
}

// ---------- ⑥ 気分の変更・削除（Update / Delete） ----------
// 履歴は何度も描き直されるので、各ボタンではなく親の <ul> で
// クリックをまとめて受け取る（イベント委任）
moodHistory.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || !currentUid) return;

  const li = btn.closest(".history-item");
  const moodId = li.dataset.id; // Step 4 で埋め込んだ pushキー
  const action = btn.dataset.action;

  try {
    if (action === "edit") {
      // 付け替えボタンの表示・非表示を切り替えるだけ（DBは触らない）
      const choicesBox = li.querySelector(".history-choices");
      choicesBox.hidden = !choicesBox.hidden;
    }

    if (action === "choose") {
      // Update：選んだ気分に付け替える
      await updateMood(currentUid, moodId, btn.dataset.mood);
      // 画面の更新は onValue が自動でやってくれる
    }

    if (action === "delete") {
      // Delete：消すと元に戻せないので確認する
      if (!confirm("この記録を削除しますか？")) return;
      await deleteMood(currentUid, moodId);
    }
  } catch (error) {
    console.error("操作失敗:", error);
    alert("操作できませんでした: " + error.message);
  }
});
