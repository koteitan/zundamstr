import {
  createRxNostr,
  createRxForwardReq,
  createRxBackwardReq,
} from "https://esm.sh/rx-nostr@3";
import { verifier } from "https://esm.sh/@rx-nostr/crypto@3";
import { nip19 } from "https://esm.sh/nostr-tools@2";

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const BOOTSTRAP_RELAYS = [
  "wss://directory.yabu.me",
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  "wss://indexer.coracle.social",
];

const FALLBACK_RELAYS = [
  "wss://yabu.me",
  "wss://r.kojira.io",
];

// アプリ固有データ(kind:30078, NIP-78)の識別子と承諾タグ
const APP_D = "zundamstr";
const CLIENT_TAG = ["client", "zundamstr"];
const COPYRIGHT_TAG = ["copyright", "accepted"];

// ---------------------------------------------------------------------------
// dom
// ---------------------------------------------------------------------------
const $boot = document.getElementById("boot");
const $bootMsg = document.getElementById("boot-msg");
const $timeline = document.getElementById("timeline");
const $status = document.getElementById("status");
const $user = document.getElementById("user");
const $composer = document.getElementById("composer");
const $composerInput = document.getElementById("composer-input");

function setBootMsg(text) {
  $bootMsg.textContent = text;
}
function setStatus(text) {
  $status.classList.remove("hidden");
  $status.textContent = text;
}

// ---------------------------------------------------------------------------
// zundamon transform (deterministic)
// ---------------------------------------------------------------------------
// 文末を機械的にずんだもん語尾へ変換する純粋関数。
// 上から順に最初にマッチした語尾だけを置換する（順序が重要）。
const ZUNDA_RULES = [
  // 疑問
  [/ですか$/, "なのだ？"],
  [/ますか$/, "のだ？"],
  [/でしょうか$/, "なのだ？"],
  [/だろうか$/, "なのだ？"],
  [/のか$/, "のだ？"],
  [/かな$/, "のだ？"],
  [/かい$/, "のだ？"],
  // 丁寧・助動詞
  [/でした$/, "だったのだ"],
  [/ましたか$/, "たのだ？"],
  [/ました$/, "たのだ"],
  [/ませんか$/, "ないのだ？"],
  [/ません$/, "ないのだ"],
  [/ましょう$/, "するのだ"],
  [/ます$/, "のだ"],
  [/でしょうね$/, "なのだ"],
  [/でしょう$/, "なのだ"],
  [/でしょ$/, "なのだ"],
  [/です$/, "なのだ"],
  [/ください$/, "てほしいのだ"],
  // んだ / のだ / なの 系
  [/んです$/, "のだ"],
  [/んだ$/, "のだ"],
  [/なのだ$/, "なのだ"], // 既にずんだもん
  [/のだ$/, "のだ"],
  [/なの$/, "なのだ"],
  // 口語の断定・語尾（だ を含むので安全に置換できる）
  [/じゃない$/, "ないのだ"],
  [/じゃん$/, "のだ"],
  [/だった$/, "だったのだ"],
  [/だろう$/, "なのだ"],
  [/である$/, "なのだ"],
  [/だよね$/, "なのだ"],
  [/だよ$/, "なのだ"],
  [/だね$/, "なのだ"],
  [/だな$/, "なのだ"],
  [/だぜ$/, "なのだ"],
  [/だぞ$/, "なのだ"],
  [/だわ$/, "なのだ"],
  [/だもん$/, "なのだ"],
  [/だ$/, "なのだ"],
];

// 末尾の装飾（笑い・ラテン文字・数字・記号・絵文字・空白）を分離する
const DECOR_TAIL = /[\s\p{P}\p{S}\p{M}\p{Cf}A-Za-z0-9ｗ笑草]+$/u;
// URL を退避する不可視マーカー（WORD JOINER）
const URL_MARK = "⁠";

function zundaSentence(raw) {
  // 末尾の装飾を切り離してから語尾を変換し、装飾を戻す
  const m = raw.match(DECOR_TAIL);
  const decor = m ? m[0] : "";
  const core = decor ? raw.slice(0, raw.length - decor.length) : raw;
  if (!core) return raw; // 日本語コンテンツが無い行はそのまま

  for (const [re, rep] of ZUNDA_RULES) {
    if (re.test(core)) return core.replace(re, rep) + decor;
  }
  // ルール非該当時は末尾の文字種で出し分ける
  if (/[ぁ-ゖ]$/u.test(core)) return core + "のだ" + decor; // 仮名（活用語）
  if (/[一-龯々ァ-ヺーゝゞ]$/u.test(core)) return core + "なのだ" + decor; // 漢字・カタカナ（体言）
  return core + decor; // それ以外はそのまま
}

function zundamonize(text) {
  // URL は変換から保護する
  const urls = [];
  const masked = text.replace(/https?:\/\/\S+/g, (m) => {
    urls.push(m);
    return URL_MARK + (urls.length - 1) + URL_MARK;
  });

  // 文単位で分割（句読点・改行を区切りとして保持）し、各文を全部変換する
  const parts = masked.split(/(\n|。|！|!|？|\?)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const delim = parts[i + 1] ?? "";
    if (body.trim() === "") {
      out += body + delim;
      continue;
    }
    out += zundaSentence(body) + delim;
  }

  // URL を復元
  return out.replace(
    new RegExp(URL_MARK + "(\\d+)" + URL_MARK, "g"),
    (_, i) => urls[Number(i)],
  );
}

// ---------------------------------------------------------------------------
// nostr helpers
// ---------------------------------------------------------------------------
// イベントを relays（kind:10002 write relay）へ署名(NIP-07)して送信する
function publishEvent(rxNostr, params, relays) {
  return new Promise((resolve) => {
    let ok = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.unsubscribe();
      resolve(ok);
    };
    const opts = relays && relays.length ? { on: { relays } } : undefined;
    const sub = rxNostr.send(params, opts).subscribe({
      next: (packet) => {
        if (packet.ok) ok = true;
      },
      complete: finish,
      error: finish,
    });
    setTimeout(finish, 8000);
  });
}

// 置換可能イベント(kind:0/3/10002 等)を購読し、EOSE を待たず
// 来るたびに（より新しければ）onUpdate を呼ぶ。返り値で購読解除できる。
function subscribeLatest(relays, filter, onUpdate) {
  let latest = null;
  const req = createRxBackwardReq();
  const sub = rxNostr.use(req, { on: { relays } }).subscribe({
    next: (p) => {
      const ev = p.event;
      if (!latest || ev.created_at > latest.created_at) {
        latest = ev;
        onUpdate(ev);
      }
    },
  });
  req.emit(filter);
  req.over();
  return sub;
}

// 指定 pubkey 群の kind:0 を購読し、来たものから順に表示名を更新する
function subscribeProfiles(authors) {
  if (authors.length === 0) return;
  const req = createRxBackwardReq();
  const sub = rxNostr.use(req).subscribe({
    next: (p) => {
      const ev = p.event;
      const name = profileName(ev, ev.pubkey);
      profileMap.set(ev.pubkey, name);
      document
        .querySelectorAll(`.post[data-pubkey="${ev.pubkey}"] .name`)
        .forEach((el) => (el.textContent = name));
    },
  });
  req.emit({ kinds: [0], authors });
  req.over();
  return sub;
}

function parseRelays(ev, want) {
  // want: "read" | "write"
  if (!ev) return [];
  const relays = [];
  for (const tag of ev.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const marker = tag[2];
    if (!marker || marker === want) relays.push(normalizeRelay(tag[1]));
  }
  return dedupe(relays);
}

function parseKind3Relays(ev, want) {
  if (!ev || !ev.content) return [];
  try {
    const obj = JSON.parse(ev.content);
    const relays = [];
    for (const [url, perm] of Object.entries(obj)) {
      if (!perm || perm[want] !== false) relays.push(normalizeRelay(url));
    }
    return dedupe(relays);
  } catch (_) {
    return [];
  }
}

function parseFollows(ev) {
  if (!ev) return [];
  const set = new Set();
  for (const tag of ev.tags) {
    if (tag[0] === "p" && /^[0-9a-f]{64}$/.test(tag[1] || "")) set.add(tag[1]);
  }
  return [...set];
}

// kind:30078 が zundamstr の改変承諾イベントか（署名は rx-nostr が検証済み）
function isConsentEvent(ev) {
  if (!ev || ev.kind !== 30078) return false;
  let client = false;
  let copyright = false;
  for (const tag of ev.tags) {
    if (tag[0] === "client" && tag[1] === CLIENT_TAG[1]) client = true;
    if (tag[0] === "copyright" && tag[1] === COPYRIGHT_TAG[1]) copyright = true;
  }
  return client && copyright;
}

function normalizeRelay(url) {
  return url.trim().replace(/\/+$/, "");
}
function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function shortNpub(pubkey) {
  const npub = nip19.npubEncode(pubkey);
  return npub.slice(0, 10) + "…" + npub.slice(-4);
}

function profileName(metaEv, pubkey) {
  if (metaEv) {
    try {
      const p = JSON.parse(metaEv.content);
      const name = p.display_name || p.displayName || p.name;
      if (name && name.trim()) return name.trim();
    } catch (_) {}
  }
  return shortNpub(pubkey);
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const seenEvents = new Set();
const profileMap = new Map(); // pubkey -> name

// 平仮名・カタカナ・漢字が1つも無ければ日本語ではないと判定する
const JP_CHAR = /[぀-ゟ゠-ヿ一-鿿]/;
function isJapanese(text) {
  return JP_CHAR.test(text);
}

function nearBottom() {
  return $timeline.scrollHeight - $timeline.scrollTop - $timeline.clientHeight < 80;
}

function renderPost(ev) {
  if (seenEvents.has(ev.id)) return;
  seenEvents.add(ev.id);
  if (!isJapanese(ev.content)) return; // 日本語以外は非表示

  const name = profileMap.get(ev.pubkey) || profileName(null, ev.pubkey);
  const stick = nearBottom();

  const div = document.createElement("div");
  div.className = "post";
  div.dataset.createdAt = ev.created_at;
  div.dataset.pubkey = ev.pubkey;

  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = name;

  const sepEl = document.createElement("span");
  sepEl.className = "sep";
  sepEl.textContent = ">";

  const bodyEl = document.createElement("span");
  bodyEl.className = "body";
  bodyEl.textContent = " " + zundamonize(ev.content);

  div.append(nameEl, sepEl, bodyEl);
  insertSorted(div, ev.created_at);

  if (stick) $timeline.scrollTop = $timeline.scrollHeight;
}

// created_at 昇順を保つように挿入（古い→新しい、下が最新）
function insertSorted(div, createdAt) {
  const children = $timeline.children;
  for (let i = children.length - 1; i >= 0; i--) {
    if (Number(children[i].dataset.createdAt) <= createdAt) {
      children[i].after(div);
      return;
    }
  }
  $timeline.prepend(div);
}

// ---------------------------------------------------------------------------
// app state
// ---------------------------------------------------------------------------
let rxNostr = null;
let myPubkey = null; // NIP-07 ユーザ（無ければ null）
let myName = null;
let myConsented = false;
let myConsentEventId = null; // 自分の kind:30078 承諾イベント id（削除用）
let consentSettled = false; // kind:30078 探索の EOSE が来たか
let consentEoseSub = null; // EOSE 監視の購読
let writeRelays = []; // 投稿・承諾の送信先

const consenters = new Set(); // 改変を承諾した pubkey
const pendingNew = new Set(); // まだ kind:1 を取り込んでいない承諾者
let k1Sub = null; // 現在の kind:1 forward 購読
let consentSub = null; // kind:30078 承諾の forward 購読
let consentReqRef = null; // 承諾探索の rxReq（フォロー更新で再emit用）
let consentAuthorsMode = false; // 承諾探索を authors 限定でやっているか
const currentFollows = new Set(); // 既知のフォロー
const discoverySubs = []; // bootstrap での探索購読（teardown 用）
let started = false; // 個人モードの探索を開始済みか
let rebuildTimer = null;
let nostrWatch = null; // window.nostr の遅延注入を監視するタイマ

// ---------------------------------------------------------------------------
// consent gated kind:1 collection
// ---------------------------------------------------------------------------
// kind:30078 探索の EOSE を監視。探索先 relay のどれか1つでも EOSE を返したら
// （全relay は待たず）確定する。bootstrap 購読の EOSE は relay で弾く。
function watchConsentEose(relays) {
  consentSettled = false;
  const need = new Set((relays || []).map(normalizeRelay));
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (consentEoseSub) {
      consentEoseSub.unsubscribe();
      consentEoseSub = null;
    }
    consentSettled = true;
    renderUser();
  };
  consentEoseSub = rxNostr.createAllMessageObservable().subscribe((pkt) => {
    if (pkt.type !== "EOSE") return;
    if (need.size && !need.has(normalizeRelay(pkt.from))) return;
    settle();
  });
  // EOSE が来なくても進めるための保険
  const timer = setTimeout(settle, 6000);
}

function onConsentEvent(ev) {
  if (!isConsentEvent(ev)) return;
  if (ev.pubkey === myPubkey) {
    myConsented = true;
    myConsentEventId = ev.id;
    renderUser();
  }
  addConsenter(ev.pubkey);
}

function addConsenter(pubkey) {
  if (consenters.has(pubkey)) return;
  consenters.add(pubkey);
  pendingNew.add(pubkey);
  scheduleRebuild();
}

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildKind1, 700);
}

// デバウンスを待たずに即座にタイムラインを再構築する
function flushRebuild() {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  rebuildKind1();
}

// 新たに承諾が判明した pubkey を取り込み、kind:1 の forward 購読を貼り直す。
// プロフィール(kind:0)は EOSE を待たず来たものから随時名前を更新する。
function rebuildKind1() {
  rebuildTimer = null;
  const newAuthors = [...pendingNew];
  pendingNew.clear();
  if (newAuthors.length === 0) return;

  subscribeProfiles(newAuthors); // 名前は後から非同期で反映
  restartForwardSub(); // 待たずに即購読
  $status.classList.add("hidden");
  $status.textContent = "";
}

// 全承諾者の kind:1 を forward strategy で購読し直す
//  since を付けないので stored（履歴）+ live を forward で受け取る
function restartForwardSub() {
  if (k1Sub) k1Sub.unsubscribe();
  const authors = [...consenters];
  if (authors.length === 0) return;
  const req = createRxForwardReq();
  k1Sub = rxNostr.use(req).subscribe({ next: (p) => renderPost(p.event) });
  req.emit({ kinds: [1], authors, limit: 20 });
}

// ---------------------------------------------------------------------------
// header user area
// ---------------------------------------------------------------------------
function renderUser() {
  if (!myPubkey) {
    $user.classList.add("hidden");
    return;
  }
  $user.classList.remove("hidden");
  $user.replaceChildren();

  const name = document.createElement("span");
  name.className = "uname";
  name.textContent = myName || shortNpub(myPubkey);
  $user.append(name);

  if (myConsented) {
    // 承諾済みなら催促メッセージもボタンも出さず、✅だけ。
    // ✅クリックで kind:5 を飛ばして承諾(kind:30078)を削除＝取り消し。
    const ok = document.createElement("button");
    ok.type = "button";
    ok.id = "revoke-btn";
    ok.className = "consent-ok";
    ok.textContent = "✅";
    ok.title = "クリックで承諾を取り消すのだ";
    ok.addEventListener("click", onRevokeClick);
    $user.append(ok);
    return;
  }

  if (!consentSettled) {
    // 承諾状況の確認が済むまで（kind:30078 の EOSE 前）はボタンを出さない。
    // でないと承諾済みの人にもロード中に承諾ボタンが見えてしまう。
    const wait = document.createElement("span");
    wait.className = "consent-text";
    wait.textContent = "確認中なのだ";
    $user.append(wait);
    return;
  }

  const txt = document.createElement("span");
  txt.className = "consent-text";
  txt.textContent = "勝手に会話をずんだもん化されることを承諾するのだ";

  const btn = document.createElement("button");
  btn.id = "consent-btn";
  btn.type = "button";
  btn.textContent = "[OKなのだ]";
  btn.addEventListener("click", onConsentClick);

  $user.append(txt, btn);
}

async function onConsentClick() {
  const btn = document.getElementById("consent-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "送信中なのだ";
  }
  try {
    const ok = await publishEvent(
      rxNostr,
      {
        kind: 30078,
        content: "",
        tags: [["d", APP_D], CLIENT_TAG, COPYRIGHT_TAG],
      },
      writeRelays,
    );
    if (!ok) throw new Error("リレーに拒否されたのだ");
    // 承諾成立 → 催促を消し、自分を承諾者に加えて即タイムラインを更新
    myConsented = true;
    renderUser();
    addConsenter(myPubkey);
    flushRebuild();
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "[OKなのだ]";
    }
    setStatus("承諾の送信に失敗したのだ: " + (e.message || e));
  }
}

// ✅クリック → kind:5(NIP-09) で承諾(kind:30078)を削除して取り消す
async function onRevokeClick() {
  const btn = document.getElementById("revoke-btn");
  if (btn) btn.disabled = true;
  try {
    // kind:30078 は置換可能イベントなので a タグ（アドレス）で削除を指示する
    const tags = [
      ["a", `30078:${myPubkey}:${APP_D}`],
      ["k", "30078"],
    ];
    if (myConsentEventId) tags.unshift(["e", myConsentEventId]);
    const ok = await publishEvent(rxNostr, { kind: 5, content: "", tags }, writeRelays);
    if (!ok) throw new Error("リレーに拒否されたのだ");

    // 取り消し成立 → 承諾解除し、自分の投稿をTLから外す
    myConsented = false;
    myConsentEventId = null;
    consenters.delete(myPubkey);
    document
      .querySelectorAll(`.post[data-pubkey="${myPubkey}"]`)
      .forEach((el) => el.remove());
    restartForwardSub();
    renderUser();
    setStatus("承諾を取り消したのだ");
  } catch (e) {
    if (btn) btn.disabled = false;
    setStatus("取り消しの送信に失敗したのだ: " + (e.message || e));
  }
}

// ---------------------------------------------------------------------------
// composer (kind:1 post)
// ---------------------------------------------------------------------------
$composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $composerInput.value.trim();
  if (!text) return;
  const btn = document.getElementById("composer-send");
  btn.disabled = true;
  try {
    // 投稿自体はずんだもん化せず生テキストで送信する
    const ok = await publishEvent(
      rxNostr,
      { kind: 1, content: text, tags: [] },
      writeRelays,
    );
    if (!ok) throw new Error("リレーに拒否されたのだ");
    $composerInput.value = "";
    // 承諾済みなら forward 購読経由で他と同様ずんだもん化されて表示される
    setStatus(
      myConsented
        ? "投稿したのだ（承諾済みなので表示はずんだもん化されるのだ）"
        : "投稿したのだ（未承諾なので自分のTLには出ないのだ）",
    );
  } catch (err) {
    setStatus("投稿に失敗したのだ: " + (err.message || err));
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------
async function init() {
  setStatus("NIP-07 を確認中なのだ");
  setBootMsg("NIP-07 を確認中なのだ");

  rxNostr = createRxNostr({ verifier });

  // 待たずに即起動。NIP-07 が既にあれば個人モード、無ければパブリックで開始し、
  // あとから window.nostr が注入されたら検出して個人モードへ切り替える。
  if (window.nostr) {
    try {
      myPubkey = await window.nostr.getPublicKey();
    } catch (_) {
      myPubkey = null;
    }
  }

  if (myPubkey) {
    await startPersonal();
  } else {
    await startPublic();
    if (!window.nostr) watchForNostr();
  }
}

// パブリック開始後、window.nostr が遅れて注入されたら検出して個人モードへ切り替える
function watchForNostr() {
  if (nostrWatch) return;
  nostrWatch = setInterval(() => {
    if (!window.nostr) return;
    clearInterval(nostrWatch);
    nostrWatch = null;
    switchToPersonal();
  }, 500);
}

// パブリック → 個人モードへ。状態を破棄して再構築する
async function switchToPersonal() {
  let pk = null;
  try {
    pk = await window.nostr.getPublicKey();
  } catch (_) {
    pk = null;
  }
  if (!pk) return; // 拒否されたらパブリックのまま（再プロンプトはしない）
  myPubkey = pk;
  teardown();
  await startPersonal();
}

// 購読・表示・収集状態をすべてリセットする
function teardown() {
  if (k1Sub) {
    k1Sub.unsubscribe();
    k1Sub = null;
  }
  if (consentSub) {
    consentSub.unsubscribe();
    consentSub = null;
  }
  if (consentEoseSub) {
    consentEoseSub.unsubscribe();
    consentEoseSub = null;
  }
  while (discoverySubs.length) discoverySubs.pop().unsubscribe();
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  consenters.clear();
  pendingNew.clear();
  currentFollows.clear();
  seenEvents.clear();
  profileMap.clear();
  consentReqRef = null;
  consentAuthorsMode = false;
  started = false;
  myConsented = false;
  myConsentEventId = null;
  consentSettled = false;
  $timeline.replaceChildren();
}

// 承諾(kind:30078)を forward strategy で購読開始。
// follows があればその範囲、無ければ全体から承諾者を探す。
function startConsentDiscovery(follows, relays) {
  // EOSE が来るまでは承諾ボタンを出さない（承諾済み判定が確定するまで隠す）
  watchConsentEose(relays);
  const consentReq = createRxForwardReq();
  consentSub = rxNostr.use(consentReq).subscribe({ next: (p) => onConsentEvent(p.event) });
  consentReqRef = consentReq;
  if (follows && follows.length > 0) {
    consentAuthorsMode = true;
    consentReq.emit({ kinds: [30078], authors: [...follows, myPubkey], "#d": [APP_D] });
  } else {
    consentAuthorsMode = false;
    consentReq.emit({ kinds: [30078], "#d": [APP_D] });
  }
}

// 後から届いた新しい kind:3 でフォローが増えたら承諾探索の対象を広げる
function extendConsentFollows(follows) {
  let added = false;
  for (const pk of follows) {
    if (!currentFollows.has(pk)) {
      currentFollows.add(pk);
      added = true;
    }
  }
  if (added && consentAuthorsMode && consentReqRef) {
    consentReqRef.emit({
      kinds: [30078],
      authors: [...currentFollows, myPubkey],
      "#d": [APP_D],
    });
  }
}

// --- NIP-07 あり: フォロー範囲の承諾者TL + 投稿 ---
// EOSE を待たず、見つかったところから随時次へ進む reactive 構成。
async function startPersonal() {
  $boot.classList.add("hidden");
  $timeline.classList.remove("hidden");
  renderUser();
  setStatus("リレー情報・フォローを探索中なのだ");

  // 自分のプロフィール（来たら名前を更新）
  discoverySubs.push(
    subscribeLatest(
      BOOTSTRAP_RELAYS,
      { kinds: [0], authors: [myPubkey], limit: 1 },
      (ev) => {
        myName = profileName(ev, myPubkey);
        renderUser();
      },
    ),
  );

  let relayEv = null;
  let contactEv = null;
  let startTimer = null;

  const doStart = () => {
    if (started) return;
    started = true;
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }

    let readRelays = parseRelays(relayEv, "read");
    let writeR = parseRelays(relayEv, "write");
    if (readRelays.length === 0) {
      readRelays = parseKind3Relays(contactEv, "read");
      writeR = parseKind3Relays(contactEv, "write");
    }
    if (readRelays.length === 0) readRelays = FALLBACK_RELAYS;
    writeRelays = writeR.length ? writeR : readRelays;

    const follows = parseFollows(contactEv);
    follows.forEach((pk) => currentFollows.add(pk));

    rxNostr.setDefaultRelays(readRelays);
    $composer.classList.remove("hidden");
    setStatus(`承諾者を探索中なのだ（follows:${follows.length}）`);
    startConsentDiscovery(follows, readRelays);
  };

  const maybeStart = () => {
    if (started) return;
    let hasRelays = parseRelays(relayEv, "read").length > 0;
    if (!hasRelays) hasRelays = parseKind3Relays(contactEv, "read").length > 0;
    // フォローが分かり、かつ read relay を決められれば即開始
    if (contactEv && (hasRelays || relayEv)) doStart();
  };

  // kind:10002 / kind:3 を bootstrap で購読（来たら即進む、後から更新は拡張）
  discoverySubs.push(
    subscribeLatest(
      BOOTSTRAP_RELAYS,
      { kinds: [10002], authors: [myPubkey], limit: 1 },
      (ev) => {
        relayEv = ev;
        maybeStart();
      },
    ),
  );
  discoverySubs.push(
    subscribeLatest(
      BOOTSTRAP_RELAYS,
      { kinds: [3], authors: [myPubkey], limit: 1 },
      (ev) => {
        contactEv = ev;
        if (started) extendConsentFollows(parseFollows(ev));
        else maybeStart();
      },
    ),
  );

  // どちらも来なくてもしばらくしたら手元の情報（無ければ fallback）で開始
  startTimer = setTimeout(doStart, 2000);
}

// --- NIP-07 なし: fallback relay の承諾者パブリックTL（閲覧のみ） ---
async function startPublic() {
  $boot.classList.add("hidden");
  $timeline.classList.remove("hidden");
  $user.classList.add("hidden");
  // 署名できないので投稿欄は出さない
  $composer.classList.add("hidden");

  rxNostr.setDefaultRelays(FALLBACK_RELAYS);
  setStatus("NIP-07 が無いので承諾者のパブリックTLを表示するのだ");
  startConsentDiscovery(null, FALLBACK_RELAYS); // 全体から承諾者
}

init();
