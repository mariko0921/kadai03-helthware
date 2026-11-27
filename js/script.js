// =====================================================
// script.js : 画面の処理
// =====================================================
import { auth, provider, db } from "./firebase.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";
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
  watchMoodsInRange,
} from "./mood.js";
import {
  startOuraLogin,
  handleOuraRedirect,
  getOuraToken,
  disconnectOura,
  convertOuraExport,
} from "./oura.js";
import {
  watchRecentHealth,
  saveOuraDays,
  watchConnection,
  watchHealthInRange,
} from "./health.js";
import {
  BODY_METRICS,
  saveBody,
  deleteBody,
  watchLatestBody,
  getBody,
  saveHealthPlanetDays,
} from "./body.js";
import { convertHealthPlanetExport } from "./healthplanet.js";
import {
  renderToday,
  renderBody,
  renderCalendar,
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

// 体組成の監視をやめるための関数
let stopWatchingBody = null;

// HealthPlanet連携状態の監視をやめるための関数
let stopWatchingHpConnection = null;

// ---------- 画面の要素を取得 ----------
const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const loginBtn = document.querySelector("#login-btn");
const logoutBtn = document.querySelector("#logout-btn");
const userName = document.querySelector("#user-name");
const headerUser = document.querySelector("#header-user");
const greetingText = document.querySelector("#greeting-text");
const greetingDate = document.querySelector("#greeting-date");

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
    renderGreeting(user.displayName);
    loginView.hidden = true;
    appView.hidden = false;
    headerUser.hidden = false;

    // ログインしたら、自分の気分データの監視を開始
    stopWatchingMoods = watchRecentMoods(user.uid, renderMoods);
    // 直近7日分の健康データの監視も開始
    stopWatchingHealth = watchRecentHealth(user.uid, 7, onHealthChanged);
    // Ouraの最終同期日時の監視も開始
    stopWatchingConnection = watchConnection(user.uid, "oura", renderOuraSync);
    // 体組成（最新2回分）の監視も開始
    stopWatchingBody = watchLatestBody(user.uid, (list) => renderBody(bodyLatest, list));
    // HealthPlanetの最終同期日時（Ouraと同じ関数を、取得元だけ変えて使い回す）
    stopWatchingHpConnection = watchConnection(user.uid, "healthplanet", (conn) => renderSyncInfo(hpSync, conn));
    // カレンダー：今月から表示
    const now = new Date();
    showCalendarMonth(now.getFullYear(), now.getMonth());
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
    if (stopWatchingBody) {
      stopWatchingBody();
      stopWatchingBody = null;
    }
    if (stopWatchingHpConnection) {
      stopWatchingHpConnection();
      stopWatchingHpConnection = null;
    }
    stopCalendarWatchers();
    // センシティブな体組成は、ログアウト時に画面からも消してコンディション表示に戻す
    bodyLatest.innerHTML = "";
    showView("condition");
    loginView.hidden = false;
    appView.hidden = true;
    headerUser.hidden = true;
  }
});

// 時間帯に合わせたあいさつと今日の日付
function renderGreeting(displayName) {
  const now = new Date();
  const h = now.getHours();
  const hello = h < 4 ? "こんばんは" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "こんばんは";
  const firstName = (displayName || "").split(" ")[0];
  greetingText.textContent = firstName ? `${hello}、${firstName}さん` : hello;
  greetingDate.textContent = now.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
}

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

// ---------- ⑨ 今日のコンディション表示（Step 8） ----------
const todayHealth = document.querySelector("#today-health");

// 表示する取得元。今は Oura のみ（将来 Apple などを足すときはここを切り替える）
const displaySource = "oura";
localStorage.removeItem("ogaru.displaySource"); // デモ廃止前の設定の掃除

// 最後に受け取った7日分のデータ（切り替え時に再描画するため保持）
let recentHealth = {};

// DBの健康データが変わるたびに呼ばれる
function onHealthChanged(data) {
  recentHealth = data;
  renderHealth();
}

// 取得元のデータだけを取り出して描画する
function renderHealth() {
  const today = todayString();
  const todayData = recentHealth[today]?.[displaySource]; // 例: data["2026-11-27"]["oura"]
  renderToday(todayHealth, todayData, displaySource);
  renderChart(); // グラフも同じデータで描き直す
}

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

    // 画面は onValue が自動で更新する
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

function renderOuraSync(conn) {
  renderSyncInfo(ouraSync, conn);
}

// 最終同期日時の表示（Oura / HealthPlanet 共通）
// el = 表示する要素、conn = connections/{uid}/{source} の中身（未同期なら null）
function renderSyncInfo(el, conn) {
  if (!conn) {
    el.textContent = "まだ同期していません";
    el.classList.remove("is-stale");
    return;
  }

  const fmt = (ms) =>
    new Date(ms).toLocaleString("ja-JP", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });

  // データが0件のときは期間の代わりに「まだありません」と出す
  const range = conn.dayCount > 0
    ? `${conn.rangeStart}〜${conn.rangeEnd} の${conn.dayCount}日分`
    : "計測データはまだありません";
  let text = `最終同期：${fmt(conn.lastSyncAt)}（取得：${fmt(conn.dataFetchedAt)}・${range}）`;

  // 24時間以上たっていたら注意を出す
  const isStale = Date.now() - conn.lastSyncAt > ONE_DAY;
  if (isStale) text = "⚠️ 1日以上同期していません　" + text;

  el.textContent = text;
  el.classList.toggle("is-stale", isStale);
}

// ---------- ⑬ 接続状態の表示（Step 12） ----------
// ".info/connected" は Firebase が用意している特別な場所
// サーバーとつながっていれば true、切れていれば false が届く（ルール設定は不要）
const connDot = document.querySelector("#conn-dot");
const offlineBanner = document.querySelector("#offline-banner");
let hasConnectedOnce = false; // 起動直後の「まだつながっていない」は警告しない

onValue(ref(db, ".info/connected"), (snapshot) => {
  const online = snapshot.val() === true;
  if (online) hasConnectedOnce = true;

  connDot.classList.toggle("is-online", online);
  connDot.title = online ? "接続中" : "オフライン";
  // 一度つながった後に切れたときだけバナーを出す
  offlineBanner.hidden = online || !hasConnectedOnce;
});

// 起動から5秒たってもつながらなければ、バナーを出す
setTimeout(() => {
  if (!hasConnectedOnce) offlineBanner.hidden = false;
}, 5000);

// ---------- ⑭ 体組成タブ（Step 12） ----------
const viewSwitch = document.querySelector("#view-switch");
const todayTitle = document.querySelector("#today-title");
const conditionPanel = document.querySelector("#condition-panel");
const bodyPanel = document.querySelector("#body-panel");
const bodyLatest = document.querySelector("#body-latest");
const bodyEditBtn = document.querySelector("#body-edit-btn");
const bodyForm = document.querySelector("#body-form");
const bodyDate = document.querySelector("#body-date");
const bodyFields = document.querySelector("#body-fields");
const bodyCancelBtn = document.querySelector("#body-cancel-btn");
const bodyDeleteBtn = document.querySelector("#body-delete-btn");
const bodyMessage = document.querySelector("#body-message");

// --- 表示の切り替え（コンディション / 体組成） ---
// 体組成はタブを押したときだけ表示。リロードすると必ずコンディションに戻る（保存しない）
function showView(view) {
  const isBody = view === "body";
  conditionPanel.hidden = isBody;
  bodyPanel.hidden = !isBody;
  todayTitle.textContent = isBody ? "体組成" : "今日のコンディション";
  viewSwitch.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  });
  if (!isBody) closeBodyForm(); // 体組成から離れたら入力フォームも閉じる
}

viewSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) showView(btn.dataset.view);
});

// --- 入力欄を BODY_METRICS から自動生成（項目を増やしてもHTMLの修正は不要） ---
for (const [key, m] of Object.entries(BODY_METRICS)) {
  const label = document.createElement("label");
  label.className = "body-field";
  label.innerHTML = `
    <span>${m.label}${m.unit ? `（${m.unit}）` : ""}</span>
    <input type="number" name="${key}" step="${m.step}" min="${m.min}" max="${m.max}" inputmode="decimal">
  `;
  bodyFields.appendChild(label);
}

// --- フォームを開く・閉じる ---
bodyEditBtn.addEventListener("click", () => {
  bodyForm.hidden = false;
  bodyEditBtn.hidden = true;
  bodyMessage.textContent = "";
  bodyDate.max = todayString(); // 未来の日付は選べない
  bodyDate.value = todayString();
  fillBodyForm(); // 今日の記録があれば入れておく
});

function closeBodyForm() {
  bodyForm.hidden = true;
  bodyEditBtn.hidden = false;
}
bodyCancelBtn.addEventListener("click", closeBodyForm);

// 日付を変えたら、その日の記録を読み込んで入れておく（修正しやすいように）
bodyDate.addEventListener("change", fillBodyForm);

async function fillBodyForm() {
  const date = bodyDate.value || todayString(); // reset() で消える前に日付を覚えておく
  bodyForm.reset();
  bodyDate.value = date; // reset() で消えた日付を「すぐに」戻す（読み込みに失敗しても日付は残る）
  bodyDeleteBtn.hidden = true;

  try {
    // 🧠 get() で「その日」の値を1回だけ読む（監視は不要なので onValue ではない）
    const saved = await getBody(currentUid, date);
    for (const key of Object.keys(BODY_METRICS)) {
      bodyForm.elements[key].value = saved?.[key] ?? "";
    }
    bodyDeleteBtn.hidden = !saved; // 記録がある日だけ「削除」を出す
  } catch (error) {
    // ルールで読み取りが拒否されると、ここに来る（PERMISSION_DENIED）
    console.error(error);
    bodyMessage.textContent = "この日の記録を読み込めませんでした: " + error.message;
  }
}

// --- 保存（Create / Update） ---
bodyForm.addEventListener("submit", async (e) => {
  e.preventDefault(); // フォーム送信でページが再読み込みされるのを止める
  if (!currentUid) return;

  // 🧠 入力された項目だけを集める（空欄は保存しない＝未取得のまま）
  const values = {};
  for (const key of Object.keys(BODY_METRICS)) {
    const input = bodyForm.elements[key];
    if (input.value !== "") values[key] = Number(input.value);
  }
  if (Object.keys(values).length === 0) {
    bodyMessage.textContent = "1つ以上の項目を入力してください";
    return;
  }

  try {
    await saveBody(currentUid, bodyDate.value, values);
    bodyMessage.textContent = `${bodyDate.value} の計測値を保存しました`;
    closeBodyForm(); // 表示は onValue が自動で更新する
  } catch (error) {
    console.error(error);
    bodyMessage.textContent = "保存できませんでした: " + error.message;
  }
});

// --- 削除（Delete） ---
bodyDeleteBtn.addEventListener("click", async () => {
  if (!confirm(`${bodyDate.value} の体組成の記録を削除しますか？`)) return;
  try {
    await deleteBody(currentUid, bodyDate.value);
    bodyMessage.textContent = `${bodyDate.value} の記録を削除しました`;
    closeBodyForm();
  } catch (error) {
    console.error(error);
    bodyMessage.textContent = "削除できませんでした: " + error.message;
  }
});

// ---------- ⑮ HealthPlanetデータの読み込み・保存 ----------
const hpSync = document.querySelector("#hp-sync");
const hpImportInput = document.querySelector("#hp-import-input");
const hpOutput = document.querySelector("#hp-output");

hpImportInput.addEventListener("change", async () => {
  const file = hpImportInput.files[0];
  if (!file || !currentUid) return;

  try {
    const json = JSON.parse(await file.text());

    // 🧠 HealthPlanetの形 → OGARUの共通の形 に変換
    const days = convertHealthPlanetExport(json);
    const count = Object.keys(days).length;

    // 0件でも「連携できた（同期した）」という記録は残す
    // → 最終同期日時が表示され、連携が成功していることが分かる
    const question = count === 0
      ? "計測データはまだありませんが、連携（同期）の記録を保存しますか？"
      : `${count}日分の体組成データを保存しますか？（同じ日付のHealthPlanet分は上書き、手入力分はそのまま）`;
    if (!confirm(question)) return;

    await saveHealthPlanetDays(currentUid, days, Date.parse(json.exportedAt));
    // センシティブなので、ここでは数値を出さず日数だけ伝える
    hpOutput.textContent = count === 0
      ? "✅ 連携を記録しました。体組成計で測定すると、次回の取り込みから反映されます"
      : `✅ ${count}日分の体組成データを保存しました（「体組成」タブで確認できます）`;
  } catch (error) {
    console.error(error);
    hpOutput.textContent = "❌ 読み込めませんでした: " + error.message;
  } finally {
    hpImportInput.value = "";
  }
});

// ---------- ⑯ 1か月カレンダー ----------
const calTitle = document.querySelector("#cal-title");
const calendarEl = document.querySelector("#calendar");
const calSummary = document.querySelector("#cal-summary");

let calYear = null;
let calMonth = null; // 0 = 1月
let calMoods = {};
let calHealth = {};
let stopCalMoods = null;
let stopCalHealth = null;

// 月の監視をやめる（月を移動したとき・ログアウトしたとき）
function stopCalendarWatchers() {
  if (stopCalMoods) { stopCalMoods(); stopCalMoods = null; }
  if (stopCalHealth) { stopCalHealth(); stopCalHealth = null; }
}

// 指定した月を表示：前の月の監視を止めてから、新しい月の監視を始める
function showCalendarMonth(year, month) {
  stopCalendarWatchers();

  // Date は「13月」→翌年1月 のように自動で繰り上げてくれる
  const first = new Date(year, month, 1);
  calYear = first.getFullYear();
  calMonth = first.getMonth();
  calTitle.textContent = `${calYear}年${calMonth + 1}月`;

  const startDate = todayString(first);                           // "2026-11-01"
  const endDate = todayString(new Date(calYear, calMonth + 1, 0)); // "2026-11-30"

  calMoods = {};
  calHealth = {};
  renderCurrentCalendar();

  // 🧠 2種類の範囲検索で、その月の分だけを取得・監視
  stopCalMoods = watchMoodsInRange(currentUid, startDate, endDate, (moods) => {
    calMoods = moods;
    renderCurrentCalendar();
  });
  stopCalHealth = watchHealthInRange(currentUid, startDate, endDate, (health) => {
    calHealth = health;
    renderCurrentCalendar();
  });
}

function renderCurrentCalendar() {
  renderCalendar(calendarEl, calSummary, calYear, calMonth, calMoods, calHealth);
}

document.querySelector("#cal-prev").addEventListener("click", () => showCalendarMonth(calYear, calMonth - 1));
document.querySelector("#cal-next").addEventListener("click", () => showCalendarMonth(calYear, calMonth + 1));
