/**
 * guilds.cjs — Backward-compatible re-export of the server guild service.
 */

const { GuildService } = require('./guild/guildService.cjs');

module.exports = { GuildService };
