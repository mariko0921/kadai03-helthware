// =====================================================
// firebase.js : Firebaseの初期化だけを担当するファイル
// ここで作った auth / db を他のファイルから import して使う
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

// 設定値は別ファイルから読み込む（firebase-config.js は GitHub に上げない）
import { firebaseConfig } from "./firebase-config.js";

// Firebaseアプリを起動
export const app = initializeApp(firebaseConfig);

// 認証（Authentication）を使うための窓口
export const auth = getAuth(app);

// Googleログインを使うという設定
export const provider = new GoogleAuthProvider();

// Realtime Database を使うための窓口（Step 3 から使う）
export const db = getDatabase(app);
