import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'token');
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
  console.log('=== Wayfarer Token ($WAYFARER) Asset Generator & Recorder ===');
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

  // Clear overlay helper
  await page.evaluate(() => {
    window.__clearCustomOverlays = () => {
      const old = document.querySelectorAll('.wf-custom-overlay');
      old.forEach((el) => el.remove());
    };
  });

  // --------------------------------------------------------------------------
  // 1. token_1_earn.png & token_1_earn.webm
  // (Slaying monsters in Meadowfield & Bog dropping $WAYFARER gold tokens)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'token_1_earn.png'),
    path.join(OUT_DIR, 'token_1_earn.webm'),
    4500,
    () => {
      window.__clearCustomOverlays();
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      const ui = game.scene.getScene('ui');

      if (ui && ui.craftPanel?.isOpen) ui.craftPanel.close();
      if (window.__econUI?.market?.isOpen) window.__econUI.market.close();

      if (world && world.player) {
        world.player.setPosition(950, 750);
        world.cameras.main.centerOn(950, 750);
        world.player.setFacing('right');
        world.player.equip('sunfire_blade', true);
        world.player.equip('viking_helm', true);

        // Spawn Meadowfield & Bog Monsters
        if (world.makeEnemy) {
          const slime1 = world.makeEnemy(995, 745, 'dewslime');
          if (slime1) { slime1.hp = 5; slime1.showBars(true); slime1.setPlate(true, 1); }
          const slime2 = world.makeEnemy(1020, 770, 'dewslime');
          if (slime2) { slime2.hp = 12; slime2.showBars(true); slime2.setPlate(true, 2); }
          const bat = world.makeEnemy(970, 705, 'mossbat');
          if (bat) { bat.hp = 18; bat.showBars(true); bat.setPlate(true, 2); }
        }

        // Trigger player attack pose
        world.player.attackPose();
      }

      // Inject Token Earn Overlay Card
      const overlay = document.createElement('div');
      overlay.className = 'wf-custom-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '24px';
      overlay.style.left = '50%';
      overlay.style.transform = 'translateX(-50%)';
      overlay.style.width = '620px';
      overlay.style.background = 'rgba(20, 13, 28, 0.95)';
      overlay.style.border = '2px solid #ffd84a';
      overlay.style.borderRadius = '10px';
      overlay.style.boxShadow = '0 0 30px rgba(255, 216, 74, 0.4), inset 0 0 15px rgba(0,0,0,0.8)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '14px 20px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #ffd84a; padding-bottom:8px; margin-bottom:10px;">
          <span style="color:#ffd84a; font-size:16px; font-weight:bold; letter-spacing:1px; display:flex; align-items:center; gap:8px;">
            ⚔️ SLAY & EARN $WAYFARER TOKENS
          </span>
          <span style="background:#4a3800; color:#ffd84a; border:1px solid #ffd84a; font-size:11px; padding:3px 8px; border-radius:4px;">
            COMBAT LOOT
          </span>
        </div>
        <div style="font-size:12px; color:#e0d0f0; line-height:1.5; margin-bottom:10px;">
          Slay monsters across Meadowfield & Bog to earn tradeable <strong style="color:#ffd84a;">$WAYFARER gold tokens</strong> from monster drops & boss encounters.
        </div>
        <div style="display:flex; gap:12px; font-size:11px;">
          <div style="background:rgba(255,216,74,0.15); border:1px solid #ffd84a; padding:6px 12px; border-radius:6px; flex:1; text-align:center;">
            <div style="color:#c0b090; font-size:10px;">Meadowfield Slime</div>
            <div style="color:#ffd84a; font-weight:bold; font-size:13px;">+250 $WAYFARER</div>
          </div>
          <div style="background:rgba(168,85,247,0.15); border:1px solid #a855f7; padding:6px 12px; border-radius:6px; flex:1; text-align:center;">
            <div style="color:#c0a0d0; font-size:10px;">Bog Creeper Boss</div>
            <div style="color:#e0a0ff; font-weight:bold; font-size:13px;">+1,500 $WAYFARER</div>
          </div>
          <div style="background:rgba(34,197,94,0.15); border:1px solid #22c55e; padding:6px 12px; border-radius:6px; flex:1; text-align:center;">
            <div style="color:#90c0a0; font-size:10px;">On-Chain Payout</div>
            <div style="color:#4ade80; font-weight:bold; font-size:13px;">Instant Settlement</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
    async () => {
      // Simulate monster combat drop floating text
      for (let i = 0; i < 3; i++) {
        await page.evaluate((idx) => {
          const game = window.__wayfarer;
          const world = game.scene.getScene('world');
          if (world && world.add) {
            const dropTxt = world.add.text(
              950 + (idx * 40 - 40),
              700 - (idx * 20),
              `+${(idx + 1) * 250} $WAYFARER! ✨`,
              { fontSize: '18px', fill: '#ffd84a', stroke: '#000', strokeThickness: 4, fontFamily: 'monospace' }
            );
            world.tweens.add({
              targets: dropTxt,
              y: dropTxt.y - 60,
              alpha: 0,
              duration: 1200,
              onComplete: () => dropTxt.destroy()
            });

            if (world.player) world.player.attackPose();
          }
        }, i);
        await sleep(1000);
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. token_2_utility.png & token_2_utility.webm
  // (Using $WAYFARER to purchase seasonal gear & high-tier weapons on Posey's Market Board)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'token_2_utility.png'),
    path.join(OUT_DIR, 'token_2_utility.webm'),
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
          page: 0, pages: 2, total: 14, mine: false,
          items: [
            { id: 'u1', item: 'sunfire_blade', price: 1250, seller: 'Valeros', lvl: 12, left: 86400 },
            { id: 'u2', item: 'jacko_helm', price: 1500, seller: 'JackO', lvl: 14, left: 72000 },
            { id: 'u3', item: 'reaper_scythe', price: 3200, seller: 'GrimMaster', lvl: 18, left: 43200 },
            { id: 'u4', item: 'vampire_coat', price: 2100, seller: 'NightBat', lvl: 15, left: 60000 },
            { id: 'u5', item: 'amethyst_blade', price: 4500, seller: 'Kaelen', lvl: 20, left: 80000 },
            { id: 'u6', item: 'ice_crown', price: 3500, seller: 'RimeKing', lvl: 20, left: 50000 }
          ]
        };
        market.render();
      }

      // Inject Token Utility Banner Overlay
      const overlay = document.createElement('div');
      overlay.className = 'wf-custom-overlay';
      overlay.style.position = 'fixed';
      overlay.style.bottom = '20px';
      overlay.style.left = '50%';
      overlay.style.transform = 'translateX(-50%)';
      overlay.style.width = '660px';
      overlay.style.background = 'rgba(20, 13, 28, 0.95)';
      overlay.style.border = '2px solid #38bdf8';
      overlay.style.borderRadius = '10px';
      overlay.style.boxShadow = '0 0 30px rgba(56, 189, 248, 0.4), inset 0 0 15px rgba(0,0,0,0.8)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '14px 20px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #38bdf8; padding-bottom:8px; margin-bottom:10px;">
          <span style="color:#38bdf8; font-size:15px; font-weight:bold; letter-spacing:1px; display:flex; align-items:center; gap:8px;">
            🛒 TOKEN UTILITY & MARKETPLACE
          </span>
          <span style="background:#0c4a6e; color:#38bdf8; border:1px solid #38bdf8; font-size:11px; padding:3px 8px; border-radius:4px;">
            POSEY'S BOARD
          </span>
        </div>
        <div style="font-size:12px; color:#e0f2fe; line-height:1.5;">
          Use <strong style="color:#ffd84a;">$WAYFARER tokens</strong> to trade seasonal armor sets, legendary weapons, and rare crafting materials directly with other players.
        </div>
      `;
      document.body.appendChild(overlay);
    },
    async () => {
      // Simulate selecting and buying an item on market board
      await sleep(1200);
      await page.evaluate(() => {
        const rowBtn = document.querySelector('#wf-social .ec-market .wf-acts button');
        if (rowBtn) rowBtn.click();
      });
      await sleep(2000);
    }
  );

  // --------------------------------------------------------------------------
  // 3. token_3_burn.png & token_3_burn.webm
  // (Marketplace 5% transaction fee burning $WAYFARER tokens permanently)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'token_3_burn.png'),
    path.join(OUT_DIR, 'token_3_burn.webm'),
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
      overlay.style.width = '440px';
      overlay.style.background = '#140d1c';
      overlay.style.border = '3px solid #ff7a2a';
      overlay.style.borderRadius = '10px';
      overlay.style.boxShadow = '0 0 30px rgba(255, 122, 42, 0.5), inset 0 0 15px rgba(0,0,0,0.8)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '16px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #ff7a2a; padding-bottom:8px; margin-bottom:10px;">
          <span style="color:#ff9a4a; font-size:15px; font-weight:bold; letter-spacing:1px; display:flex; align-items:center; gap:6px;">
            🔥 MARKETPLACE 5% TOKEN BURN
          </span>
          <span style="background:#5a1d00; color:#ff7a2a; border:1px solid #ff7a2a; font-size:10px; padding:2px 6px; border-radius:3px;">
            DEFLATIONARY
          </span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:4px;">
            <span style="color:#c0b0a0;">Marketplace Sale:</span>
            <span style="color:#a855f7; font-weight:bold;">Amethyst Blade (5,000 $WAYFARER)</span>
          </div>
          <div style="display:flex; justify-content:space-between; background:rgba(255,122,42,0.15); padding:6px 10px; border:1px dashed #ff7a2a; border-radius:4px;">
            <span style="color:#ffb07a;">5% Marketplace Fee:</span>
            <span style="color:#ffd84a; font-weight:bold;">250 Gold -> PERMANENTLY BURNED</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="color:#a09080;">Total $WAYFARER Burned:</span>
            <span id="wf-burn-counter" style="color:#ff6a2a; font-size:15px; font-weight:bold;">14,850,200 $WAYFARER</span>
          </div>
          <div style="background:#1f132b; border:1px solid #4a2c5a; border-radius:4px; padding:8px; font-size:11px; color:#d0c0e0; line-height:1.4;">
            Every market trade (5%) permanently burns $WAYFARER tokens from total supply, shrinking circulation and building long-term value.
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
  // 4. token_4_flywheel.png & token_4_flywheel.webm
  // (360-Degree Win: Decreasing supply, increasing token value for holders)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'token_4_flywheel.png'),
    path.join(OUT_DIR, 'token_4_flywheel.webm'),
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
      overlay.style.width = '720px';
      overlay.style.background = '#140d1c';
      overlay.style.border = '3px solid #f4c542';
      overlay.style.borderRadius = '12px';
      overlay.style.boxShadow = '0 0 40px rgba(244, 197, 66, 0.4), inset 0 0 20px rgba(0,0,0,0.8)';
      overlay.style.color = '#fff';
      overlay.style.fontFamily = "'Silkscreen', monospace, sans-serif";
      overlay.style.padding = '20px';
      overlay.style.zIndex = '10005';

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #f4c542; padding-bottom:10px; margin-bottom:16px;">
          <span style="color:#f4c542; font-size:18px; font-weight:bold; letter-spacing:1px; display:flex; align-items:center; gap:8px;">
            🔄 360-DEGREE TOKEN FLYWHEEL
          </span>
          <span style="background:#523e02; color:#f4c542; border:1px solid #f4c542; font-size:11px; padding:3px 8px; border-radius:4px;">
            WIN-WIN ECONOMY
          </span>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div id="fw-node-1" style="background:#1e1429; border:1px solid #a855f7; border-radius:8px; padding:12px; transition:all 0.3s;">
            <div style="color:#a855f7; font-weight:bold; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              ⚔️ 1. GAMEPLAY DEMAND
            </div>
            <div style="color:#c0b0d0; font-size:11px; line-height:1.4;">
              Active players slay monsters & grind Meadowfield/Bog to earn $WAYFARER tokens.
            </div>
          </div>

          <div id="fw-node-2" style="background:#1e1429; border:1px solid #38bdf8; border-radius:8px; padding:12px; transition:all 0.3s;">
            <div style="color:#38bdf8; font-weight:bold; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              🛒 2. MARKETPLACE UTILITY
            </div>
            <div style="color:#c0b0d0; font-size:11px; line-height:1.4;">
              High player demand for seasonal gear, rare mounts & high-tier weapons on Posey's board.
            </div>
          </div>

          <div id="fw-node-3" style="background:#1e1429; border:1px solid #ff7a2a; border-radius:8px; padding:12px; transition:all 0.3s;">
            <div style="color:#ff7a2a; font-weight:bold; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              🔥 3. DEFLATIONARY BURN
            </div>
            <div style="color:#c0b0d0; font-size:11px; line-height:1.4;">
              5% market fee permanently burns tokens, reducing circulating supply with every trade.
            </div>
          </div>

          <div id="fw-node-4" style="background:#1e1429; border:1px solid #22c55e; border-radius:8px; padding:12px; transition:all 0.3s;">
            <div style="color:#22c55e; font-weight:bold; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              📈 4. HOLDER VALUE COMPOUND
            </div>
            <div style="color:#c0b0d0; font-size:11px; line-height:1.4;">
              Decreasing supply + growing utility = Continuous compounding value for token holders.
            </div>
          </div>
        </div>

        <div style="background:rgba(244,197,66,0.1); border:1px dashed #f4c542; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:11px; color:#f4c542;">
            <strong>360° WIN:</strong> Players Earn · Market Trades Burn Supply · Holders Gain Value
          </div>
          <div style="color:#4ade80; font-weight:bold; font-size:12px; background:rgba(34,197,94,0.2); padding:4px 8px; border-radius:4px;">
            SUSTAINABLE APY
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
    async () => {
      // Pulse animation highlighting nodes 1 -> 2 -> 3 -> 4
      for (let cycle = 0; cycle < 2; cycle++) {
        for (let i = 1; i <= 4; i++) {
          await page.evaluate((nodeId) => {
            for (let j = 1; j <= 4; j++) {
              const el = document.getElementById(`fw-node-${j}`);
              if (el) {
                if (j === nodeId) {
                  el.style.transform = 'scale(1.04)';
                  el.style.boxShadow = '0 0 15px rgba(244, 197, 66, 0.6)';
                  el.style.background = '#2a1c3d';
                } else {
                  el.style.transform = 'scale(1)';
                  el.style.boxShadow = 'none';
                  el.style.background = '#1e1429';
                }
              }
            }
          }, i);
          await sleep(800);
        }
      }
    }
  );

  await browser.close();
  console.log('\n======================================================');
  console.log('SUCCESS! All 4 Token ($WAYFARER) assets generated into public/assets/custom/token/:');
  console.log(' - token_1_earn.png & token_1_earn.webm');
  console.log(' - token_2_utility.png & token_2_utility.webm');
  console.log(' - token_3_burn.png & token_3_burn.webm');
  console.log(' - token_4_flywheel.png & token_4_flywheel.webm');
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal error generating token assets:', err);
  process.exit(1);
});
