/**
 * GuildUpgradesPage.js — Perk upgrade view for GuildPanel.
 */

import { GUILD_RANKS, GUILD_PERKS, hasPermission, getPerkDescription, getPerkCost } from '../../data/guilds.cjs';

export default class GuildUpgradesPage {
  constructor(panel) {
    this.panel = panel;
  }

  render(guild) {
    const p = this.panel;
    p.setTitle('GUILD UPGRADES');
    const rank = guild.members?.[p.guildSystem.playerId]?.rank;
    const canUpgrade = rank === GUILD_RANKS.LEADER || hasPermission(rank, 'upgradeHall');
    let y = -140;
    for (const perk of GUILD_PERKS) {
      const level = guild.perks?.[perk.id] || 0;
      const maxed = level >= perk.maxLevel;
      const desc = getPerkDescription(perk.id, level + (maxed ? 0 : 1));
      p.addText(-180, y, perk.name, { fontSize: '12px', color: '#9bbc0f', origin: [0, 0.5] });
      p.addText(-180, y + 16, `${desc} — Lv.${level}/${perk.maxLevel}`, { fontSize: '10px', origin: [0, 0.5] });
      if (canUpgrade && !maxed) {
        const cost = getPerkCost(perk.id, level);
        p.addTextButton(160, y, `${cost}g`, () => p.guildSystem.upgradePerk(perk.id), { fontSize: '10px', color: '#a0c4f0' });
      } else if (maxed) {
        p.addText(160, y, 'MAX', { fontSize: '10px', color: '#a89a7e', origin: [0, 0.5] });
      }
      y += 50;
    }
    p.addButton(0, 160, 'BACK', () => { p.page = 'home'; p.refresh(); }, 120);
  }
}
