// tools/merge-verdicts.mjs <wave> [--set main|holdout]
// <waves>/w<NN>/verdicts-*.json（審査エージェントの分割出力）を1本に連結する。
import fs from "node:fs";
import path from "node:path";
import { pickSet } from "./sets.mjs";

const set = pickSet(process.argv);
const wave = String(process.argv[2] ?? "1").padStart(2, "0");
const dir = path.join(set.waves, `w${wave}`);

const parts = fs
  .readdirSync(dir)
  .filter((f) => /^verdicts-.+\.json$/.test(f))
  .sort();

const all = new Map();
for (const f of parts) {
  const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const v of arr) all.set(v.i, v);
  console.log(`  ${f}: ${arr.length}`);
}

const merged = [...all.values()].sort((a, b) => a.i - b.i);
fs.writeFileSync(
  path.join(dir, "verdicts.json"),
  JSON.stringify(merged, null, 2) + "\n",
);
console.log(`merged ${merged.length} verdicts from ${parts.length} parts`);
