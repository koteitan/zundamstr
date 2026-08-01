// tools/firerate.mjs <baseline-snapshot.js>
//
// 「一般規則のふりをした事例特化」を、エージェント無しで検出するのだ。
//
// 原理: 本当に一般的な規則なら、訓練データ以外の大量のテキストでも同じ割合で発火するはずなのだ。
// 訓練データでだけ発火して他では一度も発火しない規則は、1件から逆算して当てただけなのだ。
//
// 使い方:
//   node tools/firerate.mjs tools/waves-r1train/w01/zunda.snapshot.js
//
// 出力:
//   訓練セットの変化率 と 大量プールの変化率 を比べる。
//   プール側の変化率が訓練側より極端に低ければ、事例特化を疑うのだ。
//
// 注意: プールは「発火したかどうか」しか見ないので、正誤の情報は一切漏れないのだ。
// ホールドアウトとしての価値は失われないのだ。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zundamonize as current } from "../zunda.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basePath = process.argv[2];
if (!basePath) throw new Error("使い方: node tools/firerate.mjs <baseline snapshot.js>");

const { zundamonize: base } = await import(pathToFileURL(path.resolve(basePath)).href);

// 訓練に使ったセットと、まだ判定に使っていない大量プールを読む
const load = (f) => {
  const p = path.join(here, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
};

const trainFile = process.argv[3] ?? "samples-r1-train.json";
const train = load(trainFile);

// プール = 訓練に使っていない全サンプル
const usedIds = new Set(train.map((s) => s.id));
const pool = [];
for (const f of fs.readdirSync(here)) {
  if (!/^(pool-|samples-)/.test(f) || !f.endsWith(".json")) continue;
  if (f === trainFile) continue;
  for (const s of load(f)) {
    if (!usedIds.has(s.id)) {
      usedIds.add(s.id);
      pool.push(s);
    }
  }
}

function rate(items, label) {
  let changed = 0;
  let lessNoda = 0;
  const examples = [];
  for (const s of items) {
    const a = base(s.content);
    const b = current(s.content);
    if (a === b) continue;
    changed++;
    const na = (a.match(/のだ/g) || []).length;
    const nb = (b.match(/のだ/g) || []).length;
    if (nb < na) lessNoda++;
    if (examples.length < 6) examples.push({ a, b });
  }
  const pct = items.length ? (changed / items.length) * 100 : 0;
  console.log(
    `${label}: ${changed}/${items.length} 件が変化 (${pct.toFixed(2)}%)` +
      `  うち「のだ」が減った件: ${lessNoda}`,
  );
  return { changed, total: items.length, pct, lessNoda, examples };
}

console.log("=== 発火率チェック ===");
const t = rate(train, "訓練セット  ");
const p = rate(pool, "未使用プール");

console.log();
if (p.total === 0) {
  console.log("プールが空なのだ。判定できないのだ");
} else if (p.pct === 0 && t.pct > 0) {
  console.log(
    "✕ 事例特化なのだ: 訓練セットでしか発火していないのだ。" +
      "この変更は一般規則ではないのだ",
  );
} else {
  const ratio = p.pct / t.pct;
  const verdict =
    ratio >= 0.5 ? "○ 一般的なのだ" : ratio >= 0.2 ? "△ やや訓練寄りなのだ" : "✕ 事例特化を疑うのだ";
  console.log(
    `発火率比（プール/訓練）= ${ratio.toFixed(2)}   ${verdict}`,
  );
  console.log("  目安: 0.5以上=一般 / 0.2〜0.5=要注意 / 0.2未満=事例特化");
}

if (t.lessNoda) {
  console.log(
    `\n⚠ 訓練セットの変化 ${t.changed} 件のうち ${t.lessNoda} 件は「のだ」が減っているのだ。` +
      `\n  審査基準では「無変換＝OK」なので、変換をやめるだけで点が上がってしまうのだ。` +
      `\n  品質を上げずに得点だけ上げていないか、中身を確認するのだ`,
  );
}

if (p.examples.length) {
  console.log("\n--- プールで変化した例 ---");
  for (const e of p.examples) {
    console.log(` OLD: ${e.a.replace(/\n/g, "\\n").slice(0, 90)}`);
    console.log(` NEW: ${e.b.replace(/\n/g, "\\n").slice(0, 90)}\n`);
  }
}
