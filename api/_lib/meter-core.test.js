'use strict';
// Run: npm test   (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./meter-core');
const { EXPECTED } = core;
// The real mint is set at launch; tests run against a stand-in mint (and the pre-launch case explicitly).
const REAL_MINT = EXPECTED.mint;
const TEST_MINT = 'WaTer1111111111111111111111111111111111pump';
EXPECTED.mint = TEST_MINT;
const CONFIG = '0x883716acf0f34171c0fa754ceea2df902091e62da1655bd57d1894355d8455ba';

let n = 0;
const TX = '5E59MfV6YcLyABJAdHUuUqJN4i4B8hrsu35zsWgoBcnqf2oorNaCQg36GCEF67shAKnuvTevNvN59fUMkYMbzhtE';
function receipt(over = {}) {
  n++;
  const net = over.net ?? '8000000', fee = over.fee ?? '2000000', tip = over.tip ?? '0';
  let gross = over.gross;
  if (gross === undefined) { try { gross = String(BigInt(net) + BigInt(fee) + BigInt(tip)); } catch { gross = '0'; } }
  const r = {
    id: over.id ?? `rcpt${n}`,
    status: over.status ?? 'settled',
    settledGrossAtomic: gross, settledNetAtomic: net, settledFeeAtomic: fee, settledTipAtomic: tip,
    usdGrossE6: gross, usdNetE6: net, usdFeeE6: fee, usdTipE6: tip,
    target: { charity: { id: over.charityId ?? EXPECTED.charityId }, chain: { id: 101 }, walletAddress: '5uSL88Y3R2dbZHv9xBU8knFmdPk9AGUuve1eQ4UUnEXc' },
    transactionLog: over.transactionLog ?? { txHash: over.tx ?? TX, blockNumber: '469586767', blockTimestamp: '2026-11-15T03:57:10.000Z' },
    donationReceipt: {
      status: over.parentStatus ?? 'settled',
      inputGrossAtomic: over.lamports ?? '1000000000',
      externalSubject: {
        chainId: 101,
        token: { address: over.mint ?? EXPECTED.mint, chainId: 101 },
        donationSource: { address: over.source ?? EXPECTED.donationSource }
      },
      config: { id: over.configId ?? CONFIG },
      settlementToken: { address: over.usdc ?? EXPECTED.usdc, decimals: over.decimals ?? 6, chainId: 101 },
      inputToken: { address: over.input ?? EXPECTED.wsol }
    }
  };
  return r;
}
const pages = (...ps) => {
  let i = 0;
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(ps[Math.min(i++, ps.length - 1)]) });
};

test('donated total is the full settled USD of each donation, summed exactly', () => {
  const { ledger } = core.buildLedger([receipt({ net: '1049999', fee: '262500' }), receipt({ net: '1049999', fee: '262500' })]);
  const s = core.summarize(ledger);
  assert.equal(s.netUsdE6, '2099998');
  assert.equal(s.feeUsdE6, '525000');
  assert.equal(s.donatedUsdE6, '2624998');
  assert.equal(s.meals, undefined);
});

test('pre-launch: with no mint set, nothing is attributed to $WATER and chain reads refuse', async () => {
  EXPECTED.mint = REAL_MINT;
  try {
    if (core.isLaunched()) return; // mint already set for real: nothing to check
    const { ledger, unrelated } = core.buildLedger([receipt({ mint: TEST_MINT })]);
    assert.equal(ledger.size, 0);
    assert.equal(unrelated, 1);
    await assert.rejects(core.deriveAccounts(), /mint not set/);
  } finally { EXPECTED.mint = TEST_MINT; }
});

test('pinned config id: once set, receipts from another config are rejected', () => {
  const prev = EXPECTED.configId;
  EXPECTED.configId = CONFIG;
  try {
    assert.equal(core.buildLedger([receipt()]).ledger.size, 1);
    assert.throws(() => core.buildLedger([receipt({ configId: '0xdead' })]), core.RefreshRejected);
  } finally { EXPECTED.configId = prev; }
});

test('pending / unsettled receipts are rejected, not counted', () => {
  assert.throws(() => core.buildLedger([receipt({ status: 'pending' })]), core.RefreshRejected);
  assert.throws(() => core.buildLedger([receipt({ parentStatus: 'processing' })]), core.RefreshRejected);
});

test('unrelated receipts (other coins) are skipped', () => {
  const { ledger, unrelated } = core.buildLedger([receipt({ mint: 'So11111111111111111111111111111111111111112' }), receipt()]);
  assert.equal(ledger.size, 1);
  assert.equal(unrelated, 1);
});

test('inconsistent WATER receipts reject the refresh', () => {
  for (const bad of [{ source: 'SomeOtherProgram111111111111111111111111111' }, { charityId: 'other' },
    { usdc: 'So11111111111111111111111111111111111111112' }, { decimals: 9 }, { input: EXPECTED.usdc },
    { gross: '99' }, { net: '1.5' }, { transactionLog: { txHash: '', blockNumber: '1', blockTimestamp: '2026-11-15T03:57:10.000Z' } },
    { transactionLog: { txHash: TX, blockNumber: 'x', blockTimestamp: '2026-11-15T03:57:10.000Z' } },
    { transactionLog: { txHash: TX, blockNumber: '5', blockTimestamp: 'not a date' } }]) {
    assert.throws(() => core.buildLedger([receipt(bad)]), core.RefreshRejected, JSON.stringify(bad));
  }
});

test('batched receipts sharing one tx are each counted (dedupe by receipt id, not tx)', () => {
  const s = core.summarize(core.buildLedger([receipt({ tx: TX }), receipt({ tx: TX }), receipt({ tx: TX })]).ledger);
  assert.equal(s.receipts, 3);
  assert.equal(s.transactions, 1);
});

test('identical repeats are ignored, conflicting duplicates rejected', () => {
  const a = receipt({ id: 'dup' });
  assert.equal(core.buildLedger([a, JSON.parse(JSON.stringify(a))]).ledger.size, 1);
  const b = receipt({ id: 'dup2', net: '1000' }), c = receipt({ id: 'dup2', net: '2000' });
  assert.throws(() => core.buildLedger([b, c]), /conflicting duplicate/);
});

test('committed history must stay present and unchanged', () => {
  const a = receipt({ id: 'h1' }), b = receipt({ id: 'h2' });
  const committed = core.buildLedger([a, b]).ledger;
  assert.throws(() => core.buildLedger([a], { committed }), /missing/);
  const altered = JSON.parse(JSON.stringify(b)); altered.usdNetE6 = altered.settledNetAtomic = '7000000';
  altered.usdGrossE6 = altered.settledGrossAtomic = '9000000';
  assert.throws(() => core.buildLedger([a, altered], { committed }), /changed/);
  assert.equal(core.buildLedger([a, b, receipt()], { committed }).ledger.size, 3);
});

test('snapshot JSON round-trips exactly', () => {
  const l = core.buildLedger([receipt(), receipt()]).ledger;
  const back = core.ledgerFromJson(JSON.parse(JSON.stringify(core.ledgerToJson(l))));
  assert.deepEqual(core.summarize(back), core.summarize(l));
});

test('pagination reads every page', async () => {
  const rs = await core.fetchAllReceipts(pages({ pageKey: 'p2', response: [receipt()] }, { pageKey: null, response: [receipt()] }));
  assert.equal(rs.length, 2);
});

test('pagination failures reject: repeated cursor, malformed page, HTTP error, runaway', async () => {
  await assert.rejects(core.fetchAllReceipts(pages({ pageKey: 'same', response: [] }, { pageKey: 'same', response: [] })), /repeated/);
  await assert.rejects(core.fetchAllReceipts(pages({ nope: true })), /malformed/);
  await assert.rejects(core.fetchAllReceipts(async () => ({ ok: false, status: 500, text: async () => '' })), core.RefreshRejected);
  let k = 0;
  await assert.rejects(core.fetchAllReceipts(async () => ({ ok: true, text: async () => JSON.stringify({ pageKey: 'c' + k++, response: [] }) }), { maxPages: 5 }), /safety limit/);
});

test('RPC failover: second provider answers when the first fails; URLs are redacted in errors', async () => {
  const calls = [];
  const rpc = core.makeRpc(async url => {
    calls.push(url);
    if (url.includes('primary')) throw new Error('down https://primary.example/?api-key=SECRET');
    return { ok: true, text: async () => JSON.stringify({ result: 42 }) };
  }, ['https://primary.example/?api-key=SECRET', 'https://backup.example']);
  assert.equal(await rpc('getSlot', []), 42);
  assert.deepEqual(calls, ['https://primary.example/?api-key=SECRET', 'https://backup.example']);
  const dead = core.makeRpc(async () => { throw new Error('boom https://x.example/?api-key=SECRET'); }, ['https://x.example/?api-key=SECRET']);
  await assert.rejects(dead('getSlot', []), e => !String(e.message).includes('SECRET'));
});

test('bundled snapshot is valid and self-consistent', () => {
  const snap = require('../_data/settled-snapshot.json');
  const l = core.ledgerFromJson(snap.receipts);
  const s = core.summarize(l);
  assert.equal(BigInt(s.grossUsdE6), BigInt(s.netUsdE6) + BigInt(s.feeUsdE6) + BigInt(s.tipUsdE6));
});

test('a mint that is not trading yet reads as NotCreatedYet, not as an RPC failure', async () => {
  const rpc = async method => method === 'getMultipleAccounts' ? { context: { slot: 100 }, value: [null, null, null] } : 890880;
  await assert.rejects(core.readChain(rpc), core.NotCreatedYet);
});

test('the configured mint is a valid address and matches the site config', () => {
  if (!REAL_MINT) return;
  const { address } = require('@solana/addresses');
  assert.doesNotThrow(() => address(REAL_MINT));
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.ok(main.includes(`CA: '${REAL_MINT}'`), 'main.js CONFIG.CA must equal EXPECTED.mint');
  assert.ok(main.includes(`pump.fun/coin/${REAL_MINT}`), 'main.js BUY_URL must point at the same mint');
});
