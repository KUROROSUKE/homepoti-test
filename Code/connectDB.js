// ============ authentication      ============
/* 既存そのまま */ 
const firebaseConfig = {
    apiKey: "AIzaSyBE8CK6ODzy0OrgPogLrE4IK9938rUF3ko",
    authDomain: "homepoti-b61a7.firebaseapp.com",
    databaseURL: "https://homepoti-b61a7-default-rtdb.firebaseio.com",
    projectId: "homepoti-b61a7",
    storageBucket: "homepoti-b61a7.firebasestorage.app",
    messagingSenderId: "379862558289",
    appId: "1:379862558289:web:a8f40e857d5ade3f35ba70",
    measurementId: "G-W52MY9CN8L",
};
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

function getRandomName() {
    const animals = ["cat", "dog", "bird", "bear", "monkey", "fox", "deer", "penguin"];
    const rand = animals[Math.floor(Math.random() * 1000) % animals.length] + Math.floor(Math.random() * 1000);
    return rand;
}

// === 追加: コイン操作の基本関数（既存仕様維持） ===
/**
 * coins を ±delta する。負の値も可。0未満にはしない。
 */
async function changeCoins(uid, delta) {
    const ref = database.ref(`players/${uid}/coins`);
    await ref.transaction((cur) => {
        const v = typeof cur === "number" ? cur : 0;
        const nv = v + delta;
        return nv < 0 ? 0 : nv;
    });
}

/**
 * 将来用: コインを消費するAPI（足りなければfalse）
 */
async function spendCoins(uid, amount) {
    if (amount <= 0) return true;
    let ok = false;
    const ref = database.ref(`players/${uid}/coins`);
    await ref.transaction((cur) => {
        const v = typeof cur === "number" ? cur : 0;
        if (v < amount) return v; // 変更なし
        ok = true;
        return v - amount;
    });
    return ok;
}

// ★ 追加: 参照取得ヘルパ（HUD側で使う）
function coinsRef(uid) {
    return database.ref(`players/${uid}/coins`);
}

auth.onAuthStateChanged(async (authUser) => {
    if (!authUser) return;

    const playerRef = database.ref(`players/${authUser.uid}`);
    const snapshot  = await playerRef.once('value');
    let name = snapshot.child('Name').val();

    // もしデータに自分の情報がない -> はじめてサインインしたなら
    if (!snapshot.exists()) {
        name = getRandomName();
        await playerRef.set({
            Name  : name,
            coins : 0, // ★ 初期コイン
        });
    } else {
        // 名前だけがないなら
        if (!name) {
            name = getRandomName();
            await playerRef.update({ Name: name, IsSearched: false });
        }
        // ★ coins フィールドが無ければ作成
        if (!snapshot.child('coins').exists()) {
            await playerRef.update({ coins: 0 });
        }
    }

    // ★ 追加: 現在ユーザー名/UIDを保持
    window.currentUserName = name || "anonymous";
    window.currentUserUid = authUser.uid;

    // 表示切替
    document.getElementById('viewScreen').style.display = 'block';
    document.getElementById("bottomNav") .style.display = "flex";
    document.getElementById('notSigned' ).style.display = 'none';

    // ★ 重要: ここではコインHUDを表示しない（マーケットだけで表示する仕様のため）

    // 既存フロー
    if (window.initServicesAndMarket) window.initServicesAndMarket();

    // 全体から取得して描画（toViewScreen は全体収集版に差し替え済み）
    await toViewScreen();

    // ★ 置換：固定配列購読を廃止し、全体 .on 監視を開始
    if (window.attachGlobalPostsOn) window.attachGlobalPostsOn();
});



// Google login
function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
    .then((result) => {
        const user = result.user;
        console.log("Google login success:", user);
        // あとはauth.onAuth~~に任せる。
    })
    .catch((error) => {
        console.error("Google login failed: ", error);
        alert("Googleログインに失敗しました");
    });
}
// logout
function logout() {
    auth.signOut();
    document.getElementById("viewScreen").style.display = "none";
    document.getElementById("bottomNav") .style.display = "none";
    document.getElementById("postScreen").style.display = "none";
    document.getElementById("servicesScreen").style.display = "none";
    document.getElementById("marketScreen").style.display = "none";
    document.getElementById("notSigned" ).style.display = "block";
    // ★ HUDはマーケット配下にあるためここで触らない
}



async function upload(text_data, image_data) {
    const user = auth.currentUser;
    if (!user) { alert("ログインしてください"); return; }

    // Blob を JPEG Base64 に変換（常に JPEG で再エンコード）
    async function blobToJpegBase64(blob, quality = 0.8) {
        const img = await new Promise((res, rej) => {
        const url = URL.createObjectURL(blob);
        const i = new Image();
        i.onload = () => { URL.revokeObjectURL(url); res(i); };
        i.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
        i.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        // data:image/jpeg;base64,XXXX...
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        return dataUrl.split(",")[1]; // ヘッダ除去して Base64 部分だけ返す
    }

    function chunkString(str, size) {
        const out = [];
        for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
        return out;
    }

    const postRef = database.ref(`players/${user.uid}/posts`).push();

    if (image_data instanceof Blob) {
        console.log("画像あり");
        // 常に JPEG Base64 化（quality はお好みで調整）
        const base64 = await blobToJpegBase64(image_data, 0.8);

        // 200KB チャンクに分割（必要に応じて調整）
        const CHUNK_SIZE = 200 * 1024;
        const chunks = chunkString(base64, CHUNK_SIZE);

        await postRef.set({
        id: postRef.key,
        photoURL: user.photoURL || "",
        text: text_data,
        image: {
            chunks,
            chunkCount: chunks.length,
            base64Length: base64.length,
            format: "jpeg" // 参考用に付けるだけ。使わなければ削除可
        },
        createdAt: Date.now(),
        });
    } else {
        console.log("画像なし");
        await postRef.set({
        id: postRef.key,
        photoURL: user.photoURL || "",
        text: text_data,
        createdAt: Date.now(),
        });
    }
}


// Base64 → Blob
function base64ToBlob(base64, mime = "image/jpeg") {
  const bin = atob(base64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

// Realtime Database から復元
async function loadFromRTDB(postId, uid, img_tag, txt_tag) {
    const snap1 = await database.ref(`players/${uid}/posts/${postId}/image`).get();
    let blob = null;
    let url = null;
    if (snap1.exists()) {
        const image = snap1.val();
        const base64 = image.chunks.join("");
        blob = base64ToBlob(base64);
        url = URL.createObjectURL(blob);
        img_tag.src = url;

        // ★ 画像強制属性
        img_tag.setAttribute("width", "300");
        img_tag.setAttribute("height", "300");
        img_tag.style.display = "inline";
        img_tag.style.border = "1px solid black";
    }

    const snap2 = await database.ref(`players/${uid}/posts/${postId}/text`).get();
    const raw = snap2.val() || "";
    txt_tag.innerHTML = sanitizeAndNormalizeHTML(raw); // ★ XSS対策
}
















// ================================== ここら辺は後回し！すぐできるじゃろ！ ===================================
// Sign up with email & password
function SignUpWithMail() {
    const email = prompt("メールアドレスを入力してください:");
    if (!email) {
        alert("メールアドレスを入力してください");
        return;
    }

    const password = prompt("パスワードを設定してください（6文字以上）:");
    if (!email || !password) {
        alert("メールアドレスとパスワードを入力してください");
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
    .then((userCredential) => {
        const user = userCredential.user;
        console.log("サインアップ成功:", user);
        alert("サインアップ成功しました");
        startPeer(); // optional if you want to start after signup
    })
    .catch((error) => {
        console.error("サインアップ失敗:", error);
        alert("サインアップに失敗しました: " + error.message);
    });
}
// Login with email & password
function loginWithMail() {
    const email = prompt("メールアドレスを入力してください:");
    const password = prompt("設定したパスワードを入力してください:");
    
    if (!email || !password) {
        alert("メールアドレスとパスワードを入力してください");
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
    .then((userCredential) => {
        const user = userCredential.user;
        console.log("ログイン成功:", user);
        alert("ログイン成功しました");
        document.getElementById("LoginModal").style.display = "none";
        document.getElementById("UserDataModal").style.display = "block";
        startPeer(); // optional if you want to start after login
    })
    .catch((error) => {
        console.error("ログイン失敗:", error);
        alert("ログインに失敗しました: " + error.message);
    });
}
