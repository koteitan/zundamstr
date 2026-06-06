[English](README.md) | [Japanese](README-ja.md)

# zundamstr

A nostr client where everyone's speech endings become Zundamon-style ("〜のだ") via a **deterministic algorithm**. Cyber-terminal look: Consolas font, black background, green text, flat design.

🔗 **Live demo: https://koteitan.github.io/zundamstr/**

## What it does

- **Auto NIP-07 login.** On load it connects to your NIP-07 extension automatically. If no extension is found, it falls back to a public timeline from the fallback relays.
- **Relay discovery.** For a logged-in user it reads relays from `kind:10002` (NIP-65); if absent, from the relays in `kind:3` content; if still absent, from the fallback relays.
- **Follow timeline.** It reads the `kind:3` follow list and shows `kind:1` notes from the people you follow.
- **Zundamonize.** Every note's sentence endings are rewritten to Zundamon speech by a pure, deterministic function (no AI, no randomness).

## Relays

- **Bootstrap:** `directory.yabu.me`, `purplepag.es`, `relay.nostr.band`, `indexer.coracle.social`
- **Fallback:** `yabu.me`, `r.kojira.io`

## Tech

- [rx-nostr](https://penpenpng.github.io/rx-nostr/) — `kind:1` uses the **forward** strategy (live), everything else uses the **backward** strategy.
- Plain ES modules loaded from a CDN. No build step.

## Files

- `index.html`
- `style.css`
- `main.js`

## Run locally

It is an ES-module page, so serve it over HTTP (not `file://`):

```sh
# example
python3 -m http.server
```

Then open the served `index.html`.
