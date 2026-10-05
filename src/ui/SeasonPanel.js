/**
 * SeasonPanel.js — Season pass UI for Wayfarer Online.
 * Follows existing Solana palette, pixel fonts, and panel opacity patterns.
 */

import { SEASON_TIERS, SEASON_CONFIG, REWARD_TYPES, getProgressToNextTier } from '../data/seasons.js';

const COLORS = Object.freeze({
  bg: 0x0b0d14,
  panel: 0x161b22,
  green: 0x9bbc0f,
  purple: 0xc8a840,
  cyan: 0xa0c4f0,
  magenta: 0xff7a6a,
  white: 0xf4f0dc,
  muted: 0xa89a7e,
  gold: 0xffb800,
});

const FONTS = Object.freeze({
  title: '"Jacquard12", "Courier New", monospace',
  button: '"Silkscreen", "Courier New", monospace',
  body: '"PixelifySans", "Courier New", monospace',
});

export default class SeasonPanel extends Phaser.GameObjects.Container {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y);
    this.scene = scene;
    this.seasonSystem = options.seasonSystem || null;
    this.onClaim = options.onClaim || (() => {});
    this.onUpgrade = options.onUpgrade || (() => {});
    this.scrollIndex = 0;
    this.rows = [];

    this.createUI();
    this.setVisible(false);
    this.setDepth(1000);
    this.scene.add.existing(this);

    this.seasonSystem?.on('season:stateUpdated', () => this.refresh());
    this.seasonSystem?.on('season:xpEarned', () => this.refresh());
    this.seasonSystem?.on('season:rewardsClaimed', () => this.refresh());
    this.seasonSystem?.on('season:premiumActivated', () => this.refresh());
  }

  createUI() {
    const w = 460;
    const h = 500;

    this.modal = this.scene.add.rectangle(0, 0, 960, 640, 0x000000, 0.55)
      .setInteractive({ useHandCursor: true });
    this.modal.on('pointerdown', () => this.close());
    this.add(this.modal);

    this.panel = this.scene.add.rectangle(0, 0, w, h, COLORS.panel, 0.8)
      .setStrokeStyle(2, COLORS.purple, 0.9);
    this.add(this.panel);

    this.title = this.scene.add.text(0, -h / 2 + 24, SEASON_CONFIG.name.toUpperCase(), {
      fontFamily: FONTS.title,
      fontSize: '24px',
      color: '#9bbc0f',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add(this.title);

    this.subtitle = this.scene.add.text(0, -h / 2 + 48, `SEASON PASS • ${SEASON_CONFIG.maxTier} TIERS`, {
      fontFamily: FONTS.body,
      fontSize: '10px',
      color: '#a89a7e',
    }).setOrigin(0.5);
    this.add(this.subtitle);

    this.closeBtn = this.scene.add.text(w / 2 - 14, -h / 2 + 14, '✕', {
      fontFamily: FONTS.button,
      fontSize: '14px',
      color: '#ff7a6a',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerdown', () => this.close());
    this.add(this.closeBtn);

    this.statusText = this.scene.add.text(0, -h / 2 + 72, '', {
      fontFamily: FONTS.body,
      fontSize: '11px',
      color: '#a0c4f0',
    }).setOrigin(0.5);
    this.add(this.statusText);

    this.upgradeBtn = this.createPixelButton(0, h / 2 - 34, `UPGRADE PREMIUM (${SEASON_CONFIG.premiumCostGold} GOLD)`, () => this.onUpgrade(), 280);
    this.add(this.upgradeBtn);

    this.trackContainer = this.scene.add.container(0, -h / 2 + 100);
    this.add(this.trackContainer);

    this.buildTrack();
    this.refresh();
  }

  buildTrack() {
    for (const row of this.rows) row.destroy();
    this.rows = [];

    let y = 0;
    for (const tierDef of SEASON_TIERS) {
      const row = this.createTierRow(0, y, tierDef);
      this.rows.push(row);
      this.trackContainer.add(row);
      y += 54;
    }
  }

  createTierRow(x, y, tierDef) {
    const container = this.scene.add.container(x, y);
    const rowW = 420;
    const rowH = 48;

    const bg = this.scene.add.rectangle(0, 0, rowW, rowH, COLORS.bg, 0.4)
      .setStrokeStyle(1, COLORS.purple, 0.3);
    container.add(bg);

    const tierText = this.scene.add.text(-rowW / 2 + 12, 0, `T${tierDef.tier}`, {
      fontFamily: FONTS.button,
      fontSize: '12px',
      color: '#f4f0dc',
    }).setOrigin(0, 0.5);
    container.add(tierText);

    const freeLabel = this.createRewardLabel(-rowW / 2 + 60, -10, tierDef.free, 'free');
    container.add(freeLabel);

    const premiumLabel = this.createRewardLabel(-rowW / 2 + 60, 10, tierDef.premium, 'premium');
    container.add(premiumLabel);

    const claimFree = this.createPixelButton(rowW / 2 - 50, -10, 'CLAIM', () => this.onClaim(tierDef.tier, 'free'), 80);
    claimFree.tier = tierDef.tier;
    claimFree.track = 'free';
    container.add(claimFree);

    const claimPremium = this.createPixelButton(rowW / 2 - 50, 10, 'CLAIM', () => this.onClaim(tierDef.tier, 'premium'), 80);
    claimPremium.tier = tierDef.tier;
    claimPremium.track = 'premium';
    container.add(claimPremium);

    container.bg = bg;
    container.claimFree = claimFree;
    container.claimPremium = claimPremium;
    container.tierDef = tierDef;
    return container;
  }

  createRewardLabel(x, y, reward, track) {
    const text = rewardLabel(reward);
    const color = track === 'premium' ? '#c8a840' : '#9bbc0f';
    return this.scene.add.text(x, y, text, {
      fontFamily: FONTS.body,
      fontSize: '10px',
      color,
    }).setOrigin(0, 0.5);
  }

  createPixelButton(x, y, label, onClick, width = 100) {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.rectangle(0, 0, width, 18, COLORS.purple, 0.9)
      .setStrokeStyle(1, COLORS.green, 0.6);
    bg.setInteractive({ useHandCursor: true });

    const text = this.scene.add.text(0, 0, label, {
      fontFamily: FONTS.button,
      fontSize: '9px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(COLORS.purple));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));

    container.add([bg, text]);
    container.bg = bg;
    container.text = text;
    return container;
  }

  refresh() {
    const state = this.seasonSystem?.getState?.() || { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    const { xp, tier, premium, claimedFree, claimedPremium } = state;

    this.statusText.setText(`TIER ${tier} • ${xp.toLocaleString()} XP • PROGRESS ${Math.floor(getProgressToNextTier(xp) * 100)}%`);
    this.upgradeBtn.setVisible(!premium);
    if (premium) {
      this.upgradeBtn.text.setText('PREMIUM ACTIVE');
    } else {
      this.upgradeBtn.text.setText(`UPGRADE PREMIUM (${SEASON_CONFIG.premiumCostGold} GOLD)`);
    }

    for (const row of this.rows) {
      const tierDef = row.tierDef;
      const unlocked = tier <= tierDef.tier;
      row.bg.setStrokeStyle(1, unlocked ? COLORS.green : COLORS.purple, unlocked ? 0.6 : 0.3);

      const freeClaimed = claimedFree.includes(tierDef.tier);
      const premiumClaimed = claimedPremium.includes(tierDef.tier);

      this.setClaimButton(row.claimFree, unlocked && !freeClaimed);
      this.setClaimButton(row.claimPremium, premium && unlocked && !premiumClaimed, true);
    }
  }

  setClaimButton(btn, active, isPremium = false) {
    btn.bg.setFillStyle(active ? (isPremium ? COLORS.gold : COLORS.green) : COLORS.muted, active ? 0.9 : 0.3);
    btn.text.setText(active ? 'CLAIM' : '✓');
    btn.bg.setInteractive(active ? { useHandCursor: true } : false);
  }

  open() {
    this.setVisible(true);
    this.refresh();
    this.seasonSystem?.requestState?.();
  }

  close() {
    this.setVisible(false);
  }
}

function rewardLabel(reward) {
  if (!reward) return '—';
  switch (reward.type) {
    case REWARD_TYPES.GOLD: return `${reward.amount} GOLD`;
    case REWARD_TYPES.TOKEN_POINTS: return `${reward.amount} TOKENS`;
    case REWARD_TYPES.PREMIUM_REVIVE_TOKENS: return `${reward.amount} REVIVE TOKEN${reward.amount === 1 ? '' : 'S'}`;
    case REWARD_TYPES.PET_RENAME_TAG: return `${reward.amount} PET RENAME`;
    case REWARD_TYPES.STASH_EXPANDER: return `+${reward.amount} STASH`;
    case REWARD_TYPES.COSMETIC: return reward.name.toUpperCase();
    default: return reward.type;
  }
}
