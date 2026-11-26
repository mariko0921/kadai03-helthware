// =====================================================
// mood.js : 気分データの Realtime Database 操作をまとめたファイル
// 保存場所: moods/{uid}/{pushId}
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  push,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

// 気分コード → 表示ラベル
// DBには左側の「コード」だけを保存する（表示文言を変えてもデータに影響しないように）
// ※ここを増やすときは、セキュリティルールの matches(...) も必ず変更する
export const MOODS = {
  refreshed: { label: "爽快", emoji: "🌞" },
  relaxed: { label: "リラックス", emoji: "🍃" },
  neutral: { label: "普通", emoji: "☁️" },
  tired: { label: "疲れている", emoji: "🌙" },
  uncomfortable: { label: "不快", emoji: "🌧️" },
};

// 端末の「現地の日付」を "YYYY-MM-DD" で返す
// ※ new Date().toISOString() は世界標準時(UTC)なので、
//   日本の朝9時前だと「前日」の日付になってしまう。それを避けるために自作する
export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------- Create：気分を1件保存 ----------
export async function saveMood(uid, mood) {
  // ① 保存先の「場所」を指定する（まだ何も書き込まない）
  const moodsRef = ref(db, `moods/${uid}`);

  // ② push で新しいキーを自動生成し、その下にデータを書き込む
  await push(moodsRef, {
    mood: mood,                   // "relaxed" などのコード
    date: todayString(),          // 日付での検索・グラフ用
    recordedAt: serverTimestamp(), // 記録時刻（端末ではなくFirebaseサーバーの時計）
  });
}
