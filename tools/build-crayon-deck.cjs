// Deterministic card composition. AI supplies court artwork only; ranks/pips
// and all 54 card identities are generated and audited here, never by AI text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const uniformPaper = process.argv.includes('--uniform-paper');
const borderless = uniformPaper || process.argv.includes('--borderless');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { cwd:root, env, stdio:'inherit', windowsHide:true });
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    const output = path.join(root, 'renderer/public/cards', uniformPaper?'uniform-v4':borderless?'borderless-v3':'crayon-v1'); fs.mkdirSync(output, { recursive:true });
    const source = path.join(root, 'artwork/crayon-v1');
    const data = Object.fromEntries(['J','Q','K','back'].map(k => [k, 'data:image/png;base64,'+fs.readFileSync(path.join(source,k+'.png')).toString('base64')]));
    const window = new BrowserWindow({show:false, webPreferences:{sandbox:true,contextIsolation:true}});
    await window.loadURL('data:text/html,<meta charset="utf-8"><canvas></canvas>');
    await window.webContents.executeJavaScript(`window.borderless=${borderless};window.uniformPaper=${uniformPaper};window.sources=${JSON.stringify(data)}; (${prepare.toString()})();`);
    const cards=[];
    for(const suit of ['♦','♣','♥','♠']) for(const rank of (borderless?['J','Q','K']:['A','2','3','4','5','6','7','8','9','10','J','Q','K'])) cards.push({rank,suit});
    cards.push({rank:'Joker',suit:'black'},{rank:'Joker',suit:'red'},{rank:'back',suit:''});
    const entries=[];
    for(const card of cards){
      const result=await window.webContents.executeJavaScript(`window.makeCard(${JSON.stringify(card)})`);
      const filename=card.rank==='back'?'card-back.png':card.rank==='Joker'?`Joker-${card.suit==='black'?1:2}.png`:`${card.rank}-${['♦','♣','♥','♠'].indexOf(card.suit)+1}.png`;
      const png=Buffer.from(result.png,'base64'); fs.writeFileSync(path.join(output,filename),png);
      entries.push({...card,file:filename,width:1020,height:1425,pipCount:result.pipCount,sha256:crypto.createHash('sha256').update(png).digest('hex')});
    }
    const manifest={version:uniformPaper?'crayon-deck-v4':borderless?'crayon-deck-v3':'crayon-deck-v1',innerFrame:!borderless,width:1020,height:1425,sourceHashes:Object.fromEntries(['J','Q','K','back'].map(k=>[k,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,k+'.png'))).digest('hex')])),entries};
    fs.writeFileSync(path.join(output,borderless?'manifest-courts.json':'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    const report=path.join(root,'reports',uniformPaper?'uniform-v4':borderless?'borderless-v3':'crayon-paper-v1'); fs.mkdirSync(report,{recursive:true});
    const sheet=await window.webContents.executeJavaScript(`window.contactSheet(${JSON.stringify(entries)})`);
    fs.writeFileSync(path.join(report,'deck-contact-sheet.png'),Buffer.from(sheet,'base64'));
    console.log(JSON.stringify({cards:entries.length,output,contactSheet:path.join(report,'deck-contact-sheet.png')}));
    window.destroy(); app.quit();
  }).catch(error=>{console.error(error);app.exit(1);});
}

async function prepare(){
  const images={};
  for(const [key,url] of Object.entries(window.sources)){
    const image=new Image(); image.src=url; await image.decode();
    const scan=document.createElement('canvas');scan.width=image.width;scan.height=image.height;
    const ctx=scan.getContext('2d');ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,scan.width,scan.height).data;
    let x0=scan.width,y0=scan.height,x1=0,y1=0;
    // Bounding box ignores transparent padding without altering source pixels.
    for(let y=0;y<scan.height;y++)for(let x=0;x<scan.width;x++)if(pixels[(y*scan.width+x)*4+3]>220){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    images[key]={image,x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
  }
  const canvas=document.querySelector('canvas'); canvas.width=1020;canvas.height=1425;
  const ctx=canvas.getContext('2d'); const previews=[];
  let random=()=>.5;
  function seeded(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
  function sketchRect(x,y,w,h,r,color,width){
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
    for(let i=0;i<3;i++){
      const d=(i-1)*1.7;ctx.beginPath();ctx.moveTo(x+r,y+d);ctx.bezierCurveTo(x+w*.4,y-2+d,x+w*.7,y+2+d,x+w-r,y+d);
      ctx.quadraticCurveTo(x+w+d,y+d,x+w+d,y+r);ctx.bezierCurveTo(x+w-2+d,y+h*.4,x+w+2+d,y+h*.7,x+w+d,y+h-r);
      ctx.quadraticCurveTo(x+w+d,y+h+d,x+w-r,y+h+d);ctx.bezierCurveTo(x+w*.7,y+h+2+d,x+w*.3,y+h-2+d,x+r,y+h+d);
      ctx.quadraticCurveTo(x+d,y+h+d,x+d,y+h-r);ctx.bezierCurveTo(x+2+d,y+h*.7,x-2+d,y+h*.3,x+d,y+r);
      ctx.quadraticCurveTo(x+d,y+d,x+r,y+d);ctx.closePath();ctx.stroke();
    }ctx.restore();
  }
  function suitShape(suit,size){
    const s=size/100;ctx.scale(s,s);ctx.beginPath();
    if(suit==='♦'){ctx.moveTo(0,-51);ctx.lineTo(35,0);ctx.lineTo(0,51);ctx.lineTo(-35,0);ctx.closePath();}
    if(suit==='♥'){ctx.moveTo(0,47);ctx.bezierCurveTo(-12,31,-52,4,-45,-21);ctx.bezierCurveTo(-39,-48,-10,-48,0,-26);ctx.bezierCurveTo(10,-48,39,-48,45,-21);ctx.bezierCurveTo(52,4,12,31,0,47);ctx.closePath();}
    if(suit==='♠'){ctx.moveTo(0,-51);ctx.bezierCurveTo(-12,-32,-52,-6,-43,19);ctx.bezierCurveTo(-34,44,-9,36,0,18);ctx.bezierCurveTo(9,36,34,44,43,19);ctx.bezierCurveTo(52,-6,12,-32,0,-51);ctx.closePath();ctx.moveTo(-19,49);ctx.quadraticCurveTo(-2,32,-3,12);ctx.lineTo(3,12);ctx.quadraticCurveTo(2,32,19,49);ctx.closePath();}
    if(suit==='♣'){ctx.moveTo(-20,50);ctx.quadraticCurveTo(-1,32,-3,3);ctx.lineTo(3,3);ctx.quadraticCurveTo(1,32,20,50);ctx.closePath();for(const [x,y] of [[0,-27],[-25,8],[25,8]]){ctx.moveTo(x+25,y);ctx.arc(x,y,25,0,Math.PI*2);}}
  }
  function pip(suit,x,y,size,rotate=0){
    ctx.save();ctx.translate(x,y);ctx.rotate(rotate);suitShape(suit,size);
    const color=['♦','♥'].includes(suit)?'#e62546':'#16366e';ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.stroke();ctx.clip();
    ctx.lineCap='round';ctx.lineWidth=1.7;
    for(let i=0;i<135;i++){const x=-52+random()*104,y=-52+random()*104;ctx.strokeStyle=i%3===0?'rgba(255,255,255,.45)':'rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+2+random()*5,y-3-random()*5);ctx.stroke();}ctx.restore();
  }
  function rankText(rank,x,y,color,rotation=0){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineJoin='round';ctx.lineWidth=1.6;ctx.font=`700 ${rank==='10'?112:126}px 'Segoe Print','Comic Sans MS',cursive`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(rank,0,0);ctx.strokeText(rank,0,0);ctx.restore();}
  const layouts={1:[[510,712]],2:[[510,350],[510,1075]],3:[[510,340],[510,712],[510,1085]],4:[[330,350],[690,350],[330,1075],[690,1075]],5:[[330,350],[690,350],[510,712],[330,1075],[690,1075]],6:[[330,315],[690,315],[330,712],[690,712],[330,1110],[690,1110]],7:[[330,315],[690,315],[510,515],[330,712],[690,712],[330,1110],[690,1110]],8:[[330,315],[690,315],[510,510],[330,712],[690,712],[510,915],[330,1110],[690,1110]],9:[[330,300],[690,300],[330,570],[690,570],[510,712],[330,855],[690,855],[330,1125],[690,1125]],10:[[330,300],[690,300],[510,435],[330,570],[690,570],[330,855],[690,855],[510,990],[330,1125],[690,1125]]};
  function art(key,x,y,w,h){const a=images[key],scale=Math.min(w/a.w,h/a.h),dw=a.w*scale,dh=a.h*scale;ctx.drawImage(a.image,a.x,a.y,a.w,a.h,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
  window.makeCard=async({rank,suit})=>{
    ctx.resetTransform();ctx.clearRect(0,0,1020,1425);ctx.fillStyle='#fffefc';ctx.fillRect(0,0,1020,1425);
    random=seeded([...rank+suit].reduce((s,c)=>s*31+c.charCodeAt(0),17));
    // White paper grain is baked into the PNG, never evaluated during flicker.
    ctx.fillStyle='rgba(20,51,102,.018)';for(let i=0;i<1700;i++)ctx.fillRect(random()*1020,random()*1425,1+random(),1);
    let pipCount=null;
    if(rank==='back'){art('back',30,30,960,1365);}
    else {
      if(!window.borderless)sketchRect(30,30,960,1365,65,'#17356b',7);
      const color=['♦','♥','red'].includes(suit)?'#e62546':'#16366e';
      if(rank==='Joker'){
        rankText('JOKER',510,170,color);ctx.save();ctx.translate(510,720);ctx.fillStyle=suit==='red'?'#ef6c85':'#83b8ce';ctx.beginPath();ctx.arc(0,0,240,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#17356b';ctx.lineWidth=12;ctx.stroke();
        ctx.fillStyle='#17356b';for(const x of [-75,75]){ctx.beginPath();ctx.arc(x,-35,18,0,7);ctx.fill();}ctx.beginPath();ctx.arc(0,25,90,.15,Math.PI-.15);ctx.stroke();ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,20,27,0,7);ctx.fill();ctx.restore();
        for(const [x,y] of [[260,420],[760,420],[260,1040],[760,1040]])pip(suit==='red'?'♥':'♠',x,y,72);rankText('JOKER',510,1255,color,Math.PI);
      } else {
        const count=rank==='A'?1:Number(rank);
        if(Number.isFinite(count)){pipCount=layouts[count].length;if(pipCount!==count)throw new Error("Invalid pip layout");for(const [x,y]of layouts[count])pip(suit,x,y,count===1?330:count>=9?145:165,y>712?Math.PI:0);}
        else art(rank,155,80,710,1265);
        rankText(rank,116,145,color);pip(suit,116,258,76);
        rankText(rank,904,1280,color,Math.PI);pip(suit,904,1167,76,Math.PI);
      }
    }
    const png=canvas.toDataURL('image/png').split(',')[1];previews.push(canvas.toDataURL('image/png'));return{png,pipCount};
  };
  window.contactSheet=async(entries)=>{
    const sheet=document.createElement('canvas');sheet.width=2400;sheet.height=1480;const s=sheet.getContext('2d');s.fillStyle='#fafbfe';s.fillRect(0,0,sheet.width,sheet.height);
    s.font='22px sans-serif';s.fillStyle='#17356b';s.fillText('Crayon deck v1 · 54 cards + back · 1020 × 1425',24,32);
    for(let i=0;i<previews.length;i++){const image=new Image();image.src=previews[i];await image.decode();const col=i%13,row=Math.floor(i/13);s.drawImage(image,24+col*182,55+row*281,170,237.5);s.font='16px sans-serif';s.fillText(entries[i].rank+' '+entries[i].suit,24+col*182,55+row*281+258);}
    return sheet.toDataURL('image/png').split(',')[1];
  };
}
