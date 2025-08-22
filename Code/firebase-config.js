// firebase-config.js
// インライン禁止のCSPに対応するため、初期化を外部ファイルで行う。
// 自分のFirebaseプロジェクト設定に置き換えてください。

(function initFirebase() {
  // ここに自分の設定を貼る
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
  };
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
})();