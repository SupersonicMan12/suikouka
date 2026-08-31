# 随口咖 · 说一句，给你三家

Voice-first café discovery for people living in Shanghai. Open the page, say your
occasion and demands in one sentence (中文 or English) — the three best-fitting
cafés near you present themselves as an auto-advancing, narrated slide deck.
No browsing, no lists, (almost) no touching.

Sister project of the [Shanghai Coffee Atlas](https://github.com/SupersonicMan12/shanghai-coffee-atlas),
whose 553-café dataset and five-axis fit engine (focus / energy / linger /
adventure / spend) power the recommendations.

## How it works

```
one tap (mic + location permission)
  → browser speech recognition (zh-CN / en-US)
  → intent parsing: Qwen (阿里云百炼) via a tiny relay, with an
    on-device rules fallback so the app works with zero network AI
  → five-axis fit ranking × proximity decay, open-now aware
  → top-3 presentation deck, narrated by browser speechSynthesis
  → say 「换一批」/ "more" for the next round
```

The DashScope API key never ships to the browser: `tools/relay-worker.js` is a
Cloudflare Worker that holds the key server-side; the frontend only knows the
relay URL (`VITE_INTENT_RELAY`). Without a relay configured the app runs
entirely on-device.

Deep link: append `?q=想找个安静的地方工作` to run a spoken-style query without
the microphone (also handy on desktop).

## Develop

```bash
npm install
npm run dev      # local dev server
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

## Deploy the relay (optional, enables Qwen parsing)

```bash
wrangler deploy tools/relay-worker.js --name suikouka-relay
wrangler secret put DASHSCOPE_API_KEY
# then build the frontend with VITE_INTENT_RELAY=https://<worker-url>
```

## Caveats

- Browser speech recognition availability varies by device/browser; mainland
  Android Chrome may not support it. The roadmap swap is DashScope Paraformer
  for recognition and CosyVoice for narration through the same relay.
- Dataset and scoring are snapshots from the Atlas; see its `?` methodology
  page for how the axes are derived.

Live: https://supersonicman12.github.io/suikouka/
