// tools/fetch.mjs — リレーから kind:1 を集めて評価用サンプルを作る
//
//   node tools/fetch.mjs --until 2026-06-30T23:59:59Z --target 1000 \
//                        --out tools/samples-2026-06.json
//
// リレーの相場（~/code/nostr-research/、2026-06-26 時点）:
//   yabu.me = strfry 1.0.4 / max_limit 500 / max_subscriptions 50
//   strfry はデフォルトでレート制限を設定していない。`limit` はレート制限ではなく
//   「1 REQ あたり min(client_limit, 500) 件返す」という結果件数の上限なのだ。
// なので REQ_LIMIT は 500 が上限。それ以上を要求しても 500 しか返らない。
// 運営者が設定を変えている場合に備えて、REQ の間に SLEEP_MS の間隔を空ける。
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const REQ_LIMIT = 500; // strfry の max_limit。これ以上要求しても増えない
const SLEEP_MS = 1500; // REQ 間の間隔（相手が設定変更している場合の保険）
const MAX_REQS = 40; // 暴走よけ

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const relay = arg("relay", "wss://yabu.me");
const target = Number(arg("target", "1000"));
const out = arg("out", "tools/samples.json");
const untilStr = arg("until", null);
let until = untilStr
  ? Math.floor(new Date(untilStr).getTime() / 1000)
  : Math.floor(Date.now() / 1000);
if (!Number.isFinite(until)) throw new Error(`bad --until: ${untilStr}`);

// 評価サンプルとして使えるか（日本語を含み、URL だけでなく、長すぎない）
function usable(content) {
  const c = content.trim();
  if (!c) return false;
  if (!/[ぁ-んァ-ン一-龯]/u.test(c)) return false;
  if (c.replace(/https?:\/\/\S+/g, "").trim().length < 4) return false;
  if (c.length > 400) return false;
  return true;
}

const seenId = new Set();
const seenContent = new Set();
const samples = [];
let rawTotal = 0;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (let req = 0; req < MAX_REQS && samples.length < target; req++) {
  const iso = new Date(until * 1000).toISOString();
  process.stdout.write(
    `REQ ${req + 1}: until=${until} (${iso}) limit=${REQ_LIMIT} … `,
  );

  let stdout;
  try {
    stdout = execFileSync(
      "nak",
      ["req", "-k", "1", "-l", String(REQ_LIMIT), "--until", String(until), relay],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (e) {
    console.log(`FAILED (${e.message.split("\n")[0]})`);
    break;
  }

  const lines = stdout.split("\n").filter(Boolean);
  let fresh = 0;
  let oldest = until;
  for (const l of lines) {
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e.kind !== 1) continue;
    if (seenId.has(e.id)) continue;
    seenId.add(e.id);
    fresh++;
    rawTotal++;
    if (e.created_at < oldest) oldest = e.created_at;

    const c = e.content.trim();
    if (!usable(c) || seenContent.has(c)) continue;
    seenContent.add(c);
    if (samples.length < target) {
      samples.push({
        i: samples.length,
        id: e.id,
        pubkey: e.pubkey,
        created_at: e.created_at,
        content: c,
      });
    }
  }

  console.log(
    `${lines.length} events / ${fresh} new / samples ${samples.length}/${target}`,
  );

  if (fresh === 0) {
    console.log("これ以上さかのぼれないのだ（新着ゼロ）");
    break;
  }
  // 同じ created_at が並んでいても進むように 1 秒引く
  until = oldest - 1;
  if (samples.length < target) sleep(SLEEP_MS);
}

fs.writeFileSync(out, JSON.stringify(samples, null, 2) + "\n");
const span = samples.length
  ? `${new Date(samples[samples.length - 1].created_at * 1000).toISOString()} 〜 ${new Date(samples[0].created_at * 1000).toISOString()}`
  : "-";
console.log(`\n${out}: ${samples.length} samples（生イベント ${rawTotal} 件から）`);
console.log(`期間: ${span}`);
