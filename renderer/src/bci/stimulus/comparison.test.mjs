import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvocationSequence, createAppearanceSequence, createThreeFormSequence, createShortFixationSequence, diagnosticDataFresh, SHORT_TRIAL_COUNT, SHORT_HALFWAY_COUNT, COMPARISON_TRIAL_COUNT, COMPARISON_HALFWAY_COUNT, THREE_FORM_TRIAL_COUNT, THREE_FORM_HALFWAY_COUNT, COMPARISON_ANALYSIS_WINDOWS} from './comparison.ts';

test('randomization preserves complete matched blocks and five trials per condition',()=>{
 for(const random of [()=>0,()=>.999999,()=>.5]){
  const trials=createEvocationSequence(random);
  assert.equal(trials.length,15);
  for(let block=0;block<5;block++){
   const group=trials.slice(block*3,block*3+3);
   assert.deepEqual(group.map(t=>t.frequencyHz).sort((a,b)=>a-b),[0,12,15]);
   assert.ok(group.every(t=>t.repetition===block+1));
  }
 }
 assert.notDeepEqual(createEvocationSequence(()=>0),createEvocationSequence(()=>.999999));
});
test('form comparison has eight complete randomized six-condition blocks and balanced halves',()=>{
 for(const random of [()=>0,()=>.999999,()=>.5]){
  const trials=createAppearanceSequence(random);
  assert.equal(trials.length,48);assert.equal(COMPARISON_TRIAL_COUNT,48);assert.equal(COMPARISON_HALFWAY_COUNT,24);
  for(let block=0;block<8;block++){
   const group=trials.slice(block*6,block*6+6);
   assert.deepEqual(group.map(t=>`${t.appearance}:${t.frequencyHz}`).sort(),['card:0','card:12','card:15','solid:0','solid:12','solid:15']);
   assert.ok(group.every(t=>t.repetition===block+1&&t.segment===(block<4?1:2)));
  }
 }
 assert.notDeepEqual(createAppearanceSequence(()=>0),createAppearanceSequence(()=>.999999));
 assert.deepEqual(COMPARISON_ANALYSIS_WINDOWS,{full:[1.5,9.5],early:[1.5,5.5],late:[5.5,9.5]});
});
test('missing or stalled EEG fails readiness while normal packet spacing remains valid',()=>{
 assert.equal(diagnosticDataFresh(null,16),false);
 assert.equal(diagnosticDataFresh(30,null),false);
 assert.equal(diagnosticDataFresh(NaN,16),false);
 assert.equal(diagnosticDataFresh(-10,16),false);
 assert.equal(diagnosticDataFresh(99,16),true);
 assert.equal(diagnosticDataFresh(340,16),false);
 assert.equal(diagnosticDataFresh(390,400),true);
});

test('whole-card experiment retains balanced blocks without mixing peripheral cards',()=>{
 const trials=createAppearanceSequence(()=>.5,'card-face');
 assert.equal(trials.length,48);
 assert.deepEqual([...new Set(trials.map(t=>t.appearance))].sort(),['card-face','solid']);
 for(let block=0;block<8;block++)assert.deepEqual(trials.slice(block*6,block*6+6).map(t=>`${t.appearance}:${t.frequencyHz}`).sort(),['card-face:0','card-face:12','card-face:15','solid:0','solid:12','solid:15']);
});

test('three forms have eight complete nine-condition blocks, with four blocks per segment',()=>{
 for(const random of [()=>0,()=>.5,()=>.999999]){
  const trials=createThreeFormSequence(random);
  assert.equal(trials.length,72);assert.equal(THREE_FORM_TRIAL_COUNT,72);assert.equal(THREE_FORM_HALFWAY_COUNT,36);
  for(let block=0;block<8;block++){
   const group=trials.slice(block*9,block*9+9);
   assert.deepEqual(group.map(t=>`${t.appearance}:${t.frequencyHz}`).sort(),['card-face:0','card-face:12','card-face:15','card:0','card:12','card:15','solid:0','solid:12','solid:15']);
   assert.ok(group.every(t=>t.repetition===block+1&&t.segment===(block<4?1:2)));
  }
 }
 assert.notDeepEqual(createThreeFormSequence(()=>0),createThreeFormSequence(()=>.999999));
});

test('short screening keeps six unique static references and two balanced active blocks',()=>{
 for(const random of [()=>0,()=>.5,()=>.999999]){
  const trials=createShortFixationSequence(random);
  assert.equal(trials.length,SHORT_TRIAL_COUNT);assert.equal(SHORT_TRIAL_COUNT,30);assert.equal(SHORT_HALFWAY_COUNT,18);
  const statics=trials.slice(0,6);
  assert.ok(statics.every(t=>t.condition==='static'&&t.frequencyHz===0&&t.repetition===0&&t.segment===1));
  assert.equal(new Set(statics.map(t=>`${t.appearance}/${t.fixationMode}`)).size,6);
  for(const rep of [1,2]){
   const block=trials.slice(6+(rep-1)*12,6+rep*12);
   assert.ok(block.every(t=>t.repetition===rep&&t.segment===rep&&t.condition!=='static'));
   assert.equal(new Set(block.map(t=>`${t.appearance}/${t.fixationMode}/${t.frequencyHz}`)).size,12);
   for(const appearance of ['card','card-face','solid'])for(const mode of ['fixed','synchronous'])
    assert.deepEqual(block.filter(t=>t.appearance===appearance&&t.fixationMode===mode).map(t=>t.frequencyHz).sort(),[12,15]);
  }
 }
 assert.notDeepEqual(createShortFixationSequence(()=>0),createShortFixationSequence(()=>.999999));
});

test('short freshness tolerates packet jitter but still rejects stalled acquisition',()=>{
 assert.equal(diagnosticDataFresh(605,400,'short'),true);
 assert.equal(diagnosticDataFresh(1200,400,'short'),true);
 assert.equal(diagnosticDataFresh(1201,400,'short'),false);
 assert.equal(diagnosticDataFresh(501,16,'short'),false);
 assert.equal(diagnosticDataFresh(null,400,'short'),false);
 assert.equal(diagnosticDataFresh(605,400),false);
});
