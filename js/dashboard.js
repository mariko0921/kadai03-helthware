// =====================================================
// dashboard.js : 健康データの「見せ方」を担当（整形・描画）
// DBの操作はしない。受け取ったデータを画面に描くだけ
// =====================================================
import { METRICS } from "./health.js";
import { todayString } from "./mood.js";
import { BODY_METRICS, BODY_SOURCES } from "./body.js";

export const SOURCE_LABELS = {
  oura: "Oura（実データ）",
};

// 値を表示用の文字列に変換。値が無ければ「未取得」
export function formatMetric(key, value) {
  if (value === undefined || value === null) return "未取得";

  switch (key) {
    case "sleepDuration": {
      const h = Math.floor(value / 3600);
      const m = Math.round((value % 3600) / 60);
      return `${h}時間${m}分`;
    }
    case "temperatureDeviation":
      return `${value > 0 ? "+" : ""}${value.toFixed(2)}℃`;
    case "stressHigh":
    case "daylightMinutes":
      return `${value}分`;
    case "steps":
      return `${value.toLocaleString()}歩`;
    default: {
      const unit = METRICS[key]?.unit ?? "";
      return `${value}${unit && unit !== "秒" ? " " + unit : ""}`;
    }
  }
}

function formatDateTime(ms) {
  if (!ms) return "不明";
  return new Date(ms).toLocaleString("ja-JP", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ---------- 今日のコンディションを描画 ----------
// day = その日の1取得元分のデータ（無ければ undefined）
export function renderToday(container, day, source) {
  const score = day?.readinessScore;
  const scoreText = score === undefined ? "未取得" : score;

  // メインのスコア以外の指標をタイルにする
  const tiles = Object.entries(METRICS)
    .filter(([key]) => key !== "readinessScore")
    .map(([key, info]) => {
      const value = day?.[key];
      const missing = value === undefined || value === null;
      return `
        <div class="metric ${missing ? "is-missing" : ""}">
          <div class="metric-label">${info.label}</div>
          <div class="metric-value">${formatMetric(key, value)}</div>
        </div>`;
    })
    .join("");

  // 取得元と取得日時（デモは作成日時）
  const time = day ? formatDateTime(day.fetchedAt ?? day.generatedAt) : null;
  const sourceLine = day
    ? `取得元：${SOURCE_LABELS[source]}　／　取得：${time}`
    : `取得元：${SOURCE_LABELS[source]}　／　今日のデータはまだありません`;

  container.innerHTML = `
    <div class="score-ring ${score === undefined ? "is-missing" : ""}">
      <div class="score-value">${scoreText}</div>
      <div class="score-label">コンディション</div>
    </div>
    <div class="metric-grid">${tiles}</div>
    <p class="muted source-line">${sourceLine}</p>
  `;
}

// =====================================================
// Step 9：直近7日間のグラフ
// =====================================================

// グラフで選べる指標（日光は Oura で取れないため除外）
export const CHART_METRICS = [
  "readinessScore", "sleepScore", "sleepDuration", "hrv",
  "restingHeartRate", "temperatureDeviation", "stressHigh", "steps", "activeCalories",
];

// ---------- 🧠 データの整形：DBのデータ → グラフ用の配列 ----------
// recentHealth = { "2026-11-26": { oura: {...} }, ... }
// 戻り値 = { labels: ["11/20(木)", ...7個], values: [82, null, 75, ...7個] }
export function buildWeekSeries(recentHealth, source, metricKey, days = 7) {
  const labels = [];
  const values = [];

  // 7日間の「枠」は DB ではなくカレンダーから作る
  // → データが無い日も枠が残り、null（線が途切れる）になる
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = todayString(d); // "2026-11-20"

    labels.push(`${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`);

    const v = recentHealth[dateKey]?.[source]?.[metricKey];
    // 値が無い日は 0 ではなく null（＝未取得）
    let value = v === undefined || v === null ? null : v;

    // 睡眠時間は「秒」で保存しているので、グラフでは「時間」にする
    if (value !== null && metricKey === "sleepDuration") {
      value = Number((value / 3600).toFixed(1));
    }
    values.push(value);
  }
  return { labels, values };
}

// null を除いた平均（データが1つも無ければ null）
export function average(values) {
  const valid = values.filter((v) => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// グラフ・要約用の表示（睡眠時間はすでに「時間」に変換済み）
function chartFormat(key, value) {
  if (value === null) return "未取得";
  if (key === "sleepDuration") return `${value.toFixed(1)}時間`;
  if (key === "temperatureDeviation") return `${value > 0 ? "+" : ""}${value.toFixed(2)}℃`;
  const unit = METRICS[key].unit;
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1));
  return `${rounded.toLocaleString()}${unit ? " " + unit : ""}`;
}

// ---------- 🤖 描画：Chart.js ----------
let chart = null; // 作ったグラフを保持して、2回目以降は中身だけ差し替える

export function renderWeekChart(canvas, summaryEl, series, metricKey) {
  const { labels, values } = series;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const label = METRICS[metricKey].label;

  // 要約：今日 と 7日平均
  const today = values[values.length - 1];
  const avg = average(values);
  summaryEl.innerHTML = `
    <div><span class="muted">今日</span><strong>${chartFormat(metricKey, today)}</strong></div>
    <div><span class="muted">7日平均</span><strong>${avg === null ? "未取得" : chartFormat(metricKey, avg)}</strong></div>
  `;

  const allMissing = values.every((v) => v === null);
  canvas.parentElement.classList.toggle("is-empty", allMissing);

  if (!chart) {
    // グラフの文字もアプリのフォント・色に合わせる
    const css = getComputedStyle(document.documentElement);
    window.Chart.defaults.font.family = css.getPropertyValue("--font-body").trim();
    window.Chart.defaults.color = css.getPropertyValue("--muted").trim();

    chart = new window.Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ label, data: values }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        spanGaps: false, // null の日は線をつながない
        interaction: { mode: "index", intersect: false }, // 縦線上どこでもツールチップ
        plugins: {
          legend: { display: false }, // 1系列なので凡例は不要（見出しで分かる）
          tooltip: {
            callbacks: { label: (ctx) => `${label}: ${chartFormat(metricKey, ctx.parsed.y)}` },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "#ece3d2" }, border: { display: false } },
        },
        elements: {
          line: { borderWidth: 2, tension: 0.3 },
          point: { radius: 4, hoverRadius: 6 },
        },
      },
    });
  }

  // 中身を差し替えて更新（作り直さないのでチラつかない）
  const ds = chart.data.datasets[0];
  chart.data.labels = labels;
  ds.label = label;
  ds.data = values;
  ds.borderColor = color;
  ds.backgroundColor = color;
  chart.options.plugins.tooltip.callbacks.label = (ctx) =>
    `${label}: ${chartFormat(metricKey, ctx.parsed.y)}`;
  chart.update();
}

// =====================================================
// 体組成の表示
// =====================================================

// 数値 → "52.3 kg"（項目ごとの桁数で）
export function formatBody(key, value) {
  if (value === undefined || value === null) return "未取得";
  const m = BODY_METRICS[key];
  return `${value.toFixed(m.digits)}${m.unit ? " " + m.unit : ""}`;
}

// list = [最新, 前回]（watchLatestBody から）
export function renderBody(container, list) {
  const [latest, previous] = list;

  if (!latest) {
    container.innerHTML = `
      <p class="body-empty">まだ記録がありません。<br>
      体組成計の数値を「計測値を記録」から入力できます。</p>`;
    return;
  }

  const d = new Date(latest.date + "T00:00:00");
  const dateText = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });

  const tiles = Object.entries(BODY_METRICS).map(([key, info]) => {
    const value = latest[key];
    const missing = value === undefined || value === null;

    // 前回との差（前回にもこの項目があるときだけ）
    let diff = "";
    const prev = previous?.[key];
    if (!missing && prev !== undefined && prev !== null) {
      const delta = Number((value - prev).toFixed(info.digits));
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
      diff = `<div class="metric-diff">前回比 ${sign}${Math.abs(delta).toFixed(info.digits)}${info.unit}</div>`;
    }

    return `
      <div class="metric ${missing ? "is-missing" : ""}">
        <div class="metric-label">${info.label}</div>
        <div class="metric-value">${formatBody(key, value)}</div>
        ${diff}
      </div>`;
  }).join("");

  const prevText = previous
    ? `（前回：${new Date(previous.date + "T00:00:00").toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）`
    : "";

  container.innerHTML = `
    <p class="body-head">最終計測：<strong>${dateText}</strong> <span class="muted">${prevText}</span></p>
    <div class="metric-grid">${tiles}</div>
    <p class="muted source-line">取得元：${latest.sources.map((s) => BODY_SOURCES[s]).join("＋")}</p>
  `;
}
