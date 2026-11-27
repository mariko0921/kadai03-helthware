// =====================================================
// health.js : 健康データの Realtime Database 操作
// 保存場所: health/{uid}/{YYYY-MM-DD}/{source}
//   source = "oura"（実データ） / "demo"（デモデータ）
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  get,
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

// min〜max のランダムな数（digits = 小数点以下の桁数）
function rand(min, max, digits = 0) {
  const n = min + Math.random() * (max - min);
  return Number(n.toFixed(digits));
}

// デモデータ1日分を作る（それらしい範囲の数値）
function makeDemoDay(daysAgo) {
  const day = {
    readinessScore: rand(65, 92),
    sleepScore: rand(60, 90),
    sleepDuration: rand(5.5 * 3600, 8 * 3600), // 5.5〜8時間（秒）
    hrv: rand(30, 60),
    restingHeartRate: rand(52, 64),
    temperatureDeviation: rand(-0.4, 0.4, 2),
    stressHigh: rand(30, 180),
    steps: rand(3000, 12000),
    activeCalories: rand(150, 600),
    generatedAt: serverTimestamp(),
  };
  // 「未取得」表示の確認用に、3日前は HRV と体温を欠けさせる
  if (daysAgo === 3) {
    delete day.hrv;
    delete day.temperatureDeviation;
  }
  return day;
}

// ---------- Create：デモデータを days 日分まとめて作る ----------
export async function createDemoData(uid, days = 7) {
  const updates = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i); // i日前
    // キーに「パス」を書くと、その場所に書き込まれる
    updates[`${todayString(d)}/demo`] = makeDemoDay(i);
  }
  // 7日分を1回で書き込む（全部成功 or 全部失敗）
  await update(ref(db, `health/${uid}`), updates);
}

// ---------- Delete：デモデータだけを全部消す（実データには触れない） ----------
export async function deleteDemoData(uid) {
  // get() = 1回だけ読む。どの日付にデモがあるかを調べる
  const snapshot = await get(ref(db, `health/${uid}`));

  const updates = {};
  snapshot.forEach((dateSnap) => {
    if (dateSnap.child("demo").exists()) {
      updates[`${dateSnap.key}/demo`] = null; // null を書く = 削除
    }
  });

  if (Object.keys(updates).length === 0) return 0;
  await update(ref(db, `health/${uid}`), updates);
  return Object.keys(updates).length; // 消した日数
}

// ---------- Read：直近 days 日分の健康データを監視する ----------
// callback には { "2026-11-26": { demo: {...}, oura: {...} }, ... } が渡される
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
