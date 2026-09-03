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

## 忙闲预估怎么算

页面上的「预估·空 / 适中 / 挤」不是实时客流。它按星期几、当前小时和门店类型套用一条经验曲线：商场店在周末 13–17 点、工作日午间更忙；适合办公的店在工作日 9–11 点和 14–17 点更忙；社区店在周末 10–12 点及 14–17 点更忙。高峰前后的一小时会线性渐变，其余时段使用较低基线。

曲线会按点评图片或评价数量（没有时用高德评分）估算的人气修正，再按座位数修正容量：小店更容易挤、大店更能容纳客人。若当前不在营业时间，页面不显示预估。所有结果都是模型推断，绝不冒充实时数据。

Live: https://supersonicman12.github.io/suikouka/
