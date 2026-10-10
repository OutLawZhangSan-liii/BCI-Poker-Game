// Read-only replay of the actual main-branch FBCCA and decision policy.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';
const load = file => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports}); return exports; };
const {ContinuousFbccaFilterBank,scoreFilteredBanks,rankScores,FBCCA_FILTER_WARMUP_SAMPLES} = load('renderer/src/bci/signal/fbcca.ts');
const {fbccaDecisionPolicy,FBCCA_POLICY_VERSION} = load('renderer/src/bci/signal/decisionPolicy.ts');
const manifest = JSON.parse(fs.readFileSync(process.argv[2],'utf8')), result = {};
for (const trial of manifest.trials) {
  const bytes = fs.readFileSync(path.resolve(path.dirname(process.argv[2]),trial.file));
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const raw = Array.from({length:4},(_,c)=>Float32Array.from({length:values.length/4},(_,s)=>values[s*4+c]));
  const fsHz = trial.fs, bank = new ContinuousFbccaFilterBank(fsHz,4), started = performance.now();
  // The production ring stores filtered samples in Float32.
  const filtered = bank.process(raw).map(b=>b.map(c=>Float32Array.from(c)));
  const preprocessMs = performance.now()-started;
  const policy = fbccaDecisionPolicy(trial.frequencies.length);
  const rank = (begin,end) => {
    const before = performance.now();
    const ranking = rankScores(scoreFilteredBanks(filtered.map(b=>b.map(c=>c.subarray(begin,end))),fsHz,trial.frequencies,3));
    const flat = raw.some(c=>{ let min=Infinity,max=-Infinity;for(let i=begin;i<end;i++){min=Math.min(min,c[i]);max=Math.max(max,c[i]);}return max===min; });
    return {...ranking,flat,elapsedMs:performance.now()-before};
  };
  const windows = {};
  for (const seconds of [2,3,4]) { const begin=Math.max(FBCCA_FILTER_WARMUP_SAMPLES,Math.round(1.5*fsHz)),end=begin+Math.round(seconds*fsHz); windows[seconds]=rank(begin,end); }
  const online=[]; let votes=[];
  const windowSamples=Math.round(2.5*fsHz),hop=Math.round(.25*fsHz);
  for(let end=FBCCA_FILTER_WARMUP_SAMPLES+windowSamples;end<=Math.floor(6*fsHz);end+=hop){
    const r=rank(end-windowSamples,end), bad=r.flat||r.confidence<policy.confidenceThreshold||r.margin<policy.marginThreshold;
    votes.push(bad?-1:r.candidateIndex);if(votes.length>policy.requiredVotes)votes.shift();
    const accepted=!bad&&votes.length===policy.requiredVotes&&votes.every(v=>v===r.candidateIndex);
    online.push({...r,endSeconds:end/fsHz,accepted,candidate:accepted?r.candidateIndex:null});
  }
  result[trial.trialId]={windows,online,preprocessMs,filterWarmupSamples:FBCCA_FILTER_WARMUP_SAMPLES,policy,policyVersion:FBCCA_POLICY_VERSION};
}
fs.writeFileSync(process.argv[3],JSON.stringify(result));
