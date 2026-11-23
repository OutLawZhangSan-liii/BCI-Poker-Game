import test from 'node:test';
import assert from 'node:assert/strict';
import {computeResponsiveStimulusGeometry} from './geometry.ts';
const targets=[{x:.24,y:.64},{x:.76,y:.64}];
test('large diagnostics enlarge both matched targets and keep their complete surfaces visible',()=>{
 for(const [width,height] of [[1860,720],[1200,450],[920,320]]){
  const input={width,height,targets,showReference:false};
  const standard=computeResponsiveStimulusGeometry(input);
  const large=computeResponsiveStimulusGeometry({...input,targetSize:'diagnostic-large'});
  assert.ok(large.targets[0].ring.width>standard.targets[0].ring.width*1.2);
  for(const target of large.targets){
   for(const shape of [target.ring,target.label]){
    assert.ok(shape.x>=0&&shape.y>=0);
    assert.ok(shape.x+shape.width<=width+.01&&shape.y+shape.height<=height+.01);
   }
  }
  assert.ok(large.targets[0].ring.x+large.targets[0].ring.width<large.targets[1].ring.x);
 }
});
test('omitted or standard size presets preserve all existing game geometry',()=>{
 for(const points of [targets,[{x:.25,y:.3},{x:.75,y:.3},{x:.25,y:.74},{x:.75,y:.74}]]){
  const input={width:1700,height:760,targets:points,compactCards:points.length>2};
  assert.deepEqual(computeResponsiveStimulusGeometry(input),computeResponsiveStimulusGeometry({...input,targetSize:'standard'}));
 }
});
test('single diagnostic target remains centered and fits short viewports',()=>{
 for(const [width,height] of [[1860,720],[1200,371],[920,320]]){
  const g=computeResponsiveStimulusGeometry({width,height,targets:[{x:.5,y:.5}],showReference:false,targetSize:'diagnostic-large'});
  const t=g.targets[0];
  assert.equal(t.centerX,width/2);
  assert.ok(t.ring.height>height*.55);
  assert.ok(t.ring.y>=0&&t.label.y+t.label.height<=height);
 }
});

test('principle targets enlarge moderately with unchanged surround proportions and no collisions',()=>{
 const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
 for(const [width,height] of [[1180,620],[820,450],[1600,880],[510,340],[320,220]])for(const count of [2,3,4]){
  const points=Array.from({length:count},(_,i)=>({x:(i+.5)/count,y:.5}));
  const g=computeResponsiveStimulusGeometry({width,height,targets:points,showReference:false,targetSize:'teaching-fill'});
  const original=computeResponsiveStimulusGeometry({width,height,targets:points,showReference:false});
  assert.equal(g.reference,null);
  assert.ok(Math.abs(g.cardWidth/g.cardHeight-136/190)<1e-10);
  const maximumScale=count===2?1.04:count===3?1.17:1.3;
  assert.ok(g.cardWidth<=original.cardWidth*maximumScale+.001);
  assert.ok(Math.abs(g.ringX/g.cardWidth-original.ringX/original.cardWidth)<1e-10);
  assert.ok(Math.abs(g.ringY/g.cardHeight-original.ringY/original.cardHeight)<1e-10);
  for(const t of g.targets)for(const box of [t.card,t.ring,t.label]){
   assert.ok(box.x>=0&&box.y>=0&&box.width>0&&box.height>0);
   assert.ok(box.x+box.width<=width+.001&&box.y+box.height<=height+.001);
  }
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
   assert.equal(overlap(g.targets[i].ring,g.targets[j].ring),false);
   assert.equal(overlap(g.targets[i].label,g.targets[j].ring),false);
   assert.equal(overlap(g.targets[j].label,g.targets[i].ring),false);
   assert.equal(overlap(g.targets[i].label,g.targets[j].label),false);
  }
  assert.equal(new Set(g.targets.map(t=>t.centerY)).size,1);
  for(let i=1;i<count;i++)assert.ok(g.targets[i].centerX>g.targets[i-1].centerX);
  assert.ok(g.targets.reduce((sum,t)=>sum+t.ring.width*t.ring.height,0)<width*height*.65);
 }
 for(const count of [2,3,4]){
  const input={width:1180,height:620,targets:Array.from({length:count},(_,i)=>({x:(i+.5)/count,y:.5})),showReference:false};
  const standard=computeResponsiveStimulusGeometry(input);
  const enlarged=computeResponsiveStimulusGeometry({...input,targetSize:'teaching-fill'});
  const minimumScale=count===2?1.03:count===3?1.16:1.25;
  assert.ok(enlarged.cardWidth>standard.cardWidth*minimumScale);
 }
});

test('comfortable game cards scale faces and surrounds together without overlap', async () => {
 const {SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS}=await import('./types.ts');
 for(const [width,height] of [[1824,850],[1824,920],[912,400],[912,470]]) {
  for(const source of [SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS]) {
   const six=source.length===6;
   const input={width,height,targets:source.map(t=>({...t,x:t.x-(six?.045:0)})),compactCards:source.length>2,showReference:true,referenceX:six?.11:.5,referenceY:six?.38:source.length===2?.24:.52,deckTopRatio:.14};
   const old=computeResponsiveStimulusGeometry(input);
   const next=computeResponsiveStimulusGeometry({...input,targetSize:'game-comfortable-v1'});
   assert.ok(next.cardWidth>=old.cardWidth);
   if(width>1800) assert.ok(next.cardWidth>old.cardWidth*1.15, 'large screen '+source.length);
   assert.ok(Math.abs(next.ringX/next.cardWidth-old.ringX/old.cardWidth)<1e-10);
   assert.ok(Math.abs(next.ringY/next.cardHeight-old.ringY/old.cardHeight)<1e-10);
   const boxes=[...next.targets.map(t=>t.ring),next.reference.card];
   for(const [index,a] of boxes.entries()) {
    assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=width+.01&&a.y+a.height<=height+.01);
    for(const b of boxes.slice(index+1)) assert.ok(!(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height));
   }
  }
 }
});

test('whole-card game enlarges only faces inside validated seats', async () => {
 const {SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS}=await import('./types.ts');
 for(const [width,height] of [[1872,886],[912,462],[912,300]])for(const source of [SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS]){
  const six=source.length===6; const template={targets:source.map(t=>({...t,x:t.x-(six?.045:0)})),referenceX:six?.11:.5,referenceY:six?.38:source.length===2?.24:.52};
  const input={width,height,...template,compactCards:template.targets.length>2,showReference:true,deckTopRatio:.14};
  const old=computeResponsiveStimulusGeometry({...input,targetSize:'game-comfortable-v1'});
  const next=computeResponsiveStimulusGeometry({...input,targetSize:'game-card-face-v2'});
  assert.equal(next.sizeProfile,'game-card-face-v2');
  assert.ok(next.cardWidth>old.cardWidth*1.1);
  assert.ok(next.cardWidth<=old.cardWidth*1.12+.001);
  assert.deepEqual(next.reference,old.reference);
  for(const [i,t]of next.targets.entries()){
   assert.deepEqual(t.ring,old.targets[i].ring);
   assert.equal(t.centerX,old.targets[i].centerX);assert.equal(t.centerY,old.targets[i].centerY);
   assert.ok(t.card.x>=t.ring.x&&t.card.y>=t.ring.y);
   assert.ok(t.card.x+t.card.width<=t.ring.x+t.ring.width+.001&&t.card.y+t.card.height<=t.ring.y+t.ring.height+.001);
  }
 }
});
test('open game layout enlarges 1080p cards while separating all modes from reference and deck', async()=>{
 const {SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS}=await import('./types.ts');
 const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
 for(const [width,height]of[[1872,842],[1232,562],[912,408]])for(const source of[SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS]){
  const next=computeResponsiveStimulusGeometry({width,height,targets:source,targetSize:'game-open-v3'});
  const boxes=[...next.targets.map(t=>t.ring),next.reference.card];
  for(const [i,a]of boxes.entries()) {assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=width&&a.y+a.height<=height);for(const b of boxes.slice(i+1))assert.ok(!overlap(a,b));}
  assert.equal(next.targets.length,source.length);
  if(width===1872){const six=source.length===6;const old=computeResponsiveStimulusGeometry({width,height:886,targets:source.map(t=>({...t,x:t.x-(six?.045:0)})),compactCards:source.length>2,showReference:true,referenceX:six?.11:.5,referenceY:six?.38:source.length===2?.24:.52,targetSize:'game-card-face-v2'});assert.ok(next.cardWidth>old.cardWidth*1.05);
    const minGap=g=>Math.min(...g.targets.flatMap((a,i)=>g.targets.slice(i+1).map(b=>Math.hypot(Math.max(a.card.x-b.card.x-b.card.width,b.card.x-a.card.x-a.card.width,0),Math.max(a.card.y-b.card.y-b.card.height,b.card.y-a.card.y-a.card.height,0)))));
    assert.ok(minGap(next)>=minGap(old),'1080p candidate spacing '+source.length);}
 }
});

test('lowered v4 game enlarges all faces by five percent and clears all viewport edges', async()=>{
 const {SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS}=await import('./types.ts');
 const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
 for(const [width,height] of [[1872,842],[1232,562],[912,408],[1872,484]])for(const targets of [SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS]){
  const previous=computeResponsiveStimulusGeometry({width,height,targets,targetSize:'game-open-v3'});
  const next=computeResponsiveStimulusGeometry({width,height,targets,targetSize:'game-open-v4'});
  assert.equal(next.sizeProfile,'game-open-v4');assert.ok(Math.abs(next.cardWidth/previous.cardWidth-1.05)<1e-12);
  assert.ok(Math.abs(next.reference.card.width/previous.reference.card.width-1.05)<1e-12);
  for(const [i,t]of next.targets.entries()){assert.equal(t.centerX,previous.targets[i].centerX);assert.ok(t.centerY>previous.targets[i].centerY);}
  const boxes=[...next.targets.map(t=>t.ring),next.reference.card];
  for(const [i,a]of boxes.entries()){assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=width&&a.y+a.height<=height,JSON.stringify({width,height,a}));for(const b of boxes.slice(i+1))assert.ok(!overlap(a,b));}
 }
});

test('saved v3 coordinates retain the pre-adjustment 1080p contract', async()=>{
 const {SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS}=await import('./types.ts');
 const expected=[{width:260.1178947368421,height:363.40000000000003,centers:[[393.12,549.2],[1478.88,549.2]],ref:[826,32.12352941176471,220,307.3529411764706]},{width:237.49894736842106,height:331.8,centers:[[411.84,181.85],[1460.16,181.85],[411.84,632.15],[1460.16,632.15]],ref:[836,267.2941176470588,200,279.4117647058824]},{width:237.49894736842106,height:331.8,centers:[[561.6,181.85],[1057.6799999999998,181.85],[1553.76,181.85],[561.6,632.15],[1057.6799999999998,632.15],[1553.76,632.15]],ref:[78.47999999999999,281.2647058823529,180,251.47058823529412]}];
 for(const [index,targets]of [SIMPLE_TARGETS,DIFFICULT1_TARGETS,DIFFICULT2_DEMO_TARGETS].entries()){
  const g=computeResponsiveStimulusGeometry({width:1872,height:842,targets,targetSize:'game-open-v3'}),r=g.reference.card;
  assert.deepEqual({width:g.cardWidth,height:g.cardHeight,centers:g.targets.map(t=>[t.centerX,t.centerY]),ref:[r.x,r.y,r.width,r.height]},expected[index]);
 }
});
