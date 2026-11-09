import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { RANKS, CON, conOf, rollMobLevel, scaleForLevel } from '../data/combatMath.js';
import { StatusSet } from '../systems/status.js';
import { hitReact, deathFx } from '../systems/skillVfx.js';

const FONT = '"Silkscreen", monospace';

// Attack patterns per behaviour (see data/worldEnemies.js BEHAVIOUR).
//  range: start the wind-up inside this distance · wind: telegraph ms
//  speed/ms: lunge velocity + duration · rec: recovery ms · cd: time between attacks
const PATTERNS = {
  hopper:  { range: 30,  wind: 440, speed: 150, ms: 170, rec: 450, cd: 1500 },
  melee:   { range: 30,  wind: 380, speed: 165, ms: 170, rec: 400, cd: 1400 },
  swarm:   { range: 46,  wind: 230, speed: 225, ms: 200, rec: 300, cd: 1100 },
  charger: { range: 95,  wind: 620, speed: 245, ms: 380, rec: 650, cd: 2300 },
  ranged:  { range: 130, wind: 420, shoot: true, rec: 320, cd: 2300 },
};

// Overworld / area monster. Behaviour modes:
//   idle   — wanders around its home point; aggroes when the hero comes within `aggroR`
//   chase  — per-type steering + telegraphed attacks (wind-up → lunge / charge / shot)
//   flee   — some types bolt at low HP, then come back
//   return — leashed (too far from home / hero safe or dead): runs home, evades hits, heals
// WorldScene (via systems/combat.js) calls aiTick() every frame for enemies in the hero's space.
export class Enemy extends Phaser.GameObjects.Container {
  constructor(scene, x, y, typeId, opts = {}) {
    super(scene, x, y);
    const def = ENEMY_TABLE[typeId] || ENEMY_TABLE.dewslime;
    this.def = def; this.typeId = typeId;
    this.home = { x, y };
    this.facing = 'down';
    // — level / rank / scaled stats —
    this.rank = (!def.boss && opts.rank) || RANKS.normal;
    this.affix = !def.boss ? (opts.affix || null) : null;
    const zlv = opts.zoneLv || scene.zoneHere?.(x, y)?.lv || null;
    this.level = (opts.level ?? rollMobLevel(def, zlv)) + this.rank.lv;
    const st = scaleForLevel(def, this.level);
    this.maxHp = Math.round(st.hp * this.rank.hp); this.hp = this.maxHp;
    this.atk = st.atk * this.rank.atk;
    this.hitDmg = (st.dmg != null ? st.dmg * 1.8 : st.atk * 0.45 + 1) * this.rank.atk;
    this.xpValue = Math.max(1, Math.round(st.xp * this.rank.xp));
    this.goldRange = st.gold.map((g) => Math.max(0, Math.round(g * this.rank.gold)));
    this.displayName = `${this.affix ? `${this.affix.name} ` : ''}${this.rank.prefix}${def.name}`;
    this.ai = def.ai && PATTERNS[def.ai] ? def.ai : 'melee';
    this.pat = PATTERNS[this.ai];
    this.aggroR = def.aggro || 85;
    this.leashR = 240;
    this.spdMul = def.spd || 1;
    this.statuses = new StatusSet();
    // Ranked enemies and bosses have a readable guard layer. Regular foes stay
    // fast to dispatch and keep the field visually quiet.
    const guarded = !!def.boss || this.rank !== RANKS.normal;
    this.guardMax = guarded ? Math.max(12, Math.round(this.maxHp * (def.boss ? 0.22 : 0.3))) : 0;
    this.guard = this.guardMax;
    this.guardBrokenUntil = 0;
    this.guardRegenAt = 0;
    this.mode = 'idle';
    this.knockUntil = 0;
    this.wanderAt = 0; this.wx = null; this.wy = null;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeAt = 0;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    const sc = (def.scale || 1) * this.rank.scale;
    this.vscale = sc;
    this.body.setSize(14 * sc, 12 * sc);
    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.2 * sc, sc);
    this.texKey = `mon.${def.sprite}`;
    if (!scene.textures.exists(this.texKey)) this.texKey = 'mon.Slime';
    this.restY = -6 * sc;
    this.sprite = scene.add.sprite(0, this.restY, this.texKey, 0).setScale(sc);
    this.baseTint = this.affix?.color || this.rank.tint || def.tint || null;
    this.restoreTint();
    const parts = [];
    if (this.rank !== RANKS.normal) { // pulsing rank aura under elites / champions
      this.aura = scene.add.ellipse(0, 3, 22 * sc, 9 * sc, this.affix?.color || this.rank.tint, 0.35);
      scene.tweens.add({ targets: this.aura, alpha: 0.1, scaleX: 1.25, scaleY: 1.25, duration: 700, yoyo: true, repeat: -1 });
      parts.push(this.aura);
    }
    // Slime sits only in the bottom half of its 16px frame, so its bar hugs it lower.
    this.barW = this.rank === RANKS.normal ? 16 : 22;
    this.hpBarY = (def.sprite === 'Slime') ? Math.round(-12 * sc) + 2 : -18 - Math.round(8 * (sc - 1));
    this.hpbarBg = scene.add.rectangle(0, this.hpBarY, this.barW + 2, 4, 0x000000, 0.7).setVisible(false);
    this.hpbar = scene.add.rectangle(-this.barW / 2, this.hpBarY, this.barW, 2, 0x2ecc71).setOrigin(0, 0.5).setVisible(false);
    this.stG = scene.add.graphics();
    parts.unshift(this.shadow, this.sprite);
    parts.push(this.hpbarBg, this.hpbar, this.stG);
    this.add(parts);
    this.setDepth(8);
    this.aiState = 'idle'; this.stateUntil = 0; this.nextAtk = 0;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.isSlime = def.sprite === 'Slime';
    this.playMove();
  }

  get alive() { return this.active && !this.dying && this.hp > 0; }
  get guardBroken() { return this.guardMax > 0 && this.scene.time.now < this.guardBrokenUntil; }
  con(playerLv) { return conOf(playerLv, this.level); }

  damageGuard(amount, now = this.scene.time.now) {
    if (!this.guardMax || this.guardBroken || this.guard <= 0 || this.hp <= 0) return false;
    this.guard = Math.max(0, this.guard - Math.max(1, amount));
    this.guardRegenAt = now + 3200;
    if (this.guard > 0) return false;
    this.guardBrokenUntil = now + (this.isBoss ? 1500 : 2300);
    this.guardRegenAt = this.guardBrokenUntil + 1000;
    return true;
  }

  updateGuard(now, delta) {
    if (!this.guardMax || this.guard >= this.guardMax || now < this.guardRegenAt || now < this.guardBrokenUntil) return;
    if (this.guard <= 0) this.guard = this.guardMax * 0.5;
    this.guard = Math.min(this.guardMax, this.guard + this.guardMax * 0.18 * (delta / 1000));
  }

  playMove() {
    const key = `${this.texKey}.move.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }
  setFacingByVelocity(vx, vy) {
    let dir = this.facing;
    if (Math.abs(vx) > Math.abs(vy)) dir = vx > 0 ? 'right' : 'left';
    else if (Math.abs(vy) > 0.5) dir = vy > 0 ? 'down' : 'up';
    if (dir !== this.facing) { this.facing = dir; this.playMove(); }
  }
  get windingUp() { return this.aiState === 'windup'; }
  get channelingSupport() { return this.aiState === 'support'; }

  restoreTint() {
    if (!this.sprite) return;
    const now = this.scene?.time.now || 0;
    if (this.statuses?.has('slow', now) || now < (this.getData?.('slowUntil') || 0)) this.sprite.setTint(0x88ccff);
    else if (this.baseTint) this.sprite.setTint(this.baseTint);
    else this.sprite.clearTint();
  }

  // — nameplate: "Lv3 Dew Slime" in con colour (built lazily, shown near / targeted) —
  setPlate(show, playerLv, alpha = 1) {
    if (!show) { if (this.plate) this.plate.setVisible(false); return; }
    if (!this.plate) {
      this.plate = this.scene.add.text(0, this.hpBarY - 7, '', {
        fontFamily: FONT, fontSize: '8px', color: '#fff', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 0.5).setResolution(2);
      this.add(this.plate);
    }
    if (this.plateLv !== playerLv || this.plateName !== this.displayName || this.plateRole !== this.squadRole || this.plateCaptain !== this.isSquadCaptain) {
      this.plateLv = playerLv; this.plateName = this.displayName;
      this.plateRole = this.squadRole; this.plateCaptain = this.isSquadCaptain;
      const c = this.con(playerLv);
      const role = this.isSquadCaptain ? '[C]' : ({ vanguard: '[V]', flanker: '[F]', support: '[S]' }[this.squadRole] || '');
      this.plate.setText(`${role ? `${role} ` : ''}Lv${this.level} ${this.displayName}`).setColor(c.color);
    }
    this.plate.setVisible(true).setAlpha(alpha);
  }

  showBars(on) {
    this.hpbarBg.setVisible(on); this.hpbar.setVisible(on);
    if (on) this.refreshBar();
  }
  refreshBar() {
    const frac = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpbar.setDisplaySize(Math.max(0.01, this.barW * frac), 2);
    this.hpbar.setFillStyle(frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf39c12 : 0xe74c3c);
  }

  // Status pips under the bar + stun stars.
  drawStatus(now) {
    const g = this.stG;
    const list = this.statuses.size ? this.statuses.list(now) : null;
    const slowOld = now < (this.getData('slowUntil') || 0);
    if (!list?.length && !slowOld) { if (this._stDrawn) { g.clear(); this._stDrawn = false; } return; }
    g.clear(); this._stDrawn = true;
    const ids = list ? list.map((s) => s.id) : [];
    if (slowOld && !ids.includes('slow')) ids.push('slow');
    const COL = { poison: 0x7bd84a, burn: 0xff7a2a, bleed: 0xd02a3a, slow: 0x7ac8ff, stun: 0xffe14a };
    const y = this.hpBarY + 4;
    ids.forEach((id, i) => {
      const x = -((ids.length - 1) * 5) / 2 + i * 5;
      g.fillStyle(0x000000, 0.8).fillRect(x - 2, y - 2, 4, 4);
      g.fillStyle(COL[id] || 0xffffff, 1).fillRect(x - 1.5, y - 1.5, 3, 3);
    });
    if (ids.includes('stun')) {
      for (let i = 0; i < 3; i++) {
        const a = now / 180 + i * 2.09;
        g.fillStyle(0xffe14a, 1).fillCircle(Math.cos(a) * 7, this.hpBarY - 2 + Math.sin(a) * 2, 1.4);
      }
    }
  }

  // — AI —
  aiTick(scene, now, delta, env) {
    const p = env.p;
    const stunned = this.statuses.has('stun', now);
    const slowed = this.statuses.has('slow', now) || now < (this.getData('slowUntil') || 0);
    this.drawStatus(now);
    if (now < this.knockUntil) { this.applyFeel(now); return; }
    if (this.knockUntil) { this.knockUntil = 0; this.body.setVelocity(0, 0); }
    if (stunned) {
      this.body.setVelocity(0, 0);
      if (this.aiState !== 'idle') this.cancelAttack(now, 400);
      this.applyFeel(now);
      return;
    }
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const hx = this.home.x - this.x, hy = this.home.y - this.y;
    const hd = Math.hypot(hx, hy);
    const frenzy = this.affix?.id === 'berserker' && this.hp < this.maxHp * 0.5 ? 1.35 : 1;
    const squadMove = scene.combat?.squadMoveMultiplier?.(this, now) || 1;
    const base = CONFIG.enemySpeed * this.spdMul * env.nightBoost * (slowed ? 0.45 : 1) * frenzy * squadMove;
    if (this.aiState === 'support') {
      this.body.setVelocity(0, 0);
      const t = Phaser.Math.Clamp(1 - (this.stateUntil - now) / 1200, 0, 1);
      env.drawSupport?.(this, t);
      if (Math.floor(now / 85) % 2) this.sprite.setTintFill(0x72cfff); else this.restoreTint();
      if (now >= this.stateUntil) {
        this.aiState = 'recover'; this.stateUntil = now + 400;
        this.showBang(false); this.restoreTint();
        scene.combat?.completeSupportChannel?.(this);
      }
      this.applyFeel(now);
      return;
    }
    if (this.aiState !== 'idle') {
      if (this.mode === 'chase' && env.playerOk) { this.updateAttack(scene, now, p, d, env); this.applyFeel(now); return; }
      this.cancelAttack(now, 300);
    }
    let vx = 0, vy = 0;
    switch (this.mode) {
      case 'idle': {
        const grey = this.rank === RANKS.normal && this.con(p.level) === CON.grey;
        if (env.playerOk && !grey && d < this.aggroR) { scene.combat.aggro(this, true); break; }
        if (now > this.wanderAt) {
          this.wanderAt = now + 1600 + Math.random() * 2800;
          if (Math.random() < 0.35) { this.wx = null; break; }
          const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 34;
          this.wx = this.home.x + Math.cos(a) * r; this.wy = this.home.y + Math.sin(a) * r;
        }
        if (this.wx != null) {
          const wx = this.wx - this.x, wy = this.wy - this.y, wd = Math.hypot(wx, wy);
          if (wd > 3) { const s = 16 * this.spdMul; vx = (wx / wd) * s; vy = (wy / wd) * s; } else this.wx = null;
        }
        break;
      }
      case 'chase': {
        if (!env.playerOk || hd > this.leashR || env.safeAt(this.x, this.y)) { this.startReturn(); break; }
        if (this.def.flee && !this.fled && this.hp < this.maxHp * this.def.flee) {
          this.mode = 'flee'; this.fled = true; this.fleeUntil = now + 2600;
          scene.combat.floatText(this.x, this.y - 18, 'flees!', '#ffd0a0');
          break;
        }
        if (this.squadRole === 'support' && now >= (this.supportReadyAt || 0)
          && scene.combat?.shouldSupportChannel?.(this, now)) {
          this.startSupportChannel(now);
          break;
        }
        const formation = scene.combat?.squadVector?.(this, p, dx, dy, d);
        const nx = formation?.x ?? dx / d, ny = formation?.y ?? dy / d;
        const ready = now >= this.nextAtk;
        if (this.ai === 'ranged') {
          if (now > this.strafeAt) { this.strafeAt = now + 1200 + Math.random() * 900; this.strafe *= -1; }
          if (d < 62) { vx = -nx * base; vy = -ny * base; } else if (d > 108) { vx = nx * base; vy = ny * base; } else { vx = -ny * base * 0.6 * this.strafe; vy = nx * base * 0.6 * this.strafe; }
        } else if (this.ai === 'swarm') {
          const orb = Math.sin(now / 260 + this.wobblePhase) * 0.9;
          const s = base * 1.1;
          vx = (nx - ny * orb) * s; vy = (ny + nx * orb) * s;
        } else if (this.ai === 'charger') {
          if (d > 70 || !ready) { vx = nx * base; vy = ny * base; }
          if (!ready && d < 34) { vx = -nx * base * 0.5; vy = -ny * base * 0.5; } // backs off between charges
        } else {
          const s = base * (this.ai === 'hopper' ? 0.95 : 1);
          if (d > 12) { vx = nx * s; vy = ny * s; }
        }
        if (ready && d < this.pat.range) this.startWindup(now, p);
        break;
      }
      case 'flee': {
        const s = base * 1.2;
        vx = -(dx / d) * s; vy = -(dy / d) * s;
        if (hd > this.leashR) { this.startReturn(); break; }
        if (now > this.fleeUntil || d > 150) { this.mode = 'chase'; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08); this.refreshBar(); }
        break;
      }
      case 'return': {
        if (hd < 6) {
          this.mode = 'idle'; this.hp = this.maxHp; this.fled = false; this.showBars(false);
          this.statuses.clear(); this.restoreTint();
          break;
        }
        const s = base * 1.8;
        vx = (hx / hd) * s; vy = (hy / hd) * s;
        if (this.hp < this.maxHp) { this.hp = Math.min(this.maxHp, this.hp + this.maxHp * delta / 1200); this.refreshBar(); }
        break;
      }
      default: break;
    }
    this.body.setVelocity(vx, vy);
    if (vx || vy) this.setFacingByVelocity(vx, vy);
    this.applyFeel(now);
  }

  startReturn() {
    this.mode = 'return';
    this.statuses.clear(); this.restoreTint();
  }

  startWindup(now, p) {
    if (this.squadId && !this.scene.combat?.requestEnemyAttack?.(this, now)) {
      this.nextAtk = now + 140 + Math.random() * 120;
      return false;
    }
    const pincer = this.scene.combat?.canPincerStrike?.(this, p, now) || false;
    this.attackKind = pincer ? 'pincer' : null;
    this.attackWind = pincer ? Math.max(700, this.pat.wind * 1.35) : this.pat.wind;
    if (pincer) {
      this.pincerReadyAt = now + 8500;
      this.scene.combat?.onPincerStarted?.(this);
    }
    this.aiState = 'windup'; this.stateUntil = now + this.attackWind;
    this.lungeAngle = Math.atan2(p.y - this.y, p.x - this.x);
    this.body.setVelocity(0, 0);
    this.showBang(true);
    return true;
  }

  startSupportChannel(now) {
    this.aiState = 'support'; this.stateUntil = now + 1200; this.supportReadyAt = now + 8000;
    this.body.setVelocity(0, 0); this.showBang(true);
    this.scene.combat?.onSupportStarted?.(this);
    return true;
  }

  cancelAttack(now, delay) {
    this.aiState = 'idle'; this.nextAtk = now + delay;
    this.attackKind = null; this.attackWind = null;
    this.sprite.x = 0; this.showBang(false); this.restoreTint();
  }

  updateAttack(scene, now, p, d, env) {
    const pat = this.pat;
    if (this.aiState === 'windup') {
      this.body.setVelocity(0, 0);
      const wind = this.attackWind || pat.wind;
      const t = 1 - (this.stateUntil - now) / wind;
      // aim tracks the hero for most of the wind-up, then locks (dodgeable)
      if (t < 0.7) this.lungeAngle = Math.atan2(p.y - this.y, p.x - this.x);
      if (Math.floor(now / 70) % 2) this.sprite.setTintFill(this.attackKind === 'pincer' ? 0xd08cff : pat.shoot ? 0xfff2a0 : 0xff6655); else this.restoreTint();
      this.sprite.x = -Math.cos(this.lungeAngle) * 2 * t;
      env.drawWindup?.(this, this.lungeAngle, t, pat);
      if (this.ai === 'charger') env.drawLane?.(this, this.lungeAngle, pat.speed * pat.ms / 1000 + 10, t);
      if (now >= this.stateUntil) {
        this.sprite.x = 0; this.showBang(false); this.restoreTint();
        if (pat.shoot) {
          scene.combat.enemyShot(this, this.lungeAngle);
          this.aiState = 'recover'; this.stateUntil = now + pat.rec;
        } else {
          this.aiState = 'lunge'; this.stateUntil = now + pat.ms; this.lungeHit = false;
          const speed = pat.speed * (this.attackKind === 'pincer' ? 1.12 : 1);
          this.body.setVelocity(Math.cos(this.lungeAngle) * speed, Math.sin(this.lungeAngle) * speed);
          if (this.ai === 'charger') scene.spawnFx(this.x, this.y - 2, 'fx.dust', 0.9);
        }
      }
    } else if (this.aiState === 'lunge') {
      if (!this.lungeHit && d < 11 + 5 * this.vscale && env.playerOk) {
        this.lungeHit = true;
        scene.combat.enemyHitPlayer(this);
      }
      if (now >= this.stateUntil) {
        this.aiState = 'recover'; this.stateUntil = now + pat.rec;
        this.body.setVelocity(0, 0);
      }
    } else if (this.aiState === 'recover') {
      this.body.setVelocity(0, 0);
      if (now >= this.stateUntil) {
        this.aiState = 'idle'; this.nextAtk = now + pat.cd * (0.8 + Math.random() * 0.4);
        this.attackKind = null; this.attackWind = null;
      }
    }
  }

  // Squash & stretch: idle wobble, crouch during wind-up, stretch on the lunge.
  applyFeel(now) {
    const sp = this.sprite, sc = this.vscale;
    let sx = 1, sy = 1;
    if (this.aiState === 'windup') {
      const t = Phaser.Math.Clamp(1 - (this.stateUntil - now) / (this.attackWind || this.pat.wind), 0, 1);
      sy = 1 - 0.22 * t; sx = 1 + 0.18 * t;
    } else if (this.aiState === 'support') {
      const pulse = Math.sin(now / 90) * 0.08;
      sx = 1 + pulse; sy = 1 - pulse;
    } else if (this.aiState === 'lunge') { sx = 1.25; sy = 0.8; } else {
      const amp = this.isSlime ? 0.09 : 0.03;
      const w = Math.sin(now / (this.isSlime ? 240 : 330) + this.wobblePhase);
      sy = 1 + w * amp; sx = 1 - w * amp * 0.8;
    }
    sp.setScale(sx * sc, sy * sc);
    const halfH = 8 * sc;
    sp.y = (this.restY + halfH) - halfH * sy;
  }

  showBang(on) {
    if (on && !this.bang) {
      this.bang = this.scene.add.text(0, this.hpBarY - 6, '!', {
        fontFamily: FONT, fontSize: '12px', color: '#ffe14a', stroke: '#b3261e', strokeThickness: 3,
      }).setOrigin(0.5);
      this.add(this.bang);
    }
    if (!this.bang) return;
    this.bang.setVisible(on);
    if (on) {
      this.bang.setScale(0.4);
      this.scene.tweens.add({ targets: this.bang, scale: 1.2, duration: 120, yoyo: true, ease: 'back.out' });
    }
  }

  // opts: { knock: px/s (0 = none), flashMs }
  hurt(n, opts = {}) {
    const now = this.scene.time.now;
    this.hp -= n;
    if (this.aiState === 'support' && !this.isBoss && opts.flashMs !== 0) {
      this.aiState = 'recover'; this.stateUntil = now + 500; this.supportReadyAt = now + 5200;
      this.sprite.x = 0; this.showBang(false); this.restoreTint();
      this.scene.combat?.onSupportInterrupted?.(this);
    }
    if ((this.aiState === 'windup' || this.aiState === 'lunge') && this.rank === RANKS.normal && this.ai !== 'charger' && !this.isBoss) {
      this.aiState = 'recover'; this.stateUntil = now + 250; this.nextAtk = now + 900; // getting hit interrupts the attack
      this.attackKind = null; this.attackWind = null;
      this.sprite.x = 0; this.showBang(false);
    }
    this.showBars(true);
    if (opts.flashMs !== 0) hitReact(this, n > this.maxHp * 0.2);
    if (opts.flashMs !== 0) {
      this.sprite.setTintFill(0xffffff);
      this.scene.time.delayedCall(opts.flashMs || 70, () => { if (this.active && this.aiState !== 'windup') this.restoreTint(); });
    }
    const knock = opts.knock ?? 160;
    const p = this.scene.player;
    if (knock > 0 && p && !this.isBoss && this.hp > 0) {
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      const k = knock / Math.sqrt(this.rank.hp); // heavier ranks budge less
      this.body.setVelocity(Math.cos(a) * k, Math.sin(a) * k);
      this.knockUntil = now + 110;
    }
    return this.hp <= 0;
  }

  // Death animation: white pop, squash + rise + fade, then destroy.
  die() {
    if (this.dying) return;
    this.dying = true;
    this.hp = 0;
    this.body.setVelocity(0, 0); this.body.enable = false;
    this.scene.enemies?.remove(this);
    this.showBars(false); this.setPlate(false); this.showBang(false); this.stG.clear();
    this.aura?.setVisible(false);
    this.sprite.stop();
    this.sprite.setTintFill(0xffffff);
    const sc = this.vscale;
    if (deathFx(this)) { // family-specific sprite death (bones / ghost / bug); see systems/skillVfx.js
      this.scene.tweens.add({ targets: this.shadow, alpha: 0, duration: 800, onComplete: () => this.destroy() });
      return;
    }
    this.scene.tweens.add({
      targets: this.sprite, scaleX: 1.5 * sc, scaleY: 0.25 * sc, y: this.sprite.y + 4 * sc, duration: 140, ease: 'quad.out',
      onComplete: () => {
        if (!this.active) return;
        this.sprite.setTint(0x333344);
        this.scene.tweens.add({ targets: this.sprite, scaleX: 0.4 * sc, scaleY: 1.4 * sc, y: this.sprite.y - 14, alpha: 0, duration: 320, ease: 'quad.in' });
      },
    });
    this.scene.tweens.add({ targets: this.shadow, alpha: 0, duration: 460, onComplete: () => this.destroy() });
  }
}
