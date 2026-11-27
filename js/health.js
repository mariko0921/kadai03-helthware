// =====================================================
// health.js : 健康データの Realtime Database 操作
// 保存場所: health/{uid}/{YYYY-MM-DD}/{source}
//   source = "oura"（将来 "apple" などを追加）
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  update,
  serverTimestamp,
  query,
  orderByKey,
  startAt,
  onValue,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";
import { todayString } from "./mood.js";

// 表示する指標の一覧（画面・グラフはこの表を見て作る）
// ※項目を増やすときはここに足すだけで、表示側が自動で対応する
export const METRICS = {
  readinessScore: { label: "コンディション", unit: "" },
  sleepScore: { label: "睡眠スコア", unit: "" },
  sleepDuration: { label: "睡眠時間", unit: "秒" },
  hrv: { label: "HRV", unit: "ms" },
  restingHeartRate: { label: "安静時心拍", unit: "bpm" },
  temperatureDeviation: { label: "体温の変動", unit: "℃" },
  stressHigh: { label: "高ストレス時間", unit: "分" },
  steps: { label: "歩数", unit: "歩" },
  activeCalories: { label: "活動カロリー", unit: "kcal" },
  daylightMinutes: { label: "日光下の時間", unit: "分" }, // Ouraでは取れない → 未取得になる
};

// ---------- Read：直近 days 日分の健康データを監視する ----------
// callback には { "2026-11-26": { oura: {...} }, ... } が渡される
// 戻り値は「監視をやめる関数」
export function watchRecentHealth(uid, days, callback) {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1)); // 今日を含めて days 日分

  // キー(日付)の順に並べ、開始日以降だけを取得
  // "YYYY-MM-DD" は文字列の順番 = 日付の順番 なので範囲指定できる
  const recentQuery = query(
    ref(db, `health/${uid}`),
    orderByKey(),
    startAt(todayString(start))
  );

  return onValue(recentQuery, (snapshot) => {
    // 日付キーで直接取り出すので、ここでは val() でオブジェクトのまま渡す
    callback(snapshot.val() || {});
  });
}

// ---------- Create / Update：Ouraの実データを保存 ----------
// days = convertOuraExport() の結果 { "2026-11-27": {...}, ... }
// exportedAt = Ouraからデータを取得した時刻（ミリ秒）
export async function saveOuraDays(uid, days, exportedAt) {
  const dates = Object.keys(days).sort();
  const updates = {};

  for (const date of dates) {
    // 日付ごとに oura の中身を丸ごと置き換える
    // → 同じ日を何度読み込んでも重複せず、最新の内容になる
    updates[`health/${uid}/${date}/oura`] = { ...days[date], fetchedAt: exportedAt };
  }

  // 同期の記録も同じ書き込みに含める（健康データと必ずセットで保存される）
  updates[`connections/${uid}/oura`] = {
    lastSyncAt: serverTimestamp(), // アプリに取り込んだ時刻
    dataFetchedAt: exportedAt,     // Ouraから取得した時刻
    method: "json-import",         // 将来 Cloud Functions にしたら "auto" などに
    rangeStart: dates[0] ?? null,
    rangeEnd: dates[dates.length - 1] ?? null,
    dayCount: dates.length,
  };

  // ルート(ref(db))に対して update すると、複数のトップレベルに一括で書ける
  await update(ref(db), updates);
  return dates.length;
}

// ---------- Read：連携状態（最終同期日時など）を監視する ----------
// 保存場所: connections/{uid}/{source}
// callback には { lastSyncAt, dataFetchedAt, rangeStart, rangeEnd, dayCount, method } か null が渡される
export function watchConnection(uid, source, callback) {
  // query は使わず、1か所をそのまま監視する（中身はオブジェクト1つだけなので）
  return onValue(ref(db, `connections/${uid}/${source}`), (snapshot) => {
    callback(snapshot.val()); // まだ1度も同期していなければ null
  });
}
