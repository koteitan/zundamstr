// tools/score.mjs <wave> [--set main|holdout]
// <waves>/w<NN>/verdicts.json（審査エージェントの出力）を集計して
//   - <waves>/w<NN>/summary.json
//   - <history>.json（そのセットの全wave分）
//   - test.html（両セットを載せた1枚。データ埋め込み）
// を更新する。
import fs from "node:fs";
import path from "node:path";
import { pickSet, SETS, ROOT } from "./sets.mjs";

const set = pickSet(process.argv);
const wave = String(process.argv[2] ?? "1").padStart(2, "0");
const dir = path.join(set.waves, `w${wave}`);

const verdicts = JSON.parse(
  fs.readFileSync(path.join(dir, "verdicts.json"), "utf8"),
);
const output = JSON.parse(fs.readFileSync(path.join(dir, "output.json"), "utf8"));

// 重複審査は後勝ちで1件に畳む
const byIndex = new Map();
for (const v of verdicts) byIndex.set(v.i, v);

const missing = output.filter((o) => !byIndex.has(o.i)).map((o) => o.i);
if (missing.length) {
  console.error(`WARN: 未審査 ${missing.length} 件: ${missing.slice(0, 20).join(",")}…`);
}

const judged = [...byIndex.values()];
const ok = judged.filter((v) => v.ok).length;
const ng = judged.filter((v) => !v.ok);
const rate = judged.length ? ok / judged.length : 0;

// NG の原因カテゴリを集計
const cats = {};
for (const v of ng) {
  const c = v.category || "other";
  cats[c] = (cats[c] || 0) + 1;
}

const summary = {
  wave: Number(wave),
  total: output.length,
  judged: judged.length,
  ok,
  ng: ng.length,
  rate: Number((rate * 100).toFixed(1)),
  categories: cats,
  ngIndexes: ng.map((v) => v.i).sort((a, b) => a - b),
};
fs.writeFileSync(
  path.join(dir, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);

// このセットの history を作り直す
writeHistory(set);

// test.html は全セットぶんのデータを埋め込んで生成する
const payload = {};
for (const [name, s] of Object.entries(SETS)) {
  payload[name] = {
    label: s.label,
    versionOffset: s.versionOffset ?? 0,
    history: readHistory(s),
    waves: waveDetails(s),
  };
}
const tpl = fs.readFileSync(path.join(ROOT, "tools", "test.template.html"), "utf8");
fs.writeFileSync(
  path.join(ROOT, "test.html"),
  tpl.replace("/*__DATA__*/null", JSON.stringify(payload, null, 2)),
);

function writeHistory(s) {
  if (!fs.existsSync(s.waves)) return;
  const history = fs
    .readdirSync(s.waves)
    .filter((d) => /^w\d+$/.test(d))
    .sort()
    .map((d) => path.join(s.waves, d, "summary.json"))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
  fs.writeFileSync(s.history, JSON.stringify(history, null, 2) + "\n");
}

function readHistory(s) {
  return fs.existsSync(s.history)
    ? JSON.parse(fs.readFileSync(s.history, "utf8"))
    : [];
}

function waveDetails(s) {
  const out = {};
  for (const h of readHistory(s)) {
    const w = String(h.wave).padStart(2, "0");
    const d = path.join(s.waves, `w${w}`);
    const vp = path.join(d, "verdicts.json");
    const op = path.join(d, "output.json");
    if (!fs.existsSync(vp) || !fs.existsSync(op)) continue;
    const vs = JSON.parse(fs.readFileSync(vp, "utf8"));
    const os = JSON.parse(fs.readFileSync(op, "utf8"));
    const om = new Map(os.map((o) => [o.i, o]));
    out[h.wave] = vs
      .filter((v) => !v.ok)
      .map((v) => ({
        i: v.i,
        src: om.get(v.i)?.src ?? "",
        out: om.get(v.i)?.out ?? "",
        category: v.category || "other",
        reason: v.reason || "",
        want: v.want || "",
      }));
  }
  return out;
}

console.log(
  `[${set.name}] wave ${summary.wave}: ok ${ok}/${judged.length} = ${summary.rate}%`,
);
console.log("categories:", cats);
