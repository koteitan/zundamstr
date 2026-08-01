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
// 訓練/測定の件数。既定は 250/250 なのだ。
// 測定側だけ増やせるのは、この指標のノイズが標本サイズで決まるからなのだ。
// 250件だと 95%信頼区間が ±4.5pt もあって、84% と 89% を区別できないのだ
// （実際 r3test の 89.2% は当たりを引いただけで、次の r4test は 84.0% だったのだ）。
// 500件なら ±3.2pt、750件なら ±2.6pt まで縮むのだ
const argN = (flag, dflt) =>
  argv.includes(flag) ? Number(argv[argv.indexOf(flag) + 1]) : dflt;
const N_TRAIN = argN("--train", 250);
const N_TEST = argN("--test", 250);
const N_TOTAL = N_TRAIN + N_TEST;

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
if (fresh.length < N_TOTAL) {
  throw new Error(
    `プールの残りが足りないのだ: ${fresh.length} 件（${N_TOTAL} 件必要）。` +
      `tools/fetch.mjs で追加取得するのだ`,
  );
}

// 時間帯が偏らないよう等間隔で N_TOTAL 件取り、train と test に振り分ける。
// 振り分けも交互（比に応じた等間隔）にして、両者が同じ時間帯を等しく含むようにするのだ
const step = Math.floor(fresh.length / N_TOTAL);
const picked = [];
for (let k = 0; picked.length < N_TOTAL && k < fresh.length; k += step) {
  picked.push(fresh[k]);
}

const train = [];
const test = [];
picked.forEach((s, k) => {
  // k 件目までに train が占めるべき割合を超えていなければ train へ
  const wantTrain = Math.round(((k + 1) * N_TRAIN) / N_TOTAL);
  (train.length < wantTrain ? train : test).push(s);
});

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
