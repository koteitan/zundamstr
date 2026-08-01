// tools/ab.mjs [<baseline snapshot.js>]
//
// 承認版スナップショットと現在の zunda.js を、これまでに集めた全コーパス
// （tools/waves-*/w*/output.json の src 欄）で突き合わせて、出力が変わった件を
// 一覧にするのだ。件数だけでなく本文を出すので、1件ずつ改善／悪化を判定できるのだ。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zundamonize as cur } from "../zunda.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// 引数は位置で取らずに、旗（--で始まるもの）を除いた最初のものを基準版とするのだ。
// 位置で取ると `--pool` を単独で渡したときに旗をスナップショット名として食って
// 「そんなファイルは無い」と落ちるのだ
const basePath =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  path.join(here, "waves-r3test/w01/zunda.snapshot.js");
const { zundamonize: base } = await import(
  pathToFileURL(path.resolve(basePath)).href
);

const srcs = new Map(); // src -> where
for (const d of fs.readdirSync(here)) {
  if (!d.startsWith("waves")) continue;
  const p = path.join(here, d);
  if (!fs.statSync(p).isDirectory()) continue;
  for (const w of fs.readdirSync(p)) {
    const f = path.join(p, w, "output.json");
    if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, "utf8"))) {
      if (r.src != null && !srcs.has(r.src)) srcs.set(r.src, `${d}/${w}#${r.i}`);
    }
  }
}
// 審査に使っていないサンプル（プール）も突き合わせる。
// 発火したかどうかしか見ないので、ホールドアウトとしての価値は失われないのだ。
//
// ただし「これから盲目測定に使う測定セット」だけは除くのだ。
// A/B は変化した件の本文を全部標準出力に流すので、それを読んだエージェントは
// 測定セットを見てしまうのだ。過適合を止める規律は「同じデータを二度使わない」ことだけで、
// 出力に混ぜた時点でその一件は使ったことになるのだ。
// ファイル名で除いても足りないのだ。測定セットは元プールから切り出したものなので、
// 同じ本文が pool-*.json にも残っているからなのだ。id で除くのだ。
// 測定が済んだら BLIND_SETS から外してよいのだ
// r8test は測定が済んだ（版28で 88.6%）ので外したのだ。
// 次の盲目測定は r9test なのだ
const BLIND_SETS = ["samples-r10-test.json"];
// これから切り出す測定セットの元プールも丸ごと除くのだ。
// 測定セットがまだ作られていない段階では id で除くことができないので、
// ファイルごと見ないのが唯一の守り方なのだ。
// pool-2026-06-05.json は r9test（次の盲目測定）の元プールなのだ
const POOL_SKIP = new Set(["pool-2026-06-05.json"]);
const blindIds = new Set();
for (const f of BLIND_SETS) {
  const p = path.join(here, f);
  if (!fs.existsSync(p)) continue;
  for (const s of JSON.parse(fs.readFileSync(p, "utf8"))) blindIds.add(s.id);
}
if (process.argv.includes("--pool")) {
  for (const f of fs.readdirSync(here)) {
    if (!/^(?:samples|pool)[-.].*\.json$/.test(f)) continue;
    if (POOL_SKIP.has(f)) continue;
    const a = JSON.parse(fs.readFileSync(path.join(here, f), "utf8"));
    for (const r of Array.isArray(a) ? a : []) {
      if (blindIds.has(r.id)) continue;
      const t = r.content ?? r.src;
      if (typeof t === "string" && !srcs.has(t)) srcs.set(t, `${f}#${r.i ?? r.id}`);
    }
  }
}

const diffs = [];
for (const [src, where] of srcs) {
  const a = base(src);
  const b = cur(src);
  if (a !== b) diffs.push({ where, src, base: a, cur: b });
}
console.log(`コーパス ${srcs.size} 件中 ${diffs.length} 件で出力が変わったのだ\n`);
for (const d of diffs) {
  console.log(`--- ${d.where}`);
  console.log(`in   : ${d.src}`);
  console.log(`承認 : ${d.base}`);
  console.log(`現在 : ${d.cur}`);
}
