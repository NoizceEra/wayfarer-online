import { econ } from '../net/economyNet.js';
import { bus, Events } from '../core/events.js';
import { el, panel } from './econDom.js';
import { DYES, gearById } from '../data/gear.js';

// TokenSinkPanel — bought with Wayfarer Tokens (server-authoritative balance).
// Accessible via /sinks. Covers orb upgrades, premium revive (display only:
// the actual offer comes from reviveSystem.js), pet rename, stash expansion,
// and the daily token-claim cap. Gear dyes are cosmetic and paid from the
// in-game Wayfarer Token balance, never directly from a connected wallet.
export class TokenSinkPanel {
  constructor() {
    const { p, title } = panel('ec-sinks', 'WAYFARER TOKEN SINKS', () => this.close());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.build();
    this._offState = econ.on('state', () => this.render());
    this._offSync = econ.on('sync', () => this.render());
    this._offStatus = econ.on('status', () => this.render());
    this._offDeath = bus.on(Events.PLAYER_DIED, () => this.render());
    this._offRevive = bus.on(Events.PLAYER_HP, () => this.render());
  }

  get isOpen() { return this.el.style.display !== 'none'; }
  open() { this.el.style.display = 'flex'; this.render(); }
  close() { this.el.style.display = 'none'; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  destroy() { this.close(); this.el.remove(); if (this._offState) this._offState(); if (this._offSync) this._offSync(); if (this._offStatus) this._offStatus(); if (this._offDeath) this._offDeath(); if (this._offRevive) this._offRevive(); }

  build() {
    const b = this.body; b.innerHTML = '';
    b.appendChild(el('div', 'ec-dim', 'Spend Wayfarer Tokens on permanent upgrades and convenience. All purchases are validated server-side.'));

    // ── wallet + cap ──
    this.walletT = el('div', 'ec-row ec-gold');
    b.appendChild(this.walletT);
    this.capT = el('div', 'ec-dim');
    b.appendChild(this.capT);

    // ── orb upgrades ──
    b.appendChild(el('div', 'ec-h', 'CAPTURE ORBS'));
    const orbBox = el('div', 'ec-row', '', { style: 'flex-direction:column;align-items:stretch;gap:6px' });
    this.orbBox = orbBox;
    b.appendChild(orbBox);

    // ── premium revive ──
    b.appendChild(el('div', 'ec-h', 'PREMIUM REVIVE'));
    this.reviveBox = el('div', 'ec-row', '', { style: 'flex-direction:column;align-items:stretch;gap:6px' });
    b.appendChild(this.reviveBox);

    // ── pet rename ──
    b.appendChild(el('div', 'ec-h', 'PET RENAME'));
    this.petRenameBox = el('div', 'ec-row', '', { style: 'flex-direction:column;align-items:stretch;gap:6px' });
    b.appendChild(this.petRenameBox);

    // ── stash expansion ──
    b.appendChild(el('div', 'ec-h', 'STASH EXPANSION'));
    this.stashBox = el('div', 'ec-row', '', { style: 'flex-direction:column;align-items:stretch;gap:6px' });
    b.appendChild(this.stashBox);

    b.appendChild(el('div', 'ec-h', 'GEAR DYES'));
    this.dyeBox = el('div', 'ec-row', '', { style: 'flex-direction:column;align-items:stretch;gap:6px' });
    b.appendChild(this.dyeBox);
  }

  render() {
    const p = econ.player();
    const tokens = p?.wayfarerTokens ?? 0;
    this.walletT.innerHTML = `<b>Wayfarer Tokens:</b> ${tokens}`;

    const cap = econ.cfg?.tokenWithdrawDailyCap ?? 500;
    const claimed = econ.sinksState?.dailyClaimed ?? 0;
    this.capT.textContent = `Daily token claim cap: ${claimed}/${cap}`;

    const orbs = this._orbStock(p);
    this._renderOrbs(orbs, tokens);
    this._renderRevive(tokens);
    this._renderPetRename(tokens, p);
    this._renderStash(tokens);
    this._renderDyes(tokens, p);
  }

  _orbStock(p) {
    const inv = p?.inventory || [];
    const ext = p?.ext || {};
    const owned = { wayfarer_orb: 0, golden_orb: 0, wayfarer_orb_plus: 0, golden_orb_plus: 0 };
    for (const id of inv) if (Object.prototype.hasOwnProperty.call(owned, id)) owned[id]++;
    // Upgrades are server-side ext flags; treat them as owned for the UI.
    if (ext.wayfarer_orb_plus) owned.wayfarer_orb_plus = 1;
    if (ext.golden_orb_plus) owned.golden_orb_plus = 1;
    return owned;
  }

  _renderOrbs(orbs, tokens) {
    const b = this.orbBox; b.innerHTML = '';
    const rows = [
      { id: 'wayfarer_orb_plus', base: 'wayfarer_orb', name: 'Wayfarer Orb +', cost: 50, bonus: '+0.15 capture bonus' },
      { id: 'golden_orb_plus', base: 'golden_orb', name: 'Golden Orb +', cost: 150, bonus: '+0.25 capture bonus' },
    ];
    if (!orbs.wayfarer_orb && !orbs.wayfarer_orb_plus) {
      b.appendChild(el('div', 'ec-dim', 'Capture orbs can be bought from the Pet Master or found in the world.'));
      return;
    }
    for (const r of rows) {
      const ownedPlus = orbs[r.id] > 0;
      const ownedBase = orbs[r.base] > 0;
      const canBuy = !ownedPlus && ownedBase && tokens >= r.cost;
      const row = el('div', 'ec-row', '', { style: 'justify-content:space-between' });
      row.appendChild(el('span', '', `${r.name} — ${r.cost} tokens (${r.bonus})`));
      const btn = el('button', '', ownedPlus ? 'Owned' : ownedBase ? 'Upgrade' : 'Need base orb');
      btn.disabled = !canBuy;
      if (canBuy) {
        btn.addEventListener('click', () => {
          // avoid duplicate listeners if build() re-runs
          if (btn.dataset.bound) return;
          btn.dataset.bound = '1';
          this._buyOrb(r.id, r.cost);
        });
      }
      row.appendChild(btn);
      b.appendChild(row);
    }
  }

  _buyOrb(id, cost) {
    if (!econ.online) { bus.emit(Events.SYSTEM, 'Play Online to buy orb upgrades.'); return; }
    econ.spendTokens('orb-upgrade', cost, { item: id });
  }

  _renderRevive(tokens) {
    const b = this.reviveBox; b.innerHTML = '';
    const dead = this._isDead();
    const cost = 25;
    const row = el('div', 'ec-row', '', { style: 'justify-content:space-between' });
    row.appendChild(el('span', '', dead ? 'You have fallen. Premium revive now?' : 'Premium revive available when dead.'));
    const btn = el('button', '', `Revive now (${cost} tokens)`);
    btn.disabled = !dead || tokens < cost;
    if (!btn.disabled) {
      btn.addEventListener('click', () => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        // Single spend path (reviveSystem.js owns the confirmation + respawn).
        econ.spendTokens('revive', cost);
      });
    }
    b.appendChild(row);
    b.appendChild(btn);
    if (dead) {
      const alt = el('div', 'ec-dim', 'Or respawn normally and lose 5% gold.');
      b.appendChild(alt);
    }
  }

  _isDead() {
    const p = econ.player();
    return !!p?.dead;
  }

  _renderPetRename(tokens) {
    const b = this.petRenameBox; b.innerHTML = '';
    const cost = 10;
    const row = el('div', 'ec-row', '', { style: 'flex-wrap:nowrap' });
    const input = el('input');
    input.type = 'text'; input.placeholder = 'New pet name'; input.maxLength = 24; input.style.flex = '1';
    const btn = el('button', '', `Rename (${cost} tokens)`);
    btn.disabled = tokens < cost;
    btn.addEventListener('click', () => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      const name = input.value.trim();
      if (!name || name.length > 24) { bus.emit(Events.SYSTEM, 'Pet name must be 1-24 characters.'); return; }
      const petId = this._selectedPetId();
      if (!petId) { bus.emit(Events.SYSTEM, 'Select a pet in the Pet Panel first.'); return; }
      econ.spendTokens('pet-rename', cost, { petId, name });
    });
    row.appendChild(input); row.appendChild(btn);
    b.appendChild(row);
    b.appendChild(el('div', 'ec-dim', 'Select a pet in /pet, then type a new name here.'));
  }

  _selectedPetId() {
    const p = econ.player();
    const roster = p?.ext?.pets?.roster || [];
    const activeSlot = p?.ext?.pets?.active ?? 0;
    return roster[activeSlot]?.id || roster[0]?.id || null;
  }

  _renderStash(tokens) {
    const b = this.stashBox; b.innerHTML = '';
    const tabs = (econ.sinksState?.stashTabs ?? econ.player()?.ext?.stashTabs ?? 0);
    const cost = 100 * (tabs + 1);
    const max = 5;
    const row = el('div', 'ec-row', '', { style: 'justify-content:space-between' });
    row.appendChild(el('span', '', `Stash tabs: ${tabs}/${max} — next: ${cost} tokens (+8 slots)`));
    const btn = el('button', '', 'Buy stash tab');
    btn.disabled = tabs >= max || tokens < cost;
    btn.addEventListener('click', () => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      econ.spendTokens('stash-tab', cost);
    });
    row.appendChild(btn);
    b.appendChild(row);
  }

  _renderDyes(tokens, p) {
    const b = this.dyeBox; b.innerHTML = '';
    b.appendChild(el('div', 'ec-dim', 'Apply a permanent color to gear you own. Cosmetic only; 20 in-game Wayfarer Tokens per color change.'));
    const inventory = p?.inventory || [];
    const equipped = Object.values(p?.equipped || {});
    const ids = [...new Set([...equipped, ...inventory])].filter((id) => gearById(id)?.dyeable !== false);
    if (!ids.length) {
      b.appendChild(el('div', 'ec-dim', 'Find or equip dyeable gear to use this service.'));
      return;
    }

    const itemSelect = el('select', '');
    const itemPlaceholder = document.createElement('option');
    itemPlaceholder.value = ''; itemPlaceholder.textContent = 'Choose your gear'; itemSelect.appendChild(itemPlaceholder);
    for (const id of ids) {
      const option = document.createElement('option');
      option.value = id; option.textContent = gearById(id).name;
      itemSelect.appendChild(option);
    }
    const priorItem = ids.includes(this.dyeItem) ? this.dyeItem : ids[0];
    itemSelect.value = priorItem;
    this.dyeItem = priorItem;
    itemSelect.addEventListener('change', () => { this.dyeItem = itemSelect.value; this.render(); });

    const dyeSelect = el('select', '');
    for (const dye of DYES) {
      const option = document.createElement('option');
      option.value = dye.id; option.textContent = dye.name;
      dyeSelect.appendChild(option);
    }
    const currentDye = p?.dyes?.[priorItem];
    const firstDifferent = DYES.find((dye) => dye.id !== currentDye)?.id || DYES[0].id;
    if (!DYES.some((dye) => dye.id === this.dyeColor && dye.id !== currentDye)) this.dyeColor = firstDifferent;
    dyeSelect.value = this.dyeColor;
    dyeSelect.addEventListener('change', () => { this.dyeColor = dyeSelect.value; this.render(); });

    const apply = el('button', '', `Apply color (20 tokens)`);
    apply.disabled = !econ.online || tokens < 20 || !priorItem || !this.dyeColor || currentDye === this.dyeColor;
    apply.addEventListener('click', () => {
      if (apply.disabled) return;
      econ.spendTokens('gear-dye', 20, { itemId: priorItem, dyeId: this.dyeColor });
    });
    b.append(itemSelect, dyeSelect, apply);
    b.appendChild(el('div', 'ec-dim', 'This uses the game balance shown above. It does not send an SPL token transaction from your wallet.'));
  }
}
