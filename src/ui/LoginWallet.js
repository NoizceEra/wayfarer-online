// Login-screen [Connect Wallet] button for Wayfarer Online (ui/LoginWallet.js).
//
// Why DOM and not a Phaser object: the login/title screen is drawn inside a
// TRANSPARENT Phaser canvas over the raw HTML5 <video> backdrop (index.html +
// src/main.js). A real <button> element keeps the wallet connect() call inside a
// genuine user gesture (browsers and the Phantom / Solflare extensions require
// one) and lets us match the game's pixel palette without editing TitleScene.js,
// which owns the canvas-side layout.
//
// It shares ONE implementation with the in-game HUD wallet panel: the provider
// lookup, the connect flow and the persisted wallet record all come from
// ui/walletConnect.js, and both surfaces use the same storage key — a player who
// connects here is already connected in the HUD WalletPanel.
//
// Placement mirrors ui/PwaInstall.js: a fixed pill at z-index 8 (above the game
// canvas at z 1, below the boot splash at z 10). It is anchored *beside*
// TitleScene's own "Install App" button when that button is on screen, and the
// position is re-evaluated on a light interval + window resize, so it can never
// creep onto the login name field or the title buttons.
//
// SECURITY: public addresses only — never a private key, and no full address is
// ever logged (only a truncated form is displayed).

import {
  getProvider, connectWallet, disconnectProvider,
  loadWallet, saveWallet, clearWallet, truncateAddress, NO_PROVIDER,
} from './walletConnect.js';

const BTN_ID = 'wf-connect-wallet';
const HINT_ID = 'wf-connect-wallet-hint';
const POLL_MS = 500;
const HINT_MS = 3200;
const FONT = '700 12px/1 "Silkscreen", monospace';

// Solana palette (matches src/scenes/TitleScene.js SOL). Connect = Solana green;
// connected / disconnect = the magenta + purple the HUD WalletPanel already uses.
const SKIN = {
  off: { background: '#14F195', color: '#0A0E1A', border: '2px solid #03E1FF', boxShadow: '0 4px 0 rgba(3,225,255,0.35)' },
  on:  { background: '#DC1FFF', color: '#0A0E1A', border: '2px solid #9945FF', boxShadow: '0 4px 0 rgba(153,69,255,0.45)' },
};

let btn = null;
let hint = null;
let poll = null;
let hintTimer = null;
let busy = false;
let state = null; // last rendered wallet state: 'on' | 'off'
const anchor = { x: 0, y: 0, h: 28, shown: false };

// Returns the live TitleScene only while the login screen is the active scene.
function loginScene() {
  const game = typeof window !== 'undefined' ? window.__wayfarer : null;
  if (!game || !game.scene || typeof game.scene.isActive !== 'function') return null;
  try {
    if (!game.scene.isActive('title')) return null;
    const s = game.scene.getScene('title');
    return s && s.menuSize ? s : null;
  } catch { return null; }
}

// Logical (scene) point -> CSS pixel, through the menu camera (core/display.js)
// and the canvas' on-screen box (handles safe-area insets / DPR scaling).
function mapPoint(scene, lx, ly, rect) {
  const cam = scene.cameras.main;
  const g = scene.game;
  const sx = (lx - cam.scrollX) * cam.zoom;
  const sy = (ly - cam.scrollY) * cam.zoom;
  const kx = rect.width / g.scale.width;
  const ky = rect.height / g.scale.height;
  return { x: rect.left + sx * kx, y: rect.top + sy * ky, kx: kx * cam.zoom, ky: ky * cam.zoom };
}

function build() {
  if (btn || typeof document === 'undefined' || !document.body) return;
  btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  Object.assign(btn.style, {
    position: 'fixed', left: '0px', top: '0px',
    transform: 'translate(-50%, -50%)',
    zIndex: '8', display: 'none', visibility: 'hidden',
    alignItems: 'center', gap: '5px',
    padding: '5px 12px', margin: '0',
    font: FONT, letterSpacing: '1px', whiteSpace: 'nowrap',
    maxWidth: 'calc(100vw - 16px)',
    borderRadius: '6px', cursor: 'pointer',
    appearance: 'none', WebkitAppearance: 'none', WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    ...SKIN.off,
  });
  btn.addEventListener('click', onClick);
  // While focused, keep Space/Enter from also reaching the title scene's
  // keyboard shortcuts (they still activate this button's own click).
  btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  document.body.appendChild(btn);
}

function render(force = false) {
  if (!btn) return;
  const w = loadWallet();
  const next = w && w.addr ? 'on' : 'off';
  if (!force && next === state) return;
  state = next;
  btn.dataset.wallet = next;
  if (next === 'on') {
    const short = truncateAddress(w.addr, 4, 3, '..');
    Object.assign(btn.style, SKIN.on);
    btn.textContent = `\uD83D\uDD10 ${short} \u2715`;
    btn.title = `Disconnect ${short}`;
    btn.setAttribute('aria-label', `Disconnect Solana wallet ${short}`);
  } else {
    Object.assign(btn.style, SKIN.off);
    btn.textContent = '\uD83D\uDD10 Connect Wallet';
    btn.title = 'Connect a Solana wallet (Phantom / Solflare)';
    btn.setAttribute('aria-label', 'Connect Solana wallet');
  }
}

function showHint(msg) {
  if (typeof document === 'undefined' || !document.body) return;
  if (!hint) {
    hint = document.createElement('div');
    hint.id = HINT_ID;
    hint.setAttribute('role', 'status');
    Object.assign(hint.style, {
      position: 'fixed', left: '0px', top: '0px', transform: 'translate(-50%, -50%)',
      zIndex: '8', display: 'none', maxWidth: 'min(320px, calc(100vw - 24px))',
      padding: '6px 10px',
      font: '400 12px/1.35 "PixelifySans", "Silkscreen", monospace',
      color: '#E1E8F0', background: 'rgba(10,14,26,0.92)', border: '1px solid #6B7A99',
      borderRadius: '6px', textAlign: 'center', pointerEvents: 'none',
    });
    document.body.appendChild(hint);
  }
  hint.textContent = msg;
  hint.style.display = 'block';
  hint.style.visibility = 'hidden';
  placeHint();
  hint.style.visibility = 'visible';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { if (hint) hint.style.display = 'none'; }, HINT_MS);
}

function placeHint() {
  if (!hint || !anchor.shown) return;
  hint.style.left = anchor.x + 'px';
  hint.style.top = (anchor.y - anchor.h / 2 - 10 - hint.getBoundingClientRect().height / 2) + 'px';
}

// Anchor beside TitleScene's "Install App" button when present; otherwise in the
// same bottom strip (the slot that button would occupy). Never over the name
// field or the two title buttons — those all live above this band.
function place(scene, rect) {
  const { W, H } = scene.menuSize;
  const gap = 10;
  const r = btn.getBoundingClientRect();
  const wW = r.width || 168, wH = r.height || 28;
  let x, y;
  const install = scene.installBtn;
  const installOn = install && install.active !== false && install.visible !== false && typeof install.getBounds === 'function';
  if (installOn) {
    const b = install.getBounds();
    const tl = mapPoint(scene, b.x, b.y, rect);
    const iw = b.width * tl.kx, ih = b.height * tl.ky;
    if (tl.x + iw + gap + wW <= rect.right - 8) { x = tl.x + iw + gap + wW / 2; y = tl.y + ih / 2; }
    else { x = tl.x + iw / 2; y = tl.y - gap - wH / 2; } // narrow screen: stack above it
  } else {
    const p = mapPoint(scene, W / 2, H - 64, rect);
    x = p.x; y = p.y;
  }
  return { x, y, h: wH };
}

function tick() {
  const scene = loginScene();
  const game = typeof window !== 'undefined' ? window.__wayfarer : null;
  const rect = game && game.canvas ? game.canvas.getBoundingClientRect() : null;
  if (!scene || !rect || rect.width < 10 || rect.height < 10) { hide(); return; }
  if (!btn) build();
  if (!btn) return;
  btn.style.display = 'inline-flex';
  if (!busy) render();
  const pos = place(scene, rect);
  btn.style.left = pos.x + 'px';
  btn.style.top = pos.y + 'px';
  btn.style.visibility = 'visible';
  anchor.x = pos.x; anchor.y = pos.y; anchor.h = pos.h; anchor.shown = true;
  placeHint();
}

function hide() {
  if (btn) { btn.style.display = 'none'; btn.style.visibility = 'hidden'; }
  if (hint) hint.style.display = 'none';
  clearTimeout(hintTimer);
  anchor.shown = false;
}

async function onClick() {
  if (busy) return;
  btn.blur();
  const existing = loadWallet();
  if (existing && existing.addr) { doDisconnect(); return; }

  const provider = getProvider();
  if (!provider) { showHint('No Solana wallet found \u2014 install Phantom or Solflare to connect.'); return; }

  busy = true;
  btn.disabled = true;
  btn.textContent = '\uD83D\uDD10 Connecting\u2026';
  try {
    const { addr, provider: kind } = await connectWallet(provider);
    saveWallet({ addr, provider: kind, network: 'devnet' });
    render(true);
    showHint(`Wallet connected: ${truncateAddress(addr, 4, 3, '..')}`);
    window.dispatchEvent(new CustomEvent('wf-wallet', { detail: { connected: true } }));
  } catch (e) {
    render(true);
    if (e && e.code === NO_PROVIDER) showHint('No Solana wallet found \u2014 install Phantom or Solflare to connect.');
    else showHint('Wallet connection cancelled \u2014 you can try again any time.');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

function doDisconnect() {
  disconnectProvider();
  clearWallet();
  render(true);
  showHint('Wallet disconnected.');
  window.dispatchEvent(new CustomEvent('wf-wallet', { detail: { connected: false } }));
}

export function installLoginWallet() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('resize', tick);
  if (!poll) poll = setInterval(tick, POLL_MS);
  tick();
}
