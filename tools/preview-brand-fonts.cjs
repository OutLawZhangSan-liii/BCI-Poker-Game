// Local font specimen only; does not replace the application's brand assets.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,stdio:'inherit',windowsHide:true,timeout:60000});process.exit(r.status??1);
}else{
 const {app,BrowserWindow}=require('electron');
 app.setPath('userData',path.join(root,'.smoke-user-data/brand-fonts'));app.disableHardwareAcceleration();
 app.whenReady().then(async()=>{
  const directory=path.join(root,'reports/brand-font-options');fs.mkdirSync(directory,{recursive:true});
  const fonts=[
   {id:'ma',name:'马善政',file:path.join(root,'artwork/web-pips-v2/MaShanZheng-Regular.ttf'),tone:'手写有力 · 与彩铅／蜡笔牌面呼应',note:'推荐：国风，也更亲切。'},
   {id:'you',name:'幼圆 · 微加粗',file:'C:/Windows/Fonts/SIMYOU.TTF',tone:'圆润轻松 · 更有儿童绘本感',note:'更可爱的品牌观感。',stroke:'.7px'},
   {id:'kai',name:'楷体 · 微加粗',file:'C:/Windows/Fonts/simkai.ttf',tone:'端正清楚 · 国风与阅读性均衡',note:'稳重、清楚、好辨认。',stroke:'.5px'},
   {id:'xing',name:'华文行楷',file:'C:/Windows/Fonts/STXINGKA.TTF',tone:'笔势舒展 · 书写感和个性更强',note:'更强调书法气质。'}
  ];
  const faces=fonts.map(f=>'@font-face{font-family:'+f.id+';src:url("'+pathToFileURL(f.file).href+'")}').join('');
  const current='data:image/svg+xml;base64,'+fs.readFileSync(path.join(root,'renderer/public/assets/branding/shoujin-wordmark.svg')).toString('base64');
  const neuron='data:image/png;base64,'+fs.readFileSync(path.join(root,'renderer/public/assets/branding/neuron-icon.png')).toString('base64');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>神工神游 · 字体选择</title><style>${faces}
  *{box-sizing:border-box}body{margin:0;background:#FAFBFE;color:#17356B;font-family:'Microsoft YaHei',sans-serif;width:1920px;height:1080px;padding:56px 80px;overflow:hidden}
  header{display:flex;justify-content:space-between;align-items:center;height:112px;border-bottom:1px solid #d7e0ee;padding-bottom:28px}h1{font-size:32px;margin:0 0 12px;font-weight:500}.hint{font-size:18px;color:#64748b}.current{display:flex;align-items:center;gap:25px;font-size:16px;color:#64748b}.old{display:inline-block;width:214px;height:62px;background:#17356b;mask:url("${current}") center/contain no-repeat}
  main{display:grid;grid-template-columns:1fr 1fr;gap:48px 74px;margin-top:40px}.choice{height:360px;padding:8px 24px 20px;border-bottom:1px solid #d7e0ee}.label{display:flex;align-items:center;gap:16px;font-size:23px}.number{font:18px sans-serif;color:#64748b}.sample{font-size:112px;letter-spacing:8px;margin:25px 0 10px;height:132px;line-height:132px}.tone{font-size:20px;color:#64748b;margin-bottom:20px}.navbar{display:flex;align-items:center;gap:14px}.icon{width:30px;height:30px;background:#17356b;mask:url("${neuron}") center/contain no-repeat;mask-mode:luminance}.small{font-size:36px;letter-spacing:2px}.note{margin-left:20px;color:#64748b;font-size:16px}
  footer{margin-top:32px;font-size:17px;color:#64748b;display:flex;justify-content:space-between}
  </style><header><div><h1>神工神游 · 字标字体对照</h1><div class="hint">相同颜色与字号 · 先比较字形，选定后再调整粗细与字距</div></div><div class="current">当前字标<span class="old"></span></div></header><main>${fonts.map((f,i)=>`<section class="choice"><div class="label"><span class="number">0${i+1}</span>${f.name}</div><div class="sample" style="font-family:${f.id};-webkit-text-stroke:${f.stroke||'0'} #17356b">神工神游</div><div class="tone">${f.tone}</div><div class="navbar"><span class="icon"></span><span class="small" style="font-family:${f.id}">神工神游</span><span class="note">${f.note}</span></div></section>`).join('')}</main><footer><span>下方小字模拟导航栏中的实际观感；程序字标尚未替换。</span><span>1920 × 1080 · 本地字体实字渲染</span></footer></html>`;
  const file=path.join(directory,'font-options.html');fs.writeFileSync(file,html);
  const win=new BrowserWindow({show:false,useContentSize:true,width:1920,height:1080,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true}});win.setContentSize(1920,1080);await win.loadFile(file);
  const check=await win.webContents.executeJavaScript('Promise.all([...document.fonts].map(f=>f.load())).then(()=>[...document.fonts].map(f=>({family:f.family,status:f.status})))');
  if(check.length!==4||check.some(f=>f.status!=='loaded'))throw Error('Font failed to load');
  await new Promise(r=>setTimeout(r,250));
  const png=await win.webContents.capturePage();fs.writeFileSync(path.join(directory,'font-options-1080p.png'),png.resize({width:1920,height:1080,quality:'best'}).toPNG());
  fs.writeFileSync(path.join(directory,'fonts.json'),JSON.stringify({fonts:check,sourceFiles:fonts.map(f=>f.file),width:1920,height:1080},null,2));
  console.log(JSON.stringify({directory,fonts:check}));win.destroy();app.quit();
 }).catch(e=>{console.error(e);app.exit(1)});
}
