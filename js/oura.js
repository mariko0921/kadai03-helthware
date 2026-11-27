// =====================================================
// oura.js : Oura API との連携（Step 6 検証版）
// 方式：クライアントサイドOAuth（response_type=token）
//   → Client Secret 不要・サーバー不要・トークン有効期限30日・自動更新なし
// =====================================================
import { ouraConfig } from "./oura-config.js";

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const API_BASE = "https://api.ouraring.com/v2/usercollection";

// localStorage に保存するときの名前
const TOKEN_KEY = "ogaru.oura.token";
const STATE_KEY = "ogaru.oura.state";

// ---------- ① 連携開始：Ouraの許可画面へ移動 ----------
export function startOuraLogin() {
  // CSRF対策：ランダムな合言葉(state)を作って覚えておく
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);

  // URLSearchParams を使うと、記号などを自動で安全な形(エンコード)にしてくれる
  const params = new URLSearchParams({
    response_type: "token", // 「トークンを直接ちょうだい」= ブラウザだけの方式
    client_id: ouraConfig.clientId,
    redirect_uri: ouraConfig.redirectUri,
    state: state,
    // scope を省略すると、アプリ登録時に選んだ範囲すべてを求める
  });

  // ページごとOuraへ移動（戻ってくるときは redirect_uri に戻る）
  location.href = `${AUTHORIZE_URL}?${params}`;
}

// ---------- ② 戻ってきたとき：URLの # からトークンを取り出す ----------
// 戻り値: "connected"（成功）/ "error"（失敗）/ null（Oura から戻ってきたのではない）
export function handleOuraRedirect() {
  if (!location.hash) return null;

  // "#access_token=xxx&expires_in=2592000&state=yyy" → 読みやすい形に
  const params = new URLSearchParams(location.hash.slice(1));

  // トークンが残ったURLを履歴に残さないよう、すぐに # 以降を消す
  history.replaceState(null, "", location.pathname);

  if (params.get("error")) {
    console.error("Oura連携エラー:", params.get("error"));
    return "error";
  }

  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  // 合言葉(state)が、出発前に覚えたものと一致するか確認
  const savedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (params.get("state") !== savedState) {
    console.error("state が一致しません。連携を中止しました");
    return "error";
  }

  // 有効期限（秒）→ 期限切れになる時刻（ミリ秒）に変換して一緒に保存
  // （万一 expires_in が無い場合は、ドキュメント記載の30日とみなす）
  const expiresIn = Number(params.get("expires_in")) || 30 * 24 * 60 * 60;
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt: Date.now() + expiresIn * 1000 })
  );
  return "connected";
}

// ---------- 保存済みトークンを取り出す（期限切れなら null） ----------
export function getOuraToken() {
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
  if (!saved) return null;
  if (Date.now() > saved.expiresAt) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return saved;
}

// ---------- 連携解除（この端末からトークンを消す） ----------
export function disconnectOura() {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------- ③ 検証：Oura API からデータを取得 ----------
// endpoint 例: "daily_readiness"（コンディション）, "daily_sleep"（睡眠スコア）
export async function fetchOura(endpoint, startDate, endDate) {
  const token = getOuraToken();
  if (!token) throw new Error("Ouraと未連携です");

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const res = await fetch(`${API_BASE}/${endpoint}?${params}`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });

  // ここに来た = ブラウザから届いた（CORSは通った）
  if (!res.ok) {
    throw new Error(`Oura API エラー: HTTP ${res.status}`);
  }
  return res.json(); // { data: [...], next_token: ... }
}

// =====================================================
// Step 10：Ouraエクスポートファイル → OGARUの共通の形 に変換
// =====================================================
// 入力：scripts/fetch_oura.py が作った JSON
// 出力：{ "2026-11-27": { readinessScore: 82, sleepDuration: 25200, ... }, ... }
export function convertOuraExport(json) {
  // 違うファイルを選んだときに、変なデータを保存しないための確認
  if (json?.format !== "ogaru-oura-export") {
    throw new Error("OGARU用のOuraエクスポートファイルではありません");
  }

  const days = {};

  // 1つの値を days[日付][項目] に入れる。値が無ければ何もしない（＝未取得のまま）
  // ※ Firebase は undefined を保存できない（エラーになる）ので、ここで除外しておく
  const put = (day, key, value) => {
    if (value === null || value === undefined) return;
    if (!days[day]) days[day] = {};
    days[day][key] = value;
  };

  // --- コンディション・体温 ---
  for (const r of json.daily_readiness ?? []) {
    put(r.day, "readinessScore", r.score);
    put(r.day, "temperatureDeviation", r.temperature_deviation);
  }

  // --- 睡眠スコア ---
  for (const r of json.daily_sleep ?? []) {
    put(r.day, "sleepScore", r.score);
  }

  // --- 睡眠時間・HRV・心拍：1日に複数件あるので「メインの睡眠」を1件選ぶ ---
  const mainSleep = {}; // { "2026-11-27": sleep1件 }
  for (const s of json.sleep ?? []) {
    const current = mainSleep[s.day];
    if (!current || isBetterSleep(s, current)) {
      mainSleep[s.day] = s;
    }
  }
  for (const s of Object.values(mainSleep)) {
    put(s.day, "sleepDuration", s.total_sleep_duration);
    put(s.day, "hrv", s.average_hrv);
    put(s.day, "restingHeartRate", s.lowest_heart_rate);
  }

  // --- 活動 ---
  for (const a of json.daily_activity ?? []) {
    put(a.day, "steps", a.steps);
    put(a.day, "activeCalories", a.active_calories);
  }

  // --- ストレス：Ouraは秒、OGARUは分で保存 ---
  for (const st of json.daily_stress ?? []) {
    const minutes = st.stress_high == null ? null : Math.round(st.stress_high / 60);
    put(st.day, "stressHigh", minutes);
  }

  return days;
}

// a の方が「メインの睡眠」としてふさわしいか
// ① long_sleep（夜のメインの睡眠）を優先 ② 同じ種類なら長い方
function isBetterSleep(a, b) {
  const aMain = a.type === "long_sleep";
  const bMain = b.type === "long_sleep";
  if (aMain !== bMain) return aMain;
  return (a.total_sleep_duration ?? 0) > (b.total_sleep_duration ?? 0);
}
