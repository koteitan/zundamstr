// tools/regress.mjs
//
// これまで審査したすべてのセットについて、現在の zunda.js の出力が
// 「自然と判定された件」を壊していないかを一括で確認する。
// エージェント不要・決定論的なので毎回タダで回せるのだ。
//
// 使い方:
//   node tools/regress.mjs            # 壊した件を一覧表示、壊していれば exit 1
//   node tools/regress.mjs --snapshot # 現在の出力を基準として保存し直す（改善を承認したとき）
import fs from "node:fs";
import path from "node:path";
import { zundamonize } from "../zunda.js";
import { SETS, ROOT } from "./sets.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const basePath = path.join(here, "regress-baseline.json");
const snapshot = process.argv.includes("--snapshot");

// 審査済み（verdicts.json を持つ最新 wave がある）セットを集める
function judgedSets() {
  const out = [];
  for (const [name, s] of Object.entries(SETS)) {
    if (!fs.existsSync(s.waves) || !fs.existsSync(s.samples)) continue;
    const waves = fs
      .readdirSync(s.waves)
      .filter((d) => /^w\d+$/.test(d))
      .sort()
      .filter((d) => fs.existsSync(path.join(s.waves, d, "verdicts.json")));
    if (!waves.length) continue;
    const last = waves[waves.length - 1];
    out.push({
      name,
      samples: JSON.parse(fs.readFileSync(s.samples, "utf8")),
      verdicts: JSON.parse(
        fs.readFileSync(path.join(s.waves, last, "verdicts.json"), "utf8"),
      ),
    });
  }
  return out;
}

// 「最後の審査で自然と判定された件」だけを基準に取る。
// NG だった件は変わってよい（むしろ変わってほしい）のだ。
function build() {
  const base = {};
  for (const set of judgedSets()) {
    const ok = new Set(set.verdicts.filter((v) => v.ok).map((v) => v.i));
    base[set.name] = {};
    for (const s of set.samples) {
      if (ok.has(s.i)) base[set.name][s.i] = zundamonize(s.content);
    }
  }
  return base;
}

if (snapshot || !fs.existsSync(basePath)) {
  const base = build();
  fs.writeFileSync(basePath, JSON.stringify(base, null, 2) + "\n");
  const n = Object.values(base).reduce((a, o) => a + Object.keys(o).length, 0);
  console.log(
    `基準を保存したのだ: ${Object.keys(base).length} セット / ${n} 件`,
  );
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
let total = 0;
let broke = 0;
for (const set of judgedSets()) {
  const b = base[set.name];
  if (!b) continue;
  const byIndex = new Map(set.samples.map((s) => [s.i, s]));
  for (const [i, want] of Object.entries(b)) {
    const s = byIndex.get(Number(i));
    if (!s) continue;
    total++;
    const got = zundamonize(s.content);
    if (got === want) continue;
    broke++;
    console.log(`${set.name}#${i}`);
    console.log(`  OLD: ${want.replace(/\n/g, "\\n").slice(0, 140)}`);
    console.log(`  NEW: ${got.replace(/\n/g, "\\n").slice(0, 140)}`);
  }
}
console.log(
  `\n累積回帰コーパス: ${total} 件を検査 / 変化 ${broke} 件` +
    (broke ? "  ← 中身を見て、改善なら --snapshot で承認するのだ" : "  ✓ 回帰なし"),
);
process.exit(broke ? 1 : 0);
