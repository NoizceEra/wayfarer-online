/**
 * seasonNet.js — Client-side network layer for the season pass.
 */

export const SEASON_NET_EVENTS = Object.freeze({
  STATE: 'season:state',
  XP: 'season:xp',
  CLAIMED: 'season:claimed',
  PREMIUM: 'season:premium',
  ERROR: 'season:error',
});

export default class SeasonNet extends Phaser.Events.EventEmitter {
  constructor(scene) {
    super();
    this.scene = scene;
    this.sendFn = null;
    this.unbindFn = null;
  }

  bindTransport(send, onBroadcast) {
    this.sendFn = send;

    const handler = (type, payload) => {
      switch (type) {
        case 'season:state':
          this.emit(SEASON_NET_EVENTS.STATE, payload);
          break;
        case 'season:xp':
          this.emit(SEASON_NET_EVENTS.XP, payload);
          break;
        case 'season:claimed':
          this.emit(SEASON_NET_EVENTS.CLAIMED, payload);
          break;
        case 'season:premium':
          this.emit(SEASON_NET_EVENTS.PREMIUM, payload);
          break;
        case 'season:error':
          this.emit(SEASON_NET_EVENTS.ERROR, payload);
          break;
        default:
          break;
      }
    };

    onBroadcast(handler);
    this.unbindFn = () => offBroadcast?.(handler);
  }

  sendStateRequest() {
    this.sendFn?.('season:getState', {});
  }

  sendXp(source, amount) {
    this.sendFn?.('season:earnXp', { source, amount: Math.max(0, Math.floor(Number(amount) || 0)) });
  }

  sendClaim(tier, track) {
    this.sendFn?.('season:claim', { tier, track: track === 'premium' ? 'premium' : 'free' });
  }

  sendUpgradePremium() {
    this.sendFn?.('season:upgradePremium', {});
  }

  destroy() {
    this.unbindFn?.();
    this.removeAllListeners();
  }
}
