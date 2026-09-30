import Phaser from 'phaser';

// Hybrid sound: procedural WebAudio blips (always available, used by
// Title/Creator) + real CC0 ogg files via Phaser Sound once a scene with
// loaded audio exists (World/UIScene). Logical names map to ogg keys.
const OGG = {
  swing: ['sfx_swing_1', 'sfx_swing_2'],
  hit: ['sfx_hit_1'],
  hurt: ['sfx_player_hurt'],
  monsterDie: ['sfx_monster_die'],
  coin: ['sfx_coin'],
  gold: ['sfx_gold'],
  level: ['jng_levelup1'],
  quest: ['jng_success3'],
  ui: ['sfx_ui_click'],
  error: ['sfx_ui_error'],
  arrow: ['sfx_arrow_shot'],
  cast: ['sfx_cast_1', 'sfx_cast_2'],
  fireball: ['sfx_fireball'],
  explosion: ['sfx_explosion'],
  dash: ['sfx_whoosh_dash'],
  heal: ['sfx_heal'],
  potion: ['sfx_potion_drink'],
  npc: ['sfx_npc_blip'],
  alert: ['sfx_alert'],
  step: ['sfx_step_0', 'sfx_step_1'],
  door: ['sfx_door_open'],
  roar: ['sfx_boss_roar'],
  slam: ['sfx_impact_heavy'],
  chest: ['sfx_chest_unlock'],
  warp: ['sfx_powerup'],
  pickup: ['sfx_pickup'],
};
const MUSIC_FOR_ZONE = {
  title: 'mus_title', town: 'mus_village', meadow: 'mus_forest', woods: 'mus_forest', ruins: 'mus_ruins',
  // expansion maps + interiors
  inn: 'mus_village', cottage_a: 'mus_village', cottage_b: 'mus_village',
  dock: 'mus_village_alt', dock_beach: 'mus_village_alt',
  crypt: 'mus_crypt', frost: 'mus_tension', frost_camp: 'mus_tension',
};

class AudioBus {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.scene = null; this.musicKey = null; this.musicObj = null;
    this.stepIdx = 0; this.lastStep = 0;
  }
  attach(scene) { this.scene = scene; }
  canPlay(key) { return this.enabled && this.scene && this.scene.cache.audio.exists(key) && this.scene.sound; }
  play(logical, vol = 1) {
    const keys = OGG[logical];
    if (!keys) return;
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (this.canPlay(key)) { try { this.scene.sound.play(key, { volume: 0.5 * vol }); return; } catch { /* fall through */ } }
    this.blipFor(logical);
  }
  musicFor(zoneId) {
    const key = MUSIC_FOR_ZONE[zoneId] || (String(zoneId).startsWith('mus_') ? zoneId : 'mus_forest');
    if (key === this.musicKey || !this.enabled) return;
    if (!this.canPlay(key)) return;
    try {
      this.musicObj?.stop();
      this.musicObj = this.scene.sound.add(key, { volume: 0.35, loop: true });
      this.musicObj.play();
      this.musicKey = key;
    } catch { /* ignore */ }
  }
  stopMusic() { try { this.musicObj?.stop(); } catch {} this.musicObj = null; this.musicKey = null; }
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMusic();
    else this.musicKey = null; // force restart on next musicFor
    return this.enabled;
  }
  footstep(now) {
    if (now - this.lastStep < 320) return;
    this.lastStep = now;
    this.stepIdx = 1 - this.stepIdx;
    if (this.canPlay('sfx_step_0')) { try { this.scene.sound.play(this.stepIdx ? 'sfx_step_0' : 'sfx_step_1', { volume: 0.18 }); return; } catch {} }
  }
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
  blip(freq = 440, dur = 0.08, type = 'square', vol = 0.05) {
    if (!this.enabled) return;
    this.ensure(); if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.stop(this.ctx.currentTime + dur);
  }
  blipFor(logical) {
    if (logical === 'coin' || logical === 'gold') { this.blip(880, 0.08); setTimeout(() => this.blip(1320, 0.1), 60); }
    else if (logical === 'level' || logical === 'quest') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.12), i * 90));
    else if (logical === 'error') this.blip(160, 0.15);
    else if (logical === 'hit' || logical === 'hurt') this.blip(140, 0.12);
    else if (logical === 'swing' || logical === 'arrow') this.blip(220, 0.1, 'sawtooth', 0.04);
    else this.blip(660, 0.05);
  }
  // Back-compat API used by Title/Creator/World/UIScene
  swing() { this.play('swing', 0.8); }
  hit() { this.play('hit'); }
  coin() { this.play('coin', 0.8); }
  level() { this.play('level'); }
  ui() { this.play('ui', 0.7); }
  error() { this.play('error'); }
}
export const audio = new AudioBus();
