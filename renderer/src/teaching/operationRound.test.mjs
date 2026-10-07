import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationRound, OPERATION_TRIALS, TRAINING_TIMING} from './operationRound.ts';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function clock(t){let now=0;t.mock.timers.enable({apis:['setTimeout']});t.mock.method(performance,'now',()=>now);return async ms=>{now+=ms;t.mock.timers.tick(ms);await flush()}}
test('one start automatically runs all four conditions with independent cues and exact outcomes',async t=>{
 const tick=clock(t),trials=[],outcomes=['correct','incorrect','rejected','correct'];
 const round=new OperationRound({runTrial:async(spec,index)=>{trials.push(spec);return outcomes[index]},interruptTrial(){},change(){},error(e){throw e}});
 const done=round.start();await flush();
 for(let i=0;i<4;i++){await tick(TRAINING_TIMING.feedbackMs);if(i<3)await tick(TRAINING_TIMING.interTrialMs)}
 await done;assert.deepEqual(trials,OPERATION_TRIALS);assert.equal(round.state.phase,'ROUND_COMPLETE');
 assert.equal(round.state.completed,4);assert.equal(round.state.correct,2);assert.equal(round.state.incorrect,1);assert.equal(round.state.rejected,1);
 await tick(10000);assert.equal(trials.length,4,'does not repeat');
});
test('pause stimulation retries the same trial with a fresh window without recording a result',async t=>{
 const tick=clock(t);let resolveTrial;const starts=[];
 const round=new OperationRound({runTrial:(spec,index)=>{starts.push(index);round.setPhase('STIMULATING');return new Promise(r=>resolveTrial=r)},interruptTrial:()=>resolveTrial?.(round.state.paused?'paused':'interrupted'),change(){},error(e){throw e}});
 const done=round.start();await flush();round.pause();await flush();await tick(10000);
 assert.deepEqual(starts,[0]);assert.equal(round.state.completed,0);assert.equal(round.state.index,0);
 round.resume();await flush();assert.deepEqual(starts,[0,0]);assert.equal(round.state.completed,0);
 round.stop();await done;await tick(10000);assert.equal(starts.length,2);
});
test('feedback pause preserves remaining delay and stop cancels all automatic work',async t=>{
 const tick=clock(t),starts=[];
 const round=new OperationRound({runTrial:async(spec,index)=>{starts.push(index);return 'correct'},interruptTrial(){},change(){},error(e){throw e}});
 const done=round.start();await flush();await tick(400);round.pause();await tick(9000);
 assert.equal(round.state.phase,'FEEDBACK');assert.equal(round.state.index,0);
 round.resume();await tick(799);assert.equal(round.state.phase,'FEEDBACK');await tick(1);assert.equal(round.state.phase,'INTER_TRIAL');
 round.stop();await done;await tick(10000);assert.deepEqual(starts,[0]);assert.equal(round.state.active,false);
});
test('data interruption terminates a round without advancing or counting a fake rejection',async()=>{
 const round=new OperationRound({runTrial:async()=> 'interrupted',interruptTrial(){},change(){},error(e){throw e}});
 await round.start();assert.equal(round.state.active,false);assert.equal(round.state.completed,0);assert.equal(round.state.rejected,0);
});

test('round retains four independent actual results and reset clears them', async t => {
 const tick=clock(t); const matches=[{frequencyHz:15,correlation:.42,score:2.1}];
 const round=new OperationRound({runTrial:async(spec,index)=>{
   round.setPhase('STIMULATING');
   round.recordResult({index,stimulusMode:spec.stimulusMode,targetLabel:spec.target?'K':'A',targetFrequencyHz:spec.target?15:12,predictedLabel:'K',predictedFrequencyHz:15,outcome:spec.target?'correct':'incorrect',matches});
   return spec.target?'correct':'incorrect';
 },interruptTrial(){},change(){},error(e){throw e}});
 const done=round.start();await flush();matches[0].score=99;
 for(let i=0;i<4;i++){await tick(TRAINING_TIMING.feedbackMs);if(i<3)await tick(TRAINING_TIMING.interTrialMs)}
 await done;assert.equal(round.state.results.length,4);assert.equal(round.state.results[0].matches[0].score,2.1);
 assert.equal(round.state.results[0].targetFrequencyHz,12);assert.equal(round.state.results[0].predictedFrequencyHz,15);
 round.reset();assert.deepEqual(round.state.results,[]);
});
