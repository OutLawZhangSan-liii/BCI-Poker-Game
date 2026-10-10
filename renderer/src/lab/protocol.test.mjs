import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {computeResponsiveStimulusGeometry} from '../bci/stimulus/geometry.ts';
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>load(path.resolve(path.dirname(file),name+'.ts'))});return exports;}
const {createLabRun,recoverLabRun,pendingItems,labTargets,labTemplate}=load(fileURLToPath(new URL('./protocol.ts',import.meta.url)));
test('216 balanced active trials, 9 unique references, stable seeded order and untouched main frequencies',()=>{
 const a=createLabRun('test',42,'fixed'),b=createLabRun('test',42,'fixed');assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.equal(a.items.length,225);assert.equal(new Set(a.items.map(i=>i.id)).size,225);
 const active=a.items.filter(i=>i.kind==='active');assert.equal(active.length,216);
 for(const count of [2,4,6])for(const form of ['solid','card','card-face'])for(let cue=0;cue<count;cue++)assert.equal(active.filter(i=>i.count===count&&i.appearance===form&&i.cue===cue).length,6);
 assert.equal(active.filter(i=>i.split==='development').length,144);assert.equal(active.filter(i=>i.split==='test').length,72);
 for(const [count,frequencies] of [[2,[12,15]],[4,[7.5,8.57,10,12]],[6,[7.5,8.57,10,12,13.33,14]]])assert.deepEqual(Array.from(labTargets(count),t=>t.frequencyHz),frequencies);
 const orders=Array.from({length:6},(_,g)=>[0,1,2].map(p=>active.find(i=>i.group===g+1&&i.batch===g*3+p).count).join(','));assert.equal(new Set(orders).size,6);
});
test('recovery preserves failed attempts and only completed non-excluded items suppress retries',()=>{
 const run=createLabRun('test',1);run.attempts=[{trialId:'one',itemId:run.items[0].id,status:'started',attention:'pending'},{trialId:'two',itemId:run.items[1].id,status:'complete',attention:'confirmed'},{trialId:'three',itemId:run.items[2].id,status:'complete',attention:'excluded'}];
 const recovered=recoverLabRun(run);assert.equal(run.attempts[0].status,'started');assert.equal(recovered.attempts[0].status,'invalid');
 const pending=pendingItems(recovered);assert.ok(pending.some(i=>i.id===run.items[0].id));assert.ok(!pending.some(i=>i.id===run.items[1].id));assert.ok(pending.some(i=>i.id===run.items[2].id));assert.equal(recovered.attempts.length,3);
});
test('all lab footprints and labels fit without overlap on supported window sizes',()=>{
 for(const [width,height] of [[1876,720],[1236,720],[916,720]])for(const count of [2,4,6]){
  const template=labTemplate(count);
  const g=computeResponsiveStimulusGeometry({width,height,targets:template.targets,referenceX:template.referenceX,referenceY:template.referenceY,showReference:false,compactCards:count>2});
  const boxes=g.targets.map(t=>({...t.ring,height:t.label.y+t.label.height-t.ring.y}));
  for(const r of boxes){assert.ok(r.x>=0&&r.y>=0);assert.ok(r.x+r.width<=width+.01);assert.ok(r.y+r.height<=height+.01);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(!(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height));}
 }
});
test('phase, brightness, rendering and production classifier remain byte-identical to pinned main',()=>{
 // Versioned hashes protect this branch from silently changing the shared stimulus engine.
 const hashes={
  'renderer/src/bci/stimulus/phase.ts':'223adb6524daa9548107db0bd4db5b57e526540220d6c21c7af96d7b145bbd63',
  'renderer/src/bci/stimulus/modulation.ts':'4726cb5e95150e2d7a1adc1efb9409fb49a428d10de1c7088a1134f225194974',
  'renderer/src/components/StimulusTable.tsx':'09bf710105b8cec65eebd738729913b8a07682cd093884bf336ac2fcaeeb11ae',
  'renderer/src/bci/stimulus/geometry.ts':'863fd65d2af43cc7d974a123bfe8d9bd7408b80864c1b1b7b523b45be65cd9b0',
  'renderer/src/bci/signal/fbcca.ts':'5ff852c71eb2f33a31d1f8770916bba772445f21accdd7d7bf4fb98f046697af',
  'renderer/src/bci/signal/signal.worker.ts':'89ed06bc14f6c2332e10c01cd673b52d461d0f841feaafed93e5268583983487'
 };
 for(const [file,hash] of Object.entries(hashes)){
  assert.equal(createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex'),hash,file);
 }
});
