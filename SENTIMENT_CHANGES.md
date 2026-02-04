# Sentiment Feedback Loop — Changes Summary

**Date:** 2026-02-04
**Files modified:** `src/listeners/tradeListener.js` (1 file)
**Files already correct:** `src/services/oracleCallService.js` (no changes needed)

## Problem

The InfoFi hybrid pricing model uses **70% raffle odds + 30% market sentiment**. The raffle odds side was working (backend updates oracle via `oracleCallService.updateRaffleProbability()`). But the market sentiment side was broken — the trade listener had a **naive stub** `calculateSentiment()` that computed sentiment from just the trade's `amountIn` and `buyYes` direction, starting from a hardcoded 5000 bps neutral baseline. It never read the FPMM's actual on-chain prices.

This meant `InfoFiPriceOracle.updateMarketSentiment()` was being called with garbage values that didn't reflect real market state.

## Fix

Replaced the synchronous `calculateSentiment(amountIn, buyYes, logger)` stub with an async `readMarketSentiment(fpmmAddress, fpmmAbi, logger)` function that:

1. **Calls `SimpleFPMM.getPrices()`** on-chain via `publicClient.readContract()` after each `Trade` event
2. **Uses `yesPrice`** (already in basis points) as the market sentiment — this is the FPMM's CPMM-derived probability for YES
3. **Includes sanity checks** — warns if yesPrice + noPrice deviates from 10000 bps
4. **Clamps output** to 0-10000 bps range
5. **Falls back to 5000 bps** (neutral) if the on-chain read fails, so the oracle still gets an update

## What was already in place (no changes needed)

- **`oracleCallService.updateMarketSentiment()`** — already existed with correct signature `(fpmmAddress, marketSentimentBps, logger)`, full retry logic, and admin alerts
- **Trade listener wiring** in `server.js` — already starts trade listeners for all active FPMM addresses on boot, passes `simpleFpmmAbi`
- **`SimpleFPMMAbi.js`** — already includes `getPrices()` function definition
- **Block cursor persistence** — trade listener already uses `createBlockCursor` so it won't miss events across restarts

## The feedback loop (now complete)

```
Trade on SimpleFPMM
  → Trade event emitted
  → tradeListener detects event
  → reads SimpleFPMM.getPrices() → yesPrice in bps  ← THIS WAS THE MISSING LINK
  → calls InfoFiPriceOracle.updateMarketSentiment(fpmmAddress, yesPriceBps)
  → Oracle computes hybrid price: 70% raffle + 30% sentiment
```

## Prerequisites for production

- Backend wallet `0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4` must have `PRICE_UPDATER_ROLE` on the InfoFiPriceOracle (it already does for `updateRaffleProbability`, same role covers both functions)
- Oracle address env vars must be set (`INFOFI_ORACLE_ADDRESS_TESTNET` / `INFOFI_ORACLE_ADDRESS_MAINNET`)
