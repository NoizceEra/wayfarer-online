import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { input } from '../core/input.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { loadProfile, saveProfile } from '../core/save.js';
// Provider lookup, connect flow and the persisted wallet record are shared with
// the login-screen [Connect Wallet] button (ui/LoginWallet.js) so the two wallet
// surfaces can never drift apart.
import {
  getProvider, connectWallet, disconnectProvider,
  loadWallet, saveWallet, clearWallet, truncateAddress,
} from './walletConnect.js';

// WalletPanel v2 \u2014 real Solana integration with @solana/web3.js
const FONT = '"Silkscreen", monospace';

const NETWORKS = {
  mainnet: { name: 'Mainnet', url: 'https://api.mainnet-beta.solana.com' },
  devnet:  { name: 'Devnet',  url: clusterApiUrl('devnet') },
};

export class WalletPanel {
  constructor(scene) {
    this.scene = scene;
    this.isOpen = false;
    this.wallet = loadWallet();
    this.balance = null;
    this.network = this.wallet?.network || 'devnet';
    this.connection = new Connection(NETWORKS[this.network].url, 'confirmed');
    this.c = null;
    this.build();
    this.checkAutoConnect();
    this.off = bus.on(Events.SYSTEM, (s) => { if (s === 'wallet-update') this.refresh(); });
    scene.events.once('shutdown', () => this.destroy());
    this.pollTimer = scene.time.addEvent({ delay: 15000, loop: true, callback: () => { if (this.isOpen && this.wallet) this.fetchBalance(); } });
  }

  build() {
    const s = this.scene;
    this.c = s.add.container(0, 0).setDepth(210).setVisible(false);
    const { w: W, h: H } = s.view();
    this.dim = s.add.rectangle(0, 0, W * 2, H * 2, 0x000000, 0.55).setInteractive();
    this.c.add(this.dim);
    const pw = Math.min(W - 24, 360), ph = 320;
    const [bg, ns] = s._nsPair(0, 0, pw, ph, 'ui.panel', 4, 4, 4, 4);
    this.c.add(bg); this.c.add(ns);

    this.titleT = s.add.text(0, -ph / 2 + 24, '\uD83D\uDD10 CONNECT WALLET', {
      fontFamily: FONT, fontSize: '13px', color: '#14f195', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(212);
    this.c.add(this.titleT);

    this.netT = s.add.text(pw / 2 - 12, -ph / 2 + 24, this.network.toUpperCase(), {
      fontFamily: FONT, fontSize: '9px', color: '#9945ff',
    }).setOrigin(1, 0.5).setDepth(212).setInteractive({ useHandCursor: true });
    this.netT.on('pointerdown', () => this.toggleNetwork());
    this.c.add(this.netT);

    this.statusT = s.add.text(0, -18, 'No wallet connected', {
      fontFamily: FONT, fontSize: '10px', color: '#6b7a99', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5).setDepth(212);
    this.c.add(this.statusT);

    const mkBtn = (y, label, cb, color = 0x14f195, stroke = 0x03e1ff) => {
      const r = s.add.rectangle(0, y, 200, 30, color).setStrokeStyle(2, stroke).setInteractive({ useHandCursor: true }).setDepth(212);
      const t = s.add.text(0, y, label, { fontFamily: FONT, fontSize: '11px', color: '#0a0e1a' }).setOrigin(0.5).setDepth(213);
      r.on('pointerover', () => r.setFillStyle(0x0db87a));
      r.on('pointerout', () => r.setFillStyle(color));
      r.on('pointerdown', () => { r.setFillStyle(0x0a8f5c); cb(); });
      r.on('pointerup', () => r.setFillStyle(color));
      this.c.add([r, t]);
      return r;
    };

    this.connectBtn = mkBtn(44, 'Connect Phantom / Solflare', () => this.connect(), 0x14f195, 0x03e1ff);
    this.disconnectBtn = mkBtn(44, 'Disconnect', () => this.disconnect(), 0xdc1fff, 0x9945ff);
    this.disconnectBtn.setVisible(!!this.wallet);
    this.connectBtn.setVisible(!this.wallet);

    this.copyBtn = mkBtn(84, 'Copy Address', () => {
      if (this.wallet?.addr) navigator.clipboard?.writeText(this.wallet.addr);
      this.say('Address copied!');
    }, 0x1a103c, 0x03e1ff);
    this.copyBtn.setVisible(!!this.wallet);

    // Link the connected wallet to the game account (opens the token bridge
    // panel, which requests an ed25519 signature challenge to prove ownership).
    this.linkBtn = mkBtn(120, 'Link to account', () => {
      if (!this.wallet?.addr) { this.say('Connect a wallet first.'); return; }
      const bridge = window.__econUI?.bridge;
      if (!bridge) { this.say('Token bridge UI not available.'); return; }
      bridge.open({ link: true });
      this.close();
    }, 0x14f195, 0x03e1ff);
    this.linkBtn.setVisible(!!this.wallet);

    mkBtn(164, 'CLOSE', () => this.close(), 0x0a0e1a, 0x6b7a99);

    this.toastT = s.add.text(0, ph / 2 - 20, '', {
      fontFamily: FONT, fontSize: '9px', color: '#14f195', align: 'center',
    }).setOrigin(0.5).setDepth(212);
    this.c.add(this.toastT);

    this.dim.on('pointerdown', () => this.close());
  }

  say(msg) {
    if (this.toastT?.active) { this.toastT.setText(msg); this.scene.time.delayedCall(2000, () => this.toastT?.setText('')); }
  }

  async checkAutoConnect() {
    if (!this.wallet) return;
    const provider = getProvider();
    if (!provider) { this.disconnect(); return; }
    try {
      if (provider.isPhantom && provider.connect) {
        const resp = await provider.connect({ onlyIfTrusted: true });
        if (resp?.publicKey?.toString() !== this.wallet.addr) this.disconnect();
        else this.fetchBalance();
      }
    } catch { }
  }

  async connect() {
    const provider = getProvider();
    if (!provider) {
      this.statusT.setText('Phantom / Solflare not found\nInstall a Solana wallet');
      this.statusT.setColor('#dc1fff');
      return;
    }
    try {
      this.statusT.setText('Connecting...'); this.statusT.setColor('#03e1ff');
      const { addr, provider: kind } = await connectWallet(provider);
      this.wallet = { addr, provider: kind, network: this.network };
      saveWallet(this.wallet);
      this.syncToProfile(addr);
      this.refresh();
      this.fetchBalance();
      bus.emit(Events.SYSTEM, 'Wallet connected');
      this.say('Wallet connected!');
    } catch (e) {
      this.statusT.setText('Failed: ' + (e.message || 'rejected'));
      this.statusT.setColor('#dc1fff');
    }
  }

  disconnect() {
    disconnectProvider();
    clearWallet();
    this.wallet = null;
    this.balance = null;
    this.syncToProfile(null);
    this.refresh();
    bus.emit(Events.SYSTEM, 'Wallet disconnected');
  }

  toggleNetwork() {
    this.network = this.network === 'devnet' ? 'mainnet' : 'devnet';
    this.connection = new Connection(NETWORKS[this.network].url, 'confirmed');
    if (this.wallet) { this.wallet.network = this.network; saveWallet(this.wallet); }
    this.refresh();
    if (this.wallet) this.fetchBalance();
  }

  async fetchBalance() {
    if (!this.wallet?.addr) return;
    try {
      const pk = new PublicKey(this.wallet.addr);
      const lamports = await this.connection.getBalance(pk);
      this.balance = lamports;
      this.refresh();
    } catch (e) {
      this.balance = null;
    }
  }

  syncToProfile(addr) {
    const prof = loadProfile() || {};
    if (addr) prof.wallet = addr;
    else delete prof.wallet;
    saveProfile(prof);
  }

  activeStake() {
    try {
      const n = window.__econ?.name || (typeof net !== 'undefined' && net?.name);
      if (!n) return null;
      const pr = JSON.parse(localStorage.getItem(`wayfarer.progress.${n}`) || 'null');
      const s = pr?.ext?.stake;
      if (s && s.lockedUntil > Date.now()) return s;
    } catch { /* ignore */ }
    return null;
  }

  refresh() {
    if (!this.statusT?.active) return;
    if (this.netT?.active) this.netT.setText((this.network || 'devnet').toUpperCase());
    if (this.wallet) {
      const addr = this.wallet.addr;
      const short = truncateAddress(addr, 6, 4, '...');
      const bal = this.balance !== null ? (this.balance / 1e9).toFixed(4) + ' SOL' : '...';
      const stake = this.activeStake();
      const stakeLine = stake ? `Stake: ${stake.tier.toUpperCase()} (+${Math.round(stake.dropRate * 100)}% drops)` : '';
      this.statusT.setText(`${short}\nBalance: ${bal}\nNetwork: ${NETWORKS[this.network]?.name || this.network}${stakeLine ? '\n' + stakeLine : ''}`);
      this.statusT.setColor('#14f195');
      this.titleT.setText('\uD83D\uDD10 WALLET CONNECTED');
    } else {
      this.statusT.setText('No wallet connected');
      this.statusT.setColor('#6b7a99');
      this.titleT.setText('\uD83D\uDD10 CONNECT WALLET');
    }
    this.connectBtn?.setVisible(!this.wallet);
    this.disconnectBtn?.setVisible(!!this.wallet);
    this.copyBtn?.setVisible(!!this.wallet);
    this.linkBtn?.setVisible(!!this.wallet);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.c.setVisible(true);
    input.pushModal('wallet');
    this.refresh();
    if (this.wallet) this.fetchBalance();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.c.setVisible(false);
    input.popModal('wallet');
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  destroy() { this.close(); this.c?.destroy(); this.off?.(); this.pollTimer?.remove(false); }
}
