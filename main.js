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

// ---------------------------------------------------------------------------
// dom
// ---------------------------------------------------------------------------
const $boot = document.getElementById("boot");
const $bootMsg = document.getElementById("boot-msg");
const $timeline = document.getElementById("timeline");
const $status = document.getElementById("status");

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
const ZUNDA_RULES = [
  // 疑問
  [/ですか$/, "なのだ？"],
  [/ますか$/, "のだ？"],
  [/でしょうか$/, "なのだ？"],
  [/だろうか$/, "なのだ？"],
  [/かい$/, "のだ？"],
  // 丁寧
  [/でした$/, "だったのだ"],
  [/ましたか$/, "たのだ？"],
  [/ました$/, "たのだ"],
  [/ません$/, "ないのだ"],
  [/ませんか$/, "ないのだ？"],
  [/ましょう$/, "するのだ"],
  [/ください$/, "てほしいのだ"],
  [/です$/, "なのだ"],
  [/ます$/, "のだ"],
  // 断定・語尾
  [/だよね$/, "なのだ"],
  [/だよ$/, "なのだ"],
  [/だね$/, "なのだ"],
  [/だな$/, "なのだ"],
  [/だぜ$/, "なのだ"],
  [/だぞ$/, "なのだ"],
  [/だわ$/, "なのだ"],
  [/である$/, "なのだ"],
  [/なのだ$/, "なのだ"], // 既にずんだもん
  [/のだ$/, "のだ"],
  [/だ$/, "なのだ"],
  [/だろう$/, "なのだ"],
  [/よ$/, "のだ"],
  [/ね$/, "のだ"],
  [/わ$/, "のだ"],
];

// 末尾が動詞・形容詞っぽい仮名/漢字で終わる場合に「のだ」を付ける
const PLAIN_TAIL = /[ぁ-ゖァ-ヺ一-龯ーんッっ]$/;

function zundaSentence(body) {
  for (const [re, rep] of ZUNDA_RULES) {
    if (re.test(body)) return body.replace(re, rep);
  }
  if (PLAIN_TAIL.test(body)) return body + "のだ";
  return body; // 記号やラテン文字などはそのまま
}

function zundamonize(text) {
  // URL は変換から保護する
  const urls = [];
  let masked = text.replace(/https?:\/\/\S+/g, (m) => {
    urls.push(m);
    return " " + (urls.length - 1) + " ";
  });

  // 文単位で分割（句読点・改行を区切りとして保持）
  const parts = masked.split(/(\n|。|！|!|？|\?)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const delim = parts[i + 1] ?? "";
    if (body.trim() === "") {
      out += body + delim;
      continue;
    }
    // 末尾の空白を保持
    const tail = body.match(/\s*$/)[0];
    const core = body.slice(0, body.length - tail.length);
    out += zundaSentence(core) + tail + delim;
  }

  // URL を復元
  out = out.replace(/ (\d+) /g, (_, i) => urls[Number(i)]);
  return out;
}

// ---------------------------------------------------------------------------
// nostr helpers
// ---------------------------------------------------------------------------
function latest(events) {
  let best = null;
  for (const ev of events) {
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  return best;
}

// backward strategy: フィルタに一致するイベントを集めて解決する
function fetchEvents(rxNostr, filters, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const events = [];
    const req = createRxBackwardReq();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.unsubscribe();
      resolve(events);
    };
    const sub = rxNostr.use(req).subscribe({
      next: (packet) => events.push(packet.event),
      error: finish,
      complete: finish,
    });
    req.emit(filters);
    req.over();
    setTimeout(finish, timeoutMs);
  });
}

function parseNip65ReadRelays(ev) {
  if (!ev) return [];
  const relays = [];
  for (const tag of ev.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const marker = tag[2];
    if (!marker || marker === "read") relays.push(normalizeRelay(tag[1]));
  }
  return dedupe(relays);
}

function parseKind3Relays(ev) {
  if (!ev || !ev.content) return [];
  try {
    const obj = JSON.parse(ev.content);
    const relays = [];
    for (const [url, perm] of Object.entries(obj)) {
      if (!perm || perm.read !== false) relays.push(normalizeRelay(url));
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

function normalizeRelay(url) {
  return url.trim().replace(/\/+$/, "");
}
function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function profileName(metaEv, pubkey) {
  if (metaEv) {
    try {
      const p = JSON.parse(metaEv.content);
      const name = p.display_name || p.displayName || p.name;
      if (name && name.trim()) return name.trim();
    } catch (_) {}
  }
  const npub = nip19.npubEncode(pubkey);
  return npub.slice(0, 10) + "…" + npub.slice(-4);
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const seenEvents = new Set();
const profileMap = new Map(); // pubkey -> name

function nearBottom() {
  return $timeline.scrollHeight - $timeline.scrollTop - $timeline.clientHeight < 80;
}

function renderPost(ev) {
  if (seenEvents.has(ev.id)) return;
  seenEvents.add(ev.id);

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
  sepEl.textContent = ">>";

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

function applyProfiles(metaEvents, pubkeys) {
  const latestMeta = new Map();
  for (const ev of metaEvents) {
    const prev = latestMeta.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) latestMeta.set(ev.pubkey, ev);
  }
  for (const pk of pubkeys) {
    profileMap.set(pk, profileName(latestMeta.get(pk), pk));
  }
}

// 未知の pubkey のプロフィールを遅延取得して表示名を差し替える
async function ensureProfile(rxNostr, pubkey) {
  if (profileMap.has(pubkey)) return;
  profileMap.set(pubkey, profileName(null, pubkey)); // 多重取得防止のプレースホルダ
  const meta = await fetchEvents(
    rxNostr,
    { kinds: [0], authors: [pubkey], limit: 1 },
    4000,
  );
  const ev = latest(meta);
  if (!ev) return;
  const name = profileName(ev, pubkey);
  profileMap.set(pubkey, name);
  document
    .querySelectorAll(`.post[data-pubkey="${pubkey}"] .name`)
    .forEach((el) => (el.textContent = name));
}

// ---------------------------------------------------------------------------
// entry: 自動で NIP-07 接続、無ければ fallback relay のパブリックを表示
// ---------------------------------------------------------------------------
async function init() {
  setStatus("起動中… NIP-07 を確認中なのだ");

  let pubkey = null;
  if (window.nostr) {
    try {
      pubkey = await window.nostr.getPublicKey();
    } catch (_) {
      pubkey = null;
    }
  }

  const rxNostr = createRxNostr({ verifier });

  if (pubkey) {
    await startPersonal(rxNostr, pubkey);
  } else {
    await startPublic(rxNostr);
  }
}

// --- NIP-07 あり: フォローのタイムライン ---
async function startPersonal(rxNostr, pubkey) {
  $boot.classList.add("hidden");
  $timeline.classList.remove("hidden");

  // phase 1: bootstrap relays でリレー情報とフォローリストを取得
  rxNostr.setDefaultRelays(BOOTSTRAP_RELAYS);

  setStatus("kind:10002（リレーリスト）を取得中なのだ…");
  const relayListEvents = await fetchEvents(rxNostr, {
    kinds: [10002],
    authors: [pubkey],
    limit: 1,
  });
  let readRelays = parseNip65ReadRelays(latest(relayListEvents));

  setStatus("kind:3（フォローリスト）を取得中なのだ…");
  const contactEvents = await fetchEvents(rxNostr, {
    kinds: [3],
    authors: [pubkey],
    limit: 1,
  });
  const contact = latest(contactEvents);

  let relaySource = "kind:10002";
  if (readRelays.length === 0) {
    readRelays = parseKind3Relays(contact);
    relaySource = "kind:3 content";
  }
  if (readRelays.length === 0) {
    readRelays = FALLBACK_RELAYS;
    relaySource = "fallback";
  }

  const follows = parseFollows(contact);
  if (follows.length === 0) {
    setStatus("kind:3 にフォローが見つからないので、パブリックを表示するのだ");
    await startPublic(rxNostr);
    return;
  }

  // phase 2: ユーザのリレーへ切替
  rxNostr.setDefaultRelays(readRelays);
  setStatus(
    `リレー(${relaySource}): ${readRelays.length} / フォロー: ${follows.length} — プロフィール取得中なのだ…`,
  );
  const metaEvents = await fetchEvents(rxNostr, { kinds: [0], authors: follows });
  applyProfiles(metaEvents, follows);

  // phase 3: 過去の kind:1 を backward で取得
  setStatus(
    `リレー(${relaySource}): ${readRelays.length} / フォロー: ${follows.length} — タイムライン取得中なのだ…`,
  );
  const history = await fetchEvents(rxNostr, {
    kinds: [1],
    authors: follows,
    limit: 100,
  });
  history.sort((a, b) => a.created_at - b.created_at);
  for (const ev of history) renderPost(ev);
  $timeline.scrollTop = $timeline.scrollHeight;

  // phase 4: 新着 kind:1 を forward で購読
  const nowSec = Math.floor(Date.now() / 1000);
  const fwd = createRxForwardReq();
  rxNostr.use(fwd).subscribe({
    next: (packet) => renderPost(packet.event),
  });
  fwd.emit({ kinds: [1], authors: follows, since: nowSec });

  setStatus(
    `live ● リレー(${relaySource}):${readRelays.length} フォロー:${follows.length} — ずんだもん化中なのだ`,
  );
}

// --- NIP-07 なし: fallback relay のパブリックタイムライン ---
async function startPublic(rxNostr) {
  $boot.classList.add("hidden");
  $timeline.classList.remove("hidden");

  rxNostr.setDefaultRelays(FALLBACK_RELAYS);
  setStatus("NIP-07 が無いのでパブリックタイムラインを表示するのだ…");

  // 過去の kind:1 を backward で取得
  const history = await fetchEvents(rxNostr, { kinds: [1], limit: 100 });
  history.sort((a, b) => a.created_at - b.created_at);
  const pubkeys = dedupe(history.map((e) => e.pubkey));

  // 登場した pubkey のプロフィールをまとめて取得
  const metaEvents = await fetchEvents(rxNostr, { kinds: [0], authors: pubkeys });
  applyProfiles(metaEvents, pubkeys);

  for (const ev of history) renderPost(ev);
  $timeline.scrollTop = $timeline.scrollHeight;

  // 新着 kind:1 を forward で購読（未知 pubkey は遅延でプロフィール解決）
  const nowSec = Math.floor(Date.now() / 1000);
  const fwd = createRxForwardReq();
  rxNostr.use(fwd).subscribe({
    next: (packet) => {
      renderPost(packet.event);
      ensureProfile(rxNostr, packet.event.pubkey);
    },
  });
  fwd.emit({ kinds: [1], since: nowSec });

  setStatus("live ● public(fallback) — ずんだもん化中なのだ");
}

init();
