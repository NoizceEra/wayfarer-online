/**
 * GuildPanel.js — Guild creation/join/leave/invite UI for Wayfarer Online.
 * Follows the Solana pixel palette and existing panel style.
 * Split into sub-panels to keep each file under 10KB.
 */

import GuildPanelBase from './guild/GuildPanelBase.js';
import GuildHomePage from './guild/GuildHomePage.js';
import GuildMembersPage from './guild/GuildMembersPage.js';
import GuildUpgradesPage from './guild/GuildUpgradesPage.js';
import GuildCreatePage from './guild/GuildCreatePage.js';

export default class GuildPanel extends GuildPanelBase {
  constructor(scene, x, y, guildSystem) {
    super(scene, x, y, guildSystem);
    this.page = 'home';
    this.pages = {
      home: new GuildHomePage(this),
      members: new GuildMembersPage(this),
      upgrades: new GuildUpgradesPage(this),
      create: new GuildCreatePage(this),
    };
    this.registerNetEvents();
    this.refresh();
  }

  registerNetEvents() {
    if (!this.guildSystem?.net) return;
    const net = this.guildSystem.net;
    net.on('guild:state', () => this.refresh());
    net.on('guild:created', () => { this.page = 'home'; this.refresh(); });
    net.on('guild:joined', () => { this.page = 'home'; this.refresh(); });
    net.on('guild:left', () => { this.page = 'home'; this.refresh(); });
    net.on('guild:error', ({ message }) => this.setStatus(message || 'Guild error'));
    net.on('guild:upgraded', () => this.refresh());
    net.on('guild:perkUpgraded', () => this.refresh());
    net.on('guild:contributed', () => this.refresh());
    net.on('guild:inviteReceived', () => this.refresh());
  }

  refresh() {
    this.content.removeAll(true);
    const guild = this.guildSystem?.getGuild?.();
    if (!guild) {
      if (this.page === 'create') {
        this.pages.create.render();
      } else {
        this.page = 'home';
        this.pages.home.renderNoGuild();
      }
    } else {
      if (this.page === 'create') this.page = 'home';
      const page = this.pages[this.page] || this.pages.home;
      page.render(guild);
    }
  }
}
