// 見本ファイル：コピーして oura-config.js という名前で保存し、
// Oura の OAuth アプリ（https://cloud.ouraring.com/oauth/applications）の値を入れてください
// ※ Client Secret はブラウザ方式では使わないので、ここには書かない
export const ouraConfig = {
  clientId: "YOUR_OURA_CLIENT_ID",
  // Oura に登録した Redirect URI と1文字も違わないこと
  // 今開いているサイトに合わせて自動で切り替える
  //   ローカル: http://localhost:5500/index.html
  //   公開版  : https://kadai-wellness-mvp.web.app/index.html
  redirectUri: `${location.origin}/index.html`,
};
