// tools/ng-report.mjs <wave> [--set main|holdout]
// <waves>/w<NN>/ng.txt を書き出す（改善エージェントに渡す読みやすいNG一覧）。
import fs from "node:fs";
import path from "node:path";
import { pickSet } from "./sets.mjs";

const set = pickSet(process.argv);
const wave = String(process.argv[2] ?? "1").padStart(2, "0");
const dir = path.join(set.waves, `w${wave}`);

const verdicts = JSON.parse(fs.readFileSync(path.join(dir, "verdicts.json"), "utf8"));
const output = JSON.parse(fs.readFileSync(path.join(dir, "output.json"), "utf8"));
const om = new Map(output.map((o) => [o.i, o]));
const esc = (s) => String(s ?? "").replace(/\n/g, "\\n");

const lines = [];
for (const v of verdicts.filter((x) => !x.ok)) {
  const d = om.get(v.i) || {};
  lines.push(`#${v.i} [${v.category}] ${v.reason}`);
  lines.push(`  SRC : ${esc(d.src)}`);
  lines.push(`  OUT : ${esc(d.out)}`);
  if (v.want) lines.push(`  WANT: ${esc(v.want)}`);
  lines.push("");
}
fs.writeFileSync(path.join(dir, "ng.txt"), lines.join("\n"));
console.log(`[${set.name}] ng.txt: ${verdicts.filter((x) => !x.ok).length} cases`);
