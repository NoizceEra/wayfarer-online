// tools/chain_client_check.mjs — verification for the client token panel
// (src/ui/ChainPanel.js + src/net/chainNet.js).
//
//   node tools/chain_client_check.mjs
//
// It does three real things, in this order:
//   1. IMPORT PURITY — walks the actual import graph of both files and asserts
//      every module reached lives under src/ (in particular: never server/ or
//      tools/, which Vercel does not upload).
//   2. BUNDLES the panel with the repo's own vite (no new dependency) and
//      asserts both new files are in the output chunk.
//   3. RUNS that bundle in Node with DOM stubs against three relay conditions —
//      unreachable, economy-disabled, and live — asserting import/refresh/render
//      never throw, never console.error, never send a wallet address, publish
//      the EFFECTIVE rate (never the nominal APR), and report "unavailable"
//      rather than an error when the relay is gone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` → ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n── ${t}`);

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY = path.join(ROOT, 'src/ui/ChainPanel.js');
const OUT = path.join(process.env.TMPDIR || process.env.TEMP || os.tmpdir(), 'wf-chain-check');
const OWNED = ['src/net/chainNet.js', 'src/ui/ChainPanel.js'];

// ── 1. import purity ─────────────────────────────────────────────────────────
section('import purity (client must not reach server/ or tools/)');

function specifiersIn(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = new Set();
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[;\s])import\s*['"]([^'"]+)['"]/g,
  ]) {
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return [...out];
}
function resolveRel(from, spec) {
  if (!spec.startsWith('.')) return null;                 // npm package: not our tree
  const base = path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}
const seen = new Set();
const outside = [];
const missing = [];
(function walk(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (seen.has(rel)) return;
  seen.add(rel);
  if (!rel.startsWith('src/')) outside.push(rel);
  for (const spec of specifiersIn(file)) {
    const resolved = resolveRel(file, spec);
    if (!resolved) { if (spec.startsWith('.')) missing.push(`${rel} → ${spec}`); continue; }
    walk(resolved);
  }
})(ENTRY);
const graph = [...seen].sort();
console.log(`  modules reachable from the two new files: ${graph.length}`);
ok('no module in the import graph lives outside src/ (never server/ or tools/)', outside.length === 0, outside.join(', '));
ok('no relative import failed to resolve', missing.length === 0, missing.join(', '));
for (const f of OWNED) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(`${f} contains no literal "server/" or "tools/" import path`,
    !/from\s*['"][^'"]*(?:^|\/)server\//.test(src) && !/from\s*['"][^'"]*\/tools\//.test(src));
}
ok('import graph includes the wallet/marks modules it is meant to mirror (econDom, socialDom, input, wallet)',
  ['src/ui/econDom.js', 'src/ui/socialDom.js', 'src/core/input.js', 'src/core/wallet.js'].every((f) => seen.has(f)),
  graph.filter((g) => /econDom|socialDom|input|wallet/.test(g)).join(', '));

// ── 2. bundle with the repo's own vite ───────────────────────────────────────
section('vite bundle of the new panel');
fs.rmSync(OUT, { recursive: true, force: true });
await build({
  root: ROOT,
  configFile: false,
  logLevel: 'info',
  build: {
    outDir: OUT,
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      // keep the entry's exports: the app build would otherwise tree-shake the
      // panel away (nothing imports it yet in this worktree — the orchestrator
      // wires it in src/scenes/UIScene.js by hand)
      preserveEntrySignatures: 'strict',
      input: { chain: ENTRY, net: path.join(ROOT, 'src/net/chainNet.js') },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chain-[name].mjs' },
    },
  },
});
const built = path.join(OUT, 'chain.mjs');
const builtNet = path.join(OUT, 'net.mjs');
const allFiles = fs.readdirSync(OUT).filter((f) => f.endsWith('.mjs'));
const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const code = allFiles.map((f) => readIf(path.join(OUT, f))).join('\n');
const chunkBytes = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
ok('bundle written (chain.mjs + net.mjs)', fs.existsSync(built) && fs.existsSync(builtNet));
console.log(`  bundle: ${path.relative(ROOT, OUT).replace(/\\/g, '/')} (outside the repo) · ${(chunkBytes / 1024).toFixed(0)} KB across ${allFiles.length} chunk(s)`);
console.log(`  chunks: ${allFiles.map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)}KB`).join(' · ')}`);
ok('bundle contains chainNet (/econ/rates endpoint)', code.includes('/econ/rates'));
ok('bundle contains the panel (its own css id)', code.includes('wf-chain-css'));
ok('bundle exports the panel + net surface', /export\s*\{[\s\S]*ChainPanel/.test(readIf(built)) && /export\s*\{[\s\S]*chainNet/.test(readIf(builtNet)));
ok('bundle imports nothing from server/ or tools/', !/(?:from|import)\s*\(?\s*['"][^'"]*(?:^|\/)(?:server|tools)\//.test(code));
ok('bundle has no wallet-address request field', !/['"](?:address|destination)['"]\s*:/.test(code));

// 2b. the REAL app build with the panel wired in as an entry, i.e. exactly what
// happens once the shell imports it in src/scenes/UIScene.js (which this
// workstream does not own and has not touched). This is the honest form of
// "show the module in the build output": the app's own vite config, index.html
// plus the panel, emitted as its own chunk.
section('app build (index.html + the panel wired in as the shell will)');
const APP_OUT = path.join(OUT, 'app');
let appBuildErr = null;
try {
  await build({
    root: ROOT,
    logLevel: 'info',
    build: {
      outDir: APP_OUT,
      emptyOutDir: true,
      copyPublicDir: false,
      sourcemap: false,
      rollupOptions: {
        input: { index: path.join(ROOT, 'index.html'), chain: path.join(ROOT, 'src/ui/ChainPanel.js') },
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js' },
      },
    },
  });
} catch (e) { appBuildErr = e; }
const APP_ASSETS = path.join(APP_OUT, 'assets');
const appFiles = fs.existsSync(APP_ASSETS) ? fs.readdirSync(APP_ASSETS).filter((f) => f.endsWith('.js')) : [];
const appChunks = appFiles.map((f) => ({ f, size: fs.statSync(path.join(APP_ASSETS, f)).size, text: fs.readFileSync(path.join(APP_ASSETS, f), 'utf8') }));
const panelChunk = appChunks.find((c) => c.text.includes('wf-chain-css'));
ok('the app build succeeds with the panel in the graph', !appBuildErr, appBuildErr && appBuildErr.message);
console.log(`  app chunks: ${appChunks.map((c) => `${c.f} ${(c.size / 1024).toFixed(1)}KB`).join(' · ')}`);
ok('the app build output contains the new panel module', !!panelChunk, appChunks.map((c) => c.f).join(','));
ok('app bundle graph still never reaches server/ or tools/',
  appChunks.every((c) => !/(?:from|import)\s*\(?\s*['"][^'"]*(?:^|\/)(?:server|tools)\//.test(c.text)));

// ── 3. run the bundle with no relay ──────────────────────────────────────────
section('runtime behaviour (DOM stubs, no browser, no relay)');

function fakeNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(), children: [], style: {}, dataset: {},
    className: '', id: '', textContent: '', innerHTML: '', value: '', placeholder: '',
    title: '', type: '', disabled: false, size: 0, nodeValue: '',
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c) this.children.push(c); },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    setAttribute(k, v) { this[k] = v; }, getAttribute() { return null; }, hasAttribute() { return true; },
    querySelector(sel) { return fakeNode(String(sel).replace(/^\./, '')); },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
  };
  return n;
}
function textOf(node, depth = 0) {
  if (!node || depth > 8) return '';
  const own = `${node.innerHTML || ''} ${node.textContent || ''}`;
  return `${own} ${(node.children || []).map((c) => textOf(c, depth + 1)).join(' ')}`;
}

globalThis.window = globalThis;
globalThis.document = {
  head: fakeNode('head'), body: fakeNode('body'),
  createElement: (t) => fakeNode(t),
  getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  activeElement: null, hidden: false, hasFocus: () => true,
};
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();
try { if (typeof globalThis.navigator?.getGamepads !== 'function') Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true }); } catch { /* keep node's navigator */ }

let mode = 'refuse';
const reqs = [];
const liveRows = [
  { tierId: 'none', label: 'No stake', minLockRaw: 0, lockDays: 0, idleMultiplier: 1, idleCapHours: 8, capBonusHours: 0, aprBps: 0 },
  { tierId: 't1', label: 'Tier 1', minLockRaw: 1_000 * 10 ** 6, lockDays: 7, idleMultiplier: 1.15, idleCapHours: 12, capBonusHours: 4, aprBps: 300, effectiveYear1Bps: 161 },
  { tierId: 't2', label: 'Tier 2', minLockRaw: 10_000 * 10 ** 6, lockDays: 30, idleMultiplier: 1.35, idleCapHours: 16, capBonusHours: 8, aprBps: 450, effectiveYear1Bps: 242 },
  { tierId: 't3', label: 'Tier 3', minLockRaw: 50_000 * 10 ** 6, lockDays: 90, idleMultiplier: 1.6, idleCapHours: 24, capBonusHours: 16, aprBps: 600, effectiveYear1Bps: 322 },
];
const reply = (url) => {
  const p = url.replace(/^https?:\/\/[^/]+/, '');
  if (mode === 'disabled') {
    if (p === '/econ/rates') return [200, { ok: true, enabled: false, rows: liveRows, taper: 'Returns taper.' }];
    if (p === '/chain/status') return [200, { ok: true, enabled: false, configured: true, mint: '8q4tDsmint', cluster: 'devnet' }];
    return [403, { ok: false, error: 'not_enabled' }];
  }
  if (p === '/econ/rates') return [200, { ok: true, enabled: true, rows: liveRows, taper: 'Returns taper: the effective rate halves every 180 days.' }];
  if (p === '/chain/status') return [200, { ok: true, enabled: true, configured: true, mint: '8q4tDsmint', cluster: 'devnet', rewardsWallet: 'RewardAddr111111111111111111111111111111', treasuryWallet: 'TreasAddr1111111111111111111111111111111', flags: { stake: true, claim: true, payouts: false, walletLink: true, dryRun: true }, minClaimRaw: 1_000_000 }];
  if (p === '/econ/balance') return [200, { ok: true, balances: { gold: 1234, wayfarer: mode === 'unlinked' ? 0 : 2_000 * 10 ** 6, pendingOnLinkRaw: mode === 'unlinked' ? 25_000_000 : 0 }, stake: mode === 'unlinked' ? null : { tierId: 't1', amountRaw: 1_000 * 10 ** 6, unlockAt: Date.now() + 3_600_000 }, linked: mode !== 'unlinked', walletLinked: mode !== 'unlinked', address: mode === 'unlinked' ? null : 'Ab3kAddr1111111111111111111111111111111111', short: mode === 'unlinked' ? null : 'Ab3k…9xQz' }];
  if (p === '/econ/history') return [200, { ok: true, entries: [{ at: Date.now(), reason: 'combat', resource: 'wayfarer', amount: 5 * 10 ** 6, balanceAfter: 2_000 * 10 ** 6 }, { at: Date.now(), reason: 'fee', resource: 'gold', amount: -25 }] }];
  return [200, { ok: true, message: 'Recorded.' }];
};
globalThis.fetch = async (url, opts = {}) => {
  reqs.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  if (mode === 'refuse') throw new TypeError('fetch failed');
  const [status, data] = reply(String(url));
  return { ok: status < 400, status, json: async () => data };
};

const errs = [], warns = [];
const realError = console.error, realWarn = console.warn;
console.error = (...a) => errs.push(a.map(String).join(' '));
console.warn = (...a) => warns.push(a.map(String).join(' '));
const settle = () => new Promise((r) => setTimeout(r, 25));

let mod = null, importErr = null;
try {
  const chainMod = await import(pathToFileURL(built).href);
  const netMod = await import(pathToFileURL(builtNet).href);
  // both entries share ONE chainNet instance (rollup dedupes the module); the
  // assertions below depend on it, so they fail loudly if that ever changes.
  mod = { ...netMod, ...chainMod };
} catch (e) { importErr = e; }
ok('importing the panel + net client with nothing reachable does not throw', !importErr, importErr && (importErr.stack || '').split('\n')[0]);
ok('module exports the shell entry points', !!mod && ['installChainPanel', 'ChainPanel', 'chainHint', 'chainNet', 'openChainPanel', 'closeChainPanel'].every((k) => typeof mod[k] !== 'undefined'));

let panel = null, openErr = null;
try { panel = new mod.ChainPanel(); await panel.open(); } catch (e) { openErr = e; }
await settle();
await mod.chainNet.refresh();
ok('constructing + opening the panel with no relay throws nothing', !openErr, openErr && (openErr.stack || '').split('\n')[0]);
ok('refresh() reaches state without throwing', !!mod.chainNet.state.checked);
ok('state reports the relay unreachable', mod.chainNet.state.reachable === false && mod.chainNet.state.enabled === false, JSON.stringify({ r: mod.chainNet.state.reachable, e: mod.chainNet.state.enabled }));
ok('state reason is relay_unreachable (calm "not enabled on this relay" path)', mod.chainNet.state.reason === 'relay_unreachable', mod.chainNet.state.reason);
ok('it really tried: /econ/rates and /chain/status were requested', reqs.some((r) => r.url.endsWith('/econ/rates')) && reqs.some((r) => r.url.endsWith('/chain/status')));
ok('no console.error anywhere while the relay is down', errs.length === 0, errs.join(' | '));
let renderErr = null;
try { for (const tab of ['rates', 'stake', 'claim', 'ledger']) { panel.tab = tab; panel.render(); } } catch (e) { renderErr = e; }
ok('every tab renders in the unreachable state without throwing', !renderErr, renderErr && (renderErr.stack || '').split('\n')[0]);
const hintDown = mod.chainHint();
ok('chainHint() says unavailable (not an error) when the relay is gone', hintDown.available === false && typeof hintDown.text === 'string');
ok('no wallet panel was constructed by any of that (never auto-prompts)', panel.walletPanelInjected === null);

// ── economy disabled on this relay ───────────────────────────────────────────
section('relay reachable, token economy switched off');
mode = 'disabled';
const errsBefore = errs.length;
await mod.chainNet.refresh();
await settle();
const dst = mod.chainNet.state;
ok('relay is reachable but the economy reads disabled', dst.reachable === true && dst.enabled === false, JSON.stringify({ r: dst.reachable, e: dst.enabled, why: dst.reason }));
ok('reason is "disabled" (not an error)', dst.reason === 'disabled', dst.reason);
ok('the read-only rate sheet still serves while the economy is off', dst.rates.length === 4, `rows=${dst.rates.length}`);
panel.tab = 'stake'; panel.render();
const disText = textOf(document.body);
ok('the stake tab shows the calm "not enabled on this relay" state', /not enabled on this relay/i.test(disText));
ok('the calm state says the rest of the game is unaffected', /unaffected/i.test(disText));
ok('chainHint() reports unavailable (no marker) rather than an error', mod.chainHint().available === false);
ok('still no console.error with the economy disabled', errs.length === errsBefore, errs.slice(errsBefore).join(' | '));

// ── relay live ───────────────────────────────────────────────────────────────
section('relay live (synthetic relay, same client code)');
mode = 'live';
await mod.chainNet.refresh({ history: true });
await settle();
const lst = mod.chainNet.state;
ok('economy reads enabled', lst.enabled === true && lst.reason === 'ok', JSON.stringify({ e: lst.enabled, why: lst.reason }));
ok('gold + WAYFARER balances parsed from the ledger', lst.balances.gold === 1234 && lst.balances.wayfarer === 2_000 * 10 ** 6, JSON.stringify(lst.balances));
ok('current stake parsed (tier, locked amount, unlock time)', lst.stake.tier === 't1' && lst.stake.amountRaw === 1_000 * 10 ** 6 && lst.stake.unlockAt > Date.now(), JSON.stringify(lst.stake));
ok('wallet link state parsed', lst.linked === true && !!lst.address);
ok('recent ledger history parsed', Array.isArray(lst.history) && lst.history.length === 2, JSON.stringify(lst.history));
ok('rate sheet carries tier / min lock / lock days', lst.rates.every((r) => r.id && r.minLockRaw >= 0 && r.lockDays >= 0));
ok('the published rate is the EFFECTIVE year-1 rate, not the nominal APR (t1: 161bps, not 300)',
  mod.chainNet.rateRow('t1').effectiveYear1Bps === 161 && mod.chainNet.rateRow('t1').effectiveYear1Bps !== 300);
const nominalOnly = mod.normRates({ rows: [{ tierId: 't2', label: 'Tier 2', minLockRaw: 10_000 * 10 ** 6, lockDays: 30, aprBps: 450, idleMultiplier: 1.35 }] });
ok('a relay that publishes only aprBps yields NO published rate (never shows the nominal number)', nominalOnly[0].effectiveYear1Bps === null);
const hintUp = mod.chainHint();
ok('chainHint() is available and unobtrusive when live', hintUp.available === true && /WAYFARER 2,000/.test(hintUp.text), hintUp.text);

let actErr = null;
const stakeRes = await mod.chainNet.doStake('t1', 1_000 * 10 ** 6).catch((e) => { actErr = e; return null; });
ok('stake() completes without throwing', !actErr && !!stakeRes?.ok, actErr && actErr.message);
const claimRes = await mod.chainNet.doClaim().catch((e) => { actErr = e; return null; });
ok('claim() completes without throwing', !actErr && !!claimRes?.ok, actErr && actErr.message);
const unstakeRes = await mod.chainNet.doUnstake().catch((e) => { actErr = e; return null; });
ok('unstake() completes without throwing', !actErr && !!unstakeRes?.ok, actErr && actErr.message);
await settle();
const posts = reqs.filter((r) => r.body);
const ALLOWED = new Set(['token', 'tier', 'amountRaw', 'limit']);
const strays = posts.flatMap((r) => Object.keys(r.body).filter((k) => !ALLOWED.has(k)));
const b58 = posts.flatMap((r) => Object.entries(r.body).filter(([, v]) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(v)).map(([k]) => k));
ok('every request body contains only {token,tier,amountRaw,limit}', strays.length === 0, strays.join(','));
ok('no request ever carries a wallet address (nothing base58-shaped in any body)', b58.length === 0, b58.join(','));
ok('the device token sent is the one the rest of the client minted', posts.every((r) => typeof r.body.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(r.body.token)));
ok('the stake that was sent quoted the tier + integer base units', posts.some((r) => r.url.endsWith('/econ/stake') && r.body.tier === 't1' && r.body.amountRaw === 1_000 * 10 ** 6));

// courtesy minimum + no gating + no wallet nagging
panel.tier = 't3'; panel.tab = 'stake'; panel.amountIn = '5'; panel.render();
const before = reqs.length;
await panel.submitStake('t3', mod.chainNet.minLockRaw('t3'));
ok('a below-minimum stake is caught client-side (courtesy) without a round trip', reqs.length === before && /at least/i.test(panel.err), panel.err);
let liveRenderErr = null;
try { for (const tab of ['rates', 'stake', 'claim', 'ledger']) { panel.tab = tab; panel.render(); } } catch (e) { liveRenderErr = e; }
ok('every tab renders in the live state without throwing', !liveRenderErr, liveRenderErr && (liveRenderErr.stack || '').split('\n')[0]);
const liveText = textOf(document.body);
ok('the rates tab labels the published rate as the effective year-1 rate', /effective year-1 rate/i.test(liveText));
ok('no gating copy anywhere (no "stake to continue" / "connect to play")', !/stake to (continue|play)|connect.{0,20}to (play|continue)|must (stake|connect)/i.test(liveText));
ok('the wallet panel is still never constructed on its own (no auto-prompt)', panel.walletPanelInjected === null && globalThis.window.phantom === undefined);
const srcPanel = fs.readFileSync(path.join(ROOT, 'src/ui/ChainPanel.js'), 'utf8');
const noComments = srcPanel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
ok('module has no title-screen / onboarding mount (hidden chrome only)',
  typeof mod.mountTitleChip === 'undefined' && !/mountTitle|titleScreen|onboarding|firstRun/i.test(noComments));
const exportedNames = (readIf(built).match(/export\s*\{([\s\S]*?)\}/) || ['', ''])[1].replace(/\s+/g, ' ').trim();
console.log(`  exported surface: ${exportedNames}`);
ok('no exported hook is a title/onboarding/auto-open entry point',
  !/Title|Onboard|Welcome|Boot|AutoOpen|FirstRun/i.test(exportedNames), exportedNames);
ok('module never opens itself: no top-level panel construction', !/\n\s*new ChainPanel\(\)/.test(srcPanel.replace(/installChainPanel[\s\S]*$/, '')));
ok('whole run produced zero console.error / console.warn', errs.length === 0 && warns.length === 0, [...errs, ...warns].join(' | '));

// ── PLAY FIRST: the relay is live, but this device has NOT linked a wallet ────
// The owner's rule: the token layer does not exist for a player until they connect
// a wallet. This section is what makes that rule TESTED rather than merely claimed —
// it is the exact state a brand-new player is in while the economy is fully live.
section('relay live but NO wallet linked (play-first: the token layer is invisible)');
mode = 'unlinked';
await mod.chainNet.refresh();
await settle();
const ust = mod.chainNet.state;
ok('the economy is enabled on this relay, yet this device reads unlinked', ust.enabled === true && ust.linked === false, JSON.stringify({ e: ust.enabled, l: ust.linked }));
const hintUnlinked = mod.chainHint();
ok('chainHint() returns NOTHING before a wallet is linked (no teaser, no locked icon, no hint)',
  hintUnlinked.available === false && hintUnlinked.text === '' && !hintUnlinked.hint, JSON.stringify(hintUnlinked));
ok('the retroactive hook reaches the client (pendingOnLinkRaw is carried through)', ust.balances.pendingOnLinkRaw === 25_000_000, JSON.stringify(ust.balances));
let unlinkedRenderErr = null;
try { for (const tab of ['rates', 'stake', 'claim', 'ledger']) { panel.tab = tab; panel.render(); } } catch (e) { unlinkedRenderErr = e; }
ok('every tab renders unlinked without throwing', !unlinkedRenderErr, unlinkedRenderErr && (unlinkedRenderErr.stack || '').split('\n')[0]);
panel.tab = 'claim'; panel.render();
const ustText = textOf(document.body);
ok('the claim tab shows what the player is ALREADY owed (the retroactive hook, made visible)',
  /Already recorded for you/i.test(ustText) && /25[\s\S]{0,24}WAYFARER/.test(ustText), ustText.slice(0, 160));
ok('that line appears only inside the panel the player opened — nothing on the HUD', mod.chainHint().available === false);
ok('still no wallet panel auto-constructed for an unlinked device', panel.walletPanelInjected === null);

console.error = realError; console.warn = realWarn;
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);


