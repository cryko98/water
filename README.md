# Watercoin — $WATER

Chapter two from the Foodcoin team. Foodcoin (still running) has sent $70,000+ to feed hungry families; $WATER routes creator rewards,
on-chain through donate.gg, to **WaterAid America** (clean water, toilets and hygiene).

- Site: `index.html`, `styles.css`, `main.js` (interactions, scroll scenes, wave engine), `water.js` (WebGL water hero),
  `meter.js` (Reservoir client). Assets in `assets/` (logo, favicons, self-hosted GSAP/ScrollTrigger/Lenis).
- API: `api/meter.js`, a Vercel serverless function (core logic in `api/_lib/meter-core.js`).
- Palette from the logo: cobalt `#1339F4`, cream `#FEF1C4`, ink `#050C3A`.

## Launch checklist

1. **Front end**: the top of `main.js`:

   ```js
   const CONFIG = {
     CA: '',        // $WATER contract address
     X_URL: '',     // official X profile
     BUY_URL: ''    // e.g. https://pump.fun/coin/<CA>
   };
   ```

   Every X button, the Buy button and the Copy CA controls pick these up. While empty they show "coming soon" toasts.

2. **Reservoir tracker**: in `api/_lib/meter-core.js` set `EXPECTED.mint` to the same CA. Until then `/api/meter`
   answers `{ "prelaunch": true }` and the page shows "Awaiting launch".
   After the first settled donation, optionally pin `EXPECTED.configId` to the receipt's `donationReceipt.config.id`.

## The Reservoir (settled donations, server-side)

The donated total counts **only donations already settled to WaterAid America**, read from donate.gg's public
receipts API (`charities/584d2da9-adc3-4996-a12b-be4231e849f8/donations`, WaterAid America Inc., EIN 30-0181674):

```text
donated = sum(usdNetE6 of settled $WATER receipts) / 1,000,000   (USDC, net of donate.gg's processing fee)
```

Same accounting rules as Foodcoin's Meal Meter: every page is read before publishing, receipts must match the mint,
Solana, the Pump Fees donation source, WaterAid, USDC settlement and a wrapped-SOL input, amounts are checked
(`gross = net + fee + tip`), receipts are deduplicated by id, and already-counted history must stay unchanged.
Creator-vault and donation-account balances are read from Solana and shown as *not yet counted*.

The tank fills toward the next target: $10k → $35k → **$70k (beat Foodcoin)** → $150k → $500k (`GOALS` in `meter.js`).

Optional Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URLS` | Comma-separated RPC URLs, primary first. |
| `DONATE_API_KEY` | donate.gg API key for a higher rate limit. |

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Serves the site and `/api/meter` on http://localhost:5174.

```bash
npm test
```

## Deploy

Vercel: import the repo, no build step. The static site and the `/api/meter` function deploy together.
