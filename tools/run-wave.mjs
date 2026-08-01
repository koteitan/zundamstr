// tools/run-wave.mjs <wave> [--set main|holdout]
// サンプル全件を現在の zunda.js にかけて <waves>/w<NN>/output.json を書き出す。
// 併せて、そのwave時点の zunda.js をスナップショットとして保存する。
import fs from "node:fs";
import path from "node:path";
import { zundamonize } from "../zunda.js";
import { pickSet, ROOT } from "./sets.mjs";

const set = pickSet(process.argv);
const wave = String(process.argv[2] ?? "1").padStart(2, "0");
const dir = path.join(set.waves, `w${wave}`);
fs.mkdirSync(dir, { recursive: true });

const samples = JSON.parse(fs.readFileSync(set.samples, "utf8"));

const items = samples.map((s) => ({
  i: s.i,
  src: s.content,
  out: zundamonize(s.content),
}));

fs.writeFileSync(
  path.join(dir, "output.json"),
  JSON.stringify(items, null, 2) + "\n",
);
fs.copyFileSync(path.join(ROOT, "zunda.js"), path.join(dir, "zunda.snapshot.js"));

// 人間/エージェントが読みやすいテキスト版も出す
const txt = items
  .map((it) => `#${it.i}\nSRC: ${it.src.replace(/\n/g, "\\n")}\nOUT: ${it.out.replace(/\n/g, "\\n")}`)
  .join("\n\n");
fs.writeFileSync(path.join(dir, "output.txt"), txt + "\n");

console.log(
  `[${set.name}] wave ${wave}: ${items.length} items -> ${path.relative(ROOT, dir)}`,
);
