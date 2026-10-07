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
