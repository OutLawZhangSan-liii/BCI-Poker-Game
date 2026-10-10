// Replay production FBCCA on real recorded trials. No synthetic substitution,
// no model fitting, and no automatic threshold changes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';

const directory = path.resolve(process.argv[2]);
const index = JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
if (![
  ['P3','P4','OZ','PZ'], ['O1','O2','P3','P4'],
].some(leads => JSON.stringify(leads) === JSON.stringify(index.channels.map(name => name.trim().toUpperCase())))) throw new Error('Invalid export channel order');
const context = vm.createContext({ exports: {}, console });
vm.runInContext(ts.transpileModule(fs.readFileSync('renderer/src/bci/signal/fbcca.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { ContinuousFbccaFilterBank, scoreFilteredBanks, scoreFilterBank, rankScores, FBCCA_FILTER_WARMUP_SAMPLES } = context.exports;
const fsHz = index.sampleRateHz;
function channels(file) {
  const bytes = fs.readFileSync(path.join(directory,file));
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  return Array.from({length:4},(_,channel)=>Float32Array.from({length:values.length/4},(_,sample)=>values[sample*4+channel]));
}
function replay(raw, frequencies, seconds, method) {
  const count = Math.round(seconds*fsHz), hop = Math.round(seconds*fsHz), rows=[];
  const banks = method === 'continuous' ? new ContinuousFbccaFilterBank(fsHz,4).process(raw) : null;
  const settling = method === 'continuous' ? FBCCA_FILTER_WARMUP_SAMPLES : 0;
  for(let end=settling+count;end<=raw[0].length;end+=hop) {
    const begin=end-count, started=performance.now();
    const scores = banks ? scoreFilteredBanks(banks.map(bank=>bank.map(c=>c.subarray(begin,end))),fsHz,frequencies,3)
      : scoreFilterBank(raw.map(c=>c.subarray(begin,end)),fsHz,frequencies,3);
    const ranking=rankScores(scores);
    rows.push({startSeconds:begin/fsHz,endSeconds:end/fsHz,candidate:ranking.candidateIndex,share:ranking.confidence,
      margin:ranking.margin,targetEvidence:ranking.rawScores[ranking.candidateIndex],scores:ranking.rawScores,
      acceptedSingleWindow:ranking.confidence>=.52 && ranking.margin>=.08,computeMs:performance.now()-started});
  }
  return rows;
}
const output={sampleRateHz:fsHz,channels:index.channels,methods:{
  windowSeconds:[2.5,3,4],firWarmupSamples:FBCCA_FILTER_WARMUP_SAMPLES,
  comparison:'Legacy per-window FIR vs full-length continuously filtered FIR; non-overlapping windows; votes not simulated',
  caution:'Window agreement is not independent trial accuracy. Thresholds cannot be certified without annotated targets for each mode and held-out trials.'},trials:[]};
for(const trial of index.trials) {
  const raw=channels(trial.file), idle=trial.baselineFile ? channels(trial.baselineFile):null;
  const result={...trial,comparisons:[]};
  for(const seconds of [2.5,3,4])for(const method of ['legacy','continuous']) {
    const windows=replay(raw,trial.frequencies,seconds,method), baseline=idle?replay(idle,trial.frequencies,seconds,method):[];
    const accepted=windows.filter(w=>w.acceptedSingleWindow);
    const shares=baseline.map(w=>w.share).sort((a,b)=>a-b);
    result.comparisons.push({method,seconds,effectiveSeconds:method==='legacy'?seconds-256/fsHz:seconds,
      windows,baselineWindows:baseline,
      acceptedWindows:accepted.length,
      labelledAgreement:trial.attentionConfirmed&&trial.cueIndex!==null&&accepted.length ? accepted.filter(w=>w.candidate===trial.cueIndex).length/accepted.length:null,
      idleAcceptedWindows:baseline.filter(w=>w.acceptedSingleWindow).length,
      idleShare95:shares.length?shares[Math.floor((shares.length-1)*.95)]:null,
      thresholdSweep:[.3,.4,.52,.6,.7,.8].map(threshold=>({threshold,
        accepted:windows.filter(w=>w.share>=threshold&&w.margin>=.08).length,
        correct:trial.attentionConfirmed&&trial.cueIndex!==null?windows.filter(w=>w.share>=threshold&&w.margin>=.08&&w.candidate===trial.cueIndex).length:null,
        idleAccepted:baseline.filter(w=>w.share>=threshold&&w.margin>=.08).length}))});
  }
  output.trials.push(result);
}
fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(output,null,2));
let report=`# FBCCA 真实数据回放比较\n\n使用 ${index.channels.join(' / ')}；不训练个人模型，不自动下调门槛。\n\n`;
report+='|明确注视试次|滤波方式|窗口/有效秒数|窗口数|接受数|接受窗口相符比例|静息接受/窗口数|\n|---|---|---|---:|---:|---|---|\n';
for(const t of output.trials.filter(t=>t.attentionConfirmed))for(const c of t.comparisons) {
  report+=`|${t.trialId.slice(0,8)} · ${t.frequencies[t.cueIndex]}Hz|${c.method}|${c.seconds}/${c.effectiveSeconds.toFixed(3)}|${c.windows.length}|${c.acceptedWindows}|${c.labelledAgreement===null?'—':(100*c.labelledAgreement).toFixed(1)+'%'}|${c.idleAcceptedWindows}/${c.baselineWindows.length}|\n`;
}
report+='\n只有已确认的两个单目标试次，不能据此验证四/六目标门槛，也不能把窗口比例当作真实游戏正确率。无注视记录只用于检查拒识和计算开销。改变滤波窗口后，需要补录独立注视试次和静息对照，再确定默认窗口及门槛。\n';
fs.writeFileSync(path.join(directory,'comparison.md'),report);
console.log(JSON.stringify({trials:output.trials.length,annotated:output.trials.filter(t=>t.attentionConfirmed).length,report:path.join(directory,'comparison.md')}));
