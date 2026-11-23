// Rasterize the user's HTML sample once. SVG noise/filters never run in trials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const uniformPaper = process.argv.includes('--uniform-paper');
const borderless = uniformPaper || process.argv.includes('--borderless');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { cwd:root, env, stdio:'inherit', windowsHide:true });
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    const sourceDir = path.join(root,'artwork/web-pips-v2');
    const source = fs.readFileSync(path.join(sourceDir,'source.html'),'utf8');
    const font = fs.readFileSync(path.join(sourceDir,'MaShanZheng-Regular.ttf'));
    const fontStyle = `@font-face{font-family:'Ma Shan Zheng';src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype');font-weight:400;font-style:normal;}`;
    const window = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel:!details.url.startsWith('data:')}));
    const offline = source.replace(/<link\b[^>]*>/gi,'');
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(offline));
    await window.webContents.executeJavaScript(`(() => { const style=document.createElement('style');style.textContent=${JSON.stringify(fontStyle)};document.head.append(style); })()`);
    await window.webContents.executeJavaScript('document.fonts.ready');
    await window.webContents.executeJavaScript(`window.borderless=${borderless};window.uniformPaper=${uniformPaper};window.exportFontStyle=${JSON.stringify(fontStyle)}; (${prepare.toString()})();`);
    const output = path.join(root,'renderer/public/cards',uniformPaper?'uniform-v4':borderless?'borderless-v3':'web-pips-v2'); fs.mkdirSync(output,{recursive:true});
    const entries=[];
    for(const [suit,key,index] of [['♦','d',1],['♣','c',2],['♥','h',3],['♠','s',4]]) {
      for(const rank of ['A','2','3','4','5','6','7','8','9','10']) {
        const result=await window.webContents.executeJavaScript(`window.exportPip(${JSON.stringify(rank)},${JSON.stringify(key)})`);
        const file=`${rank}-${index}.png`,png=Buffer.from(result.png,'base64');
        fs.writeFileSync(path.join(output,file),png);
        entries.push({rank,suit,file,width:1020,height:1425,pipCount:result.pipCount,sha256:hash(png)});
      }
      console.log(`Exported A-10: ${key}`);
    }
    const repeated=await window.webContents.executeJavaScript("window.exportPip('A','d')");
    if(hash(Buffer.from(repeated.png,'base64'))!==entries[0].sha256)throw new Error('SVG sample export was not deterministic');
    const manifest={version:uniformPaper?'crayon-deck-v4':borderless?'crayon-deck-v3':'crayon-deck-v2',baseVersion:'crayon-deck-v1',innerFrame:!borderless,width:1020,height:1425,
      sourceSha256:hash(Buffer.from(source)),fontSha256:hash(font),
      settings:{rough:3,mis:2,gap:.3,lw:1.5,draft:true,boil:false},entries};
    fs.writeFileSync(path.join(output,borderless?'manifest-pips.json':'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    const report=path.join(root,'reports',uniformPaper?'uniform-v4':borderless?'borderless-v3':'web-pips-v2');fs.mkdirSync(report,{recursive:true});
    const sheet=await window.webContents.executeJavaScript('window.exportPipSheet()');
    fs.writeFileSync(path.join(report,'contact-sheet.png'),Buffer.from(sheet,'base64'));
    console.log(JSON.stringify({cards:entries.length,output,deterministic:true}));
    window.destroy();app.quit();
  }).catch(error=>{console.error(String(error).slice(0,700));app.exit(1);});
}

function prepare(){
  const previews=[];
  const filters=document.querySelector('body > svg > defs').innerHTML;
  window.exportPip=async(rank,suit)=>{
    // Use the actual sample's paths, positions, filters and default controls.
    pips(suit);
    if(document.getElementById('boil').checked)throw new Error('Animated export forbidden');
    const pipCount=LY[rank].length,expected=rank==='A'?1:Number(rank);
    if(pipCount!==expected)throw new Error(`Incorrect sample count ${rank}: ${pipCount}`);
    const index=['A','2','3','4','5','6','7','8','9','10'].indexOf(rank);
    const svg=document.querySelectorAll('#pips > svg')[index].cloneNode(true);
    if(window.borderless){
      // Remove only the sample's decorative inner frame. Archived HTML is untouched.
      const frames=[...svg.children].filter(e=>e.tagName==='rect'&&e.getAttribute('fill')==='none'&&e.getAttribute('stroke')==='#2b2f5a');
      if(frames.length!==1)throw new Error('Expected exactly one decorative card frame');
      frames[0].remove();
    }
    if(window.uniformPaper){
      // Replace only the template's paper layers; keep the actual pip artwork filters.
      const paper=[...svg.children].filter(e=>e.tagName==='rect' && (e.getAttribute('fill')==='#fffdf6'||e.getAttribute('filter')==='url(#paper)'));
      if(paper.length!==2)throw new Error('Expected two source paper layers');
      paper.forEach(e=>e.remove());
    }
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
    svg.setAttribute('width','1020');svg.setAttribute('height','1425');svg.setAttribute('preserveAspectRatio','none');
    const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=window.exportFontStyle;
    svg.prepend(style);svg.querySelector('defs').insertAdjacentHTML('beforeend',filters);
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await image.decode();
    const canvas=document.createElement('canvas');canvas.width=1020;canvas.height=1425;
    const ctx=canvas.getContext('2d');ctx.fillStyle=window.uniformPaper?'#fffefc':'#fffdf6';ctx.fillRect(0,0,1020,1425);
    if(window.uniformPaper){
      let seed=[...rank+suit].reduce((s,c)=>s*31+c.charCodeAt(0),17)>>>0;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      ctx.fillStyle='rgba(20,51,102,.018)';for(let i=0;i<1700;i++)ctx.fillRect(random()*1020,random()*1425,1+random(),1);
    }
    ctx.drawImage(image,0,0,1020,1425);
    const png=canvas.toDataURL('image/png');
    if(previews.length<40)previews.push({png,rank,suit});
    return{png:png.split(',')[1],pipCount};
  };
  window.exportPipSheet=async()=>{
    const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=1360;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fafbfe';ctx.fillRect(0,0,2200,1360);
    ctx.fillStyle='#17356b';ctx.font='24px sans-serif';ctx.fillText('A-10 · user HTML sample · fixed defaults · 1020 x 1425',20,34);
    for(let i=0;i<previews.length;i++){
      const item=previews[i],image=new Image();image.src=item.png;await image.decode();
      const x=20+(i%10)*218,y=54+Math.floor(i/10)*324;
      ctx.drawImage(image,x,y,200,279.4118);ctx.font='18px sans-serif';ctx.fillText(item.rank+' '+item.suit,x,y+303);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  };
}
