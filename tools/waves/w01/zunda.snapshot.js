// ---------------------------------------------------------------------------
// zundamon transform (deterministic) — shared by main.js and tools/*
// ---------------------------------------------------------------------------
// 文末を機械的にずんだもん語尾へ変換する純粋関数。
// 上から順に最初にマッチした語尾だけを置換する（順序が重要）。
const ZUNDA_RULES = [
  // 疑問
  [/ですか$/, "なのだ？"],
  [/ますか$/, "のだ？"],
  [/でしょうか$/, "なのだ？"],
  [/だろうか$/, "なのだ？"],
  [/のか$/, "のだ？"],
  [/かな$/, "のだ？"],
  [/かい$/, "のだ？"],
  // 丁寧・助動詞
  [/でした$/, "だったのだ"],
  [/ましたか$/, "たのだ？"],
  [/ました$/, "たのだ"],
  [/ませんか$/, "ないのだ？"],
  [/ません$/, "ないのだ"],
  [/ましょう$/, "するのだ"],
  [/ます$/, "のだ"],
  [/でしょうね$/, "なのだ"],
  [/でしょう$/, "なのだ"],
  [/でしょ$/, "なのだ"],
  [/です$/, "なのだ"],
  [/ください$/, "てほしいのだ"],
  // んだ / のだ / なの 系
  [/んです$/, "のだ"],
  [/んだ$/, "のだ"],
  [/なのだ$/, "なのだ"], // 既にずんだもん
  [/のだ$/, "のだ"],
  [/なの$/, "なのだ"],
  // 口語の断定・語尾（だ を含むので安全に置換できる）
  [/じゃない$/, "ないのだ"],
  [/じゃん$/, "のだ"],
  [/だった$/, "だったのだ"],
  [/だろう$/, "なのだ"],
  [/である$/, "なのだ"],
  [/だよね$/, "なのだ"],
  [/だよ$/, "なのだ"],
  [/だね$/, "なのだ"],
  [/だな$/, "なのだ"],
  [/だぜ$/, "なのだ"],
  [/だぞ$/, "なのだ"],
  [/だわ$/, "なのだ"],
  [/だもん$/, "なのだ"],
  [/だ$/, "なのだ"],
];

// 末尾の装飾（笑い・ラテン文字・数字・記号・絵文字・空白）を分離する
const DECOR_TAIL = /[\s\p{P}\p{S}\p{M}\p{Cf}A-Za-z0-9ｗ笑草]+$/u;
// URL を退避する不可視マーカー（WORD JOINER）
const URL_MARK = "⁠";

function zundaSentence(raw) {
  // 末尾の装飾を切り離してから語尾を変換し、装飾を戻す
  const m = raw.match(DECOR_TAIL);
  const decor = m ? m[0] : "";
  const core = decor ? raw.slice(0, raw.length - decor.length) : raw;
  if (!core) return raw; // 日本語コンテンツが無い行はそのまま

  for (const [re, rep] of ZUNDA_RULES) {
    if (re.test(core)) return core.replace(re, rep) + decor;
  }
  // ルール非該当時は末尾の文字種で出し分ける
  if (/[ぁ-ゖ]$/u.test(core)) return core + "のだ" + decor; // 仮名（活用語）
  if (/[一-龯々ァ-ヺーゝゞ]$/u.test(core)) return core + "なのだ" + decor; // 漢字・カタカナ（体言）
  return core + decor; // それ以外はそのまま
}

function zundamonize(text) {
  // URL は変換から保護する
  const urls = [];
  const masked = text.replace(/https?:\/\/\S+/g, (m) => {
    urls.push(m);
    return URL_MARK + (urls.length - 1) + URL_MARK;
  });

  // 文単位で分割（句読点・改行を区切りとして保持）し、各文を全部変換する
  const parts = masked.split(/(\n|。|！|!|？|\?)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const delim = parts[i + 1] ?? "";
    if (body.trim() === "") {
      out += body + delim;
      continue;
    }
    out += zundaSentence(body) + delim;
  }

  // URL を復元
  return out.replace(
    new RegExp(URL_MARK + "(\\d+)" + URL_MARK, "g"),
    (_, i) => urls[Number(i)],
  );
}

export { zundamonize, zundaSentence, ZUNDA_RULES };
