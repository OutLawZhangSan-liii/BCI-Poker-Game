/* Local-only UI and software render-budget check; no EEG, photodiode or display certification. */
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  const directory = path.join(root, ".smoke-user-data", `presentation-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const env = { ...process.env, PRESENTATION_SMOKE_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require("node:child_process").spawnSync(require("electron"), [__filename, ...process.argv.slice(2)], { env, stdio: "inherit", windowsHide: true, timeout: 120000 });
  console.log(`PRESENTATION_SMOKE_DIR=${directory}`);
  let passed = false;
  try { passed = JSON.parse(fs.readFileSync(path.join(directory, "result.json"), "utf8")).success === true; } catch {}
  if (result.error) console.error(result.error);
  process.exitCode = result.status === 0 && passed ? 0 : 1;
} else {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const directory = process.env.PRESENTATION_SMOKE_DIR;
  if (!directory || !path.resolve(directory).startsWith(path.join(root, ".smoke-user-data") + path.sep)) throw new Error("Isolated directory required");
  fs.mkdirSync(directory, { recursive: true });
  app.setPath("userData", path.join(directory, "user-data"));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  ipcMain.handle("window:set-appearance", () => undefined);
  ipcMain.handle("gateway:get-status", () => "stopped");
  ipcMain.handle("gateway:get-connection", () => null);
  let refreshes = 0;
  ipcMain.handle("challenge:list", () => { refreshes++; return { records: [], warnings: [] }; });
  app.whenReady().then(async () => {
    const report = { success: false, source: "isolated-software-renderer", startedAt: new Date().toISOString(), checks: [], layouts: [], rendering: [] };
    const window = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: {
      preload: path.join(root, "dist-desktop/preload/preload.cjs"), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true,
    } });
    window.webContents.setFrameRate(60);
    const errors = [];
    window.webContents.on("console-message", details => { if (details.level === "error") errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`); });
    const evaluate = source => window.webContents.executeJavaScript(source);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (source, label) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { if (await evaluate(source)) { report.checks.push(label); return; } await pause(60); }
      throw new Error(`Timed out: ${label}; ${await evaluate("JSON.stringify({hidden:document.hidden, fixture:window.presentationFixture?.snapshot()})")}`);
    };
    const click = text => evaluate(`(() => { const root = document.querySelector('dialog[open]') ?? document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled && b.getClientRects().length); if (!b) throw new Error('Button unavailable: ' + ${JSON.stringify(text)}); b.focus(); b.click(); })()`);
    const capture = async label => {
      await evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
      await pause(120);
      const captured=await window.webContents.capturePage(); const [width,height]=window.getContentSize();
      fs.writeFileSync(path.join(directory, `${label}.png`), captured.resize({width,height,quality:"best"}).toPNG());
    };
    const layout = async label => {
      const data = await evaluate(`({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, broken: [...document.images].filter(i => !i.complete || !i.naturalWidth).length, paper: getComputedStyle(document.querySelector('.shell')).backgroundColor })`);
      if (data.overflow || data.broken || data.paper !== "rgb(250, 251, 254)") throw new Error(`${label}: ${JSON.stringify(data)}`);
      report.layouts.push({ label, ...data });
      await capture(label);
    };
    try {
      if (!process.argv.includes("--fixture-only")) {
      // Windows may clamp the initial hidden window to the desktop work area.
      // Explicit content sizing is required for truthful 1080p screenshots.
      window.setContentSize(1920, 1080);
      await window.loadFile(path.join(root, "dist-renderer/index.html"));
      await until("!!document.querySelector('.intro-flip--running')", "intro plays with local artwork");
      // Advance CSS artwork for a reproducible final-frame snapshot; the real
      // JS completion timer is still exercised below, without racing its deadline.
      const intro = await evaluate("(() => { const root=document.querySelector('.intro-flip'); const animations=root.getAnimations({subtree:true}); const timings=animations.map(a=>a.effect.getTiming()); animations.forEach(a=>a.finish()); const t=document.querySelector('.intro-flip__title-position').getBoundingClientRect(), c=document.querySelector('.intro-flip__card-position').getBoundingClientRect(); return {titleBottom:t.bottom, cardTop:c.top, timings}; })()");
      if (intro.cardTop < intro.titleBottom + 12 || !intro.timings.some(t=>t.duration===2200&&t.delay===550) || !intro.timings.some(t=>t.duration===1000&&t.delay===2750)) throw new Error(`Intro layout/timing: ${JSON.stringify(intro)}`);
      report.intro = intro;
      await capture("intro-title-1080");
      window.setContentSize(960, 640); await pause(100);
      const smallIntro = await evaluate("(() => { const t=document.querySelector('.intro-flip__title-position').getBoundingClientRect(), c=document.querySelector('.intro-flip__card-position').getBoundingClientRect(); return {width:innerWidth,height:innerHeight,titleBottom:t.bottom,cardTop:c.top,cardBottom:c.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1}; })()");
      if (smallIntro.overflow || smallIntro.cardTop < smallIntro.titleBottom + 12 || smallIntro.cardBottom > 640) throw new Error(`Small intro layout: ${JSON.stringify(smallIntro)}`);
      report.intro.smallWindow = smallIntro;
      await capture("intro-title-960");
      await until("!document.querySelector('.intro-flip')", "intro completes and reveals real table");
      if (!process.argv.includes("--intro-only")) {
      for (const [width, height] of [[1920, 1080], [960, 640]]) {
        window.setContentSize(width, height); await pause(120);
        await layout(`game-${width}`);
        const canvasBeforeFold = await evaluate("JSON.stringify(document.querySelector('.stimulus-canvas').getBoundingClientRect().toJSON())");
        await evaluate("document.querySelector('[data-fold-trigger=mode]').click()"); await pause(460);
        await capture(`settings-open-${width}`);
        if (canvasBeforeFold !== await evaluate("JSON.stringify(document.querySelector('.stimulus-canvas').getBoundingClientRect().toJSON())")) throw new Error("Settings expansion moved canvas");
        const settingsBounds = await evaluate(`(() => {
          const paper=document.querySelector('.game-settings-fold__paper').getBoundingClientRect(), canvas=document.querySelector('.stimulus-canvas').getBoundingClientRect(), header=document.querySelector('.app-header').getBoundingClientRect(), status=document.querySelector('.game-setup-status').getBoundingClientRect();
          return {top:paper.top,bottom:paper.bottom,right:paper.right,canvasTop:canvas.top,headerBottom:header.bottom,statusLeft:status.left};
        })()`);
        if (settingsBounds.bottom > settingsBounds.canvasTop - 8 || settingsBounds.top < settingsBounds.headerBottom || settingsBounds.right > settingsBounds.statusLeft) throw new Error(`Settings overlap at ${width}: ${JSON.stringify(settingsBounds)}`);
        report.layouts.push({label:`settings-reserved-space-${width}`,...settingsBounds});
        await evaluate("document.querySelector('[data-fold-trigger=mode]').click()");
        await until("document.querySelector('[data-fold-trigger=mode]').getAttribute('aria-expanded') === 'false'", `settings toggle closes at ${width}`);
        for (const mode of ["进阶", "困难", "简单"]) {
          await evaluate("document.querySelector('[data-fold-trigger=mode]').click()"); await pause(350);
          await click(mode);
          await until(`document.querySelector('[aria-label="游戏难度"] button[aria-pressed="true"]')?.textContent === ${JSON.stringify(mode)}`, `difficulty choice ${mode} at ${width}`);
          await until("document.querySelector('[data-fold-trigger=mode]').getAttribute('aria-expanded') === 'false'", `selection folds at ${width}`);
          await pause(460);
          await layout(`game-choice-${mode}-${width}`);
        }
        await evaluate("document.querySelector('[data-fold-trigger=length]').click()"); await pause(460);
        await capture(`length-open-${width}`);
        const selectionMotion = await evaluate(`(async () => {
          const trigger=document.querySelector('[data-fold-trigger=length]'), reveal=document.querySelector('[data-fold-options=length]').closest('.game-settings-fold__reveal'), canvas=document.querySelector('.stimulus-canvas');
          const sample=()=>({expanded:trigger.getAttribute('aria-expanded'),width:reveal.getBoundingClientRect().width,canvas:JSON.stringify(canvas.getBoundingClientRect().toJSON())});
          const before=sample(), start=performance.now(); document.querySelector('[data-fold-options=length] button:last-child').click();
          const samples=[]; for(const deadline of [180,520,920]) {await new Promise(r=>setTimeout(r,Math.max(0,start+deadline-performance.now())));samples.push({...sample(),elapsed:performance.now()-start});}
          return {before,samples};
        })()`);
        const [held, closing, closed] = selectionMotion.samples;
        if (held.expanded !== 'true' || held.width < selectionMotion.before.width - 1 || closing.expanded !== 'false' || closing.width <= 0 || closing.width >= selectionMotion.before.width || closed.width > 1 || selectionMotion.samples.some(s=>s.canvas!==selectionMotion.before.canvas)) throw new Error(`Selection motion at ${width}: ${JSON.stringify(selectionMotion)}`);
        report.checks.push(`selection holds then smoothly closes without moving canvas at ${width}`);
        report.layouts.push({label:`settings-selection-motion-${width}`,...selectionMotion});
        await until(`document.querySelector('[aria-label="游戏局长"] button[aria-pressed="true"]')?.textContent === "15 轮"`, `15-round choice at ${width}`);
        await evaluate("document.querySelector('[data-fold-trigger=length]').click()"); await pause(460);
        await click("10 轮");
        await evaluate("document.querySelector('[data-fold-trigger=mode]').click()"); await pause(500);
        await until("document.querySelector('[data-fold-trigger=mode]').getAttribute('aria-expanded') === 'true'", `previous selection cannot close newly opened settings at ${width}`);
        await evaluate("document.querySelector('[data-fold-trigger=mode]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        await until("document.querySelector('[data-fold-trigger=mode]').getAttribute('aria-expanded') === 'false'", `Escape closes settings at ${width}`);
        await evaluate("document.querySelector('[data-fold-trigger=mode]').click()"); await pause(350);
        await evaluate("document.querySelector('.game-setup-status').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
        await until("document.querySelector('[data-fold-trigger=mode]').getAttribute('aria-expanded') === 'false'", `outside closes settings at ${width}`);
        if (process.argv.includes('--settings-only')) continue;
        await click("规则");
        await until("!!document.querySelector('.game-modal')", `rules opens at ${width}`);
        await click("返回调整");
        await until("!document.querySelector('.game-modal')", `rules closes at ${width}`);
        await click("三关挑战"); await until("!!document.querySelector('dialog[open]')", "identity opens"); await capture(`identity-${width}`);
        await click("排行榜"); await until("!!document.querySelector('.challenge-leaderboard')", "ranking opens");
        await evaluate(`(() => { const back=document.querySelector('.challenge-page-back').getBoundingClientRect(), refresh=document.querySelector('.challenge-board-tools button').getBoundingClientRect(); if(back.top<76 || refresh.top<=back.bottom || back.right>refresh.left) throw new Error('Page actions must stay below caption and separate back from refresh'); })()`);
        await capture(`rankings-${width}`);
        const before = refreshes; await click("刷新"); await pause(80); if (refreshes <= before) throw new Error("Refresh failed");
        await click("返回"); await click("取消");
        await click("教学模式"); await until("!!document.querySelector('.teaching-panel')", "teaching opens"); await click("课程学习"); await pause(150); await layout(`teaching-course-${width}`);
        await evaluate("document.querySelector('.teaching-quiz-options button')?.click()");
        await until("!!document.querySelector('.teaching-quiz-feedback')", `quiz feedback at ${width}`); await capture(`teaching-quiz-${width}`);
        await click("重答");
        await click("信号观察"); await pause(250); await layout(`teaching-observe-${width}`);
        await click("演示与训练"); await pause(250); await layout(`teaching-run-${width}`);
        await evaluate(`(() => { const tabs = [...document.querySelectorAll('.teaching-segmented button[aria-current=page]')]; for(const t of tabs){ const s=getComputedStyle(t); if(s.color==='rgb(32, 33, 38)' && getComputedStyle(t.parentElement.querySelector('.teaching-segmented__indicator') ?? t).backgroundColor==='rgb(32, 33, 38)') throw new Error('Dark text on active teaching tab'); } })()`);
        await evaluate("document.querySelector('.device-controls__trigger').click(); document.querySelector('.device-controls__footer button').click()"); await until("!!document.querySelector('.lab-device-workspace')", "device opens"); await layout(`device-${width}`);
        await evaluate("document.querySelector('.lab-log-summary').open = true"); await capture(`device-details-${width}`);
        await until("!document.querySelector('.lab-workspace-nav, .lab-experiment-workspace, .lab-timing-workspace') && document.querySelector('.lab-device-toolbar h2')?.textContent === '设备与诊断'", `single diagnostic workspace at ${width}`);
        await click("游戏牌桌");
      }
      }
      }
      if (!process.argv.includes("--intro-only") && !process.argv.includes("--settings-only")) {
      // Bundle only real rendering components into a disposable, device-free fixture.
      require("esbuild").buildSync({ entryPoints: [path.join(root, "renderer/src/theme/presentation.fixture.tsx")], bundle: true,
        outfile: path.join(directory, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic",
        define: { "import.meta.env.DEV": "false", "import.meta.env.BASE_URL": JSON.stringify("./") }, logLevel: "silent" });
      const dist = path.join(root, "dist-renderer"), html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      const stylesheet = html.match(/href="([^"]+\.css)"/)[1];
      fs.writeFileSync(path.join(directory, "fixture.html"), `<!doctype html><meta charset="utf-8"><base href="${pathToFileURL(dist + path.sep)}"><link rel="stylesheet" href="${stylesheet}"><div id="root"></div><script src="${pathToFileURL(path.join(directory, "fixture.js"))}"></script>`);
      await window.loadFile(path.join(directory, "fixture.html"));
      await until("!!window.presentationFixture?.snapshot().geometry", "real rendering fixture loaded");
      window.setContentSize(1280,800); await pause(150);
      await evaluate("window.presentationFixture.configure({mode:'difficult2',active:false,version:'crayon-paper-v1',cardSet:'crayon-deck-v4'})"); await pause(700);
      const canvasPixels = "(() => { const c=document.querySelector('canvas'); return c.toDataURL(); })()";
      const beforeResize = await evaluate(canvasPixels);
      for (const [w,h] of [[1920,1080],[960,640],[1600,900],[1280,800]]) {
        window.setContentSize(w,h); await pause(180);
        const aligned = await evaluate("(() => {const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),g=window.presentationFixture.snapshot().geometry;return g.cssWidth===r.width&&g.cssHeight===r.height&&c.width===g.backingWidth&&c.height===g.backingHeight;})()");
        if(!aligned) throw new Error('Resize left stale canvas geometry');
      }
      if(beforeResize !== await evaluate(canvasPixels)) throw new Error('Resize round-trip left residual pixels');
      report.checks.push('six-card window size round-trip: matching geometry and pixel-identical restored canvas');
      report.rasterQuality = [];
      for (const rasterQuality of ["balanced-v1", "sharp-v1"]) {
        await evaluate(`window.presentationFixture.configure({mode:'simple',active:false,version:'crayon-paper-v1',rasterQuality:'${rasterQuality}'})`); await pause(200);
        const g = await evaluate("({displayScale:devicePixelRatio,geometry:window.presentationFixture.snapshot().geometry})");
        report.rasterQuality.push({ rasterQuality, displayScale:g.displayScale, rasterScale:g.geometry.devicePixelRatio, backingWidth:g.geometry.backingWidth, backingHeight:g.geometry.backingHeight, targets:g.geometry.targets });
        await capture(`card-quality-${rasterQuality}`);
      }
      const [balanced, sharp] = report.rasterQuality;
      if (JSON.stringify(balanced.targets)!==JSON.stringify(sharp.targets) || sharp.rasterScale < balanced.rasterScale || (sharp.displayScale>1 && sharp.rasterScale<=balanced.rasterScale)) throw new Error("Card raster quality or geometry regression");
      report.checks.push("sharp profile increases backing resolution at identical card geometry");
      for (const [width, height] of [[1920, 1080], [960, 640]]) {
        window.setContentSize(width, height); await pause(100);
        for (const mode of ["simple", "difficult1", "difficult2"]) {
          await evaluate(`window.presentationFixture.configure({ mode: ${JSON.stringify(mode)}, active: false, version: 'crayon-paper-v1', targetSize:'game-comfortable-v1', length: 15, round: 3 })`);
          await pause(200);
          const data = await evaluate(`(() => { const g=window.presentationFixture.snapshot().geometry, c=document.querySelector('canvas').getBoundingClientRect(), stage=document.querySelector('.game-focus-stage').getBoundingClientRect(); const rects=g.targets.map(t=>({...t.ring,x:t.ring.x+c.left,y:t.ring.y+c.top})); const overlap=rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y))); return { targetCount:g.targets.length, overlap, bounds:rects.every(t=>t.x>=0&&t.y>=stage.bottom&&t.x+t.width<=innerWidth&&t.y+t.height<=innerHeight), dots:document.querySelectorAll('.game-round-dots i').length, completed:document.querySelectorAll('.game-round-dots .is-complete').length, active:document.querySelectorAll('.game-round-dots .is-active').length }; })()`);
          if (data.overlap || !data.bounds || data.dots !== 15 || data.completed !== 3 || data.active !== 1) throw new Error(`Stimulus layout ${mode} ${width}: ${JSON.stringify(data)}`);
          report.layouts.push({ label: `focus-${mode}-${width}`, ...data }); await capture(`focus-${mode}-${width}`);
          await evaluate("window.presentationFixture.configure({countdown:2})"); await pause(80);
          const countdownLayout = await evaluate(`(() => {
            const g=window.presentationFixture.snapshot().geometry,c=document.querySelector('canvas').getBoundingClientRect();
            const notice=document.querySelector('.game-countdown').getBoundingClientRect(),header=document.querySelector('.game-focus-top').getBoundingClientRect();
            const cards=g.targets.map(t=>t.ring);if(g.reference) cards.push(g.reference.card);if(document.querySelector("canvas").dataset.referenceTagBounds)cards.push(JSON.parse(document.querySelector("canvas").dataset.referenceTagBounds));
            const intersects=r=>notice.left<r.x+c.left+r.width&&notice.right>r.x+c.left&&notice.top<r.y+c.top+r.height&&notice.bottom>r.y+c.top;
            return {cardTop:Math.min(...cards.filter(r=>notice.left<r.x+c.left+r.width&&notice.right>r.x+c.left).map(r=>r.y+c.top)),overlap:cards.some(intersects),headerGap:notice.top-header.bottom,centerError:Math.abs((notice.left+notice.right)/2-innerWidth/2),top:notice.top,bottom:notice.bottom};
          })()`);
          if(countdownLayout.overlap || countdownLayout.headerGap<4 || countdownLayout.centerError>1) throw new Error(`Countdown layout ${mode} ${width}: ${JSON.stringify(countdownLayout)}`);
          report.layouts.push({label:`countdown-${mode}-${width}`,...countdownLayout});await capture(`countdown-${mode}-${width}`);
          await evaluate("window.presentationFixture.configure({countdown:0})");
        }
      }
      await evaluate("window.presentationFixture.configure({active:true})");
      await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5", "comfortable size starts");
      const lockedSize = await evaluate("window.presentationFixture.snapshot().geometry");
      await evaluate("window.presentationFixture.configure({targetSize:'standard'})"); await pause(100);
      if (JSON.stringify(lockedSize) !== JSON.stringify(await evaluate("window.presentationFixture.snapshot().geometry"))) throw new Error("Size changed during active trial");
      report.checks.push("size profile locked during active stimulus");
      await evaluate("window.presentationFixture.configure({active:false,targetSize:'standard'})"); await pause(100);
      window.setContentSize(1920,1080); await pause(150);
      const faceHashes = `(() => { const g=window.presentationFixture.snapshot().geometry,ctx=document.querySelector('canvas').getContext('2d'); return g.targets.map(t=>{const p=t.card,d=g.devicePixelRatio,inset=Math.ceil(12*d),pixels=ctx.getImageData(Math.ceil(p.x*d)+inset,Math.ceil(p.y*d)+inset,Math.floor(p.width*d)-2*inset,Math.floor(p.height*d)-2*inset).data;let h=2166136261;for(const v of pixels)h=Math.imul(h^v,16777619);return h>>>0;}); })()`;
      report.cardSetRevision = [];
      for (const cardSet of ['crayon-deck-v1','crayon-deck-v2','crayon-deck-v3','crayon-deck-v4']) {
        await evaluate(`window.presentationFixture.configure({mode:'difficult2',active:false,version:'crayon-paper-v1',cardSet:'${cardSet}'})`);await pause(500);
        const data=await evaluate(`({cardSet:document.querySelector('canvas').dataset.cardSet,geometry:window.presentationFixture.snapshot().geometry,hashes:${faceHashes}})`);
        if(data.cardSet!==cardSet)throw new Error('Saved card set was not rendered');
        report.cardSetRevision.push(data);await capture(`six-${cardSet}`);
      }
      const [oldPips,newPips]=report.cardSetRevision;
      if(JSON.stringify(oldPips.geometry)!==JSON.stringify(newPips.geometry) || oldPips.hashes.slice(0,3).some((hash,i)=>hash===newPips.hashes[i]))throw new Error('Pip update changed geometry or failed to replace pips');
      await evaluate("window.presentationFixture.configure({cardSet:'crayon-deck-v1'})");await pause(300);
      await evaluate("window.presentationFixture.configure({active:true})");await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5",'saved crayon card set starts');
      const oldActiveHashes=await evaluate(faceHashes);
      await evaluate("window.presentationFixture.configure({cardSet:'crayon-deck-v2'})");await pause(150);
      const lockedSet=await evaluate("document.querySelector('canvas').dataset.cardSet"),lockedHashes=await evaluate(faceHashes);
      report.cardSetLock={cardSet:lockedSet,hashes:lockedHashes,geometry:await evaluate('window.presentationFixture.snapshot().geometry')};
      if(lockedSet!=='crayon-deck-v1' || JSON.stringify(lockedHashes)!==JSON.stringify(oldActiveHashes))throw new Error('Active card set changed');
      await evaluate("window.presentationFixture.configure({active:false,cardSet:'crayon-deck-v2'})");await pause(300);
      const newIdleHashes=await evaluate(faceHashes);
      await evaluate("window.presentationFixture.configure({active:true})");await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5",'new pip card set starts');
      const newActiveHashes=await evaluate(faceHashes);
      if(JSON.stringify(newActiveHashes)!==JSON.stringify(newIdleHashes))throw new Error('New pip idle/active pixels differ');
      // Compare stimulated court pixels with stimulated court pixels: historical
      // sets retain their original idle renderer's fractional-DPI rounding.
      if(oldActiveHashes.slice(3).some((hash,i)=>hash!==newActiveHashes[i+3]))throw new Error('Unchanged court stimulus pixels differ');
      report.activeCardPixels={old:oldActiveHashes,current:newActiveHashes};
      await evaluate("window.presentationFixture.configure({active:false})");await pause(150);
      report.checks.push('new pips replace only numeric cards; saved v1 art, geometry, courts and active card-set lock preserved');
      report.checks.push('new pip revision uses pixel-identical idle and active face interiors at fractional raster scale');
      const borderless=report.cardSetRevision[2];
      if(JSON.stringify(borderless.geometry)!==JSON.stringify(newPips.geometry))throw new Error('Borderless revision changed target geometry');
      await evaluate("window.presentationFixture.configure({active:false,cardSet:'crayon-deck-v3'})");await pause(350);
      const borderlessIdle=await evaluate(faceHashes);
      await evaluate("window.presentationFixture.configure({active:true})");await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5",'borderless card set starts');
      const borderlessActive=await evaluate(faceHashes);
      if(JSON.stringify(borderlessIdle)!==JSON.stringify(borderlessActive))throw new Error('Borderless idle/active pixels differ');
      await evaluate("window.presentationFixture.configure({cardSet:'crayon-deck-v2'})");await pause(150);
      if(await evaluate("document.querySelector('canvas').dataset.cardSet")!=='crayon-deck-v3'||JSON.stringify(await evaluate(faceHashes))!==JSON.stringify(borderlessActive))throw new Error('Borderless trial version changed');
      report.borderlessPixels={idle:borderlessIdle,active:borderlessActive};
      report.checks.push('v3 retains target geometry, identical idle/active interiors and locked deck version');
      await evaluate("window.presentationFixture.configure({active:false,cardSet:'crayon-deck-v4'})");await pause(350);
      if(JSON.stringify(await evaluate("window.presentationFixture.snapshot().geometry"))!==JSON.stringify(borderless.geometry))throw new Error('Uniform deck changed geometry');
      const uniformIdle=await evaluate(faceHashes);
      const crossCenters=await evaluate(`(() => {const g=window.presentationFixture.snapshot().geometry,ctx=document.querySelector('canvas').getContext('2d'),d=g.devicePixelRatio;return g.targets.map(t=>[...ctx.getImageData(Math.floor((t.card.x+t.card.width/2)*d),Math.floor((t.card.y+t.card.height/2)*d),1,1).data]);})()`);
      if(crossCenters.some(p=>[23,53,107].some((v,i)=>Math.abs(p[i]-v)>15)))throw new Error('Cross center color missing: '+JSON.stringify(crossCenters));
      await evaluate("window.presentationFixture.configure({active:true})");await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5",'uniform deck starts');
      if(JSON.stringify(await evaluate(faceHashes))!==JSON.stringify(uniformIdle))throw new Error('Uniform idle/active interior mismatch');
      await evaluate("window.presentationFixture.configure({cardSet:'crayon-deck-v3'})");await pause(150);
      if(await evaluate("document.querySelector('canvas').dataset.cardSet")!=='crayon-deck-v4')throw new Error('Cross/paper changed mid-trial');
      report.uniformPaper={crossCenters};report.checks.push('v4 uniform paper and cross retain geometry, idle/active pixels and trial version lock');

      await evaluate("window.presentationFixture.configure({active:false,cardSet:undefined})");await pause(150);
      const priorResizeFaults = await evaluate("window.presentationFixture.snapshot().resizeFaults");
      await evaluate("window.presentationFixture.configure({active:true})"); await pause(180);
      window.setContentSize(1100,720);
      await until(`window.presentationFixture.snapshot().resizeFaults > ${priorResizeFaults}`, "active resize safety guard preserved");
      await evaluate("window.presentationFixture.configure({active:false})"); await pause(150);
      report.wholeCardLayouts=[];
      for(const [width,height] of [[1920,1080],[960,640]]) {
        window.setContentSize(width,height);await pause(120);
        for(const mode of ['simple','difficult1','difficult2']) {
          await evaluate(`window.presentationFixture.configure({mode:'${mode}',active:false,appearance:'card-face',targetSize:'game-card-face-v2',cardSet:'crayon-deck-v4',countdown:2})`);await pause(200);
          const data=await evaluate(`(() => {const g=window.presentationFixture.snapshot().geometry,c=document.querySelector('canvas').getBoundingClientRect(),notice=document.querySelector('.game-countdown').getBoundingClientRect();const rects=g.targets.map(t=>t.card);if(g.reference)rects.push(g.reference.card);if(document.querySelector("canvas").dataset.referenceTagBounds)rects.push(JSON.parse(document.querySelector("canvas").dataset.referenceTagBounds));return {mode:window.presentationFixture.snapshot().configuration.mode,profile:g.sizeProfile,width:innerWidth,height:innerHeight,overlap:rects.some((a,i)=>rects.slice(i+1).some(b=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height)),noticeOverlap:rects.some(a=>notice.left<a.x+c.left+a.width&&notice.right>a.x+c.left&&notice.top<a.y+c.top+a.height&&notice.bottom>a.y+c.top),bounds:[...g.targets.map(t=>t.card),...(g.reference?[g.reference.card]:[])].every(a=>a.x>=0&&a.y>=0&&a.x+a.width<=c.width&&a.y+a.height<=c.height)};})()`);
          if(data.overlap||data.noticeOverlap||!data.bounds||data.profile!=='game-card-face-v2')throw new Error('Whole-card layout: '+JSON.stringify(data));
          report.wholeCardLayouts.push(data);await capture(`whole-card-${mode}-${width}`);
        }
      }
      await evaluate("window.presentationFixture.configure({mode:'simple',active:false,countdown:0})");await pause(180);
      const sampleFace = `(() => {const c=document.querySelector('canvas'),ctx=c.getContext('2d'),g=window.presentationFixture.snapshot().geometry,t=g.targets[0],d=g.devicePixelRatio; const pixel=(x,y)=>[...ctx.getImageData(Math.round(x*d),Math.round(y*d),1,1).data];return {face:pixel(t.card.x+t.card.width*.5,t.card.y+t.card.height*.12),outside:pixel(t.ring.x+2,t.centerY),reference:pixel(g.reference.card.x+g.reference.card.width*.5,g.reference.card.y+g.reference.card.height*.12),cross:pixel(t.centerX,t.centerY)};})()`;
      const idleFace=await evaluate(sampleFace);
      await evaluate(`(() => {const queue=new Map();let id=0;window.frameProbe={raf:window.requestAnimationFrame,caf:window.cancelAnimationFrame,step(t){const batch=[...queue.values()];queue.clear();batch.forEach(f=>f(t));}};window.requestAnimationFrame=f=>{queue.set(++id,f);return id};window.cancelAnimationFrame=id=>queue.delete(id);window.presentationFixture.configure({active:true});})()`);await pause(100);
      const trace=[];
      for(const t of [1000,1000+1000/48,1000+1000/16]){await evaluate(`window.frameProbe.step(${t})`);trace.push(await evaluate(sampleFace));}
      if(trace[1].face.some((v,i)=>Math.abs(v-idleFace.face[i])>1))throw new Error('Bright peak does not retain original card pixels');
      if(trace[2].face.slice(0,3).some((v,i)=>Math.abs(v-idleFace.face[i]*.05)>2))throw new Error('Dark trough does not reach 5% RGB');
      for(const frame of trace)for(const key of ['outside','reference','cross'])if(JSON.stringify(frame[key])!==JSON.stringify(idleFace[key]))throw new Error('Unmodulated '+key+' changed');
      report.wholeCardPixels={idle:idleFace,trace};report.checks.push('whole-card bright peak original, dark trough 5%, surround/reference/fixed cross unchanged');
      await evaluate("window.presentationFixture.configure({active:false,appearance:'card',targetSize:'game-comfortable-v1',cardSet:undefined})");await pause(100);
      await evaluate("window.frameProbe.step(1200);window.requestAnimationFrame=window.frameProbe.raf;window.cancelAnimationFrame=window.frameProbe.caf;true;");
      window.setContentSize(1920,1080);await pause(100);
      await evaluate("window.presentationFixture.configure({mode:'difficult2',active:false,appearance:'card-face',targetSize:'game-card-face-v2',cardSet:'crayon-deck-v4'})");await pause(200);
      await evaluate("window.presentationFixture.configure({active:true})");
      await until("window.presentationFixture.snapshot().stats?.renderedFrames>120",'six whole-card targets render continuously');
      report.wholeCardRendering=await evaluate("window.presentationFixture.snapshot().stats");
      report.wholeCardMemory=app.getAppMetrics().find(m=>m.pid===window.webContents.getOSProcessId())?.memory;
      await evaluate("window.presentationFixture.configure({active:false,appearance:'card',targetSize:'game-comfortable-v1',cardSet:undefined})");await pause(150);
      if (!process.argv.includes('--cards-only')) {
      for (const version of ["crayon-paper-v1", "warm-paper-v1", "legacy-green-v1"]) {
        await evaluate(`window.presentationFixture.configure({ mode: 'difficult2', active: false, version: '${version}', length: 10, round: 0 })`); await pause(250);
        const idle = await evaluate("({ pixel:[...document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data], geometry:window.presentationFixture.snapshot().geometry })");
        if (version === "crayon-paper-v1" && idle.pixel.slice(0,3).join(',') !== "250,251,254") throw new Error("Crayon canvas background mismatch");
        if (version === "warm-paper-v1" && idle.pixel.slice(0,3).join(',') !== "247,245,241") throw new Error("Warm canvas background mismatch");
        if (version === "legacy-green-v1" && idle.pixel[1] <= idle.pixel[0]) throw new Error("Legacy background lost");
        await capture(`six-idle-${version}`);
        const beforeMetric = app.getAppMetrics().find(m=>m.pid === window.webContents.getOSProcessId());
        const beforeTime = Date.now();
        await evaluate("window.presentationFixture.configure({active:true})");
        await until("window.presentationFixture.snapshot().stats?.renderedFrames > 20", "stimulus renders real frames");
        // A changed requested presentation must not change the active canvas.
        await evaluate(`window.presentationFixture.configure({version:'${version === "warm-paper-v1" ? "legacy-green-v1" : "warm-paper-v1"}'})`);
        await pause(100);
        const locked = await evaluate("document.querySelector('canvas').dataset.presentation");
        if (locked !== version) throw new Error("Active presentation changed");
        await evaluate(`window.presentationFixture.configure({version:'${version}'})`);
        const expectedQuality = version === "legacy-green-v1" ? "balanced-v1" : "sharp-v1";
        await evaluate("window.presentationFixture.configure({rasterQuality:'balanced-v1'})"); await pause(60);
        if (await evaluate("document.querySelector('canvas').dataset.rasterQuality") !== expectedQuality) throw new Error("Active raster quality changed");
        await evaluate("window.presentationFixture.configure({rasterQuality:'sharp-v1'})");
        await pause(6000);
        await evaluate("window.presentationFixture.configure({active:false})"); await pause(120);
        const snapshot = await evaluate("window.presentationFixture.snapshot()");
        const renderer = app.getAppMetrics().find(m=>m.pid === window.webContents.getOSProcessId());
        report.rendering.push({ version, rasterQuality:expectedQuality, rasterScale:snapshot.geometry.devicePixelRatio, backingPixels:snapshot.geometry.backingWidth*snapshot.geometry.backingHeight, ...snapshot.stats, faults: snapshot.faults, rendererMemoryKB: renderer?.memory,
          cpuCorePercent: renderer && beforeMetric ? 100000 * (renderer.cpu.cumulativeCPUUsage-beforeMetric.cpu.cumulativeCPUUsage)/(Date.now()-beforeTime) : null });
        if (!snapshot.firstFrame || !snapshot.stats || snapshot.stats.renderedFrames < 30) throw new Error("No timing evidence");
      }
      // Deterministic RAF samples compare actual rendered surround pixels at identical phases.
      const traces = [];
      for (const version of ["crayon-paper-v1", "warm-paper-v1", "legacy-green-v1"]) {
        await evaluate(`window.presentationFixture.configure({active:false,version:'${version}'})`); await pause(200);
        await evaluate(`(() => { const queue=new Map(); let id=0;
          window.frameProbe={ raf:window.requestAnimationFrame, caf:window.cancelAnimationFrame,
            step(t){const batch=[...queue.values()];queue.clear();batch.forEach(callback=>callback(t));} };
          window.requestAnimationFrame=callback=>{queue.set(++id,callback);return id;}; window.cancelAnimationFrame=handle=>queue.delete(handle);
          window.presentationFixture.configure({active:true}); })()`);
        await pause(100);
        const trace = await evaluate(`(() => { const result=[]; for(let i=0;i<60;i++){
          window.frameProbe.step(1000+i*1000/60);
          const canvas=document.querySelector('canvas'),g=window.presentationFixture.snapshot().geometry,ctx=canvas.getContext('2d');
          result.push(g.targets.map(t=>[...ctx.getImageData(Math.floor((t.ring.x+(t.card.x-t.ring.x)/2)*g.devicePixelRatio),Math.floor(t.centerY*g.devicePixelRatio),1,1).data]));
        } return result; })()`);
        traces.push(trace);
        await evaluate("window.presentationFixture.configure({active:false})"); await pause(100);
        await evaluate("window.frameProbe.step(2100); window.requestAnimationFrame=window.frameProbe.raf; window.cancelAnimationFrame=window.frameProbe.caf; true;");
      }
      if (traces.some(trace=>JSON.stringify(trace)!==JSON.stringify(traces[0]))) throw new Error("Rendered luminance differs at identical phases");
      if (new Set(traces[0].map(sample=>JSON.stringify(sample))).size < 10) throw new Error("Luminance comparison did not exercise changing frames");
      report.checks.push("60 identical timestamps x six targets: rendered surround RGB unchanged across themes");
      // Unmodulated face interiors must be copied pixel-for-pixel from idle to active.
      const fingerprints = `(() => { const g=window.presentationFixture.snapshot().geometry,ctx=document.querySelector('canvas').getContext('2d'); return g.targets.map(t=>{ const p=t.card, d=g.devicePixelRatio, inset=Math.ceil(12*d), pixels=ctx.getImageData(Math.ceil(p.x*d)+inset,Math.ceil(p.y*d)+inset,Math.floor(p.width*d)-2*inset,Math.floor(p.height*d)-2*inset).data; let hash=2166136261; for(let i=0;i<pixels.length;i++) hash=Math.imul(hash^pixels[i],16777619); return hash>>>0; }); })()`;
      await evaluate("window.presentationFixture.configure({active:false,version:'crayon-paper-v1',rasterQuality:'sharp-v1'})"); await pause(200);
      const idleCards = await evaluate(fingerprints);
      await evaluate("window.presentationFixture.configure({active:true})"); await until("window.presentationFixture.snapshot().stats?.renderedFrames > 5", "sharp card sprites render");
      if (JSON.stringify(idleCards)!==JSON.stringify(await evaluate(fingerprints))) throw new Error("Cached card copy introduced additional resampling");
      report.checks.push("sharp crayon card interiors remain pixel-identical during surround stimulation");
      const cacheBytes=await evaluate("Number(document.querySelector('canvas').dataset.imageCacheBytes)");
      if (!(cacheBytes > 0 && cacheBytes <= 64*1024*1024)) throw new Error("Decoded image cache budget invalid: "+cacheBytes);
      report.decodedImageCacheBytes=cacheBytes;
      await evaluate("window.presentationFixture.configure({active:false})"); await pause(100);
      await evaluate("window.presentationFixture.configure({active:false,version:'crayon-paper-v1'})"); await pause(200);
      await evaluate("window.presentationFixture.configure({active:true})"); await pause(200);
      window.setContentSize(1880,1080);
      await until("window.presentationFixture.snapshot().resizeFaults > 0", "resizing active stimulus notifies trial cancellation guard");
      await evaluate("window.presentationFixture.configure({active:false})");
      report.performanceStatus = report.rendering.some(r=>r.faults) ? "display-timing-inconclusive-offscreen" : "software-budget-measured";
      } else report.performanceStatus = 'not-run-resource-only';
      }
      if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
      report.success = true;
    } catch (error) { report.error = String(error); await capture("failure").catch(()=>{}); }
    report.consoleErrors = errors;
    report.finishedAt = new Date().toISOString();
    report.displayVerification = "Hidden software-rendered window; timing and process metrics describe this harness, not physical display or EEG validity.";
    fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); app.exit(report.success ? 0 : 1);
  });
}
