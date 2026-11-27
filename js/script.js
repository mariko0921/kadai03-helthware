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
import {
  startOuraLogin,
  handleOuraRedirect,
  getOuraToken,
  disconnectOura,
  convertOuraExport,
} from "./oura.js";
import {
  createDemoData,
  deleteDemoData,
  watchRecentHealth,
  saveOuraDays,
  watchConnection,
} from "./health.js";
import {
  renderToday,
  CHART_METRICS,
  buildWeekSeries,
  renderWeekChart,
} from "./dashboard.js";
import { METRICS } from "./health.js";

// ログイン中のユーザーのuid（未ログインなら null）
let currentUid = null;

// 気分の監視をやめるための関数（watchRecentMoods の戻り値を入れておく）
let stopWatchingMoods = null;

// 健康データの監視をやめるための関数
let stopWatchingHealth = null;

// Oura連携状態の監視をやめるための関数
let stopWatchingConnection = null;

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
    // 直近7日分の健康データの監視も開始
    stopWatchingHealth = watchRecentHealth(user.uid, 7, onHealthChanged);
    // Ouraの最終同期日時の監視も開始
    stopWatchingConnection = watchConnection(user.uid, "oura", renderOuraSync);
  } else {
    // ログアウトしたら監視をやめる
    // （やめないと、権限がないのに読もうとしてエラーになる）
    if (stopWatchingMoods) {
      stopWatchingMoods();
      stopWatchingMoods = null;
    }
    if (stopWatchingHealth) {
      stopWatchingHealth();
      stopWatchingHealth = null;
    }
    if (stopWatchingConnection) {
      stopWatchingConnection();
      stopWatchingConnection = null;
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

// ---------- ⑦ Oura連携（Step 6 → Step 10 で更新） ----------
// Oura API はブラウザから直接呼べない（CORS）ため、
// ブラウザでは「トークンの取得」だけを行い、データ取得はターミナルのスクリプトで行う
const ouraStatus = document.querySelector("#oura-status");
const ouraConnectBtn = document.querySelector("#oura-connect-btn");
const ouraCopyBtn = document.querySelector("#oura-copy-btn");
const ouraDisconnectBtn = document.querySelector("#oura-disconnect-btn");
const ouraOutput = document.querySelector("#oura-output");
const ouraImportLabel = document.querySelector("#oura-import-label");
const ouraImportInput = document.querySelector("#oura-import-input");

// ページを開いた瞬間に「Ouraから戻ってきたところか？」を確認
const redirectResult = handleOuraRedirect();

function renderOuraStatus() {
  const token = getOuraToken();
  if (token) {
    const until = new Date(token.expiresAt).toLocaleDateString("ja-JP");
    ouraStatus.textContent = `✅ 連携中（${until} まで有効）`;
  } else {
    ouraStatus.textContent = redirectResult === "error" ? "⚠️ 連携に失敗しました" : "未連携";
  }
  ouraConnectBtn.hidden = !!token;
  ouraCopyBtn.hidden = !token;
  ouraImportLabel.hidden = !token;
  ouraDisconnectBtn.hidden = !token;
}
renderOuraStatus();

ouraConnectBtn.addEventListener("click", () => startOuraLogin());

ouraDisconnectBtn.addEventListener("click", () => {
  disconnectOura();
  ouraOutput.textContent = "";
  renderOuraStatus();
});

// 取得スクリプト（scripts/fetch_oura.py）に貼り付けるためのトークンをコピー
// ※画面には表示しない（肩越しに見られたり、スクショに写ったりしないように）
ouraCopyBtn.addEventListener("click", async () => {
  const token = getOuraToken();
  if (!token) return;
  await navigator.clipboard.writeText(token.accessToken);
  ouraOutput.textContent =
    "📋 コピーしました。ターミナルで python3 scripts/fetch_oura.py を実行し、貼り付けてください。";
});

// ---------- ⑧ デモデータの作成・削除（Step 7） ----------
const demoCreateBtn = document.querySelector("#demo-create-btn");
const demoDeleteBtn = document.querySelector("#demo-delete-btn");
const demoMessage = document.querySelector("#demo-message");

demoCreateBtn.addEventListener("click", async () => {
  if (!currentUid) return;
  try {
    await createDemoData(currentUid, 7);
    demoMessage.textContent = "デモデータを7日分作成しました";
  } catch (error) {
    console.error(error);
    demoMessage.textContent = "作成できませんでした: " + error.message;
  }
});

demoDeleteBtn.addEventListener("click", async () => {
  if (!currentUid) return;
  if (!confirm("デモデータをすべて削除しますか？（実データは消えません）")) return;
  try {
    const count = await deleteDemoData(currentUid);
    demoMessage.textContent = `デモデータを${count}日分削除しました`;
  } catch (error) {
    console.error(error);
    demoMessage.textContent = "削除できませんでした: " + error.message;
  }
});

// ---------- ⑨ 今日のコンディション表示（Step 8） ----------
const todayHealth = document.querySelector("#today-health");
const sourceSwitch = document.querySelector("#source-switch");
const demoBadge = document.querySelector("#demo-badge");

// 表示する取得元（"oura" or "demo"）。リロードしても覚えておく
let displaySource = localStorage.getItem("ogaru.displaySource") || "oura";

// 最後に受け取った7日分のデータ（切り替え時に再描画するため保持）
let recentHealth = {};

// DBの健康データが変わるたびに呼ばれる
function onHealthChanged(data) {
  recentHealth = data;
  renderHealth();
}

// 選んだ取得元のデータだけを取り出して描画する（混ぜない）
function renderHealth() {
  const today = todayString();
  const todayData = recentHealth[today]?.[displaySource]; // 例: data["2026-11-26"]["demo"]
  renderToday(todayHealth, todayData, displaySource);
  renderChart(); // グラフも同じデータ・同じ取得元で描き直す

  // デモ表示中は必ずバッジを出す
  demoBadge.hidden = displaySource !== "demo";
  sourceSwitch.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.source === displaySource);
  });
}

// 実データ / デモ の切り替え
sourceSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-source]");
  if (!btn) return;
  displaySource = btn.dataset.source;
  localStorage.setItem("ogaru.displaySource", displaySource);
  renderHealth(); // DBは読み直さず、手元のデータで描き直す
});

// ---------- ⑩ 直近7日間のグラフ（Step 9） ----------
const chartTabs = document.querySelector("#chart-tabs");
const chartCanvas = document.querySelector("#week-chart");
const chartSummary = document.querySelector("#chart-summary");

let chartMetric = "readinessScore"; // 最初に表示する指標

// 指標の切り替えタブを METRICS から自動生成
for (const key of CHART_METRICS) {
  const btn = document.createElement("button");
  btn.dataset.metric = key;
  btn.textContent = METRICS[key].label;
  chartTabs.appendChild(btn);
}

chartTabs.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-metric]");
  if (!btn) return;
  chartMetric = btn.dataset.metric;
  renderChart();
});

function renderChart() {
  // 🧠 ここがデータ処理の本体：手元の7日分 → 選んだ取得元・指標だけの配列
  const series = buildWeekSeries(recentHealth, displaySource, chartMetric);
  renderWeekChart(chartCanvas, chartSummary, series, chartMetric);

  chartTabs.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.metric === chartMetric);
  });
}

// ---------- ⑪ Ouraデータの読み込み・保存（Step 10） ----------
ouraImportInput.addEventListener("change", async () => {
  const file = ouraImportInput.files[0];
  if (!file || !currentUid) return;

  try {
    // ① ファイルの中身を文字列として読む → JSONとして解釈
    const json = JSON.parse(await file.text());

    // ② 🧠 Ouraの形 → OGARUの共通の形 に変換
    const days = convertOuraExport(json);
    const count = Object.keys(days).length;
    if (count === 0) throw new Error("保存できるデータがありませんでした");

    if (!confirm(`${count}日分のOuraデータを保存しますか？（同じ日付は上書きされます）`)) return;

    // ③ Firebaseに保存（健康データ + 最終同期日時を一括で）
    await saveOuraDays(currentUid, days, Date.parse(json.exportedAt));
    ouraOutput.textContent = `✅ ${count}日分のOuraデータを保存しました`;

    // ④ 表示を実データに切り替える（画面はonValueで自動更新される）
    displaySource = "oura";
    localStorage.setItem("ogaru.displaySource", displaySource);
    renderHealth();
  } catch (error) {
    console.error(error);
    ouraOutput.textContent = "❌ 読み込めませんでした: " + error.message;
  } finally {
    // 同じファイルをもう一度選んでも change が起きるように空にする
    ouraImportInput.value = "";
  }
});

// ---------- ⑫ 最終同期日時の表示（Step 11） ----------
const ouraSync = document.querySelector("#oura-sync");
const ONE_DAY = 24 * 60 * 60 * 1000; // 24時間（ミリ秒）

// conn = connections/{uid}/oura の中身（未同期なら null）
function renderOuraSync(conn) {
  if (!conn) {
    ouraSync.textContent = "まだ同期していません";
    ouraSync.classList.remove("is-stale");
    return;
  }

  const fmt = (ms) =>
    new Date(ms).toLocaleString("ja-JP", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });

  let text =
    `最終同期：${fmt(conn.lastSyncAt)}` +
    `（Ouraから取得：${fmt(conn.dataFetchedAt)}・${conn.rangeStart}〜${conn.rangeEnd} の${conn.dayCount}日分）`;

  // 24時間以上たっていたら注意を出す
  const isStale = Date.now() - conn.lastSyncAt > ONE_DAY;
  if (isStale) text = "⚠️ 1日以上同期していません　" + text;

  ouraSync.textContent = text;
  ouraSync.classList.toggle("is-stale", isStale);
}
