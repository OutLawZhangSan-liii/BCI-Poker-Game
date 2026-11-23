// Rebuild v3 from the original SVG/canvas templates; never overwrite historical decks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const uniformPaper=process.argv.includes('--uniform-paper'), version=uniformPaper?'crayon-deck-v4':'crayon-deck-v3';
for(const tool of ['build-web-pips.cjs','build-crayon-deck.cjs']){
  const result=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,tool),uniformPaper?'--uniform-paper':'--borderless'],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status??1);
}
const directory=path.join(root,'renderer/public/cards',uniformPaper?'uniform-v4':'borderless-v3');
const sources=['manifest-pips.json','manifest-courts.json'].map(file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')));
const entries=sources.flatMap(s=>s.entries);
if(entries.length!==55||new Set(entries.map(e=>e.file)).size!==55)throw Error('Expected 54 unique faces and one back');
for(const e of entries){
 const png=fs.readFileSync(path.join(directory,e.file));
 if(crypto.createHash('sha256').update(png).digest('hex')!==e.sha256)throw Error('Asset hash mismatch: '+e.file);
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({version,baseVersion:uniformPaper?'crayon-deck-v3':'crayon-deck-v2',...(uniformPaper?{paperColor:'#FFFEFC',fixationShape:'cross'}:{}),innerFrame:false,width:1020,height:1425,sources:sources.map(({entries,...source})=>source),entries},null,2)+'\n');
console.log(JSON.stringify({version,faces:54,back:1,innerFrame:false}));
