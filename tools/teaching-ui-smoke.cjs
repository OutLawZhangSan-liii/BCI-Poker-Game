// Isolated app navigation/course QA plus synthetic display-only PSD history. No device or score writes.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=require('node:child_process').spawnSync(require('electron'),[__filename,...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true,timeout:120000});if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1;}
else{
 const {app,BrowserWindow,ipcMain}=require('electron');
 const out=path.join(root,'.smoke-user-data','teaching-'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'user-data'));app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
 const appearances=[];
 ipcMain.handle('gateway:get-status',()=> 'stopped');ipcMain.handle('gateway:get-connection',()=>null);ipcMain.handle('challenge:list',()=>({records:[],warnings:[]}));ipcMain.handle('window:set-appearance',(_,appearance)=>{appearances.push(appearance)});
 app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:1920,height:1080,useContentSize:true,show:false,webPreferences:{preload:path.join(root,'dist-desktop/preload/preload.cjs'),sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  const errors=[],checks=[];let success=false,error;
  w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
  const read=s=>w.webContents.executeJavaScript(s),pause=ms=>new Promise(r=>setTimeout(r,ms)),check=(label,condition,detail)=>{checks.push({label,passed:!!condition,detail});if(!condition)throw Error(label+': '+JSON.stringify(detail))};
  const capture=async name=>fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());
  const click=selector=>read(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('missing '+${JSON.stringify(selector)});n.click()})()`);
  const pointerClick = async selector => {
    const {x, y} = await read(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
    })()`);
    for (const type of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({type, button:'left', clickCount:1, x, y});
  };
  const plotLayout=async(label,standalone=false)=>{
   const d=await read(`(()=>{const cards=[...document.querySelectorAll('.demo-analysis-results > .sim-analysis-chart-card')],details=document.querySelector('.teaching-settings-details'),side=document.querySelector('.principle-demo-side');const figures=cards.map(card=>{const c=card.querySelector('canvas'),r=c.getBoundingClientRect(),p=JSON.parse(c.dataset.plotBounds),h=card.querySelector('h4').getBoundingClientRect(),legend=card.querySelector('.spectrum-frequency-legend > span').getBoundingClientRect();return{left:r.left+p.left,right:r.left+p.right,topInset:p.top,bottomInset:r.height-p.bottom,xLabel:r.left+Number(c.dataset.xLabelAnchor),headerLeft:h.left,legendLeft:legend.left,canvasWidth:r.width,canvasHeight:r.height}});return{figures,overflow:document.documentElement.scrollWidth>innerWidth+1,sideOverflow:side?side.scrollWidth>side.clientWidth+1:false,sideTop:side?.getBoundingClientRect().top,settingsTop:details?.getBoundingClientRect().top}})()`);
   const[a,b]=d.figures;check(label,d.figures.length===2&&!d.overflow&&!d.sideOverflow&&Math.abs(a.left-b.left)<1&&Math.abs(a.right-b.right)<1&&Math.abs(a.xLabel-b.xLabel)<1&&Math.abs(a.headerLeft-b.headerLeft)<1&&Math.abs(a.legendLeft-b.legendLeft)<1&&Math.abs(a.topInset-b.topInset)<1&&Math.abs(a.bottomInset-b.bottomInset)<1&&(standalone||d.sideTop<=d.settingsTop+1),d);return d;
  };
  const settle=async()=>{await pause(420);await read('document.fonts.ready');await read('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')};
  try{
   await w.loadFile(path.join(root,'dist-renderer/index.html'));
   for(let i=0;i<100;i++){await read("document.querySelector('.intro-flip')?.click()");if(await read("!document.querySelector('.intro-flip')&&!!document.querySelector('.view-nav')"))break;await pause(100)}
   await click('.view-nav button[aria-controls="teaching-workspace"]');await pause(80);
   const headerMetrics=await read(`[...document.querySelectorAll('.app-header__action')].map(button=>{
     const s=getComputedStyle(button), r=button.getBoundingClientRect();
     return {label:button.textContent.trim(),font:s.fontFamily,size:s.fontSize,height:r.height,center:r.top+r.height/2,
       scale:new DOMMatrix(getComputedStyle(button.querySelector('span')).transform).a};
   })`);
   check('four header actions share type size, baseline and height while switching',headerMetrics.map(b=>b.label).join('/')==='游戏牌桌/纸飞机/教学模式/设备'&&headerMetrics.every(b=>b.font===headerMetrics[0].font&&b.size===headerMetrics[0].size&&b.height===headerMetrics[0].height&&Math.abs(b.center-headerMetrics[0].center)<1&&b.scale===1),headerMetrics);
   await click('.device-controls__trigger');await click('.device-controls__footer button');await pause(35);check('device content has a cancellable entrance',await read("document.querySelector('.lab-device-workspace').getAnimations().some(a=>a.playState==='running')"));await pause(35);await click('.view-nav button[aria-controls="teaching-workspace"]');await settle();
   const selected=await read(`(() => {
     const nav=document.querySelector('.view-nav'), active=nav.querySelector('[aria-current="page"]'), idle=nav.querySelector('button:not([aria-current])');
     active.focus();
     return {label:active.textContent,scale:new DOMMatrix(getComputedStyle(active.firstElementChild).transform).a,
       idleScale:getComputedStyle(idle.firstElementChild).transform,activeColor:getComputedStyle(active).color,idleColor:getComputedStyle(idle).color,
       activeWeight:getComputedStyle(active).fontWeight,idleWeight:getComputedStyle(idle).fontWeight,outline:getComputedStyle(active).outlineWidth};
   })()`);
   check('rapid retarget ends with ink emphasis on the selected main label',selected.label==='教学模式'&&selected.scale===1&&selected.idleScale==='none'&&selected.activeColor!==selected.idleColor&&Number(selected.activeWeight)>Number(selected.idleWeight)&&selected.outline==='0px',selected);
   const checkTeachingCorners=async label=>{
     const tabs=await read(`Array.from(document.querySelectorAll('.teaching-workspace-nav button'),button=>{
       const s=button.querySelector('span'), a=getComputedStyle(s,'::before'), b=getComputedStyle(s,'::after');
       return {current:button.getAttribute('aria-current'),label:s.textContent,opacity:[a.opacity,b.opacity],
         edges:[a.borderTopWidth,a.borderLeftWidth,b.borderRightWidth,b.borderBottomWidth]};
     })`);
     check('only '+label+' has both ink corners',tabs.length===3&&tabs.every(t=>t.label===label?
       t.current==='page'&&t.opacity.every(v=>v==='1')&&t.edges.every(v=>parseFloat(v)>0):
       t.current===null&&t.opacity.every(v=>v==='0')),tabs);
   };
   await checkTeachingCorners('课程学习');
   if (!process.argv.includes('--plots-only')) {
    await click('.teaching-course-nav__desktop button:nth-child(7)');
    let previousFont = 0;
    for (const [width, height] of [[1280,800], [1707,912], [2560,1440], [3840,2160]]) {
      w.setContentSize(width,height); await settle();
      const metrics = await read(`(() => {
        const workspace = document.querySelector('.teaching-course-workspace');
        const directory = document.querySelector('.teaching-course-nav__desktop');
        const font = parseFloat(getComputedStyle(document.querySelector('.teaching-lesson__observation article p')).fontSize);
        const navBox = directory.getBoundingClientRect(), progress = document.querySelector('.teaching-course-nav__progress').getBoundingClientRect();
        return {width:innerWidth,height:innerHeight,font,left:navBox.left,directoryGap:progress.top-navBox.bottom,
          fits:workspace.scrollWidth<=workspace.clientWidth+1 && workspace.scrollHeight<=workspace.clientHeight+1};
      })()`);
      check('viewport scales text and uses the left edge at '+width, metrics.width===width && metrics.height===height &&
        metrics.font>previousFont && metrics.left<width*.05 && metrics.directoryGap>=0 && metrics.directoryGap<24 && metrics.fits,metrics);
      const bookmarks=await read(`Array.from(document.querySelectorAll('.teaching-course-nav__desktop button'),b=>({
        current:b.getAttribute('aria-current'),mark:getComputedStyle(b,'::before').clipPath,background:getComputedStyle(b).backgroundColor
      }))`);
      check('course directory marks only the current lesson '+width,bookmarks.length===8&&bookmarks.filter(b=>b.current==='step').length===1&&bookmarks.every(b=>b.current==='step'?b.mark.startsWith('polygon(')&&b.background==='rgba(0, 0, 0, 0)':b.mark==='none'),bookmarks);
      previousFont=metrics.font;
      if (width===1707) await capture('responsive-course-1707');
    }
    w.setContentSize(1707,912); await settle();
    const keyboardRange=async (selector,key)=>{
      await read(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      for(const type of ['keyDown','keyUp']) w.webContents.sendInputEvent({type,keyCode:key});
      await pause(55);
    };
    for(const lesson of [6,7]){
      await click('.teaching-course-nav__desktop button:nth-child('+lesson+')');await settle();
      const state=()=>read(`(() => {
        const [amp,noise]=document.querySelectorAll('.lesson-signal-sliders input');
        return {amp:amp.value,noise:noise.value,curve:document.querySelector('.lesson-example-graph polyline').getAttribute('points'),
          readout:document.querySelector('.lesson-signal-example figcaption span').textContent,selected:document.querySelector('.lesson-example-choices [aria-pressed=true]')?.textContent};
      })()`);
      const before=await state();await pointerClick('.lesson-example-choices button:nth-child(2)');await settle();const preset=await state();
      check('preset sets a visible spectrum '+lesson,before.curve!==preset.curve && preset.selected && preset.readout.includes('dB'),preset.readout);
      await keyboardRange('.lesson-signal-sliders input[aria-label=信号幅值]','Right');const louder=await state();
      check('amplitude updates independently '+lesson,Number(louder.amp)>Number(preset.amp)&&louder.noise===preset.noise&&louder.curve!==preset.curve&&!louder.selected&&louder.readout!==preset.readout);
      await keyboardRange('.lesson-signal-sliders input[aria-label=噪声强度]','Right');const noisier=await state();
      check('noise updates independently '+lesson,Number(noisier.noise)>Number(louder.noise)&&noisier.amp===louder.amp&&noisier.curve!==louder.curve&&noisier.readout!==louder.readout);
      await keyboardRange('.lesson-signal-sliders input[aria-label=信号幅值]','Home');check('noise only '+lesson,(await state()).readout==='仅有噪声');
      await keyboardRange('.lesson-signal-sliders input[aria-label=噪声强度]','Home');check('all zero '+lesson,(await state()).readout==='无信号、无噪声');
      await pointerClick('.lesson-example-choices button:first-child');await settle();
      if(lesson===7)await capture('lesson-parameters-1707');
    }
    await click('.teaching-course-nav__desktop button:nth-child(8)');await settle();
    const readings=()=>read("Array.from(document.querySelectorAll('.lesson-window-readings dd'),d=>d.textContent).join('/')");
    check('six seconds distinguishes short and long windows',await readings()==='15 Hz/15 Hz/12 Hz');
    await capture('lesson-recognition-1707');
    const clock='.lesson-time-controls input';
    await keyboardRange(clock,'Home');
    check('estimates wait for acquisition window',await readings()==='12 Hz/积累中/积累中' && await read("document.querySelectorAll('.lesson-example-graph g').length===0"));
    await pointerClick('.lesson-play');await pause(1150);await pointerClick('.lesson-play');
    const paused=await read("Number(document.querySelector('.lesson-time-controls input').value)");
    await pause(310);
    check('playback and pause', paused>=4 && paused<16 && paused===await read("Number(document.querySelector('.lesson-time-controls input').value)") && await readings()==='12 Hz/12 Hz/积累中');
    await keyboardRange(clock,'End');check('both windows have caught up',await readings()==='15 Hz/15 Hz/15 Hz');
    await pointerClick('.lesson-example-choices button:first-child');await settle();
    check('stable input produces stable decisions',await readings()==='12 Hz/12 Hz/12 Hz');
    await click('.teaching-course-nav__desktop button:nth-child(3)'); await settle();
    await read("document.querySelector('.teaching-number-control input').focus()");
    w.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await pause(80);
    check('keyboard changes base frequency and harmonics',await read("document.querySelector('.teaching-number-control output').textContent.includes('12.5') && document.querySelector('.harmonic-preview').textContent.includes('37.5 Hz')"));
    w.setContentSize(740,800);await settle();
    const picker='.teaching-course-picker .themed-dropdown__trigger';
    await pointerClick(picker);await pause(100);
    const list='.themed-dropdown__menu.themed-dropdown--course';
    check('compact course menu distinguishes current from completed',await read(`(() => {
      const b=document.querySelector('${list} [aria-selected="true"]');
      return b?.textContent.includes('从基频到谐波') && getComputedStyle(b,'::before').clipPath.startsWith('polygon(') && !b.querySelector('.themed-dropdown__check').textContent;
    })()`));
    await pointerClick(list+' [role="option"]:nth-child(5)');await settle();
    check('compact picker follows the new bookmarked course',await read(`document.querySelector('${picker}').textContent.includes('从证据到决策') && document.querySelector('.teaching-course-nav__desktop [aria-current="step"]').textContent.includes('从证据到决策')`));
    await click('.teaching-course-nav__desktop button:nth-child(1)');
   }
   for(const [width,height] of [[1920,1080],[1700,910],[1200,880],[1280,800],[960,640]]){
    w.setContentSize(width,height);await settle();
    let anchors=null;
    const courseExports={};new Function('exports',require('typescript').transpileModule(fs.readFileSync(path.join(root,'renderer/src/teaching/courses.ts'),'utf8'),{compilerOptions:{module:require('typescript').ModuleKind.CommonJS}}).outputText)(courseExports);
    const lessonBounds=()=>read("(()=>{const l=document.querySelector('.teaching-lesson'),w=document.querySelector('.teaching-course-workspace'),body=l.querySelector('.teaching-lesson__body'),f=l.querySelector('.teaching-lesson__navigation').getBoundingClientRect(),t=l.querySelector('.teaching-lesson__takeaway');const title=l.querySelector('.teaching-lesson__intro h3'),tr=title.getBoundingClientRect(),sr=t.getBoundingClientRect(),hr=title.parentElement.getBoundingClientRect();return{titleFont:parseFloat(getComputedStyle(title).fontSize),subtitleFits:sr.left>=tr.right && sr.top>=hr.top-1 && sr.bottom<=hr.bottom+1,intro:l.querySelector('.teaching-lesson__intro').getBoundingClientRect().top,focus:t.getBoundingClientRect().top,body:body.getBoundingClientRect().top,footer:f.top,font:parseFloat(getComputedStyle(t).fontSize),overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1,workspaceOverflow:w.scrollHeight>w.clientHeight+1,bodyOverflow:body.scrollHeight>body.clientHeight+2,footerVisible:f.bottom<=innerHeight+1,single:getComputedStyle(l.querySelector('.lesson-pane-nav')).display!=='none',quiz:l.querySelectorAll('.teaching-quiz-options button').length}})()");
    for(let index=0;index<(process.argv.includes('--plots-only')?0:8);index++){
     await click(`.teaching-course-nav__desktop button:nth-child(${index+1})`);await settle();
     const d=await lessonBounds();if(!anchors)anchors=d;
     check(`stable lesson ${index+1} ${width}`,!d.overflow&&!d.workspaceOverflow&&!d.bodyOverflow&&d.footerVisible&&d.font>=16&&d.font<d.titleFont&&d.subtitleFits&&d.quiz===4&&['intro','body','footer'].every(k=>Math.abs(d[k]-anchors[k])<1),d);
     await pointerClick('.lesson-reference-trigger');await pause(70);check('reference dialog dims native caption',appearances.at(-1)?.color?.toUpperCase()==='#D6DBE6',appearances.at(-1));check('full explanation opens without moving lesson',await read("document.querySelector('.lesson-reference-dialog').open&&document.querySelector('.lesson-reference-dialog').scrollHeight<=document.querySelector('.lesson-reference-dialog').clientHeight+1")&&(await lessonBounds()).footer===d.footer);
     const dialogBounds = await read(`(() => {
       const dialog = document.querySelector('.lesson-reference-dialog');
       const box = dialog.getBoundingClientRect();
       const button = dialog.querySelector('header button');
       const close = button.getBoundingClientRect();
       const x = Math.round(close.left + close.width / 2), y = Math.round(close.top + close.height / 2);
       return { x, y, left: box.left, top: box.top, centered: Math.abs(box.left + box.width / 2 - innerWidth / 2) < 2 && Math.abs(box.top + box.height / 2 - innerHeight / 2) < 2,
         clearOfCaption: close.top > document.querySelector('.app-header').getBoundingClientRect().bottom,
         opaque: getComputedStyle(dialog).backgroundColor.startsWith('rgb('),
         hit: button.contains(document.elementFromPoint(x, y)) };
     })()`);
     check('reading dialog is centered and close is outside the window drag region', dialogBounds.centered && dialogBounds.clearOfCaption && dialogBounds.opaque && dialogBounds.hit, dialogBounds);
     if(index === 6) await capture('reading-snr-'+width);
     await pointerClick('.lesson-reference-dialog header button');
     await pause(80);
     const returnedToLesson = () => read("!document.querySelector('.lesson-reference-dialog').open && document.activeElement === document.querySelector('.lesson-reference-trigger')");
     check('pointer closes reading dialog and restores focus', await returnedToLesson());
     if(index === 6){
       await pointerClick('.lesson-reference-trigger');await pause(50);
       w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
       w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
       await pause(80);check('Escape closes reopened reading dialog and restores focus',await returnedToLesson());
       await capture('lesson-snr-'+width);
     }
     check('closing reference restores native caption',appearances.at(-1)?.color?.toUpperCase()==='#FAFBFE',appearances.at(-1));
     if(d.single){await click('.lesson-pane-nav button:nth-child(2)');await pause(50)}
     if(index===0){await click('.teaching-quiz-options button:nth-child(1)');check('wrong answer retains explanation',await read("!!document.querySelector('.teaching-quiz-feedback.is-wrong')"));await click('.teaching-quiz-retry');}
     await click(`.teaching-quiz-options button:nth-child(${courseExports.teachingCourses[index].quiz.answer+1})`);await pause(50);
     const answered=await lessonBounds();check(`answer remains inside lesson ${index+1} ${width}`,!answered.bodyOverflow&&!answered.workspaceOverflow&&answered.footer===d.footer&&await read("!!document.querySelector('.teaching-quiz-feedback.is-correct')"),answered);
     if (width >= 1200 && height >= 880) {
       const columns = await read(`(() => {
         const box = s => document.querySelector(s).getBoundingClientRect();
         const nav = box('.teaching-course-nav__desktop'), progress = box('.teaching-course-nav__progress');
         const example = box('.teaching-lesson__main'), quiz = box('.teaching-quiz'), footer = box('.teaching-lesson__navigation');
         return {navEnd:nav.bottom, progress:progress.top, progressEnd:progress.bottom,
           observeEnd:example.bottom, practice:quiz.top, practiceEnd:quiz.bottom, footer:footer.top, footerEnd:footer.bottom};
       })()`);
       check('wide lesson places exercise below example and progress below directory',
         columns.observeEnd <= columns.practice && columns.practiceEnd <= columns.footer + 1 &&
         columns.navEnd <= columns.progress + 1 && Math.abs(columns.progressEnd - columns.footerEnd) < 16, columns);
     }
     if([0,3,7].includes(index)){await settle();if(d.single)await capture(`practice-${index+1}-${width}`);if(d.single){await click('.lesson-pane-nav button:nth-child(1)');await pause(50)}await capture(`course-${index+1}-${width}`);}
    }
    await click('.teaching-workspace-nav button:nth-of-type(2)');await settle();await checkTeachingCorners('信号观察');
    await click('.analysis-inline-details > button');await pause(260);
    const params=await read("(()=>{const s=document.querySelector('.analysis-inline-details'),b=s.querySelector('button').getBoundingClientRect(),c=s.querySelector('.analysis-inline-details__body').getBoundingClientRect();return{buttonRight:b.right,bodyLeft:c.left,height:c.height,open:s.querySelector('button').getAttribute('aria-expanded'),overflow:s.scrollWidth>s.clientWidth+1}})()");
    check(`horizontal analysis parameters ${width}`,params.open==='true'&&params.bodyLeft>=params.buttonRight+8&&params.height<90&&!params.overflow,params);await capture(`analysis-parameters-${width}`);
    await click('.analysis-inline-details > button');check('parameter disclosure closes',await read("!document.querySelector('.analysis-inline-details__body')"));
    await click('.teaching-workspace-nav button:nth-of-type(3)');await settle();await checkTeachingCorners('演示与训练');
    check('PSD followed by time-frequency and target match',await read("(()=>{const nodes=[...document.querySelector('.demo-analysis-results').children];return nodes.length===3&&nodes[1].classList.contains('principle-spectrogram')&&nodes[2].classList.contains('demo-cca')})()"));
    await read("(()=>{const s=document.querySelector('[aria-label=\"PSD 显示通道\"]');s.value='Pz';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await settle();
    check('one channel selection controls both plots',await read("[...document.querySelectorAll('.demo-analysis-results h4')].slice(0,2).every(n=>n.textContent.includes('Pz'))"));
    check('no data stays empty without duplicate helper copy',await read("!document.querySelector('.demo-cca-description')&&document.querySelector('.principle-spectrogram canvas').dataset.windowEnd===''"));
    await plotLayout(`aligned empty plots ${width}`);
    const countSelect=".teaching-settings label:has(select) select";
    await read(`(()=>{const s=document.querySelector('${countSelect}');s.value='4';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await settle();
    await plotLayout(`four-target settings leave analysis clear ${width}`);
    await read(`(()=>{const s=document.querySelector('${countSelect}');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await settle();
    await capture(`demo-empty-${width}`);
    await click('.teaching-segmented--modes button:nth-of-type(2)');await settle();
    const operation = await read(`(() => {
      const layout = document.querySelector('.operation-focus-layout');
      const modes = document.querySelector('.teaching-segmented--modes');
      const active = modes.querySelector('[aria-current="page"]');
      const marker = modes.querySelector('.teaching-segmented__indicator').getBoundingClientRect();
      const stage = layout.querySelector('.stimulus-stage').getBoundingClientRect();
      return {active: active.textContent, markerGap: Math.abs(marker.left - active.getBoundingClientRect().left),
        stageHeight: stage.height, controls: document.querySelectorAll('.training-control-actions button').length};
    })()`);
    check(`operation training switches and shows the selected mode at ${width}`,
      operation.active === '操作训练' && operation.markerGap < 1 && operation.stageHeight > 100 && operation.controls === 2, operation);
    if(width === 1700) await capture('operation-'+width);
    await click('.teaching-segmented--modes button:nth-of-type(1)');await settle();
    await click('.teaching-workspace-nav button:nth-of-type(1)');await settle();
   }
   w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   check('reduced motion disables navigation transition',await read("getComputedStyle(document.querySelector('.view-nav button[aria-current]')).transitionDuration==='0s' && getComputedStyle(document.querySelector('.teaching-workspace-nav button[aria-current] > span'),'::before').transitionDuration==='0s'"));await click('.device-controls__trigger');await click('.device-controls__footer button');await pause(30);check('reduced motion skips content entrance',await read("document.querySelector('.lab-device-workspace').getAnimations().length===0"));w.webContents.debugger.detach();
   const dist=path.join(root,'dist-renderer'),css=fs.readdirSync(path.join(dist,'assets')).find(f=>/^index.*\.css$/.test(f));
   const fixture=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{RealPrincipleAnalysis}from'./renderer/src/components/RealPrincipleAnalysis';import{SimulatedAnalysisPanel}from'./renderer/src/components/SimulatedAnalysisPanel';import{computePowerSpectrumWithConfig}from'./renderer/src/teaching/simulatedAnalysis';import{applyPresentation}from'./renderer/src/theme/presentation';applyPresentation('crayon-paper-v1');function App(){const[a,set]=useState(null);const[simulation,setSimulation]=useState(false);window.teachingFixture={simulation(){setSimulation(true)},push(k,trial='one',reason,scale=1){const start=256+k*63;const channelSpectra=Object.fromEntries(['P3','P4','Oz','Pz'].map((lead,i)=>[lead,computePowerSpectrumWithConfig(Float32Array.from({length:625},(_,n)=>10*scale*Math.sin(2*Math.PI*[8,10,12,15][i]*(start+n)/250)),250,1024)]));channelSpectra.mean=channelSpectra.Oz;set({sessionId:'isolated',trialId:trial,windowStartSample:start,windowEndSample:start+625,sampleRateHz:250,psdBandpass:{lowHz:2,highHz:45},channelSpectra,spectrum:reason?null:channelSpectra.Oz,matches:[{frequencyHz:12,correlation:.9,score:8},{frequencyHz:15,correlation:.2,score:.5}],candidateIndex:reason?null:0,rejected:!!reason,reason})},clear(){set(null)}};return <main className='shell shell--teaching shell--teaching-run'><p>模拟显示验收 · 非真实EEG</p>{simulation?<SimulatedAnalysisPanel/>:<RealPrincipleAnalysis analysis={a} labels={['A♠','K♥']} targetFrequencies={[12,15]} connected acquiring running notice='' progress={null}/>}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
   require('esbuild').buildSync({stdin:{contents:fixture,resolveDir:root,sourcefile:'teaching.fixture.tsx',loader:'tsx'},bundle:true,outfile:path.join(out,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',define:{'import.meta.env.DEV':'false'}});
   fs.writeFileSync(path.join(out,'fixture.html'),`<!doctype html><meta charset='utf-8'><base href='${pathToFileURL(dist+path.sep)}'><link rel='stylesheet' href='assets/${css}'><style>.principle-demo-analysis{width:760px;margin:auto}</style><div id='root'></div><script src='${pathToFileURL(path.join(out,'fixture.js'))}'></script>`);
   w.setContentSize(1000,950);await w.loadFile(path.join(out,'fixture.html'));await settle();
   for(let i=0;i<8;i++){await read(`window.teachingFixture.push(${i})`);await pause(70)}
   check('window boundaries match Worker PSD history',await read("document.querySelector('.principle-spectrogram canvas').dataset.windowEnd==='1322'"));
   const heat=()=>read("(()=>{const c=document.querySelector('.principle-spectrogram canvas'),d=c.getContext('2d').getImageData(100,50,400,60).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])>80)n++;return n})()");
   check('live spectrogram paints spectral energy',await heat()>500);await plotLayout('aligned populated plots',true);await capture('demo-synthetic');await read("window.teachingFixture.push(8,'one',undefined,100000)");await settle();await plotLayout('large PSD ticks keep plots aligned',true);await read("window.teachingFixture.push(9,'one',undefined,.00001)");await settle();await plotLayout('small PSD ticks keep plots aligned',true);
   await read("(()=>{const s=document.querySelector('[aria-label=\"PSD 显示通道\"]');s.value='Pz';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await settle();check('time-frequency renders newly selected channel',await read("document.querySelector('.principle-spectrogram canvas').dataset.channel==='Pz'"));
   await read("window.teachingFixture.push(0,'second')");await settle();check('new trial uses new sample origin',await read("document.querySelector('.principle-spectrogram canvas').dataset.windowEnd==='881'"));
   await read("window.teachingFixture.push(1,'second','transport_gap_suspected')");await settle();check('transport-corrupted frame clears history',await read("document.querySelector('.principle-spectrogram canvas').dataset.windowEnd===''")&&await heat()<200);
   await read('window.teachingFixture.simulation()');await settle();await click('.analysis-inline-details > button');await settle();
   check('simulated details also flow horizontally',await read("getComputedStyle(document.querySelector('.analysis-inline-details .sim-analysis-footer')).display==='contents'&&document.querySelector('.analysis-inline-details__body').getBoundingClientRect().height<90"));
   success=errors.length===0;
  }catch(e){error=String(e);await capture('failure').catch(()=>{})}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({success,checks,errors,error,source:'isolated-app and synthetic display fixture; no physical EEG'},null,2));console.log(JSON.stringify({success,checks:checks.length,errors,error,out}));app.exit(success?0:1);
 }).catch(e=>{console.error(e);app.exit(1)});
}
