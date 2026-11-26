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
