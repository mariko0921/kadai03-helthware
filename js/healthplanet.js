// =====================================================
// healthplanet.js : HealthPlanet（タニタ）エクスポート → OGARUの共通の形 に変換
// 入力：scripts/fetch_healthplanet.py が作った JSON
//   data: [{ date: "202611270712", keydata: "64.10", tag: "6021", model: "..." }, ...]
// 出力：{ "2026-11-27": { weight: 64.1, bodyFat: 31.0, ..., measuredAt: ミリ秒 }, ... }
// =====================================================

// タグ番号 → OGARUの項目名
const TAG_MAP = {
  "6021": "weight",         // 体重
  "6022": "bodyFat",        // 体脂肪率
  "6023": "muscleMass",     // 筋肉量
  "6024": "muscleScore",    // 筋肉スコア
  "6025": "visceralFat",    // 内臓脂肪レベル（小数）
  "6026": "visceralFatInt", // 内臓脂肪レベル（整数）… 6025 が無いときだけ使う
  "6027": "bmr",            // 基礎代謝量
  "6028": "bodyAge",        // 体内年齢
  "6029": "boneMass",       // 推定骨量
};

// "202611270712" → その時刻のミリ秒（端末のタイムゾーン＝日本時間として解釈）
function toMillis(t) {
  return new Date(
    Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, Number(t.slice(6, 8)),
    Number(t.slice(8, 10)), Number(t.slice(10, 12))
  ).getTime();
}

export function convertHealthPlanetExport(json) {
  // 違うファイル（例：Ouraのファイル）を選んだときに、変なデータを保存しないための確認
  if (json?.format !== "ogaru-healthplanet-export") {
    throw new Error("OGARU用のHealthPlanetエクスポートファイルではありません");
  }

  // ① 日付ごと・項目ごとに「その日いちばん遅い時刻の値」を残す
  const latest = {}; // { "2026-11-27": { weight: { time: "202611270712", value: 64.1 } } }
  for (const r of json.data ?? []) {
    const key = TAG_MAP[r.tag];
    if (!key || !r.date) continue;

    const value = Number(r.keydata); // "64.10"（文字列）→ 64.1（数値）
    if (!Number.isFinite(value)) continue; // 数値にできない値は捨てる

    const day = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`;
    if (!latest[day]) latest[day] = {};
    const current = latest[day][key];
    // "yyyyMMddHHmm" は文字列のまま比べても時刻の順になる
    if (!current || r.date > current.time) {
      latest[day][key] = { time: r.date, value };
    }
  }

  // ② 1日分のオブジェクトに整える
  const height = Number(json.height); // cm（プロフィール未登録なら NaN）
  const days = {};
  for (const [day, items] of Object.entries(latest)) {
    const values = {};
    let lastTime = "";
    for (const [key, { time, value }] of Object.entries(items)) {
      values[key] = value;
      if (time > lastTime) lastTime = time;
    }

    // 内臓脂肪：小数版が無いときだけ整数版を使う
    if (values.visceralFat === undefined && values.visceralFatInt !== undefined) {
      values.visceralFat = values.visceralFatInt;
    }
    delete values.visceralFatInt;

    // BMI：HealthPlanet には無いので、体重と身長から計算
    if (values.weight !== undefined && height > 0) {
      values.bmi = Number((values.weight / (height / 100) ** 2).toFixed(1));
    }

    values.measuredAt = toMillis(lastTime); // その日の最後の計測時刻
    days[day] = values;
  }
  return days;
}
