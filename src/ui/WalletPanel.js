import { input } from '../core/input.js';
import { bus, Events } from '../core/events.js';

// Wallet connection panel (Phaser overlay) - optional Solana wallet integration.
// Detects Phantom / Solflare via window injection; shows connect/disconnect UI.
// Stores wallet address in localStorage (no private keys ever touch this code).
const FONT = '"Silkscreen", monospace';
const STORAGE_KEY = 'wayfarer.wallet.v1';

function loadWallet() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; } }
function saveWallet(w) { localStorage.setItem(STORAGE_KEY, JSON.stringify(w)); }
function clearWallet() { localStorage.removeItem(STORAGE_KEY); }

function getProvider() {
  if (typeof window === 'undefined') return null;
  const p = window.phantom?.solana || window.solflare || window.solana;
  if (p?.isPhantom || p?.isSolflare) return p;
  return null;
}

export class WalletPanel {
  constructor(scene) {
    this.scene = scene;
    this.isOpen = false;
    this.wallet = loadWallet();
    this.c = null;
    this.build();
    this.checkAutoConnect();
    this.off = bus.on(Events.SYSTEM, (s) => { if (s === 'wallet-update') this.refresh(); });
    scene.events.once('shutdown', () => this.destroy());
  }

  build() {
    const s = this.scene;
    this.c = s.add.container(0, 0).setDepth(210).setVisible(false);
    const { w: W, h: H } = s.view();
    this.dim = s.add.rectangle(0, 0, W * 2, H * 2, 0x000000, 0.5).setInteractive();
    this.c.add(this.dim);
    const pw = Math.min(W - 24, 340), ph = 220;
    const [bg, ns] = s._nsPair(0, 0, pw, ph, 'ui.panel', 4, 4, 4, 4);
    this.c.add(bg); this.c.add(ns);

    this.titleT = s.add.text(0, -ph / 2 + 22, '\ud83d\udd10 CONNECT WALLET', {
      fontFamily: FONT, fontSize: '13px', color: '#ffe8a0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(212);
    this.c.add(this.titleT);

    this.statusT = s.add.text(0, -20, this.wallet ? 'Connected:\n' + this.wallet.addr.slice(0, 6) + '...' + this.wallet.addr.slice(-4) : 'No wallet connected', {
      fontFamily: FONT, fontSize: '10px', color: this.wallet ? '#7dff9a' : '#c8b890', align: 'center', lineSpacing: 4,
    }).setOrigin(0.5).setDepth(212);
    this.c.add(this.statusT);

    const mkBtn = (y, label, cb, color = 0x8bac0f) => {
      const r = s.add.rectangle(0, y, 180, 28, color).setStrokeStyle(2, 0x306230).setInteractive({ useHandCursor: true }).setDepth(212);
      const t = s.add.text(0, y, label, { fontFamily: FONT, fontSize: '11px', color: '#0f380f' }).setOrigin(0.5).setDepth(213);
      r.on('pointerover', () => r.setFillStyle(0x9bbc0f));
      r.on('pointerout', () => r.setFillStyle(color));
      r.on('pointerdown', () => { r.setFillStyle(0x6a8c0f); cb(); });
      r.on('pointerup', () => r.setFillStyle(color));
      this.c.add([r, t]);
      return r;
    };

    this.connectBtn = mkBtn(24, 'Connect Phantom / Solflare', () => this.connect(), 0x8bac0f);
    this.disconnectBtn = mkBtn(24, 'Disconnect', () => this.disconnect(), 0xc0705a);
    this.disconnectBtn.setVisible(!!this.wallet);
    this.connectBtn.setVisible(!this.wallet);

    mkBtn(64, 'CLOSE', () => this.close(), 0x5a5a48);

    this.dim.on('pointerdown', () => this.close());
  }

  async checkAutoConnect() {
    if (!this.wallet) return;
    const provider = getProvider();
    if (!provider) { this.disconnect(); return; }
    try {
      if (provider.isPhantom && provider.connect) {
        const resp = await provider.connect({ onlyIfTrusted: true });
        if (resp?.publicKey?.toString() !== this.wallet.addr) this.disconnect();
      }
    } catch { }
  }

  async connect() {
    const provider = getProvider();
    if (!provider) {
      this.statusT.setText('Phantom / Solflare not found\nInstall a Solana wallet');
      this.statusT.setColor('#e74c3c');
      return;
    }
    try {
      this.statusT.setText('Connecting...'); this.statusT.setColor('#ffd84a');
      const resp = await provider.connect();
      const addr = resp.publicKey.toString();
      this.wallet = { addr, provider: provider.isPhantom ? 'phantom' : 'solflare' };
      saveWallet(this.wallet);
      this.refresh();
      bus.emit(Events.SYSTEM, 'Wallet connected');
    } catch (e) {
      this.statusT.setText('Failed: ' + e.message);
      this.statusT.setColor('#e74c3c');
    }
  }

  disconnect() {
    const provider = getProvider();
    if (provider?.disconnect) provider.disconnect().catch(() => {});
    clearWallet();
    this.wallet = null;
    this.refresh();
    bus.emit(Events.SYSTEM, 'Wallet disconnected');
  }

  refresh() {
    if (!this.statusT?.active) return;
    if (this.wallet) {
      this.statusT.setText('Connected:\n' + this.wallet.addr.slice(0, 6) + '...' + this.wallet.addr.slice(-4));
      this.statusT.setColor('#7dff9a');
      this.titleT.setText('\ud83d\udd10 WALLET CONNECTED');
    } else {
      this.statusT.setText('No wallet connected');
      this.statusT.setColor('#c8b890');
      this.titleT.setText('\ud83d\udd10 CONNECT WALLET');
    }
    this.connectBtn?.setVisible(!this.wallet);
    this.disconnectBtn?.setVisible(!!this.wallet);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.c.setVisible(true);
    input.pushModal('wallet');
    this.refresh();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.c.setVisible(false);
    input.popModal('wallet');
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  destroy() { this.close(); this.c?.destroy(); this.off?.(); }
}
