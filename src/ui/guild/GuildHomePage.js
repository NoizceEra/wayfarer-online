/**
 * GuildHomePage.js — Home view for GuildPanel.
 */

import { GUILD_RANKS, getNextLevelCost, canAffordUpgrade, getProgressToNextLevel } from '../../data/guilds.cjs';

export default class GuildHomePage {
  constructor(panel) {
    this.panel = panel;
  }

  renderNoGuild() {
    const p = this.panel;
    p.setTitle('GUILD HALL');
    const y = -80;
    p.addText(0, y, 'You are not in a guild.', { fontSize: '14px' });
    p.addText(0, y + 22, 'Join one to earn shared perks and daily bonuses.', { fontSize: '10px', color: '#a89a7e' });
    p.addButton(0, y + 70, 'CREATE GUILD', () => { p.page = 'create'; p.refresh(); });
    p.addButton(0, y + 110, 'ENTER GUILD HALL', () => p.enterHall());
    p.renderInvites();
  }

  render(guild) {
    const p = this.panel;
    p.setTitle(`${guild.name} [${guild.tag}]`);
    const rank = guild.members?.[p.guildSystem.playerId]?.rank;
    const y = -130;
    p.addText(-180, y, `Level ${guild.level}`, { fontSize: '13px', color: '#9bbc0f', origin: [0, 0.5] });
    p.addText(180, y, `${guild.treasury || 0}g treasury`, { fontSize: '12px', color: '#a0c4f0', origin: [1, 0.5] });
    p.addText(-180, y + 22, `EXP: ${guild.exp}`, { fontSize: '10px', color: '#a89a7e', origin: [0, 0.5] });
    p.drawProgressBar(-70, y + 22, 140, 8, getProgressToNextLevel(guild));

    p.addText(0, y + 56, guild.motd || 'No message of the day.', { fontSize: '11px' });

    const isOfficer = rank === GUILD_RANKS.OFFICER || rank === GUILD_RANKS.LEADER;
    const isLeader = rank === GUILD_RANKS.LEADER;

    p.addButton(-110, y + 110, 'MEMBERS', () => { p.page = 'members'; p.refresh(); }, 100);
    p.addButton(0, y + 110, 'UPGRADES', () => { p.page = 'upgrades'; p.refresh(); }, 100);
    p.addButton(110, y + 110, 'HALL', () => p.enterHall(), 100);

    if (isLeader) {
      const cost = getNextLevelCost(guild);
      const can = canAffordUpgrade(guild) && cost != null;
      p.addButton(-110, y + 155, can ? `UPGRADE LVL (${cost}g)` : 'MAX LEVEL', () => {
        if (can) p.guildSystem.upgradeLevel();
      }, 140);
    }

    p.addButton(110, y + 155, 'LEAVE', () => p.guildSystem.leave(), 100);

    if (isOfficer) {
      p.addText(0, y + 200, 'INVITE PLAYER', { fontSize: '10px', color: '#a89a7e' });
      this.inviteInput = p.addInput(0, y + 225, 200, '');
      p.addButton(130, y + 225, 'INVITE', () => {
        const id = this.inviteInput?.value || '';
        if (id) p.guildSystem.invite(id);
      }, 80);
    }

    p.addText(0, y + 260, 'CONTRIBUTE GOLD', { fontSize: '10px', color: '#a89a7e' });
    this.contributeInput = p.addInput(-60, y + 285, 120, '');
    p.addButton(60, y + 285, 'CONTRIBUTE', () => {
      const value = parseInt(this.contributeInput?.value || '0', 10);
      if (value > 0) p.guildSystem.contribute(value);
    }, 120);
  }
}
