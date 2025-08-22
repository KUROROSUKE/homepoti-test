// firebase-config.js
// インライン禁止CSPのため外部ファイルで初期化。
// 自分のFirebaseプロジェクト設定に置き換えてください。

(function initFirebase() {
  // TODO: 自分の設定を貼る
  const firebaseConfig = {
    apiKey: "AIzaSyBE8CK6ODzy0OrgPogLrE4IK9938rUF3ko",
    authDomain: "homepoti-b61a7.firebaseapp.com",
    databaseURL: "https://homepoti-b61a7-default-rtdb.firebaseio.com",
    projectId: "homepoti-b61a7",
    storageBucket: "homepoti-b61a7.firebasestorage.app",
    messagingSenderId: "379862558289",
    appId: "1:379862558289:web:a8f40e857d5ade3f35ba70",
    measurementId: "G-W52MY9CN8L"
  };
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
})();
