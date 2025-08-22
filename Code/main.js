// ==============================
// UI wiring (no anonymous login)
// ==============================

// ★ ここでは firebase.* を即呼ばない。
//    初期化後に確実に取得する。
let auth = null;
let database = null;

function ensureFirebaseReady() {
  if (!firebase.apps || !firebase.apps.length) {
    throw new Error("Firebase not initialized. Check firebase-config.js load and config.");
  }
  if (!auth || !database) {
    auth = firebase.auth();
    database = firebase.database();
  }
}

const postText = document.getElementById("postText");
const postImage = document.getElementById("postImage");
const postBtn = document.getElementById("postBtn");

const feedList = document.getElementById("feedList");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const postTemplate = document.getElementById("postTemplate");

let oldestLoadedTime = null;
let liveFeedAttached = false;
const PAGE_SIZE = 10;
const shown = new Set();

// ===== Auth state gating =====
function bindAuthState() {
  ensureFirebaseReady();
  auth.onAuthStateChanged(user => {
    postBtn.disabled = !user;
  });
}

// ===== Composer =====
postBtn.addEventListener("click", async () => {
  try {
    ensureFirebaseReady();
  } catch (e) {
    alert("初期化前です。firebase-config.jsの配置と読み込み順を確認してください。");
    return;
  }
  const user = auth.currentUser;
  if (!user) { alert("ログインしてください"); return; }
  const textHTML = postText.value;
  let imageBlob = null;
  if (postImage.files && postImage.files[0]) {
    imageBlob = postImage.files[0];
  }
  postBtn.disabled = true;
  try {
    await uploadPost(textHTML, imageBlob);
    postText.value = "";
    postImage.value = "";
  } catch (e) {
    console.error(e);
    alert("投稿に失敗しました");
  } finally {
    postBtn.disabled = !auth.currentUser;
  }
});

// ===== Feed =====
async function renderPost(postId, uid, position = "bottom") {
  if (shown.has(postId)) return;
  shown.add(postId);

  const node = document.importNode(postTemplate.content, true);
  const article = node.querySelector("article.post");
  const avatarEl = node.querySelector(".avatar");
  const nameEl = node.querySelector(".name");
  const timeEl = node.querySelector(".time");
  const photoEl = node.querySelector(".photo");
  const bodyEl = node.querySelector(".body");
  const buyBtn = node.querySelector(".buyBtn");

  const ok = await loadPostInto(postId, uid, photoEl, bodyEl, { avatarEl, nameEl, timeEl });
  if (!ok) return;

  // 購入ボタン（ログイン必須）
  buyBtn.addEventListener("click", async () => {
    try { ensureFirebaseReady(); } catch { alert("初期化前です"); return; }
    if (!auth.currentUser) { alert("ログインしてください"); return; }
    const message = prompt("購入メッセージを入力してください（任意）", "");
    try {
      await purchaseWithMessage(uid, postId, message || "");
      alert("購入リクエストとメッセージを送信しました");
    } catch (e) {
      console.error(e);
      alert("購入に失敗しました");
    }
  });

  if (position === "top") {
    feedList.prepend(node);
  } else {
    feedList.appendChild(node);
  }
}

async function initialLoad() {
  try {
    ensureFirebaseReady();
  } catch (e) {
    console.error(e);
    alert("Firebase未初期化。firebase-config.jsの配置と読み込み順を確認してください。");
    return;
  }
  bindAuthState();

  const page = await fetchFeedPage(null, PAGE_SIZE);
  if (page.length === 0) {
    loadMoreBtn.style.display = "none";
    return;
  }
  for (const item of page) {
    await renderPost(item.postId, item.uid, "bottom");
  }
  oldestLoadedTime = page[page.length - 1].createdAt;
  loadMoreBtn.style.display = "block";

  if (!liveFeedAttached) {
    attachLiveFeed();
    liveFeedAttached = true;
  }
}

function attachLiveFeed() {
  // ensureFirebaseReady は initialLoad 内で実行済み想定
  const now = Date.now();
  const ref = database.ref("feeds/public").orderByChild("createdAt").startAt(now);
  ref.on("child_added", async snap => {
    const v = snap.val() || {};
    const postId = snap.key;
    if (!postId) return;
    await renderPost(postId, v.uid, "top");
  });
}

loadMoreBtn.addEventListener("click", async () => {
  try { ensureFirebaseReady(); } catch { alert("初期化前です"); return; }
  loadMoreBtn.disabled = true;
  const prev = loadMoreBtn.textContent;
  loadMoreBtn.textContent = "読み込み中...";
  try {
    const page = await fetchFeedPage(oldestLoadedTime, PAGE_SIZE);
    if (page.length === 0) {
      loadMoreBtn.textContent = "これ以上ありません";
      return;
    }
    for (const item of page) {
      await renderPost(item.postId, item.uid, "bottom");
    }
    oldestLoadedTime = page[page.length - 1].createdAt;
    loadMoreBtn.textContent = prev;
  } catch (e) {
    console.error(e);
    loadMoreBtn.textContent = "エラー。再試行";
  } finally {
    loadMoreBtn.disabled = false;
  }
});

window.addEventListener("DOMContentLoaded", initialLoad);
