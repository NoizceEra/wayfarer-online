/**
 * GuildMembersPage.js — Member list and rank actions for GuildPanel.
 */

import { GUILD_RANKS } from '../../data/guilds.cjs';

export default class GuildMembersPage {
  constructor(panel) {
    this.panel = panel;
  }

  render(guild) {
    const p = this.panel;
    p.setTitle('GUILD MEMBERS');
    const rank = guild.members?.[p.guildSystem.playerId]?.rank;
    const isLeader = rank === GUILD_RANKS.LEADER;
    const isOfficer = isLeader || rank === GUILD_RANKS.OFFICER;
    let y = -140;
    for (const member of Object.values(guild.members || {})) {
      const nameText = `${member.name || member.playerId} — ${member.rank}`;
      p.addText(-180, y, nameText, { fontSize: '11px', origin: [0, 0.5] });
      if (isLeader && member.playerId !== p.guildSystem.playerId) {
        p.addTextButton(80, y, 'PROMOTE', () => p.guildSystem.promote(member.playerId), { fontSize: '9px', color: '#03E1FF' });
        p.addTextButton(130, y, 'DEMOTE', () => p.guildSystem.demote(member.playerId), { fontSize: '9px', color: '#6B7A99' });
        p.addTextButton(180, y, 'KICK', () => p.guildSystem.kick(member.playerId), { fontSize: '9px', color: '#ff4444' });
      } else if (isOfficer && member.rank === GUILD_RANKS.MEMBER) {
        p.addTextButton(160, y, 'KICK', () => p.guildSystem.kick(member.playerId), { fontSize: '9px', color: '#ff4444' });
      }
      y += 26;
    }
    p.addButton(0, 160, 'BACK', () => { p.page = 'home'; p.refresh(); }, 120);
  }
}
