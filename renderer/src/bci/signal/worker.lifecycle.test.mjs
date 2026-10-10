import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ObservationFilter } from '../../teaching/observationFilter.ts';
import { ReusableSpectrum } from '../../teaching/reusableSpectrum.ts';

// Execute the production Worker handler and its real signal modules.
function loadWorker() {
  const messages = [];
  const self = { postMessage: message => messages.push(structuredClone(message)) };
  const cache = new Map();
  const nativeRequire = createRequire(import.meta.url);
  const load = filename => {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    const context = vm.createContext({ self, exports, console,
      require: name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')).exports : nativeRequire(name) });
    const entry = { exports, context };
    cache.set(filename, entry);
    vm.runInContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context, { filename });
    return entry;
  };
  const worker = load(fileURLToPath(new URL('./signal.worker.ts', import.meta.url)));
  return { send: data => self.onmessage({ data }), messages,
    origin: () => vm.runInContext('markerSampleIndex', worker.context) };
}

test('late markers cannot align a stopped trial or replace the origin of a newer trial', () => {
  const worker = loadWorker();
  worker.send({ type: 'configure', config: { sampleRateHz: 1000, channelCount: 4,
    leadNames: ['P3', 'P4', 'Oz', 'Pz'], targetFrequenciesHz: [12, 15], windowSeconds: 2.5,
    hopSeconds: 0.25, harmonics: 3, confidenceThreshold: 0.52, marginThreshold: 0.08, requiredVotes: 2 } });
  worker.send({ type: 'start_trial', sessionId: 'session', trialId: 'old' });
  worker.send({ type: 'stop_trial' });
  worker.send({ type: 'set_trial_marker', sessionId: 'session', trialId: 'old', firstSampleIndex: '100' });
  assert.equal(worker.origin(), null);
  worker.send({ type: 'start_trial', sessionId: 'session', trialId: 'new' });
  worker.send({ type: 'set_trial_marker', sessionId: 'session', trialId: 'old', firstSampleIndex: '100' });
  assert.equal(worker.origin(), null);
  worker.send({ type: 'set_trial_marker', sessionId: 'other-session', trialId: 'new', firstSampleIndex: '100' });
  assert.equal(worker.origin(), null);
  worker.send({ type: 'set_trial_marker', sessionId: 'session', trialId: 'new', firstSampleIndex: '200' });
  assert.equal(worker.origin(), 200n);
  assert.deepEqual(worker.messages.filter(message => message.type === 'error'), []);
});



// Synthetic samples are confined to tests; production input uses encoded gateway frames.
const session = '00112233-4455-6677-8899-aabbccddeeff';
function frame(start, count, frequencies = [15], sequence = 1, gap = false, invalid = false) {
  const buffer = new ArrayBuffer(60 + count * 4 * 4), view = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([66, 71, 69, 69]);
  view.setUint16(4, 1, true); view.setUint16(6, 1, true);
  new Uint8Array(buffer, 8, 16).set(session.replaceAll('-', '').match(/../g).map(value => parseInt(value, 16)));
  view.setBigUint64(24, BigInt(sequence), true); view.setBigUint64(32, BigInt(start), true);
  view.setUint32(48, 256, true); view.setUint16(52, 4, true); view.setUint16(54, count, true); view.setUint32(56, gap ? 1 : 0, true);
  const samples = new Float32Array(buffer, 60);
  for (let n = 0; n < count; n++) for (let c = 0; c < 4; c++) samples[n * 4 + c] = frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * (start + n) / 256 + c * .2), 0);
  if (invalid) samples[0] = NaN;
  return buffer;
}
function startRealWorker(publishAnalysis = true, publishMatches = false) {
  const worker = loadWorker();
  worker.send({ type: 'configure', config: { sampleRateHz: 256, channelCount: 4, leadNames: ['P3', 'P4', 'Oz', 'Pz'], targetFrequenciesHz: [12, 15], windowSeconds: 2.5, hopSeconds: .25, harmonics: 3, confidenceThreshold: .52, marginThreshold: .08, requiredVotes: 2, publishAnalysis, publishMatches } });
  worker.send({ type: 'start_trial', sessionId: session, trialId: 'real' });
  worker.send({ type: 'set_trial_marker', sessionId: session, trialId: 'real', firstSampleIndex: '0' });
  return worker;
}

test('Worker selects P3/P4/Oz/Pz by real metadata even with extra O1/O2 and reordered mixed-case names', () => {
  const worker = loadWorker();
  worker.send({type:'configure',config:{sampleRateHz:256,channelCount:6,
    leadNames:['O1',' pZ ','p4','O2',' OZ ','P3'],targetFrequenciesHz:[12,15],windowSeconds:2.5,
    hopSeconds:.25,harmonics:3,confidenceThreshold:.52,marginThreshold:.08,requiredVotes:2,publishAnalysis:true}});
  worker.send({type:'start_trial',sessionId:session,trialId:'mapped'});
  worker.send({type:'set_trial_marker',sessionId:session,trialId:'mapped',firstSampleIndex:'0'});
  for(const [start,count,sequence] of [[0,896,1],[896,64,2]]) {
    const encoded = new ArrayBuffer(60+count*6*4), view = new DataView(encoded);
    new Uint8Array(encoded,0,60).set(new Uint8Array(frame(start,count,[12],sequence),0,60));
    view.setUint16(52,6,true);
    const samples = new Float32Array(encoded,60);
    for(let n=0;n<count;n++) for(let c=0;c<6;c++) {
      // Old occipital channels are flat distractors. Selected leads have distinct DC levels.
      samples[n*6+c] = c===0 || c===3 ? 9999 : 100*c+(c+1)*Math.sin(2*Math.PI*12*(start+n)/256);
    }
    worker.send({type:'eeg',buffer:encoded});
  }
  assert.deepEqual(worker.messages.filter(m=>m.type==='error'),[]);
  const decision=worker.messages.filter(m=>m.type==='decision').at(-1).decision;
  assert.deepEqual(decision.channelQuality.map(c=>c.lead),['P3','P4','Oz','Pz']);
  for(const [index,source] of [5,2,4,1].entries()) assert.ok(Math.abs(decision.channelQuality[index].meanUv-100*source)<.01);
  assert.notEqual(decision.reason,'flat_channel');
  const analysis=worker.messages.filter(m=>m.type==='analysis').at(-1).analysis;
  assert.deepEqual(analysis.spectrum,analysis.channelSpectra.Oz);
  assert.equal('O1' in analysis.channelSpectra,false);
});

test('Worker refuses the old montage and reports genuinely missing Oz/Pz', () => {
  const worker=loadWorker();
  worker.send({type:'configure',config:{sampleRateHz:256,channelCount:4,leadNames:['O1','O2','P3','P4'],
    targetFrequenciesHz:[12,15],windowSeconds:2.5,hopSeconds:.25,harmonics:3,
    confidenceThreshold:.52,marginThreshold:.08,requiredVotes:2}});
  assert.equal(worker.messages.some(m=>m.type==='ready'),false);
  assert.match(worker.messages.find(m=>m.type==='error').message,/缺少：Oz、Pz/);
});

test('no data or an incomplete real EEG window never produces PSD or classification', () => {
  const worker = startRealWorker();
  assert.equal(worker.messages.some(message => message.type === 'analysis' || message.type === 'decision'), false);
  worker.send({ type: 'eeg', buffer: frame(0, 200) });
  assert.equal(worker.messages.some(message => message.type === 'analysis' || message.type === 'decision'), false);
  const progress = worker.messages.find(message => message.type === 'analysis_progress');
  assert.equal(progress.samples, 0); assert.equal(progress.requiredSamples, 640);
});

test('PSD and CCA share the real gateway window and may predict a different frequency than the prompted target', () => {
  const worker = startRealWorker();
  worker.send({ type: 'eeg', buffer: frame(0, 896, [15]) });
  worker.send({ type: 'eeg', buffer: frame(896, 64, [15], 2) });
  const analysis = worker.messages.filter(message => message.type === 'analysis').at(-1).analysis;
  const decision = worker.messages.filter(message => message.type === 'decision').at(-1).decision;
  assert.equal(analysis.candidateIndex, 1); assert.equal(analysis.rejected, false);
  assert.equal(decision.candidateIndex, analysis.candidateIndex);
  assert.equal(analysis.windowStartSample, decision.windowStartSample); assert.equal(analysis.windowEndSample, decision.windowEndSample);
  assert.ok(analysis.matches[1].correlation > .95);
  const { frequenciesHz, powerDensity } = analysis.spectrum;
  let peak = 1; for (let i = 2; frequenciesHz[i] <= 64; i++) if (powerDensity[i] > powerDensity[peak]) peak = i;
  assert.ok(Math.abs(frequenciesHz[peak] - 15) < .5);
  assert.equal(worker.messages.some(message => message.type === 'error'), false);
});

test('ambiguous real windows, invalid samples and transport gaps reject instead of manufacturing a result', () => {
  const mixed = startRealWorker();
  mixed.send({ type: 'eeg', buffer: frame(0, 896, [12, 15]) });
  mixed.send({ type: 'eeg', buffer: frame(896, 64, [12, 15], 2) });
  assert.equal(mixed.messages.filter(message => message.type === 'decision').at(-1).decision.rejected, true);
  for (const [gap, invalid] of [[true, false], [false, true]]) {
    const worker = startRealWorker();
    worker.send({ type: 'eeg', buffer: frame(0, 896, [15], 1, gap, invalid) });
    const result = worker.messages.find(message => message.type === 'analysis').analysis;
    assert.equal(result.spectrum, null); assert.equal(result.matches.length, 0); assert.equal(result.candidateIndex, null); assert.equal(result.rejected, true);
  }
});

test('stopped acquisition never resumes with mock data or stale real frames', () => {
  const worker = startRealWorker(); worker.send({ type: 'eeg', buffer: frame(0, 896) });
  worker.send({ type: 'stop_trial' }); const count = worker.messages.length;
  worker.send({ type: 'eeg', buffer: frame(896, 64, [15], 2) });
  assert.equal(worker.messages.length, count);
  assert.equal(worker.messages.some(message => message.type === 'demo_result'), false);
});


for (const publishAnalysis of [true, false]) test(`display disruption discards overlapping windows and votes in ${publishAnalysis ? 'principle' : 'operation'} mode`, () => {
  const worker = startRealWorker(publishAnalysis);
  worker.send({ type: 'eeg', buffer: frame(0, 960) });
  worker.send({ type: 'invalidate_stimulus_window', sessionId: session, trialId: 'old', revision: 1 });
  assert.equal(worker.messages.some(m => m.type === 'stimulus_window_invalidated'), false);
  worker.send({ type: 'invalidate_stimulus_window', sessionId: session, trialId: 'real', revision: 2 });
  assert.equal(worker.messages.at(-1).revision, 2);
  worker.messages.length = 0;
  worker.send({ type: 'eeg', buffer: frame(960, 832, [15], 2) });
  assert.equal(worker.messages.some(m => m.type === 'analysis' || m.type === 'decision'), false);
  worker.send({ type: 'eeg', buffer: frame(1792, 64, [15], 3) });
  const first = worker.messages.find(m => m.type === 'decision');
  assert.ok(first.decision.windowStartSample >= 1216); assert.equal(first.decision.rejected, true);
  worker.send({ type: 'eeg', buffer: frame(1856, 64, [15], 4) });
  assert.equal(worker.messages.filter(m => m.type === 'decision').at(-1).decision.candidateIndex, 1);
});


function channelFrame(start, count, frequencies, phases = [0, 0, 0, 0], sequence = 1) {
  const encoded = frame(start, count, [15], sequence), samples = new Float32Array(encoded, 60);
  for (let n = 0; n < count; n++) for (let c = 0; c < 4; c++) samples[n * 4 + c] = Math.sin(2 * Math.PI * frequencies[c] * (start + n) / 256 + phases[c]);
  return encoded;
}
test('all PSD channels retain their true frequencies and share the same normalization; FBCCA decisions are unchanged', () => {
  const display = startRealWorker(), classifier = startRealWorker(false);
  for (const worker of [display, classifier]) {
    worker.send({ type: 'eeg', buffer: channelFrame(0, 896, [12, 15, 20, 24]) });
    worker.send({ type: 'eeg', buffer: channelFrame(896, 64, [12, 15, 20, 24], undefined, 2) });
  }
  const result = display.messages.filter(m => m.type === 'analysis').at(-1).analysis;
  const channels = ['P3', 'P4', 'Oz', 'Pz'];
  for (let c = 0; c < 4; c++) {
    const psd = result.channelSpectra[channels[c]], axis = psd.frequenciesHz;
    let peak = 1; for (let i = 2; axis[i] <= 64; i++) if (psd.powerDensity[i] > psd.powerDensity[peak]) peak = i;
    assert.ok(Math.abs(axis[peak] - [12, 15, 20, 24][c]) < .5);
    assert.equal(psd.frequenciesHz, result.channelSpectra.Oz.frequenciesHz);
    assert.equal(psd.windowEnergy, result.channelSpectra.Oz.windowEnergy);
    assert.equal(psd.frequencyBinHz, .25);
  }
  const mean = result.channelSpectra.mean;
  for (let bin = 0; bin < mean.powerDensity.length; bin++) assert.equal(mean.powerDensity[bin], channels.reduce((sum, name) => sum + result.channelSpectra[name].powerDensity[bin], 0) / 4);
  assert.deepEqual(display.messages.filter(m => m.type === 'decision'), classifier.messages.filter(m => m.type === 'decision'));
});

test('principle PSD uses continuous display bandpass across packets without modifying EEG or FBCCA decisions', () => {
  const display = startRealWorker(), classifier = startRealWorker(false);
  const sources = Array.from({length:4},()=>new Float32Array(960));
  let start=0,sequence=0;
  for (const count of [173,723,64]) {
    const encoded=frame(start,count,[15],++sequence), samples=new Float32Array(encoded,60);
    for(let n=0;n<count;n++)for(let c=0;c<4;c++) {
      const t=(start+n)/256;
      samples[n*4+c]=1000+30*Math.sin(2*Math.PI*.1*t)+Math.sin(2*Math.PI*15*t+c*.2)+4*Math.sin(2*Math.PI*90*t);
      sources[c][start+n]=samples[n*4+c];
    }
    const original=new Uint8Array(encoded).slice();
    for(const worker of [display,classifier])worker.send({type:'eeg',buffer:encoded});
    assert.deepEqual(new Uint8Array(encoded),original);
    start+=count;
  }
  const result=display.messages.filter(m=>m.type==='analysis').at(-1).analysis;
  assert.deepEqual(result.psdBandpass,{lowHz:2,highHz:45});
  for(const [index,name] of ['P3','P4','Oz','Pz'].entries()) {
    const filtered=new ObservationFilter(256).process(sources[index]).bandpassed;
    const expected=new ReusableSpectrum().compute(filtered.subarray(320),256,1024);
    assert.deepEqual(Array.from(result.channelSpectra[name].powerDensity),Array.from(expected.powerDensity));
    const raw=new ReusableSpectrum().compute(sources[index].subarray(320),256,1024);
    assert.ok(result.channelSpectra[name].powerDensity[360]<raw.powerDensity[360]*.01,'90 Hz interference is attenuated');
    assert.ok(result.channelSpectra[name].powerDensity[60]>.1,'15 Hz target remains visible');
  }
  assert.deepEqual(display.messages.filter(m=>m.type==='decision'),classifier.messages.filter(m=>m.type==='decision'));
  assert.equal(display.messages.some(m=>m.type==='error'),false);
});

test('principle PSD resets bandpass at gaps, invalid samples and new trials',()=>{
  for(const invalid of [false,true]) {
    const worker=startRealWorker();worker.send({type:'eeg',buffer:frame(0,896,[12])});
    if(invalid)worker.send({type:'eeg',buffer:frame(896,64,[12],2,false,true)});
    const first=invalid?960:1156,sequence=3;
    worker.send({type:'eeg',buffer:frame(first,960,[15],sequence)});
    const fresh=startRealWorker();fresh.send({type:'set_trial_marker',sessionId:session,trialId:'real',firstSampleIndex:String(first)});
    fresh.send({type:'eeg',buffer:frame(first,960,[15],sequence)});
    const actual=worker.messages.filter(m=>m.type==='analysis'&&m.analysis.spectrum).at(-1).analysis;
    const expected=fresh.messages.filter(m=>m.type==='analysis').at(-1).analysis;
    assert.deepEqual(actual.channelSpectra,expected.channelSpectra,'no old filter state enters recovered PSD');
    worker.send({type:'stop_trial'});worker.send({type:'start_trial',sessionId:session,trialId:'real'});
    worker.send({type:'set_trial_marker',sessionId:session,trialId:'real',firstSampleIndex:String(first)});
    worker.send({type:'eeg',buffer:frame(first,960,[15],1)});
    assert.deepEqual(worker.messages.filter(m=>m.type==='analysis').at(-1).analysis.channelSpectra,expected.channelSpectra);
    assert.equal(worker.messages.some(m=>m.type==='error'),false);
  }
});
test('opposite channel phases do not cancel averaged PSD and invalid channels never produce an average', () => {
  const worker = startRealWorker();
  worker.send({ type: 'eeg', buffer: channelFrame(0, 896, [15, 15, 15, 15], [0, Math.PI, 0, Math.PI]) });
  const result = worker.messages.find(m => m.type === 'analysis').analysis;
  const peak = result.channelSpectra.mean.powerDensity[60];
  assert.ok(peak > .5); assert.ok(Math.abs(peak - result.channelSpectra.P3.powerDensity[60]) < 1e-6);
  const bad = startRealWorker(), encoded = channelFrame(0, 896, [12, 15, 20, 24]);
  new Float32Array(encoded, 60)[1] = NaN;
  bad.send({ type: 'eeg', buffer: encoded });
  const invalid = bad.messages.find(m => m.type === 'analysis').analysis;
  assert.ok(Object.values(invalid.channelSpectra).every(spectrum => spectrum === null));
  assert.equal(invalid.rejected, true);
});

test('round match snapshots reuse FBCCA scores without PSD work or changing decisions', () => {
  const baseline = startRealWorker(false), detailed = startRealWorker(false, true), analysis = startRealWorker(true);
  for (const worker of [baseline, detailed, analysis]) {
    worker.send({ type: 'eeg', buffer: frame(0, 896, [15]) });
    worker.send({ type: 'eeg', buffer: frame(896, 64, [15], 2) });
  }
  const decisions = worker => worker.messages.filter(m => m.type === 'decision').map(m => m.decision);
  const plain = decisions(baseline), snapshots = decisions(detailed);
  assert.deepEqual(snapshots.map(({ matches, ...decision }) => decision), plain);
  assert.deepEqual(snapshots.map(d => d.matches), analysis.messages.filter(m => m.type === 'analysis').map(m => m.analysis.matches));
  assert.equal(detailed.messages.some(m => m.type === 'analysis'), false);
  assert.equal(snapshots.at(-1).candidateIndex, 1);
  assert.equal(snapshots.at(-1).matches.length, 2);
  for (const [gap, invalid] of [[true, false], [false, true]]) {
    const worker = startRealWorker(false, true);
    worker.send({ type: 'eeg', buffer: frame(0, 896, [15], 1, gap, invalid) });
    assert.deepEqual(decisions(worker)[0].matches, []);
  }
});

test('game Worker caps analysis windows at stimulus deadline and retains real frequency selection', () => {
 const worker=loadWorker();
 worker.send({type:'configure',config:{sampleRateHz:256,channelCount:4,leadNames:['P3','P4','Oz','Pz'],targetFrequenciesHz:[12,15],windowSeconds:2.5,hopSeconds:.25,harmonics:3,confidenceThreshold:.52,marginThreshold:.08,requiredVotes:2,maxTrialSeconds:4}});
 worker.send({type:'start_trial',sessionId:session,trialId:'game'});
 worker.send({type:'set_trial_marker',sessionId:session,trialId:'game',firstSampleIndex:'128'});
 worker.send({type:'eeg',buffer:frame(0,1024,[12])});
 worker.send({type:'eeg',buffer:frame(1024,1024,[15],2)});
 const results=worker.messages.filter(m=>m.type==='decision').map(m=>m.decision);
 assert.ok(results.length>0);assert.ok(results.every(d=>d.windowEndSample<=1024));
 assert.equal(results.at(-1).candidateIndex,0,'samples after stimulus deadline do not change selection to 15 Hz');
 assert.equal(worker.messages.some(m=>m.type==='analysis'),false,'no PSD in game');
});

test('game FBCCA uses exactly the visible four/six candidate frequencies', () => {
 for (const frequencies of [[7.5,8.57,10,12],[7.5,8.57,10,12,13.33,14]]) {
  const worker=loadWorker();
  worker.send({type:'configure',config:{sampleRateHz:256,channelCount:4,leadNames:['P3','P4','Oz','Pz'],targetFrequenciesHz:frequencies,windowSeconds:2.5,hopSeconds:.25,harmonics:3,confidenceThreshold:.52,marginThreshold:.08,requiredVotes:2,publishMatches:true,maxTrialSeconds:4}});
  worker.send({type:'start_trial',sessionId:session,trialId:'game'});
  worker.send({type:'set_trial_marker',sessionId:session,trialId:'game',firstSampleIndex:'0'});
  worker.send({type:'eeg',buffer:frame(0,960,[10])});
  const last=worker.messages.filter(m=>m.type==='decision').at(-1).decision;
  assert.deepEqual(last.matches.map(match=>match.frequencyHz),frequencies);
  assert.equal(last.rejected,false);assert.equal(last.candidateIndex,2);
 }
});

test('full-window decisions record effective duration and reject a flat required lead',()=>{
 const worker=startRealWorker(false);
 worker.send({type:'eeg',buffer:frame(0,960,[15])});
 const decision=worker.messages.filter(m=>m.type==='decision').at(-1).decision;
 assert.equal(decision.effectiveWindowSamples,640);
 assert.equal(decision.filterWarmupSamples,256);
 assert.equal(decision.windowEndSample-decision.windowStartSample,640);
 assert.deepEqual(decision.channelQuality.map(c=>c.lead),['P3','P4','Oz','Pz']);
 assert.equal(decision.classifierName,'fbcca-cca');assert.equal(decision.classifierVersion,'0.3.0');
 const flat=startRealWorker(false), encoded=frame(0,960,[15]), samples=new Float32Array(encoded,60);
 for(let n=0;n<960;n++)samples[n*4+2]=1000;
 flat.send({type:'eeg',buffer:encoded});
 const rejected=flat.messages.filter(m=>m.type==='decision').at(-1).decision;
 assert.equal(rejected.rejected,true);assert.equal(rejected.reason,'flat_channel');
});

test('sample gaps keep real acquisition time and cannot move post-deadline EEG into a game window',()=>{
 const worker=loadWorker();
 worker.send({type:'configure',config:{sampleRateHz:256,channelCount:4,leadNames:['P3','P4','Oz','Pz'],targetFrequenciesHz:[12,15],windowSeconds:2.5,hopSeconds:.25,harmonics:3,confidenceThreshold:.52,marginThreshold:.08,requiredVotes:2,maxTrialSeconds:6}});
 worker.send({type:'start_trial',sessionId:session,trialId:'gapped-game'});
 worker.send({type:'set_trial_marker',sessionId:session,trialId:'gapped-game',firstSampleIndex:'0'});
 worker.send({type:'eeg',buffer:frame(0,256,[12],1)});
 worker.send({type:'eeg',buffer:frame(1400,960,[15],3)});
 assert.equal(worker.messages.some(m=>m.type==='decision'),false,'no complete clean window fits before six-second deadline');
 assert.equal(worker.messages.some(m=>m.type==='error'),false);
});
