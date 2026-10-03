/**
 * GuildCreatePage.js — Create-guild view for GuildPanel.
 */

import { GUILD_CREATE_COST } from '../../data/guilds.cjs';

export default class GuildCreatePage {
  constructor(panel) {
    this.panel = panel;
  }

  render() {
    const p = this.panel;
    p.setTitle('CREATE GUILD');
    p.addText(0, -120, 'NAME', { fontSize: '11px', color: '#6B7A99' });
    this.nameInput = p.addInput(0, -95, 220, '');
    p.addText(0, -55, 'TAG (2-4 letters)', { fontSize: '11px', color: '#6B7A99' });
    this.tagInput = p.addInput(0, -30, 120, '');
    p.addText(0, 20, `Cost: ${GUILD_CREATE_COST.toLocaleString()} gold from your inventory.`, { fontSize: '11px', color: '#03E1FF' });
    p.addButton(0, 70, 'FOUND GUILD', () => this.doCreate());
    p.addButton(0, 110, 'BACK', () => { p.page = 'home'; p.refresh(); }, 120);
  }

  doCreate() {
    const p = this.panel;
    const name = this.nameInput?.value || '';
    const tag = this.tagInput?.value || '';
    if (!name || tag.length < 2) {
      p.setStatus('Enter a name and a 2-4 letter tag.');
      return;
    }
    p.guildSystem.create(name, tag);
  }
}
