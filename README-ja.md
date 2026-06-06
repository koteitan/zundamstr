[English](README.md) | [Japanese](README-ja.md)

# zundamstr

**決定論的アルゴリズム**で全員の語尾がずんだもん（「〜のだ」）になる nostr クライアントなのだ。見た目はサイバーなターミナル風（Consolas / 黒背景 / 緑文字 / フラットデザイン）。

🔗 **デモ: https://koteitan.github.io/zundamstr/**

## できること

- **自動 NIP-07 ログイン。** 読み込み時に NIP-07 拡張へ自動接続するのだ。拡張が無ければ fallback relay のパブリックタイムラインを表示する。
- **リレー探索。** ログイン時は `kind:10002`(NIP-65) の read relay を使い、無ければ `kind:3` content のリレー、それも無ければ fallback relay を使うのだ。
- **フォロータイムライン。** `kind:3` のフォローリストを読み、フォロー相手の `kind:1` を表示する。
- **ずんだもん化。** 各投稿の文末を、純粋で決定論的な関数（AIも乱数も使わない）でずんだもん語尾に書き換えるのだ。

## リレー

- **Bootstrap:** `directory.yabu.me`, `purplepag.es`, `relay.nostr.band`, `indexer.coracle.social`
- **Fallback:** `yabu.me`, `r.kojira.io`

## 技術

- [rx-nostr](https://penpenpng.github.io/rx-nostr/) — `kind:1` は **forward** strategy（新着）、その他は **backward** strategy なのだ。
- CDN から読む素の ES module。ビルド不要。

## ファイル構成

- `index.html`
- `style.css`
- `main.js`

## ローカル実行

ES module ページなので `file://` ではなく HTTP で配信するのだ:

```sh
# 例
python3 -m http.server
```

配信された `index.html` を開くのだ。
