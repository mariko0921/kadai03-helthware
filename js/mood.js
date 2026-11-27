// =====================================================
// mood.js : 気分データの Realtime Database 操作をまとめたファイル
// 保存場所: moods/{uid}/{pushId}
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  push,
  serverTimestamp,
  query,
  limitToLast,
  orderByChild,
  startAt,
  endAt,
  onValue,
  update,
  remove,
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

// ---------- Read：直近の気分を「監視」する ----------
// データが変わるたびに callback(気分の配列) が呼ばれる
// 戻り値は「監視をやめる関数」。ログアウト時に呼ぶ
export function watchRecentMoods(uid, callback) {
  // ① 場所 + 条件（最新20件だけ）を組み合わせた「問い合わせ」を作る
  const recentQuery = query(ref(db, `moods/${uid}`), limitToLast(20));

  // ② 監視を開始。初回と、以降データが変わるたびに実行される
  return onValue(recentQuery, (snapshot) => {
    // snapshot = その瞬間のデータのかたまり
    const list = [];
    snapshot.forEach((child) => {
      // child.key = "-Oxxxx"（pushのキー）, child.val() = { mood, date, recordedAt }
      list.push({ id: child.key, ...child.val() });
    });
    list.reverse(); // DBからは古い順に届くので、新しい順に並べ替える
    callback(list);
  });
}

// ---------- Update：1件の気分を付け替える ----------
// update は「指定した項目だけ」を書き換える（date / recordedAt はそのまま残る）
export async function updateMood(uid, moodId, newMood) {
  const oneMoodRef = ref(db, `moods/${uid}/${moodId}`); // 1件分の住所
  await update(oneMoodRef, {
    mood: newMood,
    updatedAt: serverTimestamp(), // いつ変更したかを残す
  });
}

// ---------- Delete：1件の気分を削除する ----------
export async function deleteMood(uid, moodId) {
  const oneMoodRef = ref(db, `moods/${uid}/${moodId}`);
  await remove(oneMoodRef);
}

// ---------- Read：指定した期間（例：1か月）の気分を監視する ----------
// callback には { "2026-11-27": "relaxed", ... }（その日の「最後の」気分）が渡される
export function watchMoodsInRange(uid, startDate, endDate, callback) {
  // 🧠 キーは push のID なので、中の date 項目で並べ替えてから範囲を指定する
  //    （ルールの ".indexOn": ["date"] が、この検索を速くする索引）
  const rangeQuery = query(
    ref(db, `moods/${uid}`),
    orderByChild("date"),
    startAt(startDate),
    endAt(endDate)
  );

  return onValue(rangeQuery, (snapshot) => {
    const latestByDate = {}; // { "2026-11-27": { mood, recordedAt } }
    snapshot.forEach((child) => {
      const m = child.val();
      const current = latestByDate[m.date];
      // 同じ日に複数あれば、記録時刻が遅い方を残す
      if (!current || (m.recordedAt ?? 0) > (current.recordedAt ?? 0)) {
        latestByDate[m.date] = m;
      }
    });
    const result = {};
    for (const [date, m] of Object.entries(latestByDate)) result[date] = m.mood;
    callback(result);
  });
}
