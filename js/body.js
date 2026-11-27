// =====================================================
// body.js : 体組成データの Realtime Database 操作
// 保存場所: body/{uid}/{YYYY-MM-DD}/{source}
//   source = "manual"（手入力）。将来 "apple"（体組成計→Appleヘルスケア）などを追加
// 体型データは特にセンシティブなので、health とは別のトップレベルに置く
//   → 将来「コンディションは共有するが体型は共有しない」をルールで分けられる
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  get,
  update,
  set,
  remove,
  query,
  orderByKey,
  limitToLast,
  onValue,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

// 体組成の項目一覧（入力欄・表示はこの表から自動で作られる）
// ※項目を増やすときはここに1行足すだけ（ルールの変更は不要）
//   step = 入力の刻み / min・max = 入力できる範囲 / digits = 表示する小数点以下の桁数
export const BODY_METRICS = {
  weight:      { label: "体重",         unit: "kg",   step: 0.1, min: 20,  max: 300,  digits: 1 },
  bodyFat:     { label: "体脂肪率",     unit: "%",    step: 0.1, min: 1,   max: 75,   digits: 1 },
  bmi:         { label: "BMI",          unit: "",     step: 0.1, min: 10,  max: 60,   digits: 1 },
  muscleMass:  { label: "筋肉量",       unit: "kg",   step: 0.1, min: 5,   max: 150,  digits: 1 },
  visceralFat: { label: "内臓脂肪",     unit: "",     step: 0.5, min: 1,   max: 60,   digits: 1 },
  bmr:         { label: "基礎代謝量",   unit: "kcal", step: 1,   min: 500, max: 5000, digits: 0 },
  bodyAge:     { label: "体内年齢",     unit: "歳",   step: 1,   min: 5,   max: 120,  digits: 0 },
  bodyWater:   { label: "体水分率",     unit: "%",    step: 0.1, min: 20,  max: 80,   digits: 1 },
  boneMass:    { label: "推定骨量",     unit: "kg",   step: 0.1, min: 0.5, max: 10,   digits: 1 },
  muscleScore: { label: "筋肉スコア",   unit: "",     step: 1,   min: -4,  max: 4,    digits: 0 },
};

// 取得元の表示名（同じ日に複数あるときは、この順で優先して合成する）
export const BODY_SOURCES = {
  healthplanet: "HealthPlanet",
  manual: "手入力",
};

// ---------- Create / Update：1日分の計測値を保存 ----------
// values = { weight: 52.3, bodyFat: 24.1, ... }（入力された項目だけ）
export async function saveBody(uid, date, values) {
  // set = その場所を「丸ごと置き換え」
  // → 修正時に空欄にした項目は、古い値が残らず消える（update との違い）
  await set(ref(db, `body/${uid}/${date}/manual`), {
    ...values,
    measuredAt: serverTimestamp(),
  });
}

// ---------- Delete：1日分の計測値を削除 ----------
export async function deleteBody(uid, date) {
  await remove(ref(db, `body/${uid}/${date}/manual`));
}

// ---------- Read：最新2回分の計測を監視（最新 と 前回比 のため） ----------
// callback には [{ date, sources, ...値 }（最新）, {...}（前回）] が渡される（無ければ短い配列）
export function watchLatestBody(uid, callback) {
  // 日付キーの順に並べて、最後の2件 = 最新の2日分
  const latestQuery = query(ref(db, `body/${uid}`), orderByKey(), limitToLast(2));

  return onValue(latestQuery, (snapshot) => {
    const list = [];
    snapshot.forEach((dateSnap) => {
      const merged = mergeSources(dateSnap.val());
      if (merged) list.push({ date: dateSnap.key, ...merged });
    });
    list.reverse(); // 新しい順に
    callback(list);
  });
}

// 🧠 1日分の { manual: {...}, healthplanet: {...} } を「項目ごと」に合成する
// 優先順位は BODY_SOURCES の並び順（先に書いたものが優先）
// ※DBの中身は別々のまま。表示するときだけ合成するので、優先順位を後から変えても困らない
function mergeSources(day) {
  if (!day) return null;
  const merged = {};
  const sources = [];
  // 優先度の低い順に重ねていく → 後から重ねた（優先度の高い）値で上書きされる
  for (const source of Object.keys(BODY_SOURCES).reverse()) {
    if (!day[source]) continue;
    sources.unshift(source);
    for (const key of Object.keys(BODY_METRICS)) {
      if (day[source][key] !== undefined) merged[key] = day[source][key];
    }
  }
  return sources.length ? { ...merged, sources } : null;
}

// ---------- Create / Update：HealthPlanetの取り込みデータを保存 ----------
// days = convertHealthPlanetExport() の結果 { "2026-11-27": { weight, ..., measuredAt }, ... }
export async function saveHealthPlanetDays(uid, days, exportedAt) {
  const dates = Object.keys(days).sort();
  const updates = {};
  for (const date of dates) {
    // 日付ごとに healthplanet を丸ごと置き換え（手入力 manual には触れない）
    updates[`body/${uid}/${date}/healthplanet`] = { ...days[date], fetchedAt: exportedAt };
  }
  // 同期の記録も一緒に（Ouraと同じ形 → 表示の関数を使い回せる）
  updates[`connections/${uid}/healthplanet`] = {
    lastSyncAt: serverTimestamp(),
    dataFetchedAt: exportedAt,
    method: "json-import",
    rangeStart: dates[0] ?? null,
    rangeEnd: dates[dates.length - 1] ?? null,
    dayCount: dates.length,
  };
  await update(ref(db), updates);
  return dates.length;
}

// ---------- Read（1回だけ）：指定した日付の計測値 ----------
// 入力フォームで日付を選んだとき、既存の値を入れておくために使う
export async function getBody(uid, date) {
  const snapshot = await get(ref(db, `body/${uid}/${date}/manual`));
  return snapshot.val(); // 無ければ null
}
