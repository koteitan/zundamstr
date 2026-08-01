// tools/grammar.mjs [--baseline]
//
// 日本語の活用表そのものを叩く合成テストなのだ。
//
// なぜ要るか: 実データの回帰コーパスは、そこに出てこない現象を検出できないのだ。
// 実際 2942件のコーパスに『できません』は0件、『〜ていません』も0件で、
// 「回帰0件」と出ていたのに補助動詞の否定が全滅していたのだ。
// 活用は生産的（無限に語が作れる）なので、表を直接テストするしかないのだ。
//
// 使い方:
//   node tools/grammar.mjs             # 合否を表示。baseline より悪化したら exit 1
//   node tools/grammar.mjs --baseline  # 現在の合否を基準として保存
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zundamonize } from "../zunda.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(
  fs.readFileSync(path.join(here, "grammar-cases.json"), "utf8"),
);
const basePath = path.join(here, "grammar-baseline.json");

const results = cases.map((c) => {
  const got = zundamonize(c.in);
  return { ...c, got, pass: got === c.expect };
});

const pass = results.filter((r) => r.pass);
const fail = results.filter((r) => !r.pass);

// ★ 基準の書き換えは意図的に封じてあるのだ。
// 改善する側が自分で基準を書き換えられるなら、退行検査は自己参照になって意味を失うのだ
// （実際それが起きたのだ: 82/82 と自称して基準も 82 で上書きし、
//  「基準比 ±0」を根拠に安全だと報告してきたのだ）。
// 基準はレビューを通った版からのみ、人が明示的に更新するのだ。
if (process.argv.includes("--baseline")) {
  console.error(
    "基準の更新は封じてあるのだ。\n" +
      "自分で基準を書き換えたら退行検査にならないのだ。\n" +
      "更新が必要なら、承認された版のスナップショットから作り直すのだ:\n" +
      "  node -e 'const fs=require(\"fs\");const{cases}=JSON.parse(fs.readFileSync(\"tools/grammar-cases.json\",\"utf8\"));\n" +
      "  import(\"<承認版のsnapshot.js>\").then(({zundamonize:z})=>fs.writeFileSync(\n" +
      "    \"tools/grammar-baseline.json\",JSON.stringify(cases.filter(c=>z(c.in)===c.expect).map(c=>c.in),null,2)))'",
  );
  process.exit(2);
}

// グループごとに集計
const byGroup = {};
for (const r of results) {
  (byGroup[r.g] ??= []).push(r);
}
console.log("=== 活用テスト ===");
for (const [g, rs] of Object.entries(byGroup)) {
  const n = rs.filter((r) => r.pass).length;
  const mark = n === rs.length ? "✓" : "✕";
  console.log(`${mark} ${g}: ${n}/${rs.length}`);
}
console.log(`\n合計: ${pass.length}/${results.length} 件が合格`);

if (fail.length) {
  console.log("\n--- 不合格 ---");
  for (const r of fail) {
    console.log(`[${r.g}] ${JSON.stringify(r.in)}`);
    console.log(`  期待: ${JSON.stringify(r.expect)}`);
    console.log(`  実際: ${JSON.stringify(r.got)}${r.note ? `   （${r.note}）` : ""}`);
    if (r.known) console.log(`  ⓘ ${r.known}`);
  }
}

// baseline と比べて「前は通っていたのに落ちた」件を検出する
if (fs.existsSync(basePath)) {
  const base = new Set(JSON.parse(fs.readFileSync(basePath, "utf8")));
  // known（決着不能）を付けたケースは退行判定から外すのだ。
  // 言語的にどちらに倒しても必ず穴が開くもので、期待損の小さい側を選んだ記録なのだ
  const broke = fail.filter((r) => base.has(r.in) && !r.known);
  const gained = pass.filter((r) => !base.has(r.in));
  console.log(
    `\n基準比: 新たに合格 +${gained.length} / 落ちた -${broke.length}`,
  );
  if (gained.length) console.log(`  ↑ ${gained.map((r) => r.in).join(", ")}`);
  if (broke.length) {
    console.log(`  ↓ ${broke.map((r) => r.in).join(", ")}`);
    console.log("\n✕ 前は通っていた活用を壊しているのだ。このルールは入れてはいけないのだ");
    process.exit(1);
  }
}
console.log("\n✓ 活用の退行なしなのだ");
