import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {trialSpectrogramFrame} from './trialSpectrogram.ts';
import {loadSignalModule} from '../../../tools/signal-module-harness.mjs';
const psd=(peak)=>({frequenciesHz:Float64Array.from({length:129},(_,i)=>i),powerDensity:Float64Array.from({length:129},(_,i)=>i===peak?20:.001),frequencyBinHz:1,mean:0,windowEnergy:1,invalidSamples:0});
const make=(extra={})=>({sessionId:'session',trialId:'first',sampleRateHz:256,windowStartSample:256,windowEndSample:896,spectrum:null,channelSpectra:{P3:psd(12),P4:psd(15),Oz:psd(10),Pz:psd(8),mean:psd(11)},matches:[],candidateIndex:null,rejected:true,...extra});
test('time-frequency display uses precisely the selected PSD object and Worker sample boundaries',()=>{
 const analysis=make();
 for(const channel of ['P3','P4','Oz','Pz','mean']){
  const f=trialSpectrogramFrame(analysis,channel);
  assert.equal(f.spectrum,analysis.channelSpectra[channel]);
  assert.equal(f.snapshot.windowStartSample,256n);assert.equal(f.snapshot.windowEndSampleExclusive,896n);
  assert.equal(f.snapshot.windowSamples,640);assert.equal(f.snapshot.sampleRateHz,256);
 }
});
test('history identity separates sessions, trials, channels, sample rates and preprocessing',()=>{
 const a=make(), key=trialSpectrogramFrame(a,'Oz').key;
 assert.equal(trialSpectrogramFrame({...a,windowStartSample:320,windowEndSample:960},'Oz').key,key);
 for(const b of [{...a,sessionId:'other'},{...a,trialId:'second'},{...a,sampleRateHz:250},{...a,psdBandpass:{lowHz:2,highHz:45}}])assert.notEqual(trialSpectrogramFrame(b,'Oz').key,key);
 assert.notEqual(trialSpectrogramFrame(a,'Pz').key,key);
});
test('absent, malformed and transport-corrupted windows never provide colored samples',()=>{
 for(const a of [null,make({reason:'invalid_samples'}),make({reason:'transport_gap_suspected'}),make({sampleRateHz:0}),make({windowEndSample:256}),make({windowStartSample:-1})]){
  const f=trialSpectrogramFrame(a,'Oz');assert.equal(f.spectrum,null);assert.equal(f.snapshot.windowEndSampleExclusive,null);
 }
});
test('bounded live history ignores duplicate windows and clears on channel/trial change or invalid data',()=>{
 const module=loadSignalModule(fileURLToPath(new URL('../components/RealSpectrogram.ts',import.meta.url)));
 const writes=[];
 const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(...args)=>writes.push(args),clearRect(){}};
 module.context.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
 const history=new module.exports.RealSpectrogram();
 const update=(analysis,channel='Oz')=>{const f=trialSpectrogramFrame(analysis,channel);history.update(f.snapshot,f.spectrum,f.key)};
 const a=make();update(a);assert.equal(history.count,1);const revision=history.revision;update(a);assert.equal(history.revision,revision);
 update({...a,windowStartSample:320,windowEndSample:960});assert.ok(history.count>1);
 update({...a,windowStartSample:320,windowEndSample:960},'Pz');assert.equal(history.count,1);
 update({...a,trialId:'next'});assert.equal(history.count,1);
 update(make({reason:'transport_gap_suspected'}));assert.equal(history.count,0);
 for(let i=0;i<400;i++)update({...a,windowStartSample:256+i*64,windowEndSample:896+i*64});
 assert.equal(history.count,300);assert.ok(writes.length>300);
});
