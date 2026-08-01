// tools/round.mjs <round> [--pool <file>]
//
// ラウンド r の訓練用250件と測定用250件を、プールから「まだ使っていない」件だけ切り出す。
//   tools/samples-r<N>-train.json
//   tools/samples-r<N>-test.json
//
// 過適合を止めるための唯一の規律は「同じデータを二度使わない」ことなのだ。
// 使用済み id は tools/used-ids.json に積む。ここに載った id は二度と出てこない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const round = Number(argv[0] ?? 1);
const poolPath = argv.includes("--pool")
  ? argv[argv.indexOf("--pool") + 1]
  : path.join(here, "pool-2026-06-25.json");
const N = 250;

const usedPath = path.join(here, "used-ids.json");
const used = new Set(
  fs.existsSync(usedPath) ? JSON.parse(fs.readFileSync(usedPath, "utf8")) : [],
);

// 既存のサンプルセットも使用済みとして登録する（初回のみ効く）
for (const f of ["samples.json", "samples-wide.json", "samples-final.json"]) {
  const p = path.join(here, f);
  if (!fs.existsSync(p)) continue;
  for (const s of JSON.parse(fs.readFileSync(p, "utf8"))) used.add(s.id);
}

const pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
const fresh = pool.filter((s) => !used.has(s.id));
if (fresh.length < N * 2) {
  throw new Error(
    `プールの残りが足りないのだ: ${fresh.length} 件（${N * 2} 件必要）。` +
      `tools/fetch.mjs で追加取得するのだ`,
  );
}

// 時間帯が偏らないよう等間隔で 2N 件取り、交互に train / test へ振る
const step = Math.floor(fresh.length / (N * 2));
const picked = [];
for (let k = 0; picked.length < N * 2 && k < fresh.length; k += step) {
  picked.push(fresh[k]);
}

const train = [];
const test = [];
picked.forEach((s, k) => (k % 2 === 0 ? train : test).push(s));

const write = (kind, arr) => {
  const p = path.join(here, `samples-r${round}-${kind}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify(arr.map((s, i) => ({ ...s, i })), null, 2) + "\n",
  );
  return p;
};

write("train", train);
write("test", test);
for (const s of picked) used.add(s.id);
fs.writeFileSync(usedPath, JSON.stringify([...used], null, 2) + "\n");

const span = (arr) => {
  const t = arr.map((s) => s.created_at);
  return `${new Date(Math.min(...t) * 1000).toISOString().slice(0, 16)} 〜 ${new Date(Math.max(...t) * 1000).toISOString().slice(0, 16)}`;
};
console.log(`round ${round}:`);
console.log(`  train ${train.length}件  ${span(train)}`);
console.log(`  test  ${test.length}件  ${span(test)}`);
console.log(`  プール残り: ${fresh.length - picked.length} 件 / 使用済み累計 ${used.size} 件`);
