let delay_time = 10; //10秒たつまで再投稿はできない

// ============ indexedDB actions ============
const DB_NAME = "homepoti_DB";
const STORE_NAME = "homepoti_Store";
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = (event) => reject("DB open error");
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            };
        };
    });
}
async function setItem(key, value) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    return tx.complete;
}
async function getItem(key) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Get error");
    });
}



const textInput = document.getElementById('postTextInput');
const charCount = document.getElementById('charCount');

textInput.addEventListener('input', function () {
    const count = this.value.length;
    charCount.textContent = count;

    if (count > 250) {
        charCount.style.color = '#f91880'; // 赤
    } else if (count > 0) {
        charCount.style.color = '#1d9bf0'; // 青
    } else {
        charCount.style.color = '#999';    // グレー
    }

    // オートリサイズ
    this.style.height = 'auto';
    this.style.height = Math.max(36, this.scrollHeight) + 'px';
});





async function viewImageCanvas(maxLong=300) {
    // ここでのmaxLongはテストで表示するcanvasの大きさ
    file = document.getElementById("fileInput").files[0];
    console.log(file);

    const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = URL.createObjectURL(file);
    });

    let w = img.width, h = img.height;
    const isWLong = w >= h;
    const ratio = isWLong ? Math.min(1, maxLong / w) : Math.min(1, maxLong / h);
    const nw = Math.max(1, Math.round(w * ratio));
    const nh = Math.max(1, Math.round(h * ratio));

    const canvas = document.getElementById("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, nw, nh);
    canvas.style.display = "block";
}



// アップロード時に画像の容量を落とす。
// fileInput(id)に画像が選択されてる前提で動作
// blob形式のデータを返す
// canvasの削除を行う
async function resizeImage(maxLong=640) {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return null;

    const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = URL.createObjectURL(file);
    });

    let w = img.width, h = img.height;
    const isWLong = w >= h;
    const ratio = isWLong ? Math.min(1, maxLong / w) : Math.min(1, maxLong / h);
    const nw = Math.max(1, Math.round(w * ratio));
    const nh = Math.max(1, Math.round(h * ratio));

    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    // ここで確実に目的サイズへ描画
    canvas.width = nw;
    canvas.height = nh;
    ctx.drawImage(img, 0, 0, nw, nh);

    const blob = await new Promise((res) =>
        canvas.toBlob(res, "image/jpeg", 0.9)
    );

    // 後片付け
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0; canvas.height = 0;
    canvas.style.display = "none";

    return blob;
}


async function post() {
    // NoSQLサーバーへアップロードする。
    // ファイルは最大で画像1枚（500KBくらいに圧縮して送りたい）
    // 文章は最大で200文字かな

    // テキスト入力
    const TextInputTag = document.getElementById("postTextInput")
    const content_text = TextInputTag.value;
    if (content_text.length == 0) {alert("テキストを入れてください"); return}
    
    //画像入力
    const ImageInputTag = document.getElementById("fileInput");
    const blob_image =  ImageInputTag.files[0] ? await resizeImage() : null;   //もし画像があれば、リサイズしてcanvasの方は消す。

    try {
        // ここはイメージ。あとで実装。
        await upload(content_text, blob_image); // ★ 送信を待ってから

        // ★ 追加: 投稿ボーナス +1 コイン
        const user = auth.currentUser;
        if (user) {
            await changeCoins(user.uid, 1);
        }

        // 使ったところを消しておく（成功時のみ）
        TextInputTag.value = "";
        ImageInputTag.value = "";
        
        const count = textInput.value.length;
        charCount.textContent = count;
        charCount.style.color = '#1d9bf0'; // 青
        // オートリサイズ
        textInput.style.height = 'auto';
        textInput.style.height = Math.max(36, textInput.scrollHeight) + 'px';
    } catch (e) {
        console.error(e);
        alert("投稿に失敗しました");
    }
}







//const Follow_uid_list = ["I5wUbCT8cXRdwjXjSTI4ORJzoWh1", "ykeRda4HA6e6Byhn1nqad8Tpwv92"]
if (window.attachGlobalPostStream) window.attachGlobalPostStream();
const shownPostIds = new Set();

// ===== ページネーション用の状態 =====
let oldestLoadedTime = null;           // 画面にある中で最も古い createdAt
const postsPerPage = 10;               // 1回の読み込み件数
const LOAD_DELAY_MS = 1500;            // 連打防止の待ち
const loadMoreBtn = document.getElementById("loadMoreBtn");

// === 追加: 下端判定ユーティリティ（1px余裕） ===
const viewScreen = document.getElementById("viewScreen");
function isAtBottom(el) {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
}

/**
 * 全件取得してローカルでフィルタ＆ソート（インデックス不要）
 * beforeTime が null のときは最新から limit 件。
 * beforeTime が数値のときは createdAt < beforeTime の範囲から limit 件（＝今より次に古い塊）。
 */
async function collectMergedPage(followerUids, beforeTime, limit = postsPerPage) {
    if (!followerUids || followerUids.length === 0) return [];
    const collected = [];

    await Promise.all(followerUids.map(async (uid) => {
        const snap = await database.ref(`players/${uid}/posts`).get(); // orderByChildは使わない
        if (!snap.exists()) return;

        snap.forEach(child => {
            const val = child.val() || {};
            if (!val || !val.text || !val.text.trim()) return;
            const ts = typeof val.createdAt === "number" ? val.createdAt : 0;
            if (beforeTime == null || ts < beforeTime) {
                collected.push({ uid, postId: child.key, createdAt: ts });
            }
        });
    }));

    // 降順（新しい→古い）で並べ、上から limit 件だけ返す
    collected.sort((a, b) => b.createdAt - a.createdAt);
    return collected.slice(0, limit);
}

function attachPostStreamForUid(uid) {
    const query = database
        .ref(`players/${uid}/posts`)
        .limitToLast(1); // 最新1件だけ監視（orderByChild不要で既定キー順）

    const handler = (snap) => {
        const postId = snap.key;
        if (!postId) return;
        if (shownPostIds.has(postId)) return;

        // 新規は上に挿入
        renderPost(postId, uid, 'top');
    };

    query.on('child_added', handler);
}

async function getRecentFollowerPostIds(followerUids) {
    if (!followerUids || followerUids.length === 0) return [];
    const collected = [];

    await Promise.all(followerUids.map(async (uid) => {
        const snap = await database.ref(`players/${uid}/posts`).get();
        if (!snap.exists()) return;

        snap.forEach(child => {
            const val = child.val() || {};
            if (val.text && val.text.trim().length > 0) {
                collected.push({
                    uid, // 追加
                    postId: child.key,
                    createdAt: typeof val.createdAt === "number" ? val.createdAt : 0
                });
            }
        });
    }));
    // 全体をcreatedAt降順に並べて10件だけ返す
    collected.sort((a, b) => b.createdAt - a.createdAt);
    return collected.slice(0, 10).map(item => ({
        uid: item.uid,
        postId: item.postId
    }));
}


/**
 * コメント送信
 *  - ownerUid: 投稿の所有者UID
 *  - postId  : 対象投稿ID
 */
async function submitComment(ownerUid, postId, inputEl, buttonEl) {
    const user = auth.currentUser;
    if (!user) { alert("ログインしてください"); return; }

    const text = (inputEl.value || "").trim();
    if (!text) return;

    buttonEl.disabled = true;
    try {
        const ref = database.ref(`players/${ownerUid}/posts/${postId}/comments`).push();
        const payload = {
            id: ref.key,
            uid: user.uid,
            name: window.currentUserName || "anonymous", // ★ connectDBでセット
            text,
            createdAt: Date.now(),
        };
        await ref.set(payload);
        inputEl.value = "";
    } catch (e) {
        console.error(e);
        alert("コメントの送信に失敗しました");
    } finally {
        buttonEl.disabled = false;
    }
}

/**
 * コメントのリアルタイム購読
 */
function attachCommentsStream(ownerUid, postId, listEl) {
    const ref = database.ref(`players/${ownerUid}/posts/${postId}/comments`).limitToLast(50);
    ref.on("child_added", (snap) => {
        const v = snap.val() || {};
        const item = document.createElement("div");
        item.className = "comment-item";

        const meta = document.createElement("div");
        meta.className = "comment-meta";
        meta.textContent = v.name ? v.name : "匿名";

        const body = document.createElement("div");
        body.className = "comment-body";
        // textContent なのでXSS対策としてプレーンテキスト表示
        body.textContent = v.text || "";

        item.appendChild(meta);
        item.appendChild(body);
        listEl.appendChild(item);
    });
}


// === 追加: コイン付与に関する定義 ===
const COIN_FOR_GIVER = 1;     // 褒めた人
const COIN_FOR_RECEIVER = 1;  // 褒められた人

async function awardCoinsForPraise(ownerUid, likerUid) {
    // 取り消し時は別関数で減算
    await Promise.all([
        database.ref(`players/${ownerUid}/coins`).transaction((cur) => {
            const v = typeof cur === "number" ? cur : 0;
            return v + COIN_FOR_RECEIVER;
        }),
        database.ref(`players/${likerUid}/coins`).transaction((cur) => {
            const v = typeof cur === "number" ? cur : 0;
            return v + COIN_FOR_GIVER;
        }),
    ]);
}

async function revertCoinsForPraise(ownerUid, likerUid) {
    await Promise.all([
        database.ref(`players/${ownerUid}/coins`).transaction((cur) => {
            const v = typeof cur === "number" ? cur : 0;
            const nv = v - COIN_FOR_RECEIVER;
            return nv < 0 ? 0 : nv;
        }),
        database.ref(`players/${likerUid}/coins`).transaction((cur) => {
            const v = typeof cur === "number" ? cur : 0;
            const nv = v - COIN_FOR_GIVER;
            return nv < 0 ? 0 : nv;
        }),
    ]);
}


/**
 * position:
 *  - 'top'    : 先頭へ挿入（新規投稿など）
 *  - 'bottom' : 末尾へ追加（過去ロード）
 */
async function renderPost(postId, uid, position = 'top') {
    let n = shownPostIds.size;

    const post_div = document.createElement("div");
    post_div.id = `post_${n}`;
    post_div.style.width = "calc(100% - 40px)";
    post_div.style.height = "auto";
    post_div.style.border = "1px solid #000";
    post_div.style.margin = "0 5px 0 5px";
    post_div.style.padding = "10px";
    post_div.style.position = "relative"; // ★ 追加: 褒めるボタンの絶対配置用

    // ★★★ 追加: 褒めるボタンUI + ロジック ★★★
    const praiseBtn = document.createElement("button");
    praiseBtn.className = "praise-btn";
    praiseBtn.textContent = "褒める ";
    // 右上に固定配置
    praiseBtn.style.position = "absolute";
    praiseBtn.style.top = "8px";
    praiseBtn.style.right = "8px";
    praiseBtn.style.zIndex = "1";

    const praiseCount = document.createElement("span");
    praiseCount.className = "praise-count";
    praiseCount.textContent = "0";
    praiseBtn.appendChild(praiseCount);

    // DB参照（この投稿のpraises配下）
    const praisesRef = database.ref(`players/${uid}/posts/${postId}/praises`);

    // リアルタイム購読で人数と自分の状態を反映
    praisesRef.on("value", (snap) => {
        const v = snap.val() || {};
        const cnt = Object.keys(v).length;
        praiseCount.textContent = String(cnt);
        const cu = auth.currentUser;
        if (cu && v[cu.uid]) {
            praiseBtn.classList.add("active");
        } else {
            praiseBtn.classList.remove("active");
        }
    });

    // トグル挙動（transactionで二重加算を抑止）
    praiseBtn.addEventListener("click", async () => {
        const cu = auth.currentUser;
        if (!cu) { alert("ログインしてください"); return; }
        const myRef = praisesRef.child(cu.uid);

        try {
            const result = await myRef.transaction((curr) => {
                // 既に褒めているなら取り消し(null)、そうでなければ褒める(true)
                return curr ? null : true;
            });
            if (!result.committed) return;

            // 反映後の値を見て、付与か減算かを判断
            const afterVal = result.snapshot.val();
            if (afterVal === true) {
                await awardCoinsForPraise(uid, cu.uid);
            } else {
                await revertCoinsForPraise(uid, cu.uid);
            }
        } catch (e) {
            console.error(e);
            alert("操作に失敗しました");
        }
    });

    // 先にボタンを右上へ配置
    post_div.appendChild(praiseBtn);

    const img_tag = document.createElement("img");
    img_tag.alt = "base64 image";
    img_tag.id  = `img_${n}`;
    // ★ 追加: 投稿画像の幅300・高さauto・inline化（要件）
    img_tag.style.width = "300px";
    img_tag.style.height = "auto";
    img_tag.style.display = "inline";
    img_tag.style.maxWidth = "none";
    img_tag.style.maxHeight = "none";

    const text_tag = document.createElement("p");
    text_tag.id = `txt_${n}`;

    await loadFromRTDB(postId, uid, img_tag, text_tag).catch(console.error);

    // ★ 本文内の<img>スタイルは loadFromRTDB 側で enforceImgStyleIn を適用済み
    post_div.appendChild(text_tag);
    if (img_tag.src) post_div.appendChild(img_tag);

    // ★ 追加: コメントUI
    const commentsWrap = document.createElement("div");
    commentsWrap.className = "comments";

    const list = document.createElement("div");
    list.className = "comment-list";
    commentsWrap.appendChild(list);

    const form = document.createElement("div");
    form.className = "comment-form";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "コメントを書く";
    input.maxLength = 200;
    input.className = "comment-input";

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "送信";
    sendBtn.className = "comment-send";
    sendBtn.addEventListener("click", () => submitComment(uid, postId, input, sendBtn));

    form.appendChild(input);
    form.appendChild(sendBtn);
    commentsWrap.appendChild(form);

    post_div.appendChild(commentsWrap);

    // コメントのストリーム購読開始
    attachCommentsStream(uid, postId, list);

    const container = document.getElementById("viewScreen");
    if (position === 'top' && container.firstChild) {
        container.insertBefore(post_div, container.firstChild);
    } else {
        container.appendChild(post_div);
    }

    shownPostIds.add(postId);
}



/**
 * 初期ロード:
 *   最新から limit 件を降順で取得し、その順で末尾追加。
 *   → 画面全体は上が新しい、下が古い。
 *   最後に oldestLoadedTime を画面内の最小 createdAt に更新。
 * 既存の toViewScreen 名は connectDB.js から呼ばれるため維持
 */
// ===== 修正: 全体から取得して描画 =====
async function toViewScreen() {
    const page = await collectAllPage(null, postsPerPage);
    if (page.length === 0) {
        loadMoreBtn.style.display = "none";
        return;
    }

    for (let i = 0; i < page.length; i++) {
        const { postId, uid } = page[i];
        await renderPost(postId, uid, 'bottom');
    }

    oldestLoadedTime = page[page.length - 1].createdAt;
    loadMoreBtn.style.display = isAtBottom(viewScreen) ? "block" : "none";
}


// 「さらに読み込む」: 今の最古よりさらに古い塊を取得して末尾に追加
// ===== 修正: 全体からの過去ページを追加 =====
loadMoreBtn.addEventListener("click", async () => {
    if (loadMoreBtn.disabled) return;

    const wasAtBottom = isAtBottom(viewScreen);
    loadMoreBtn.disabled = true;
    const prevLabel = loadMoreBtn.textContent;
    loadMoreBtn.textContent = "読み込み中...";

    try {
        const page = await collectAllPage(oldestLoadedTime, postsPerPage);
        if (page.length === 0) {
            loadMoreBtn.textContent = "これ以上ありません";
            loadMoreBtn.style.display = isAtBottom(viewScreen) ? "block" : "none";
            return;
        }

        for (let i = 0; i < page.length; i++) {
            const { postId, uid } = page[i];
            await renderPost(postId, uid, 'bottom');
        }

        oldestLoadedTime = page[page.length - 1].createdAt;

        if (wasAtBottom) {
            viewScreen.scrollTop = viewScreen.scrollHeight - viewScreen.clientHeight;
        }
        loadMoreBtn.textContent = prevLabel;
        loadMoreBtn.style.display = isAtBottom(viewScreen) ? "block" : "none";
    } catch (e) {
        console.error(e);
        loadMoreBtn.textContent = "エラー。再試行";
        loadMoreBtn.style.display = isAtBottom(viewScreen) ? "block" : "none";
    } finally {
        setTimeout(() => { loadMoreBtn.disabled = false; }, LOAD_DELAY_MS);
    }
});




// コインと価値の実装
// UIの改善
// ====== スクロール位置による「さらに読み込む」制御 ======
viewScreen.addEventListener("scroll", () => {
    const nearBottom = isAtBottom(viewScreen);
    if (nearBottom) {
        loadMoreBtn.style.display = "block";
    } else {
        loadMoreBtn.style.display = "none";
    }
});


// ========================= ここから新機能: サービスとマーケット =========================

// サービス保存（作成または上書き）
async function upsertService(svcId, { title, desc, price, active }) {
    const user = auth.currentUser;
    if (!user) { alert("ログインしてください"); return; }
    const id = svcId || database.ref(`players/${user.uid}/services`).push().key;
    const payload = {
        id,
        title: (title || "").trim(),
        desc: (desc || "").trim(),
        price: Math.max(0, Number(price) || 0),
        active: !!active,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await database.ref(`players/${user.uid}/services/${id}`).update(payload);
    return id;
}

// サービス削除
async function deleteService(svcId) {
    const user = auth.currentUser;
    if (!user) return;
    await database.ref(`players/${user.uid}/services/${svcId}`).remove();
}

// ★ 修正: コメント対応のシグネチャに変更
async function buyService(sellerUid, service, buyerComment) {
    const buyer = auth.currentUser;
    if (!buyer) { alert("ログインしてください"); return; }
    if (buyer.uid === sellerUid) { alert("自分のサービスは買えません"); return; }

    const purchaseKey = `${sellerUid}_${service.id}`;
    const flagRef = database.ref(`purchases/${buyer.uid}/${purchaseKey}`);
    const tx = await flagRef.transaction((cur) => cur ? cur : true);
    if (!tx.committed) return;
    if (tx.snapshot.val() !== true) return;

    const ok = await spendCoins(buyer.uid, service.price);
    if (!ok) {
        await flagRef.remove();
        alert("コインが足りません");
        return;
    }

    const half = Math.floor(service.price / 2);
    await changeCoins(sellerUid, half);

    const orderRef = database.ref(`players/${sellerUid}/orders`).push();
    const order = {
        id: orderRef.key,
        serviceId: service.id,
        serviceTitle: service.title,
        price: service.price,
        buyerUid: buyer.uid,
        buyerName: window.currentUserName || "anonymous",
        buyerComment: buyerComment || "",   // ★ 追加: 購入コメント
        createdAt: Date.now(),
        status: "paid",
    };
    await orderRef.set(order);

    alert("購入しました");
}



// 画面要素
const myServicesList = document.getElementById('myServicesList');
const marketList     = document.getElementById('marketList');
const myOrdersList   = document.getElementById('myOrdersList');

// 自分のサービス一覧描画
function renderMyServiceCard(svc) {
    const card = document.createElement('div');
    card.className = 'svc-card';

    const title = document.createElement('div');
    title.className = 'svc-title';
    title.textContent = svc.title || '(無題)';

    const desc = document.createElement('div');
    desc.className = 'svc-desc';
    desc.textContent = svc.desc || '';

    const meta = document.createElement('div');
    meta.className = 'svc-meta';
    // ★ 修正: 半分だけ受け取れる説明を追記
    meta.textContent = `価格: ${svc.price} 🪙（受取はその半分） / 状態: ${svc.active ? '公開' : '停止'}`;

    const actions = document.createElement('div');
    actions.className = 'svc-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.onclick = () => {
        document.getElementById('svcTitle').value = svc.title || '';
        document.getElementById('svcDesc').value  = svc.desc || '';
        document.getElementById('svcPrice').value = svc.price || 0;
        document.getElementById('svcActive').checked = !!svc.active;
        document.getElementById('svcAddBtn').dataset.editing = svc.id;
        document.getElementById('svcAddBtn').textContent = '更新';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.onclick = async () => {
        if (!confirm('削除しますか？')) return;
        await deleteService(svc.id);
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(meta);
    card.appendChild(actions);
    return card;
}

// マーケット用カード
// ★ 修正: マーケットの購入ボタンでコメント入力を取得
function renderMarketCard(sellerUid, sellerName, svc) {
    const card = document.createElement('div');
    card.className = 'svc-card';
    // 既存: タイトル/説明/meta（省略）

    const actions = document.createElement('div');
    actions.className = 'svc-actions';

    const buyBtn = document.createElement('button');
    buyBtn.textContent = '購入';
    buyBtn.onclick = () => {
        const comment = prompt('購入時のコメント（任意）を入力');
        buyService(sellerUid, svc, comment || '');
    };

    actions.appendChild(buyBtn);
    card.appendChild(actions);
    return card;
}


// 注文アイテム描画
// ★ 修正: 注文表示にコメントを追加
function renderOrderItem(o) {
    const item = document.createElement('div');
    item.className = 'order-item';
    const when = new Date(o.createdAt).toLocaleString();
    const base = `${o.buyerName} が「${o.serviceTitle}」を ${o.price}🪙 で購入 (${when})`;
    item.textContent = o.buyerComment ? `${base} / コメント: ${o.buyerComment}` : base;
    return item;
}


// 初期化と購読
window.initServicesAndMarket = function initServicesAndMarket() {
    const addBtn = document.getElementById('svcAddBtn');
    const titleEl = document.getElementById('svcTitle');
    const descEl  = document.getElementById('svcDesc');
    const priceEl = document.getElementById('svcPrice');
    const activeEl= document.getElementById('svcActive');

    // 追加 / 更新
    addBtn.onclick = async () => {
        const title = titleEl.value;
        const desc  = descEl.value;
        const price = Number(priceEl.value || 0);
        const active= !!activeEl.checked;

        const editingId = addBtn.dataset.editing || null;
        const id = await upsertService(editingId, { title, desc, price, active });

        // フォームリセット
        delete addBtn.dataset.editing;
        addBtn.textContent = '追加 / 更新';
        titleEl.value = '';
        descEl.value  = '';
        priceEl.value = '';
        activeEl.checked = true;
    };

    const cu = auth.currentUser;
    if (!cu) return;

    // 自分のサービス購読
    database.ref(`players/${cu.uid}/services`).on('value', (snap) => {
        myServicesList.innerHTML = '';
        const val = snap.val() || {};
        Object.values(val).forEach((svc) => {
            myServicesList.appendChild(renderMyServiceCard(svc));
        });
    });

    // 自分の注文購読
    database.ref(`players/${cu.uid}/orders`).limitToLast(100).on('value', (snap) => {
        myOrdersList.innerHTML = '';
        const val = snap.val() || {};
        const list = Object.values(val).sort((a,b)=> (a.createdAt||0)-(b.createdAt||0));
        list.forEach(o => myOrdersList.appendChild(renderOrderItem(o)));
        // バッジは未読管理が無いのでカウントだけ更新
        const badge = document.getElementById('ordersBadge');
        if (badge) {
            const n = list.length;
            if (n > 0) {
                badge.textContent = String(n);
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    });

    // マーケット購読（全ユーザーをざっくり走査）
    // プロトタイプのため単純に players/*/services を走査
    database.ref('players').on('value', async (snap) => {
        marketList.innerHTML = '';
        const players = snap.val() || {};
        const buyerUid = cu.uid;

        Object.entries(players).forEach(([uid, p]) => {
            if (!p || !p.services) return;
            const name = p.Name || 'unknown';
            Object.values(p.services).forEach((svc) => {
                if (!svc.active) return;
                if (uid === buyerUid) return; // 自分は除外
                marketList.appendChild(renderMarketCard(uid, name, svc));
            });
        });
    });
};

// ========================= 追加：マーケット専用コインHUD制御 =========================

/**
 * マーケット専用コインHUDコントローラを作る。
 * - show(): HUD表示 + coins購読開始
 * - hide(): HUD非表示 + coins購読停止
 */
function makeMarketCoinHUD() {
    const hud = document.getElementById('coinHUD');
    const bal = document.getElementById('coinBalance');
    let ref = null;
    let handler = null;

    function start() {
        const cu = auth.currentUser;
        if (!hud || !bal || !cu) return;
        hud.style.display = 'block';
        ref = database.ref(`players/${cu.uid}/coins`);
        handler = (s) => { bal.textContent = typeof s.val() === 'number' ? s.val() : 0; };
        ref.on('value', handler);
    }
    function stop() {
        if (ref && handler) ref.off('value', handler);
        if (hud) hud.style.display = 'none';
        ref = null;
        handler = null;
    }
    return { show: start, hide: stop };
}

const coinHUDController = makeMarketCoinHUD();

/**
 * タブ切り替え。マーケットのときだけHUDを表示。
 */
function switchTab(tab) {
    document.getElementById("viewScreen").style.display      = (tab === "view") ? "block" : "none";
    document.getElementById("postScreen").style.display      = (tab === "post") ? "block" : "none";
    document.getElementById("servicesScreen").style.display  = (tab === "services") ? "block" : "none";
    document.getElementById("marketScreen").style.display    = (tab === "market") ? "block" : "none";

    if (tab === 'market') {
        coinHUDController.show();
    } else {
        coinHUDController.hide();
    }
}



// ===== 追加: 全員の投稿を集めるページャ =====
async function collectAllPage(beforeTime, limit = postsPerPage) {
    const collected = [];
    const playersSnap = await database.ref("players").get();
    if (!playersSnap.exists()) return [];

    playersSnap.forEach(playerSnap => {
        const uid = playerSnap.key;
        const postsSnap = playerSnap.child("posts");
        postsSnap.forEach(child => {
            const val = child.val() || {};
            if (!val || !val.text || !val.text.trim()) return;
            const ts = typeof val.createdAt === "number" ? val.createdAt : 0;
            if (beforeTime == null || ts < beforeTime) {
                collected.push({ uid, postId: child.key, createdAt: ts });
            }
        });
    });

    collected.sort((a, b) => b.createdAt - a.createdAt);
    return collected.slice(0, limit);
}

// ===== 追加: 全体を .on で監視（新規投稿を先頭に挿入） =====
function attachGlobalPostsOn() {
    // uid -> { ref, handler } を保持して二重アタッチ防止
    const listeners = new Map();

    function attachFor(uid) {
        if (listeners.has(uid)) return;
        const ref = database.ref(`players/${uid}/posts`).limitToLast(1);
        const handler = (snap) => {
            const postId = snap.key;
            if (!postId) return;
            if (shownPostIds.has(postId)) return;
            renderPost(postId, uid, 'top');
        };
        ref.on('child_added', handler);
        listeners.set(uid, { ref, handler });
    }

    // 既存ユーザーに付与
    database.ref('players').once('value').then(s => {
        s.forEach(ch => attachFor(ch.key));
    });

    // 新規ユーザーにも追従
    database.ref('players').on('child_added', (snap) => {
        attachFor(snap.key);
    });
}

// ========================= ここまで：マーケット専用コインHUD制御 =========================