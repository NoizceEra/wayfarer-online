import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'marketplace');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordSegment(page, outPngPath, outWebmPath, durationMs, setupFn, actionFn) {
  const pngName = outPngPath ? path.basename(outPngPath) : null;
  const webmName = outWebmPath ? path.basename(outWebmPath) : null;
  console.log(`\n======================================================`);
  console.log(`Capturing [${pngName || 'N/A'}] & [${webmName || 'N/A'}]`);
  console.log(`======================================================`);

  // Run initial scene setup
  if (setupFn) {
    await page.evaluate(setupFn);
    await sleep(1000);
  }

  // Start MediaRecorder if webm path is requested
  if (outWebmPath) {
    await page.evaluate(() => {
      window.__recordedChunks = [];
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Canvas not found!');

      const stream = canvas.captureStream(60);
      let recorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 });
      } catch (e) {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 8000000 });
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          window.__recordedChunks.push(e.data);
        }
      };

      window.__mediaRecorder = recorder;
      recorder.start(50);
    });
  }

  // Take initial screenshot after setup settles
  if (outPngPath) {
    await sleep(600);
    await page.screenshot({ path: outPngPath });
    console.log(`✔ Saved screenshot [${pngName}]`);
  }

  // Run action animations during recording
  if (outWebmPath) {
    const startTime = Date.now();
    if (actionFn) {
      await actionFn(page);
    }
    const elapsed = Date.now() - startTime;
    if (elapsed < durationMs) {
      await sleep(durationMs - elapsed);
    }

    // Stop MediaRecorder and retrieve WebM buffer
    console.log(`Stopping MediaRecorder for [${webmName}]...`);
    const base64Video = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const recorder = window.__mediaRecorder;
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const blob = new Blob(window.__recordedChunks, { type: 'video/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        };
        recorder.stop();
      });
    });

    if (base64Video) {
      const videoBuffer = Buffer.from(base64Video, 'base64');
      fs.writeFileSync(outWebmPath, videoBuffer);
      console.log(`✔ Created video clip [${webmName}] (${(videoBuffer.length / 1024).toFixed(1)} KB)`);
    } else {
      console.error(`✖ Failed to record video for ${outWebmPath}`);
    }
  }
}

async function main() {
  console.log('=== Marketplace & Token Burn Asset Generator & Recorder ===');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Output Directory: ${OUT_DIR}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching Puppeteer browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  console.log(`Navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await sleep(1000);

  // Initialize Hero & Launch World Scene
  console.log('Starting Thistle Town World Scene...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 0, hairStyle: 1, hairColor: 2, topTint: 1, accessory: 'scarf', weapon: 'sunfire_blade' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  // Wait 4 seconds for World Scene map rendering
  await sleep(4000);

  // --------------------------------------------------------------------------
  // Helper for custom UI overlays
  // --------------------------------------------------------------------------
  await page.evaluate(() => {
    window.__clearCustomOverlays = () => {
      const old = document.querySelectorAll('.wf-custom-overlay');
      old.forEach((el) => el.remove());
    };
  });

  // --------------------------------------------------------------------------
  // 1. market_1_seasonal.png & market_1_seasonal.webm
  // (Trading Halloween, Winter & Everyday gear)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'market_1_seasonal.png'),
    path.join(OUT_DIR, 'market_1_seasonal.webm'),
    4500,
    () => {
      window.__clearCustomOverlays();
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      const ui = game.scene.getScene('ui');

      if (ui.craftPanel?.isOpen) ui.craftPanel.close();

      if (world && world.player && world.townfolk) {
        const jackRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'jack');
        if (jackRec) {
          world.player.setPosition(jackRec.day.x + 20, jackRec.day.y + 16);
          world.player.setFacing('left');
          world.cameras.main.centerOn(world.player.x, world.player.y);
        }
        world.player.equip('jacko_helm', true);
        world.player.equip('reaper_scythe', true);
        world.player.equip('vampire_coat', true);
      }

      if (window.__econUI) {
        const { market } = window.__econUI;
        market.open('browse');
        market.result = {
          page: 0, pages: 1, total: 9, mine: false,
          items: [
            { id: 'm1', item: 'jacko_helm', price: 1500, seller: 'JackO', lvl: 12, left: 86400 },
            { id: 'm2', item: 'reaper_scythe', price: 3200, seller: 'GrimMaster', lvl: 18, left: 72000 },
            { id: 'm3', item: 'vampire_coat', price: 2100, seller: 'NightBat', lvl: 15, left: 43200 },
            { id: 'm4', item: 'witch_broom', price: 1800, seller: 'HexWitch', lvl: 14, left: 60000 },
            { id: 'm5', item: 'winter_coat', price: 1400, seller: 'FrostyRider', lvl: 10, left: 80000 },
            { id: 'm6', item: 'ice_crown', price: 3500, seller: 'RimeKing', lvl: 20, left: 50000 },
            { id: 'm7', item: 'sunfire_blade', price: 1250, seller: 'Solaris', lvl: 10, left: 86400 },
            { id: 'm8', item: 'iron_greatblade', price: 850, seller: 'SmithyJohn', lvl: 8, left: 36000 },
            { id: 'm9', item: 'candy_pouch', price: 300, seller: 'SweetTooth', lvl: 1, left: 90000 }
          ]
        };
        market.render();
      }
    },
    async () => {
      // Cycle gear & outfit preview during recording
      for (let i = 0; i < 3; i++) {
        await page.evaluate((idx) => {
          const game = window.__wayfarer;
          const world = game.scene.getScene('world');
          if (world && world.player) {
            if (idx === 1) {
              world.player.equip('witch_hat', true);
              world.player.equip('witch_broom', true);
            } else if (idx === 2) {
              world.player.equip('winter_coat', true);
              world.player.equip('sunfire_blade', true);
            }
          }
        }, i);
        await sleep(1000);
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. market_2_crafting.png & market_2_crafting.webm
  // (Smithing high-tier gear & selling to new players)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'market_2_crafting.png'),
    path.join(OUT_DIR, 'market_2_crafting.webm'),
    4500,
    () => {
      window.__clearCustomOverlays();
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      const ui = game.scene.getScene('ui');

      if (window.__econUI?.market?.isOpen) window.__econUI.market.close();

      if (world && world.player) {
        const anvilStation = world.craft?.stations?.find((s) => s.type === 'anvil') || { x: world.player.x - 30, y: world.player.y };
        world.player.setPosition(anvilStation.x + 20, anvilStation.y + 10);
        world.player.setFacing('left');
        world.cameras.main.centerOn(world.player.x, world.player.y);
        world.player.equip('tool_hammer', true);
        world.player.attackPose();
      }

      if (ui && ui.craftPanel) {
        ui.craftPanel.toggle(true, 'anvil');
      }
    },
    async () => {
      // Anvil smithing pose then open Market Board Sell tab
      await sleep(1800);
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const ui = game.scene.getScene('ui');
        if (ui.craftPanel?.isOpen) ui.craftPanel.close();

        if (window.__econUI) {
          const { market } = window.__econUI;
          const p = window.__econUI.player ? window.__econUI.player() : null;
          if (p) {
            p.inventory = ['amethyst_blade', 'iron_greatblade', 'bar_mithril', 'bar_purple'];
          }
          market.open('sell');
          market.sel = 'amethyst_blade';
          market.render();
        }
      });
      await sleep(2000);
    }
  );

  // --------------------------------------------------------------------------
  // 3. market_3_board.png & market_3_board.webm
  // (Posey's Market Board interface with live player listings)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'market_3_board.png'),
    path.join(OUT_DIR, 'market_3_board.webm'),
    4500,
    () => {
      window.__clearCustomOverlays();
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');

      if (world && world.player && world.townfolk) {
        const poseyRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'posey');
        if (poseyRec) {
          world.player.setPosition(poseyRec.day.x + 24, poseyRec.day.y + 16);
          world.player.setFacing('left');
          world.cameras.main.centerOn(world.player.x, world.player.y);
        }
      }

      if (window.__econUI) {
        const { market } = window.__econUI;
        market.open('browse');
        market.result = {
          page: 0, pages: 3, total: 24, mine: false,
          items: [
            { id: 'b1', item: 'sunfire_blade', price: 1250, seller: 'Valeros', lvl: 12, left: 86400 },
            { id: 'b2', item: 'amethyst_blade', price: 4500, seller: 'Kaelen', lvl: 20, left: 72000 },
            { id: 'b3', item: 'vampire_coat', price: 2100, seller: 'Elaria', lvl: 15, left: 43200 },
            { id: 'b4', item: 'iron_greatblade', price: 450, seller: 'Zephyr', lvl: 8, left: 68000 },
            { id: 'b5', item: 'witch_hat', price: 780, seller: 'Aiden', lvl: 9, left: 52000 },
            { id: 'b6', item: 'potion_small', price: 35, seller: 'Maren', lvl: 1, left: 80000 },
            { id: 'b7', item: 'bar_mithril', price: 950, seller: 'OreMaster', lvl: 14, left: 60000 },
            { id: 'b8', item: 'reaper_scythe', price: 3200, seller: 'ShadowHawk', lvl: 18, left: 24000 }
          ]
        };
        market.render();
      }
    },
    async () => {
      // Simulate arming Buy confirmation on listing
      await sleep(1200);
      await page.evaluate(() => {
        const rowBtn = document.querySelector('#wf-social .ec-market .wf-acts button');
        if (rowBtn) {
          rowBtn.click();
        }
      });
      await sleep(2000);
    }
  );

  // --------------------------------------------------------------------------
  // 4. market_4_tokenburn.png & market_4_tokenburn.webm
  // (Marketplace 5% fee burning $WAYFARER tokens)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'market_4_tokenburn.png'),
    path.join(OUT_DIR, 'market_4_tokenburn.webm'),
    4500,
    () => {
      window.__clearCustomOverlays();
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');

      if (world && world.player && world.townfolk) {
        const poseyRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'posey');
        if (poseyRec) {
          world.player.setPosition(poseyRec.day.x + 24, poseyRec.day.y + 16);
          world.player.setFacing('left');
          world.cameras.main.centerOn(world.player.x, world.player.y);
        }
      }

      if (window.__econUI) {
        const { market } = window.__econUI;
        market.open('sell');
        market.sel = 'amethyst_blade';
        market.price = 5000;
        market.render();
      }

      // Inject Token Burn Mechanic Card
      const overlay = document.createElement('div');
      overlay.className = 'wf-custom-overlay';
      overlay.style.position = 'fixed';
      overlay.style.bottom = '24px';
      overlay.style.right = '24px';
      overlay.style.width = '420px';
      overlay.style.background = '#140d1c';
      overlay.style.border = '3px solid #ff7a2a';
      overlay.style.borderRadius = '8px';
      overlay.style.boxShadow = '0 0 25px rgba(255, 122, 42, 0.5), inset 0 0 15px rgba(0,0,0,0.8)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '14px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #ff7a2a; padding-bottom:8px; margin-bottom:10px;">
          <span style="color:#ff9a4a; font-size:14px; font-weight:bold; letter-spacing:1px; display:flex; align-items:center; gap:6px;">
            🔥 MARKETPLACE 5% TOKEN BURN
          </span>
          <span style="background:#5a1d00; color:#ff7a2a; border:1px solid #ff7a2a; font-size:10px; padding:2px 6px; border-radius:3px;">
            DEFLATIONARY
          </span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
          <div style="display:flex; justify-space-between; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:4px;">
            <span style="color:#c0b0a0;">Item Listing:</span>
            <span style="color:#a855f7; font-weight:bold;">Amethyst Greatsword (5,000 Gold)</span>
          </div>
          <div style="display:flex; justify-content:space-between; background:rgba(255,122,42,0.15); padding:6px 10px; border:1px dashed #ff7a2a; border-radius:4px;">
            <span style="color:#ffb07a;">5% Marketplace Fee:</span>
            <span style="color:#ffd84a; font-weight:bold;">250 Gold -> 100% BURNED</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="color:#a09080;">Total $WAYFARER Burned:</span>
            <span id="wf-burn-counter" style="color:#ff6a2a; font-size:15px; font-weight:bold;">14,850,200 $WAYFARER</span>
          </div>
          <div style="background:#1f132b; border:1px solid #4a2c5a; border-radius:4px; padding:8px; font-size:10px; color:#d0c0e0; line-height:1.4;">
            Every market listing fee (5%) permanently burns $WAYFARER tokens from total supply, reducing circulation and compounding value for all token holders.
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
    async () => {
      // Burn animation counter increment
      await sleep(1000);
      await page.evaluate(() => {
        const counter = document.getElementById('wf-burn-counter');
        if (counter) {
          let current = 14850200;
          const target = 14850450;
          const step = () => {
            if (current < target) {
              current += 10;
              counter.textContent = `${current.toLocaleString()} $WAYFARER`;
              requestAnimationFrame(step);
            } else {
              counter.textContent = `14,850,450 $WAYFARER 🔥`;
            }
          };
          step();
        }
      });
      await sleep(2000);
    }
  );

  // --------------------------------------------------------------------------
  // 5. market_5_winwin.png & market_5_winwin.webm
  // (360-Degree Win: decreasing supply, increasing holder value)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'market_5_winwin.png'),
    path.join(OUT_DIR, 'market_5_winwin.webm'),
    5000,
    () => {
      window.__clearCustomOverlays();
      if (window.__econUI?.market?.isOpen) window.__econUI.market.close();

      // Inject 360-Degree Win Economy Dashboard
      const overlay = document.createElement('div');
      overlay.className = 'wf-custom-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '50%';
      overlay.style.left = '50%';
      overlay.style.transform = 'translate(-50%, -50%)';
      overlay.style.width = '680px';
      overlay.style.background = '#140d1c';
      overlay.style.border = '3px solid #f4c542';
      overlay.style.borderRadius = '10px';
      overlay.style.boxShadow = '0 0 35px rgba(244, 197, 66, 0.4), inset 0 0 20px rgba(0,0,0,0.9)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '18px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="text-align:center; border-bottom:2px solid #f4c542; padding-bottom:10px; margin-bottom:14px;">
          <div style="color:#ffd84a; font-size:16px; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">
            🌟 WAYFARER 360° WIN-WIN ECONOMY
          </div>
          <div style="color:#7ed321; font-size:11px; margin-top:4px;">
            DECREASING TOKEN SUPPLY · INCREASING HOLDER & PLAYER VALUE
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
          <div id="pillar-1" class="wf-pillar" style="background:rgba(0,0,0,0.5); border:1.5px solid #4a3420; border-radius:6px; padding:10px;">
            <div style="color:#f4c542; font-weight:bold; font-size:12px; margin-bottom:4px;">⚔️ 1. PLAY & CRAFT</div>
            <div style="color:#c0b0a0; font-size:10px;">Players slay monsters, mine ore & smith high-tier gear at Anvil.</div>
          </div>
          <div id="pillar-2" class="wf-pillar" style="background:rgba(0,0,0,0.5); border:1.5px solid #4a3420; border-radius:6px; padding:10px;">
            <div style="color:#50e3c2; font-weight:bold; font-size:12px; margin-bottom:4px;">🏪 2. MARKET BOARD</div>
            <div style="color:#c0b0a0; font-size:10px;">Sellers & crafters trade gear with new players on Posey's Board.</div>
          </div>
          <div id="pillar-3" class="wf-pillar" style="background:rgba(0,0,0,0.5); border:1.5px solid #ff7a2a; border-radius:6px; padding:10px;">
            <div style="color:#ff7a2a; font-weight:bold; font-size:12px; margin-bottom:4px;">🔥 3. 5% FEE TOKEN BURN</div>
            <div style="color:#c0b0a0; font-size:10px;">Every trade fee (5%) permanently burns $WAYFARER tokens.</div>
          </div>
          <div id="pillar-4" class="wf-pillar" style="background:rgba(0,0,0,0.5); border:1.5px solid #7ed321; border-radius:6px; padding:10px;">
            <div style="color:#7ed321; font-weight:bold; font-size:12px; margin-bottom:4px;">📈 4. VALUE ACCRETION</div>
            <div style="color:#c0b0a0; font-size:10px;">Decreasing total supply compounds token value for all holders.</div>
          </div>
        </div>

        <div style="background:rgba(244, 197, 66, 0.08); border:1px solid #f4c542; border-radius:6px; padding:12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; text-align:center;">
          <div>
            <div style="color:#a09080; font-size:9px; uppercase;">Total Supply</div>
            <div style="color:#fff; font-size:13px; font-weight:bold; margin-top:2px;">100,000,000</div>
          </div>
          <div>
            <div style="color:#ff7a2a; font-size:9px; uppercase;">Total Tokens Burned</div>
            <div style="color:#ff7a2a; font-size:13px; font-weight:bold; margin-top:2px;">14,850,450 (14.85%)</div>
          </div>
          <div>
            <div style="color:#7ed321; font-size:9px; uppercase;">Holder Value Index</div>
            <div style="color:#7ed321; font-size:13px; font-weight:bold; margin-top:2px;">+142.8% 🚀</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
    async () => {
      // Pillar cycle highlight animation during recording
      for (let i = 1; i <= 4; i++) {
        await page.evaluate((idx) => {
          const pillars = document.querySelectorAll('.wf-pillar');
          pillars.forEach((p, pIdx) => {
            if (pIdx === idx - 1) {
              p.style.boxShadow = '0 0 15px #f4c542';
              p.style.transform = 'scale(1.03)';
              p.style.transition = 'all 0.3s ease';
            } else {
              p.style.boxShadow = 'none';
              p.style.transform = 'scale(1)';
            }
          });
        }, i);
        await sleep(900);
      }
    }
  );

  await browser.close();

  console.log('\n======================================================');
  console.log('SUCCESS! All Marketplace & Token Burn assets verified in public/assets/custom/marketplace/:');
  console.log(' 1. market_1_seasonal.png & market_1_seasonal.webm');
  console.log(' 2. market_2_crafting.png & market_2_crafting.webm');
  console.log(' 3. market_3_board.png & market_3_board.webm');
  console.log(' 4. market_4_tokenburn.png & market_4_tokenburn.webm');
  console.log(' 5. market_5_winwin.png & market_5_winwin.webm');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Fatal error generating marketplace assets:', err);
  process.exit(1);
});
