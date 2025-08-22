// ==============================
// DB helpers and secure loaders
// ==============================

// 既存コメントは削除しない方針。ここから安全なユーティリティ関数。

/** Base64(JPEG想定) → Blob */
function base64ToBlob(base64, mime = "image/jpeg") {
  const bin = atob(base64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/** Blob → JPEG Base64(先頭ヘッダ除去) */
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
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}

/** 文字列を固定長で分割 */
function chunkString(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

/**
 * サニタイズ済みHTMLに img属性(width/height/style) を強制付与して返す
 * 仕様:
 *  - scriptタグやイベント属性はDOMPurifyで無効化
 *  - imgタグには width=300, height=300, style="display:inline;" を勝手に追加
 *  - srcは相対パスと blob:/data: のみ許可（外部追跡防止）
 */
function sanitizeAndNormalizeHTML(raw) {
  const textVal = typeof raw === "string" ? raw : "";
  // 1) サニタイズ: 許可タグと属性を制限
  const cleanHTML = DOMPurify.sanitize(textVal, {
    ALLOWED_TAGS: ["h1","h2","h3","b","i","u","p","br","img"],
    ALLOWED_ATTR: ["src","style","width","height"]
  });

  // 2) DOMを解析し、imgに強制属性を付加。src検証も実施
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanHTML, "text/html");
  doc.querySelectorAll("img").forEach(img => {
    const src = img.getAttribute("src") || "";
    const ok = src.startsWith("./") || src.startsWith("../") || src.startsWith("/") ||
               src.startsWith("blob:") || src.startsWith("data:");
    if (!ok) {
      img.remove();
      return;
    }
    img.setAttribute("width", "300");
    img.setAttribute("height", "300");
    img.setAttribute("style", "display:inline;");
  });
  return doc.body.innerHTML;
}

/**
 * 投稿作成 + 公開フィードへインデックス
 * visibility: 'public'（固定）
 */
async function uploadPost(textHTML, imageBlob) {
  const user = firebase.auth().currentUser;
  if (!user) { alert("ログインしてください"); return; }

  const playersRef = firebase.database().ref(`players/${user.uid}/posts`).push();
  const createdAt = Date.now();

  let imagePayload = null;
  if (imageBlob instanceof Blob) {
    const base64 = await blobToJpegBase64(imageBlob, 0.85);
    const CHUNK_SIZE = 200 * 1024; // 200KB/chunk for RTDB
    const chunks = chunkString(base64, CHUNK_SIZE);
    imagePayload = { chunks, chunkCount: chunks.length, base64Length: base64.length, format: "jpeg" };
  }

  const postData = {
    id: playersRef.key,
    uid: user.uid,
    photoURL: user.photoURL || "",
    text: textHTML, // 生HTMLは保存するが、表示時に必ずsanitize
    image: imagePayload,
    createdAt,
    visibility: "public"
  };

  // players に本体保存
  await playersRef.set(postData);
  // feeds にインデックス
  await firebase.database().ref(`feeds/public/${playersRef.key}`).set({
    uid: user.uid, createdAt, visibility: "public"
  });

  return playersRef.key;
}

/**
 * 投稿読み込み（安全表示）
 * - 画像: Base64チャンクを復元
 * - 本文: sanitizeAndNormalizeHTML()でscript無効化、img属性付与
 */
async function loadPostInto(postId, uid, imgEl, bodyEl, header) {
  // header: {avatarEl, nameEl, timeEl}
  const snap = await firebase.database().ref(`players/${uid}/posts/${postId}`).get();
  if (!snap.exists()) return false;
  const post = snap.val();

  // メタ
  if (header) {
    if (header.avatarEl) header.avatarEl.src = post.photoURL || "";
    if (header.nameEl) header.nameEl.textContent = uid;
    if (header.timeEl) header.timeEl.textContent = new Date(post.createdAt).toLocaleString();
  }

  // 画像
  if (post.image && post.image.chunks) {
    const base64 = post.image.chunks.join("");
    const blob = base64ToBlob(base64);
    const url = URL.createObjectURL(blob);
    imgEl.src = url;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
  }

  // 本文（必ずサニタイズ）
  bodyEl.innerHTML = sanitizeAndNormalizeHTML(post.text);
  return true;
}

/**
 * 公開フィードを時系列で取得（新しい順ページング）
 * beforeTime: ミリ秒。これより古いものを取得したいときに使用。
 */
async function fetchFeedPage(beforeTime, limit = 10) {
  const ref = firebase.database().ref("feeds/public").orderByChild("createdAt");
  const q = beforeTime == null ? ref.limitToLast(limit)
                               : ref.endAt(beforeTime - 1).limitToLast(limit);
  const snap = await q.get();
  if (!snap.exists()) return [];
  const arr = [];
  snap.forEach(child => {
    const v = child.val() || {};
    arr.push({ postId: child.key, uid: v.uid, createdAt: v.createdAt || 0 });
  });
  arr.sort((a,b)=> b.createdAt - a.createdAt);
  return arr;
}

/**
 * 購入処理 + メッセージ送信
 * - buyer → seller へメッセージ保存
 * - コイン等の決済はここでは行わない（既存実装に合わせて拡張可）
 */
async function purchaseWithMessage(sellerUid, postId, message) {
  const user = firebase.auth().currentUser;
  if (!user) { alert("ログインしてください"); return; }
  const ts = Date.now();

  const updates = {};
  // 購入レコード（Seller 側の受信箱）
  updates[`purchases/${sellerUid}/${postId}/${user.uid}`] = { buyerUid: user.uid, postId, message, createdAt: ts };
  // 双方向でメッセージも保存（簡易スレッド）
  updates[`messages/${postId}/${user.uid}/${ts}`] = { from: user.uid, to: sellerUid, body: message, createdAt: ts };

  await firebase.database().ref().update(updates);
  return true;
}
