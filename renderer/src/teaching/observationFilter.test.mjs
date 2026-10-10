import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {ObservationFilter, observationFilterInfo} from './observationFilter.ts';

const signal = (rate, seconds) => Float32Array.from({length:rate*seconds}, (_,i)=>
  100000 + 1000*Math.sin(2*Math.PI*.1*i/rate) + 100*Math.sin(2*Math.PI*i/rate)
  + 10*Math.sin(2*Math.PI*6*i/rate) + 25*Math.sin(2*Math.PI*12*i/rate)
  + 20*Math.sin(2*Math.PI*50*i/rate) + 20*Math.sin(2*Math.PI*90*i/rate));
function amplitude(samples, rate, hz) {
  let real=0, imaginary=0;
  for(let i=0;i<samples.length;i++) {real+=samples[i]*Math.cos(2*Math.PI*hz*i/rate);imaginary+=samples[i]*Math.sin(2*Math.PI*hz*i/rate);}
  return 2*Math.hypot(real,imaginary)/samples.length;
}
test('observation filter attenuates offset, drift, high frequencies and optional mains while preserving 12 Hz',()=>{
  const input=signal(1000,30), copy=input.slice(), output=new ObservationFilter(1000).process(input);
  const band=output.bandpassed.subarray(20000), notch=output.notched.subarray(20000);
  assert.deepEqual(input,copy,'never mutate transport/classifier samples');
  assert.ok(Math.abs(band.reduce((s,x)=>s+x,0)/band.length)<.05);
  assert.ok(amplitude(band,1000,.1)<.02);
  assert.ok(amplitude(band,1000,1)<7,'2 Hz highpass attenuates 1 Hz drift');
  assert.ok(Math.abs(amplitude(band,1000,6)-10)<.2,'lowest teaching target remains visible');
  assert.ok(Math.abs(amplitude(band,1000,12)-25)<.5);
  assert.ok(amplitude(band,1000,90)<2);
  assert.ok(amplitude(band,1000,50)>5,'notch is genuinely optional');
  assert.ok(amplitude(notch,1000,50)<.05);
  assert.ok(Math.abs(amplitude(notch,1000,12)-25)<.5);
});
test('large static offsets start at equilibrium at all supported device rates',()=>{
  for(const rate of [250,1000,10000]) {
    const result=new ObservationFilter(rate).process(new Float32Array(rate*3).fill(1000000));
    assert.ok(result.bandpassed.every(x=>Number.isFinite(x)&&Math.abs(x)<1e-5));
    assert.ok(result.notched.every(x=>Number.isFinite(x)&&Math.abs(x)<1e-5));
  }
});
test('packet boundaries do not restart filters; reset removes old channel history',()=>{
  const input=signal(1000,7), full=new ObservationFilter(1000).process(input);
  const stream=new ObservationFilter(1000), band=new Float32Array(input.length), notch=new Float32Array(input.length);
  for(let i=0;i<input.length;) {
    const end=Math.min(input.length,i+(i%137)+1), out=stream.process(input.subarray(i,end));
    band.set(out.bandpassed,i);notch.set(out.notched,i);i=end;
  }
  assert.deepEqual(band,full.bandpassed);assert.deepEqual(notch,full.notched);
  stream.reset();assert.deepEqual(stream.process(input),new ObservationFilter(1000).process(input));
});
test('observation filter adapts to Nyquist and disables unavailable 50 Hz notch',()=>{
  assert.equal(observationFilterInfo(1),null);assert.equal(observationFilterInfo(NaN),null);
  assert.equal(observationFilterInfo(4),null,'adapted high cutoff must exceed the new 2 Hz lower cutoff');
  assert.equal(observationFilterInfo(5).lowHz,2);
  const low=new ObservationFilter(80);assert.equal(low.info.highHz,36);assert.equal(low.info.notchAvailable,false);
  const out=low.process(new Float32Array(1000).fill(10));assert.deepEqual(out.notched,out.bandpassed);
  assert.equal(observationFilterInfo(100).notchAvailable,false);
  assert.equal(observationFilterInfo(250).notchAvailable,true);
});

// Load the real observation buffer and FFT without changing their module code.
const cache=new Map();
function load(filename) {
  if(cache.has(filename))return cache.get(filename);
  const exports={};cache.set(filename,exports);
  const context=vm.createContext({exports,console,require:name=>load(path.resolve(path.dirname(filename),name+'.ts'))});
  vm.runInContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return exports;
}
const {RealEegAnalysisBuffer,computeRealEegSpectrum,resolveRealEegChannelIndex}=load(fileURLToPath(new URL('./realEegAnalysis.ts',import.meta.url)));
test('observation defaults to the real Oz electrode and preserves explicit user selection',()=>{
  assert.equal(resolveRealEegChannelIndex(['O1','P3',' pz ',' oZ '],0,null,false),3);
  assert.equal(resolveRealEegChannelIndex(['Pz','Oz','P3'],0,'P3',true),2);
});
function makeBuffer(channelIndex=0) {
  const buffer=new RealEegAnalysisBuffer();
  buffer.configure({sessionId:'live',sampleRateHz:1000,channelCount:2,channelIndex,samplesPerPacket:100});
  return buffer;
}
function chunk(first,count,sequence,frequency=12) {
  return {sessionId:'live',sampleRateHz:1000,channelCount:2,sampleCountPerChannel:count,
    gatewaySequence:BigInt(sequence),firstSampleIndex:BigInt(first),transportGapSuspected:false,
    samples:Float32Array.from({length:count*2},(_,i)=>100000+25*Math.sin(2*Math.PI*(i%2===0?frequency:20)*(first+Math.floor(i/2))/1000))};
}
test('all display modes keep sample alignment, bounded storage and spectra of the selected channel',()=>{
  const buffer=makeBuffer();let raw=[];
  for(let i=0;i<120;i++){const c=chunk(i*100,100,i+1);const copy=c.samples.slice();assert.equal(buffer.acceptChunk(c,i*100).accepted,true);assert.deepEqual(c.samples,copy);raw.push(...c.samples.filter((_,i)=>i%2===0));}
  const original=buffer.snapshot(true,'raw'), filtered=buffer.snapshot(true,'filtered'), notch=buffer.snapshot(true,'filtered',true);
  assert.deepEqual(Array.from(original.samples),raw.slice(-2000));
  assert.equal(buffer.snapshot(false,'filtered').samples.length,10000);
  for(const s of [original,filtered,notch]) {
    assert.equal(s.samples.length,2000);assert.equal(s.windowStartSample,10000n);assert.equal(s.windowEndSampleExclusive,12000n);
    const psd=computeRealEegSpectrum(s);let best=1;for(let i=2;i<psd.powerDensity.length;i++)if(psd.powerDensity[i]>psd.powerDensity[best])best=i;
    assert.ok(Math.abs(psd.frequenciesHz[best]-12)<.5);
  }
  assert.ok(Math.abs(filtered.samples.reduce((a,b)=>a+b,0)/2000)<1);
});
test('gaps, invalid samples, pause and channel reconfiguration discard previous filter state',()=>{
  const buffer=makeBuffer();buffer.acceptChunk(chunk(0,2500,1),0);
  const next=chunk(4000,2100,3,20);buffer.acceptChunk(next,100);
  const fresh=makeBuffer();fresh.acceptChunk(next,100);
  assert.deepEqual(buffer.snapshot(true,'filtered').samples,fresh.snapshot(true,'filtered').samples);
  const bad=chunk(6100,100,4);bad.samples[0]=NaN;assert.equal(buffer.acceptChunk(bad,200).accepted,false);
  const restored=chunk(6200,2100,5);buffer.acceptChunk(restored,300);
  const clean=makeBuffer();clean.acceptChunk(restored,300);
  assert.deepEqual(buffer.snapshot(true,'filtered',true).samples,clean.snapshot(true,'filtered',true).samples);
  buffer.pause();assert.equal(buffer.acceptChunk(chunk(8300,100,6),400).accepted,false);buffer.resume();
  const after=chunk(8500,2100,7);buffer.acceptChunk(after,500);
  const resumed=makeBuffer();resumed.acceptChunk(after,500);
  assert.deepEqual(buffer.snapshot(true,'filtered').samples,resumed.snapshot(true,'filtered').samples);
  buffer.configure({sessionId:'live',sampleRateHz:1000,channelCount:2,channelIndex:1});
  buffer.acceptChunk(after,600);const other=makeBuffer(1);other.acceptChunk(after,600);
  assert.deepEqual(buffer.snapshot(true,'filtered').samples,other.snapshot(true,'filtered').samples);
});
