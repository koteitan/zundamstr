// tools/sets.mjs — 評価サンプルセットの定義
//
// main    : 最初のチューニングに使った100件（2026-07-30）。wave 1..5。
// wide    : 別期間の250件（2026-06-30）。wave 1 は main で調整した規則を
//           一度も見ずに測った「素の実力」＝72%。wave 2 以降はこちらを対象に改善する。
// final   : まだ一度も審査に使っていない750件（2026-06-30 の残り）。
//           過適合の最終判定用に温存する。使うのは最後の1回だけなのだ。
//
// 各スクリプトは `--set <name>` で切り替える（省略時は main）。
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// versionOffset: グラフの横軸は wave 番号ではなく「zunda.js のルール版」なのだ。
// ルール版 = wave + versionOffset。
// main の wave5 と wide の wave1 は同じルール（版5）を別データで測ったものなので、
// この対応を付けないと 99% と 72% が別の x に並んで比較できないのだ。
export const SETS = {
  main: {
    samples: path.join(here, "samples.json"),
    waves: path.join(here, "waves"),
    history: path.join(here, "history.json"),
    label: "初期チューニング 100件（07-30）",
    versionOffset: 0, // wave1..5 → 版1..5
  },
  wide: {
    samples: path.join(here, "samples-wide.json"),
    waves: path.join(here, "waves-wide"),
    history: path.join(here, "history-wide.json"),
    label: "広域 250件（06-30）",
    versionOffset: 4, // wave1 → 版5（main wave5 と同じルール）
  },
  final: {
    samples: path.join(here, "samples-final.json"),
    waves: path.join(here, "waves-final"),
    history: path.join(here, "history-final.json"),
    label: "最終ホールドアウト 250件（06-30・未使用）",
    versionOffset: 4,
  },
  // --- ラウンド制の訓練/測定セット（毎ラウンド新規データ） ---
  // r<N>train でチューニングし、r<N>test で測る。test の結果は改善側に渡さないのだ。
  ...Object.fromEntries(
    [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].flatMap((r) => [
      [`r${r}train`, {
        samples: path.join(here, `samples-r${r}-train.json`),
        waves: path.join(here, `waves-r${r}train`),
        history: path.join(here, `history-r${r}train.json`),
        label: `R${r} 訓練 250件`,
        versionOffset: 12 + (r - 1) * 2,
      }],
      [`r${r}test`, {
        samples: path.join(here, `samples-r${r}-test.json`),
        waves: path.join(here, `waves-r${r}test`),
        history: path.join(here, `history-r${r}test.json`),
        // 件数はセットごとに違うのだ。R5 から測定側を 500件に増やしたのだ——
        // 250件では 95%信頼区間が ±4.5pt もあって、84% と 89% を区別できないからなのだ
        label: `R${r} 測定（未使用）`,
        versionOffset: 13 + (r - 1) * 2,
      }],
    ]),
  ),
};

// argv から --set を読んでセット定義を返す
export function pickSet(argv) {
  const i = argv.indexOf("--set");
  const name = i >= 0 ? argv[i + 1] : "main";
  const s = SETS[name];
  if (!s) throw new Error(`unknown --set: ${name}（${Object.keys(SETS)} のどれか）`);
  return { name, ...s };
}

export const ROOT = path.join(here, "..");
