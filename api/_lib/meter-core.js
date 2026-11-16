'use strict';
/*
 * Watercoin Reservoir — server-side accounting core.
 *
 * The donated total is computed ONLY from donate.gg beneficiary receipts that are settled to WaterAid America
 * and attributed to $WATER:
 *     donated = sum(usdNetE6)   (USDC, net of donate.gg's processing fee)
 * Unclaimed creator fees and pending donations are reported separately (in SOL) and never counted.
 * No live SOL price is involved, so a price move can't change an already-counted total.
 *
 * EXPECTED.mint is the $WATER mint. After the first settled donation, optionally pin EXPECTED.configId to that
 * receipt's donationReceipt.config.id so receipts from any other donation config are rejected.
 * Until the coin trades, the fee-sharing account does not exist on-chain yet: readChain reports that as
 * NotCreatedYet, which the API publishes as "not_found" (shown as "opens with the first trade", not as an error).
 */
const {
  address, getAddressEncoder, getAddressDecoder, getProgramDerivedAddress
} = require('@solana/addresses');

const EXPECTED = {            // not frozen so tests can set a mint; only edit these constants here
  mint: 'FV23gQJYmnqSZtEkVCzVAzwS5YmSQcp7UuYSLVepump',                   // $WATER mint (same value as CONFIG.CA in main.js)
  chainId: 101,
  donationSource: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',          // Pump Fees program
  configId: null,                                                         // pin after the first settled receipt (null = any config)
  charityId: '584d2da9-adc3-4996-a12b-be4231e849f8',                      // WaterAid America Inc. on donate.gg (EIN 30-0181674)
  charityName: 'WaterAid America',
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdcDecimals: 6,
  wsol: 'So11111111111111111111111111111111111111112'
};
const isLaunched = () => typeof EXPECTED.mint === 'string' && EXPECTED.mint.length >= 32;
const DONATE_API = 'https://api.donate.gg/api/v1/charities/' + EXPECTED.charityId + '/donations';
const MAX_PAGES = 100;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const PROGRAMS = Object.freeze({
  pump: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  amm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  fees: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  system: '11111111111111111111111111111111'
});
const DISC = Object.freeze({ sharing: 'd84a0900388c5d4b', donation: 'f6c56009c11e5d73' });

class RefreshRejected extends Error {
  constructor(msg) { super(msg); this.name = 'RefreshRejected'; }
}
// The mint's fee-sharing account is not on-chain yet (the coin has not launched or sharing is not set up).
class NotCreatedYet extends Error {
  constructor() { super('fee-sharing config not created yet'); this.name = 'NotCreatedYet'; }
}

/* ------------------------------------------------------------------ helpers */
const INT = /^(0|[1-9]\d*)$/;
function int(v, what) {
  if (typeof v !== 'string' || !INT.test(v)) throw new RefreshRejected(`invalid integer for ${what}`);
  return BigInt(v);
}
function validTimestamp(s) {
  if (typeof s !== 'string') return false;
  const t = Date.parse(s);
  return Number.isFinite(t) && t > Date.UTC(2024, 0, 1) && t < Date.now() + 10 * 60 * 1000;
}
const isWaterReceipt = r => isLaunched() && r && r.donationReceipt && r.donationReceipt.externalSubject &&
  r.donationReceipt.externalSubject.token && r.donationReceipt.externalSubject.token.address === EXPECTED.mint;

async function fetchJson(fetchImpl, url, { timeoutMs = 10000, headers = {}, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...headers }, body, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('response too large');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

/* ------------------------------------------------------------- receipts */
// Fetches EVERY page. Any failure, malformed page, repeated cursor or runaway pagination rejects the
// whole refresh, so a partial read can never become the published total.
async function fetchAllReceipts(fetchImpl, { apiKey, limit = 200, maxPages = MAX_PAGES } = {}) {
  const all = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new RefreshRejected('pagination safety limit exceeded');
    const url = `${DONATE_API}?limit=${limit}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    let j;
    try { j = await fetchJson(fetchImpl, url, { headers: apiKey ? { 'donate-api-key': apiKey } : {} }); }
    catch (e) { throw new RefreshRejected(`receipt page ${page + 1} failed`); }
    if (!j || !Array.isArray(j.response) || !('pageKey' in j)) throw new RefreshRejected('malformed receipt page');
    all.push(...j.response);
    if (j.pageKey === null || j.pageKey === undefined || j.pageKey === '') break;
    if (typeof j.pageKey !== 'string' || seenCursors.has(j.pageKey)) throw new RefreshRejected('repeated or invalid pagination cursor');
    seenCursors.add(j.pageKey);
    cursor = j.pageKey;
  }
  return all;
}

// Validates one WATER beneficiary receipt. Throws (rejecting the refresh) when anything is inconsistent.
function validateReceipt(r) {
  const d = r.donationReceipt;
  const fail = m => { throw new RefreshRejected(`WATER receipt ${r && r.id}: ${m}`); };
  if (typeof r.id !== 'string' || !r.id) fail('missing receipt id');
  if (r.status !== 'settled') fail('beneficiary receipt not settled');
  if (d.status !== 'settled') fail('parent donation not settled');
  const es = d.externalSubject;
  if (es.chainId !== EXPECTED.chainId || es.token.chainId !== EXPECTED.chainId) fail('wrong chain');
  if (!es.donationSource || es.donationSource.address !== EXPECTED.donationSource) fail('unexpected donation source');
  if (!d.config || typeof d.config.id !== 'string' || (EXPECTED.configId && d.config.id !== EXPECTED.configId)) fail('unexpected donation config');
  if (!r.target || !r.target.charity || r.target.charity.id !== EXPECTED.charityId) fail('unexpected beneficiary');
  if (!r.target.chain || r.target.chain.id !== EXPECTED.chainId) fail('beneficiary not on Solana');
  const st = d.settlementToken;
  if (!st || st.address !== EXPECTED.usdc || st.decimals !== EXPECTED.usdcDecimals || st.chainId !== EXPECTED.chainId) fail('settlement token is not canonical USDC');
  if (!d.inputToken || d.inputToken.address !== EXPECTED.wsol) fail('unexpected input token');
  const tx = r.transactionLog;
  if (!tx || typeof tx.txHash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(tx.txHash)) fail('missing distribution transaction');
  const slot = typeof tx.blockNumber === 'string' && INT.test(tx.blockNumber) ? Number(tx.blockNumber) : tx.blockNumber;
  if (!Number.isSafeInteger(slot) || slot <= 0) fail('missing distribution slot');
  if (!validTimestamp(tx.blockTimestamp)) fail('missing distribution timestamp');

  const v = {};
  for (const k of ['settledGrossAtomic', 'settledNetAtomic', 'settledFeeAtomic', 'settledTipAtomic', 'usdGrossE6', 'usdNetE6', 'usdFeeE6', 'usdTipE6']) v[k] = int(r[k], k);
  if (v.settledGrossAtomic !== v.settledNetAtomic + v.settledFeeAtomic + v.settledTipAtomic) fail('settlement amounts do not reconcile');
  if (v.usdGrossE6 !== v.usdNetE6 + v.usdFeeE6 + v.usdTipE6) fail('USD amounts do not reconcile');
  const inputGross = int(d.inputGrossAtomic, 'inputGrossAtomic');

  return {
    id: r.id,
    netE6: v.usdNetE6, grossE6: v.usdGrossE6, feeE6: v.usdFeeE6, tipE6: v.usdTipE6,
    sourceLamports: inputGross,
    tx: tx.txHash, slot, at: tx.blockTimestamp,
    beneficiaryWallet: r.target.walletAddress || null
  };
}

const fingerprint = x => [x.netE6, x.grossE6, x.feeE6, x.tipE6, x.sourceLamports, x.tx, x.slot, x.at].join('|');

// Builds the settled ledger: dedupes by beneficiary receipt id (NOT by tx hash — batches share one tx),
// ignores identical repeats, rejects conflicting duplicates, and enforces that already-committed history
// is still present and unchanged.
function buildLedger(receipts, { committed } = {}) {
  const ledger = new Map();
  let unrelated = 0;
  for (const r of receipts) {
    if (!isWaterReceipt(r)) { unrelated++; continue; }
    const x = validateReceipt(r);
    const prev = ledger.get(x.id);
    if (prev) {
      if (fingerprint(prev) !== fingerprint(x)) throw new RefreshRejected(`conflicting duplicate receipt ${x.id}`);
      continue;
    }
    ledger.set(x.id, x);
  }
  if (committed) {
    for (const [id, c] of committed) {
      const now = ledger.get(id);
      if (!now) throw new RefreshRejected(`previously counted receipt ${id} is missing`);
      if (fingerprint(now) !== fingerprint(c)) throw new RefreshRejected(`previously counted receipt ${id} changed`);
    }
  }
  return { ledger, unrelated };
}

function summarize(ledger) {
  let net = 0n, gross = 0n, fee = 0n, tip = 0n, lamports = 0n, last = null;
  const txs = new Set();
  for (const x of ledger.values()) {
    net += x.netE6; gross += x.grossE6; fee += x.feeE6; tip += x.tipE6; lamports += x.sourceLamports;
    txs.add(x.tx);
    if (!last || Date.parse(x.at) > Date.parse(last.at)) last = x;
  }
  return {
    receipts: ledger.size,
    transactions: txs.size,
    netUsdE6: net.toString(),
    grossUsdE6: gross.toString(),
    feeUsdE6: fee.toString(),
    tipUsdE6: tip.toString(),
    sourceLamports: lamports.toString(),
    lastSettlement: last ? { tx: last.tx, at: last.at, slot: last.slot } : null,
    beneficiary: { name: EXPECTED.charityName, wallet: last ? last.beneficiaryWallet : null }
  };
}

// ledger <-> JSON (for the bundled snapshot)
const ledgerToJson = ledger => [...ledger.values()].map(x => ({
  id: x.id, netE6: x.netE6.toString(), grossE6: x.grossE6.toString(), feeE6: x.feeE6.toString(), tipE6: x.tipE6.toString(),
  sourceLamports: x.sourceLamports.toString(), tx: x.tx, slot: x.slot, at: x.at, beneficiaryWallet: x.beneficiaryWallet
}));
function ledgerFromJson(arr) {
  const m = new Map();
  for (const o of arr) {
    m.set(o.id, {
      id: o.id, netE6: int(o.netE6, 'netE6'), grossE6: int(o.grossE6, 'grossE6'), feeE6: int(o.feeE6, 'feeE6'), tipE6: int(o.tipE6, 'tipE6'),
      sourceLamports: int(o.sourceLamports, 'sourceLamports'), tx: o.tx, slot: o.slot, at: o.at, beneficiaryWallet: o.beneficiaryWallet || null
    });
  }
  return m;
}

/* ------------------------------------------------------------ chain reads */
// Pending, not-yet-settled funds (shown separately, never counted as donated).
const enc = getAddressEncoder(), dec = getAddressDecoder();
const pdaOf = async (seeds, program) => (await getProgramDerivedAddress({ programAddress: address(program), seeds }))[0];

let addrCache = null;
async function deriveAccounts() {
  if (!isLaunched()) throw new Error('mint not set yet');
  if (addrCache) return addrCache;
  const mint = enc.encode(address(EXPECTED.mint));
  const sharing = await pdaOf(['sharing-config', mint], PROGRAMS.fees);
  const sharingB = enc.encode(sharing);
  const curveVault = await pdaOf(['creator-vault', sharingB], PROGRAMS.pump);
  const ammAuth = await pdaOf(['creator_vault', sharingB], PROGRAMS.amm);
  const ammVault = await pdaOf([enc.encode(ammAuth), enc.encode(address(PROGRAMS.token)), enc.encode(address(EXPECTED.wsol))], PROGRAMS.ata);
  addrCache = { sharing, curveVault, ammAuth, ammVault };
  return addrCache;
}
const wsolAtaOf = async owner => pdaOf([enc.encode(address(owner)), enc.encode(address(PROGRAMS.token)), enc.encode(address(EXPECTED.wsol))], PROGRAMS.ata);

const hex8 = b => Buffer.from(b.subarray(0, 8)).toString('hex');
const u64 = (b, o) => { if (b.length < o + 8) throw new Error('account too short'); return Buffer.from(b).readBigUInt64LE(o); };
const keyAt = (b, o) => { if (b.length < o + 32) throw new Error('account too short'); return dec.decode(b.subarray(o, o + 32)); };

// RPC with failover: tries each URL in order; providers that failed get a cooldown.
function makeRpc(fetchImpl, urls, { timeoutMs = 8000, cooldownMs = 60000 } = {}) {
  const downUntil = new Map();
  return async function rpc(method, params) {
    let lastErr;
    const order = [...urls].sort((a, b) => (downUntil.get(a) || 0) - (downUntil.get(b) || 0));
    for (const url of order) {
      if ((downUntil.get(url) || 0) > Date.now() && url !== order[order.length - 1]) continue;
      try {
        const j = await fetchJson(fetchImpl, url, { method: 'POST', timeoutMs, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        if (j.error) throw new Error('rpc error ' + (j.error.code || ''));
        return j.result;
      } catch (e) {
        lastErr = e;
        downUntil.set(url, Date.now() + cooldownMs);
      }
    }
    throw new Error('all RPC providers failed' + (lastErr ? ' (' + String(lastErr.message).replace(/https?:\/\/\S+/g, '[redacted]') + ')' : ''));
  };
}

async function readChain(rpc, { minContextSlot = 0 } = {}) {
  const a = await deriveAccounts();
  const opts = { encoding: 'base64', commitment: 'finalized' };
  if (minContextSlot) opts.minContextSlot = minContextSlot;
  const res = await rpc('getMultipleAccounts', [[a.sharing, a.curveVault, a.ammVault], opts]);
  const slot = res.context.slot;
  if (minContextSlot && slot < minContextSlot) throw new Error('stale snapshot');
  const [sharingAcc, vaultAcc, ammAcc] = res.value;
  const b = acc => (acc ? Buffer.from(acc.data[0], 'base64') : null);

  if (!sharingAcc) throw new NotCreatedYet();
  if (sharingAcc.owner !== PROGRAMS.fees || hex8(b(sharingAcc)) !== DISC.sharing) throw new Error('fee-sharing config not found');
  const sd = b(sharingAcc);
  if (keyAt(sd, 11) !== EXPECTED.mint) throw new Error('fee-sharing config is for another mint');
  const locked = sd[75] === 1;
  const n = sd.readUInt32LE(76);
  if (n < 1 || n > 10) throw new Error('unexpected shareholder count');
  const holders = [];
  for (let i = 0, o = 80; i < n; i++, o += 34) holders.push({ key: keyAt(sd, o), bps: sd.readUInt16LE(o + 32) });

  const rent0 = BigInt(await rpc('getMinimumBalanceForRentExemption', [0]));
  let creatorVault = 0n;
  if (vaultAcc) {
    if (vaultAcc.owner !== PROGRAMS.system) throw new Error('creator vault has unexpected owner');
    const l = BigInt(vaultAcc.lamports);
    creatorVault = l > rent0 ? l - rent0 : 0n;
  }
  let ammVault = 0n;
  if (ammAcc) {
    if (ammAcc.owner !== PROGRAMS.token) throw new Error('PumpSwap vault has unexpected owner');
    const ad = b(ammAcc);
    if (keyAt(ad, 0) !== EXPECTED.wsol || keyAt(ad, 32) !== a.ammAuth) throw new Error('PumpSwap vault mint/authority mismatch');
    ammVault = u64(ad, 64);
  }

  // donation account(s)
  let donationBps = 0, donation = null;
  for (const h of holders) {
    const ata = await wsolAtaOf(h.key);
    const r2 = await rpc('getMultipleAccounts', [[h.key, ata], { encoding: 'base64', commitment: 'finalized', minContextSlot: slot }]);
    const [acc, ataAcc] = r2.value;
    if (!acc || acc.owner !== PROGRAMS.fees || hex8(b(acc)) !== DISC.donation) continue;
    const dd = b(acc);
    if (keyAt(dd, 42) !== EXPECTED.mint) continue; // shared with another mint: don't attribute
    donationBps += h.bps;
    const rentD = BigInt(await rpc('getMinimumBalanceForRentExemption', [dd.length]));
    const lam = BigInt(acc.lamports);
    const pending = (lam > rentD ? lam - rentD : 0n) + (ataAcc ? u64(Buffer.from(ataAcc.data[0], 'base64'), 64) : 0n);
    const lastCrank = Number(Buffer.from(dd).readBigInt64LE(146));
    donation = {
      address: h.key, configId: keyAt(dd, 10), pendingLamports: pending.toString(),
      totalDonatedLamports: u64(dd, 138).toString(), lastCrankAt: lastCrank > 0 ? new Date(lastCrank * 1000).toISOString() : null
    };
  }
  if (donationBps > 10000) throw new Error('invalid fee allocation');
  const share = BigInt(donationBps);

  return {
    slot,
    locked,
    shareBps: donationBps,
    creatorVaultLamports: (creatorVault * share / 10000n).toString(),
    ammVaultLamports: (ammVault * share / 10000n).toString(),
    donation,
    accounts: { sharing: a.sharing, creatorVault: a.curveVault, pumpswapVault: a.ammVault }
  };
}

module.exports = {
  EXPECTED, RefreshRejected, NotCreatedYet, isLaunched,
  fetchAllReceipts, validateReceipt, buildLedger, summarize, ledgerToJson, ledgerFromJson,
  makeRpc, readChain, deriveAccounts, isWaterReceipt
};
