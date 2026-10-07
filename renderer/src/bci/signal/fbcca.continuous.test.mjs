import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousFbccaFilterBank, scoreFilterBank, scoreFilteredBanks, rankScores, FBCCA_FILTER_WARMUP_SAMPLES } from './fbcca.ts';

test('packet splits preserve full FIR stream and reset removes previous trial history',()=>{
  const fs=250, count=1250;
  const channels=Array.from({length:4},(_,c)=>Float32Array.from({length:count},(_,n)=>5000+c*1000+20*Math.sin(2*Math.PI*12*n/fs+c*.4)));
  const whole=new ContinuousFbccaFilterBank(fs,4).process(channels);
  const stream=new ContinuousFbccaFilterBank(fs,4), split=Array.from({length:2},()=>Array.from({length:4},()=>[]));
  let begin=0;
  for(const size of [73,100,351,726]) {
    stream.process(channels.map(c=>c.subarray(begin,begin+size))).forEach((bank,b)=>bank.forEach((c,i)=>split[b][i].push(...c)));
    begin+=size;
  }
  for(let b=0;b<2;b++)for(let c=0;c<4;c++)assert.deepEqual(split[b][c],Array.from(whole[b][c]));
  stream.reset();assert.deepEqual(stream.process(channels),whole);
});

test('continuous CCA keeps 625 valid samples and matches FIR evaluation on identical real sample support',()=>{
  const fs=250, warmup=FBCCA_FILTER_WARMUP_SAMPLES, n=warmup+625;
  const channels=Array.from({length:4},(_,c)=>Float32Array.from({length:n},(_,sample)=>2000+2*Math.sin(2*Math.PI*15*sample/fs+c*.3)+.3*Math.sin(2*Math.PI*30*sample/fs)));
  const filtered=new ContinuousFbccaFilterBank(fs,4).process(channels).map(bank=>bank.map(c=>c.subarray(warmup)));
  assert.ok(filtered.every(bank=>bank.every(c=>c.length===625)));
  const streamed=scoreFilteredBanks(filtered,fs,[12,15],3), equivalent=scoreFilterBank(channels,fs,[12,15],3);
  assert.equal(rankScores(streamed).candidateIndex,1);
  for(let i=0;i<streamed.length;i++)assert.ok(Math.abs(streamed[i].score-equivalent[i].score)<1e-5);
});

test('invalid stream inputs fail visibly instead of contaminating future filter history',()=>{
  const stream=new ContinuousFbccaFilterBank(250,4);
  assert.throws(()=>stream.process([new Float32Array(3)]),/invalid/);
  const bad=Array.from({length:4},()=>new Float32Array(4));bad[2][1]=NaN;
  assert.throws(()=>stream.process(bad),/invalid/);
  assert.equal(stream.process(Array.from({length:4},()=>new Float32Array(20))).length,2);
});
