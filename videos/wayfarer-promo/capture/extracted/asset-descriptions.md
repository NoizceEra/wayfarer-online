# Asset Descriptions

⚠️  No vision credentials — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY), or HYPERFRAMES_VERTEX_PROJECT_ID plus HYPERFRAMES_VERTEX_SERVICE_ACCOUNT for Vertex service-account auth, and re-run.

The `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.

- videos/wayfarer_login_bg.mp4 — [video] 1920×1080, 30.3s, H.264. Official "Wayfarer Online — Pure Gameplay Showcase" reel already used on the site's own login background: title card, crowded Thistle Town (20+ named characters), Equipment panel, Meadowfield combat against Thornmite/Dew Slime. Real, on-brand b-roll — safe to cut into the new promo as supporting footage.
- wayfarer-online.gif — 640×360, 30.3s, 7002KB. Same showcase reel as an animated GIF (lower-res alternate source, prefer the MP4 above for anything full-res).
- favicon.svg — 1KB, favicon
- icon-apple-touch-icon-unsized.png — 1KB, icon apple touch icon unsized
- icon-icon-unsized.svg — 1KB, icon icon unsized
- live/01-town-crowded.jpg — 593×334 reference screenshot, live-captured this session: Thistle Town packed with 20+ named characters (Zephyr, Nessa, Gaffer Nib, Old Tob, Lady Aurelia, Brindle Pip, Maren, Captain Varro, etc.) — real players and ambient AI agents rendered identically, impossible to tell apart at a glance. Primary visual for the "which one is the agent?" beat.
- live/02-title-screen.jpg — 593×334 reference screenshot: clean title screen, Jacquard12 pixel-gothic wordmark "WAYFARER ONLINE", tagline "a cozy open world · solo or together".
- live/03-world-hud.jpg — 593×334 reference screenshot: in-world HUD showing the full top-right icon row (combat log, trophy/season, guild, arena ⚡, skill-tree, agent 🤖, gift) plus live HP/MP/gold/status panel, hotbar, minimap.
- live/04-agent-panel.jpg — 593×334 reference screenshot, AUTHENTIC capture of the real in-game Agent panel (src/ui/AgentPanel.js) opened live: "AGENT" header (green), status/reason lines, NAME/ACTION/ZONE rows, GATHERED/KILLS/SOL FOUND/UPTIME/ACCUMULATED stat grid, "CLAIM DISABLED" button (honestly gated — shown disabled here since no live entitlement data, exactly the documented default-off state). Exact Solana palette confirmed live: bg #0A0E1A, green #14F195, cyan #03E1FF, muted #6B7A99.
- live/05-arena-panel.jpg — 593×334 reference screenshot, AUTHENTIC capture of the real in-game Arena panel (src/ui/ArenaPanel.js): "ARENA" header (green), "RATING 1000", "W0 · L0" record, "OFFLINE — QUEUE UNAVAILABLE", "JOIN QUEUE" button (green/cyan). Background shows a live "WORLD EVENT: SHOOTING STAR" banner — good incidental atmosphere.
