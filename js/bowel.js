// =====================================================
// bowel.js : お通じ（排便）のワンタップ記録
// 保存場所: bowel/{uid}/{pushId} = { date: "2026-11-27", recordedAt: 時刻 }
//   ・気分と同じく push で、1日に何回でも記録できる
//   ・とてもセンシティブなので、health / body とも別のトップレベルに置く
// =====================================================
import { db } from "./firebase.js";
import {
  ref,
  push,
  remove,
  query,
  orderByChild,
  startAt,
  endAt,
  onValue,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";
import { todayString } from "./mood.js";

// ---------- Create：「出た」を1件記録 ----------
export async function addBowel(uid) {
  await push(ref(db, `bowel/${uid}`), {
    date: todayString(),           // カレンダーで日付ごとに数えるため
    recordedAt: serverTimestamp(), // 何時に記録したか
  });
}

// ---------- Delete：1件取り消す（押し間違い用） ----------
export async function deleteBowel(uid, id) {
  await remove(ref(db, `bowel/${uid}/${id}`));
}

// ---------- Read：期間内の記録を監視 ----------
// callback には [{ id, date, recordedAt }, ...]（古い順）が渡される
export function watchBowelInRange(uid, startDate, endDate, callback) {
  // 気分のカレンダーと同じ：中の date で並べ替えて範囲指定（ルールに .indexOn が必要）
  const rangeQuery = query(
    ref(db, `bowel/${uid}`),
    orderByChild("date"),
    startAt(startDate),
    endAt(endDate)
  );
  return onValue(rangeQuery, (snapshot) => {
    const list = [];
    snapshot.forEach((child) => {
      list.push({ id: child.key, ...child.val() });
    });
    list.sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0));
    callback(list);
  });
}
