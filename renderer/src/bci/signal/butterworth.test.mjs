import test from 'node:test';import assert from 'node:assert/strict';import {ContinuousButterworthBank}from'./butterworth.ts';
import {loadSignalModule,eegPacket,session}from'../../../../tools/signal-module-harness.mjs';import{fileURLToPath}from'node:url';
test('Butterworth streaming is packet-invariant, causal, resettable and rejects invalid data',()=>{for(const rate of[250,500,1000]){const x=Array.from({length:4},(_,c)=>Float32Array.from({length:1500},(_,n)=>4000+c*300+20*Math.sin(2*Math.PI*12*n/rate+c*.4)));const bank=new ContinuousButterworthBank(rate,4),whole=bank.process(x);bank.reset();const split=Array.from({length:2},()=>Array.from({length:4},()=>[]));let start=0;for(const count of[1,73,291,1135]){bank.process(x.map(c=>c.subarray(start,start+count))).forEach((b,i)=>b.forEach((c,j)=>split[i][j].push(...c)));start+=count;}assert.deepEqual(split,whole.map(b=>b.map(c=>Array.from(c))));bank.reset();assert.deepEqual(bank.process(x.map(c=>c.subarray(0,100))),whole.map(b=>b.map(c=>c.subarray(0,100))));assert.throws(()=>bank.process([Float32Array.of(NaN)]));}assert.throws(()=>new ContinuousButterworthBank(80,4));});
test('trial profile has raw scoring, fixed policy and distinct challenge fingerprint',()=>{const {exports:p}=loadSignalModule(fileURLToPath(new URL('./gameClassifier.ts',import.meta.url)));assert.equal(p.gameClassifierPolicy('butterworth-trial-v1',6).confidenceThreshold,.25);assert.equal(p.gameClassifierPolicy('fir-baseline-v1',6).confidenceThreshold,.52);assert.notEqual(p.gameClassifierConfiguration('butterworth-trial-v1',250,false,6000,500,2.5),p.gameClassifierConfiguration('fir-baseline-v1',250,false,6000,500,2.5));assert.equal(p.savedGameClassifier('{"name":"fbcca-cca","version":"0.3.0"}'),'fir-baseline-v1');assert.throws(()=>p.parseGameClassifier('unknown'));});
test('production worker switches profile and retains marker/gap/flat-channel protections',()=>{const w=loadSignalModule(fileURLToPath(new URL('./signal.worker.ts',import.meta.url)));const config={sampleRateHz:250,channelCount:4,leadNames:['P3','P4','Oz','Pz'],targetFrequenciesHz:[12,15],windowSeconds:2.5,hopSeconds:.25,harmonics:3,confidenceThreshold:.25,marginThreshold:.08,requiredVotes:2,maxTrialSeconds:6};const x=Float32Array.from({length:1500*4},(_,i)=>30*Math.sin(2*Math.PI*12*Math.floor(i/4)/250+(i%4)*.4));for(const profile of['butterworth-trial-v1','fir-baseline-v1']){w.messages.length=0;w.send({type:'configure',config:{...config,classifierProfile:profile}});w.send({type:'start_trial',sessionId:session,trialId:'trial'});w.send({type:'set_trial_marker',sessionId:session,trialId:'trial',firstSampleIndex:'0'});for(let n=0;n<1500;n+=100)w.send({type:'eeg',buffer:eegPacket(x,n,100,n/100+1)});const decisions=w.messages.filter(m=>m.type==='decision').map(m=>m.decision);assert.ok(decisions.length>2);assert.ok(decisions.every(d=>d.classifierName===(profile==='butterworth-trial-v1'?'fbcca-butterworth':'fbcca-cca')));assert.ok(decisions.some(d=>!d.rejected&&d.candidateIndex===0));assert.ok(decisions.every(d=>d.windowEndSample<=1500));assert.equal(w.messages.filter(m=>m.type==='error').length,0);}
 w.messages.length=0;w.send({type:'configure',config:{...config,classifierProfile:'butterworth-trial-v1'}});w.send({type:'start_trial',sessionId:session,trialId:'flat'});w.send({type:'set_trial_marker',sessionId:session,trialId:'flat',firstSampleIndex:'0'});w.send({type:'eeg',buffer:eegPacket(new Float32Array(6000).fill(100),0,1500,1)});assert.ok(w.messages.filter(m=>m.type==='decision').every(m=>m.decision.rejected));
});

test('Jacobi trial solver converges when dominant eigenvalues are close',async()=>{
 const {jacobiLargestEigenvalue}=await import('./fbcca.ts');
 const a=.9001,b=.9,c=.000001;
 const expected=(a+b+Math.sqrt((a-b)**2+4*c*c))/2;
 assert.ok(Math.abs(jacobiLargestEigenvalue([[a,c],[c,b]])-expected)<1e-12);
});
test('Butterworth ignores stale markers and resets settling after discontinuity or invalid samples',()=>{
 const config={sampleRateHz:250,channelCount:4,leadNames:['P3','P4','Oz','Pz'],targetFrequenciesHz:[12,15],windowSeconds:2.5,hopSeconds:.25,harmonics:3,confidenceThreshold:.25,marginThreshold:.08,requiredVotes:2,classifierProfile:'butterworth-trial-v1'};
 const x=Float32Array.from({length:3000*4},(_,i)=>30*Math.sin(2*Math.PI*12*Math.floor(i/4)/250+(i%4)*.4));
 for(const issue of ['sequence','invalid']){
  const w=loadSignalModule(fileURLToPath(new URL('./signal.worker.ts',import.meta.url)));
  const decisions=()=>w.messages.filter(m=>m.type==='decision').map(m=>m.decision);
  w.send({type:'configure',config});w.send({type:'start_trial',sessionId:session,trialId:'old'});w.send({type:'stop_trial'});
  w.send({type:'set_trial_marker',sessionId:session,trialId:'old',firstSampleIndex:'0'});
  w.send({type:'start_trial',sessionId:session,trialId:'new'});
  w.send({type:'eeg',buffer:eegPacket(x,0,1000,1)});
  w.send({type:'set_trial_marker',sessionId:session,trialId:'old',firstSampleIndex:'0'});
  assert.equal(decisions().length,0,'stale marker must not release buffered data');
  w.send({type:'set_trial_marker',sessionId:session,trialId:'new',firstSampleIndex:'0'});
  assert.ok(decisions().some(d=>!d.rejected&&d.candidateIndex===0));
  w.messages.length=0;
  const bad=eegPacket(x,1000,300,issue==='sequence'?3:2);
  if(issue==='invalid')new Float32Array(bad,60)[0]=NaN;
  w.send({type:'eeg',buffer:bad});
  assert.ok(decisions().every(d=>d.rejected),'no accepted decision during reset');
  w.send({type:'eeg',buffer:eegPacket(x,1300,1000,issue==='sequence'?4:3)});
  const valid=decisions().filter(d=>!d.rejected);
  assert.ok(valid.length>0,'classification recovers with clean data');
  assert.ok(valid.every(d=>d.windowStartSample>=(issue==='sequence'?1256:1556)&&d.candidateIndex===0));
  w.send({type:'stop_trial'});const count=w.messages.length;
  w.send({type:'eeg',buffer:eegPacket(x,2300,100,5)});assert.equal(w.messages.length,count);
  assert.equal(w.messages.filter(m=>m.type==='error').length,0);
 }
});