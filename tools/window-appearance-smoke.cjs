// Isolated actual UI/preload/native caption check. Never connects to EEG or saves scores.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const rankingCheck = process.argv.includes("--rankings");
const root = path.resolve(__dirname, ".."), directory = path.join(root, ".smoke-user-data", rankingCheck ? "ranking-layout" : "window-appearance");
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require("node:child_process").spawnSync(require("electron"), [__filename, ...process.argv.slice(2)], { env, stdio: "inherit", windowsHide: true, timeout: 60000 });
  if(result.error) console.error(result.error);
  process.exitCode = result.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, ipcMain } = require("electron");
  app.setPath("userData", path.join(directory, "user-data"));
  app.disableHardwareAcceleration(); app.commandLine.appendSwitch("force-device-scale-factor", "1");
  ipcMain.handle("gateway:get-status", () => "stopped");
  ipcMain.handle("gateway:get-connection", () => null);
  let records = [], refreshes = 0;
  ipcMain.handle("challenge:list", () => { refreshes++; return { records, warnings: [] }; });
  app.whenReady().then(async () => {
    const { validateWindowAppearance } = await import(pathToFileURL(path.join(root, "dist-desktop/main/windowAppearance.js")));
    if (rankingCheck) {
      const { createChallenge, validateChallenge, CHALLENGE_MODES, CHALLENGE_RULE_VERSION } = await import(pathToFileURL(path.join(root, "dist-desktop/main/challengeModel.js")));
      const { randomUUID } = require("node:crypto");
      const configuration = { ruleVersion:CHALLENGE_RULE_VERSION, classifier:"isolated-layout-fixture", stimulus:JSON.stringify({presentationVersion:"crayon-paper-v1",cardSetVersion:"crayon-deck-v3",rasterQuality:"sharp-v1",gameSizeProfile:"game-comfortable-v1"}) };
      records = [29, 23, 12, 4].map((correct, participant) => {
        const r=createChallenge(randomUUID(), `000${participant}`, participant===0 ? "布局验收长姓名甲乙丙丁戊己庚辛" : `布局验收${participant}`, configuration, "2026-10-25T00:00:00.000Z");
        r.rounds=Array.from({length:participant===3?4:30}, (_,i)=>({mode:CHALLENGE_MODES[Math.floor(i/10)], index:i%10,
          reference:{rank:6,suit:"♣"}, candidates:Array.from({length:[2,4,6][Math.floor(i/10)]},(_,j)=>({rank:7+j,suit:"♥"})), correctIndex:0,
          attempts:[{id:randomUUID(),trialId:randomUUID(),sessionId:"isolated-layout",preparedAt:r.createdAt,outcome:i<correct?"correct":"incorrect",selectedIndex:i<correct?0:1,
            logicalStartMs:990,firstFrameMs:1000,endedMs:3000+participant*200,elapsedMs:2000+participant*200,reason:null}]}));
        if(participant!==3){r.status="completed";r.completedAt=r.createdAt;}
        validateChallenge(r);return r;
      });
    }
    fs.mkdirSync(directory, { recursive: true });
    const win = new BrowserWindow({ show: false, useContentSize: true, width: 1920, height: 1080,
      titleBarStyle: "hidden", titleBarOverlay: { color: "#FAFBFE", symbolColor: "#17356B", height: 64 },
      webPreferences: { preload: path.join(root, "dist-desktop/preload/preload.cjs"), sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
    let caption = null; const changes = [], errors = [], checks = [];
    ipcMain.handle("window:set-appearance", (event, value) => {
      assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, win.webContents.mainFrame);
      caption = validateWindowAppearance(value); win.setTitleBarOverlay(caption); changes.push(caption);
    });
    win.webContents.on("console-message", d => { if (d.level === "error") errors.push(d.message); });
    const read = code => win.webContents.executeJavaScript(code), pause = ms => new Promise(r => setTimeout(r, ms));
    const click = label => read(`(() => { const root = document.querySelector('dialog[open]') || document;
      const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled && b.getClientRects().length);
      if (!b) throw new Error('Missing button: ' + ${JSON.stringify(label)}); b.click(); })()`);
    const check = async (label, dimmed, selector) => {
      await read("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"); await pause(150);
      assert.deepEqual(caption, { color: dimmed ? "#D6DBE6" : "#FAFBFE", symbolColor: "#17356B" }, label);
      const layout = await read(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if(!e) return null;
        const r=e.getBoundingClientRect(), s=getComputedStyle(e); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,radius:s.borderTopLeftRadius,width:innerWidth,height:innerHeight,
        overflow:document.documentElement.scrollWidth>innerWidth+1,
        backdrop: e.tagName==='DIALOG' ? getComputedStyle(e,'::backdrop').backgroundColor : getComputedStyle(e.parentElement).backgroundColor }; })()`);
      assert.ok(layout && !layout.overflow && layout.x >= -1 && layout.y >= -1 && layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1, `${label}: ${JSON.stringify(layout)}`);
      if (dimmed) { assert.equal(layout.radius, "24px", label); assert.equal(layout.backdrop, "rgba(23, 53, 107, 0.16)", label); }
      checks.push({ label, caption, layout });
    };
    try {
      win.setContentSize(1920, 1080); await win.loadFile(path.join(root, "dist-renderer/index.html"));
      win.webContents.debugger.attach("1.3");await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled",{enabled:true}); await read("document.fonts.ready");
      for (let i=0; i<100 && await read("!!document.querySelector('.intro-flip')"); i++) await pause(100);
      assert.equal(await read("!!document.querySelector('.intro-flip')"), false, "intro must be gone before modal checks");
      for (const [width, height] of [[1920, 1080], [960, 640]]) {
        win.setContentSize(width, height); await pause(160);
        await check(`home-${width}`, false, '.shell');
        const statusOffset = await read("(() => { const r=document.querySelector('.game-setup-status').getBoundingClientRect(); return Math.abs((r.left+r.right)/2-innerWidth/2); })()");
        assert.ok(statusOffset < 1, `waiting status must be centered: ${statusOffset}px`);
        await click('规则'); await check(`rules-${width}`, true, '.game-rules-modal');
        fs.writeFileSync(path.join(directory, `rules-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await click('返回调整'); await check(`rules-close-${width}`, false, '.shell');
        await click('开始游戏'); await check(`start-rules-${width}`, true, '.game-rules-modal');
        await read("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await check(`escape-${width}`, false, '.shell');
        await click('三关挑战'); await check(`identity-${width}`, true, 'dialog[open]');
        const focus=await read("(() => {const e=document.querySelector('input[name=studentId]');e.focus();const s=getComputedStyle(e);return {outline:s.outlineStyle,bottom:s.borderBottomColor,shadow:s.boxShadow}})()");
        assert.equal(focus.outline,'none');assert.equal(focus.bottom,'rgb(23, 53, 107)');
        fs.writeFileSync(path.join(directory, `identity-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await click('排行榜'); await check(`rankings-${width}`, true, 'dialog[open]');
        assert.equal(await read("(() => {const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.width<innerWidth&&r.height<innerHeight&&r.top>=64})()"),true,'ranking is a bounded modal');
        if (rankingCheck) {
          const inspectRanking = async label => {
            await pause(100);
            const layout=await read(`(() => { const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
              const scroller=document.querySelector('.challenge-hub-body'), table=document.querySelector('.challenge-ranking-table');
              return {back:box('.challenge-page-back'),refresh:box('.challenge-board-tools button'),heading:box('.challenge-board-heading'),filters:box('.challenge-ranking-controls'),results:box('.challenge-list-heading'),
                pageOverflow:document.querySelector('.challenge-hub-body').scrollWidth>scroller.clientWidth+1,
                tableOverflow:table ? table.parentElement.scrollWidth>table.parentElement.clientWidth+1 : false,
                tablePresent:!!table, empty:!!document.querySelector('.challenge-empty'), count:document.querySelector('.challenge-list-heading').textContent}; })()`);
            assert.ok(layout.back.top>=76 && layout.refresh.top>=layout.back.bottom+16 && layout.back.right<layout.refresh.left, label+' caption safety '+JSON.stringify(layout));
            assert.ok(layout.heading.bottom+20<=layout.filters.top && layout.filters.bottom<=layout.results.top, label+' section spacing');
            assert.ok(!layout.pageOverflow && !layout.tableOverflow,label+' overflow');
            checks.push({label,layout});return layout;
          };
          const empty=await inspectRanking(`empty-board-${width}`);assert.ok(empty.empty&&!empty.tablePresent);
          fs.writeFileSync(path.join(directory,`ranking-empty-${width}.png`),(await win.webContents.capturePage()).toPNG());
          await read("(() => { const s=document.querySelector('.challenge-group-filter select');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true})); })()");
          const populated=await inspectRanking(`populated-board-${width}`);assert.ok(populated.tablePresent&&populated.count.includes('3 次挑战'));
          fs.writeFileSync(path.join(directory,`ranking-populated-${width}.png`),(await win.webContents.capturePage()).toPNG());
          for (const name of ['准确榜','速度榜','连胜榜','综合榜']) {
            await click(name);await pause(70);
            assert.equal(await read("document.querySelectorAll('.challenge-ranking-table > tbody > tr').length"),name==='速度榜'?2:3,name+' row coverage');
          }
          await click('展开');await pause(80);
          assert.equal(await read("document.querySelectorAll('.challenge-ranking-table > tbody > tr > td[colspan] .challenge-table tbody tr').length"),3);
          await click('收起');
          await read("document.querySelector('.challenge-explanation').open=true;document.querySelector('.challenge-hub-body').scrollTop=10000");await pause(100);
          assert.equal(await read("(() => { const b=document.querySelector('.challenge-page-back'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+8,r.top+8)) })()"),true,'back stays reachable after scroll');
          await read("document.querySelector('.challenge-hub-body').scrollTop=0");
        }
        const beforeRefresh=refreshes;
        await click('刷新'); await check(`rankings-refresh-${width}`, true, 'dialog[open]');
        assert.ok(refreshes>beforeRefresh,'refresh reloads records');
        await click('返回'); await check(`back-to-identity-${width}`, true, 'dialog[open]');
        if(rankingCheck) {
          await click('继续挑战');await pause(150);
          assert.equal(await read("document.querySelectorAll('.challenge-resume article').length"),1);
          const resume=await read("(() => {const r=document.querySelector('.challenge-resume article').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:innerWidth}})()");
          assert.ok(resume.left>=0&&resume.right<=resume.width&&resume.top>=76);
          checks.push({label:`resume-${width}`,layout:resume});
          fs.writeFileSync(path.join(directory,`resume-${width}.png`),(await win.webContents.capturePage()).toPNG());
          await click('返回');await check(`resume-back-${width}`,true,'dialog[open]');
        }
        // Local unsaved form only; deliberately stop before creating a challenge.
        await read(`(() => { for(const [name,value] of [['studentId','0000'],['participantName','界面验收']]) {
          const input=document.querySelector('input[name="'+name+'"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
          input.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
        await click('下一步'); await check(`challenge-rules-${width}`, true, 'dialog[open]');
        await read("document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{cancelable:true}))");
        await check(`challenge-close-${width}`, false, '.shell');
        await click('教学模式'); await check(`teaching-${width}`, false, '.shell');
        await win.webContents.executeJavaScript("document.querySelector('.device-controls__trigger').click(); document.querySelector('.device-controls__footer button').click()"); await check(`lab-${width}`, false, '.shell');
        await click('游戏牌桌');
      }
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({success:true,checks,changes,errors,
        captureScope:'webContents only; native caption synchronization verified by real setTitleBarOverlay calls, not screenshot pixels'},null,2));
      console.log(`WINDOW_APPEARANCE_OK ${checks.length} checks; ${directory}`);
    } finally { win.destroy(); app.quit(); }
  }).catch(error => { console.error(error); app.exit(1); });
}
