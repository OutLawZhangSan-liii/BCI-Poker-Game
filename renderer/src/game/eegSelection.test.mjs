import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const cache = new Map();
function load(filename) {
 if(cache.has(filename)) return cache.get(filename);
 const exports = {}; cache.set(filename,exports);
 vm.runInContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  vm.createContext({exports,console,require:name=>load(path.resolve(path.dirname(filename),name+'.ts'))}));
 return exports;
}
const {gameDecisionChoice, gameEegReadiness, GAME_STIMULUS_MS, GAME_ANALYSIS_GRACE_MS} = load(fileURLToPath(new URL('./eegSelection.ts',import.meta.url)));
const trial={sessionId:'session',trialId:'trial',frequencies:[12,15],onsetMs:1000,sampleRateHz:256};
const decision={sessionId:'session',trialId:'trial',classifierName:'fbcca-cca',classifierVersion:'0.2.0',candidateIndex:0,rejected:false,confidence:.8,windowStartSample:0,windowEndSample:640};
test('formal game requires connected streaming EEG and all four real leads',()=>{
 assert.match(gameEegReadiness(false,false,[]),/连接/);
 assert.match(gameEegReadiness(true,false,['P3','P4','Oz','Pz']),/采集/);
 assert.match(gameEegReadiness(true,true,['P3','Oz','Pz']),/P4/);
 assert.equal(gameEegReadiness(true,true,['pz',' OZ ','P3','p4']),null);
 assert.match(gameEegReadiness(true,true,['O1','O2','P3','P4']),/Oz.*Pz/);
 for(const missing of ['P3','P4','Oz','Pz']) {
  assert.notEqual(gameEegReadiness(true,true,['P3','P4','Oz','Pz'].filter(lead=>lead!==missing)),null);
 }
});
test('accepted real candidates select their card indices independently of the correct answer',()=>{
 assert.equal(gameDecisionChoice(decision,trial,3700),0);
 assert.equal(gameDecisionChoice({...decision,candidateIndex:1},trial,3700),1);
 const four={...trial,frequencies:[7.5,8.57,10,12]};
 assert.equal(gameDecisionChoice({...decision,candidateIndex:3},four,3700),3);
});
test('rejects, stale sessions/trials, other classifiers and invalid indices cannot select a card',()=>{
 for(const patch of [{rejected:true},{candidateIndex:null},{candidateIndex:2},{candidateIndex:-1},{candidateIndex:.5},{sessionId:'old'},{trialId:'old'},{classifierName:'etraca-prototype'}]) assert.equal(gameDecisionChoice({...decision,...patch},trial,3700),null);
});
test('only windows inside the fixed stimulus period can finish during a bounded analysis grace',()=>{
 const deadline=trial.onsetMs+GAME_STIMULUS_MS+GAME_ANALYSIS_GRACE_MS;
 assert.equal(gameDecisionChoice(decision,trial,deadline),0);
 assert.equal(gameDecisionChoice(decision,trial,deadline+1),null);
 assert.equal(gameDecisionChoice({...decision,windowEndSample:Math.floor(trial.sampleRateHz*GAME_STIMULUS_MS/1000)+1},trial,deadline),null);
 assert.equal(gameDecisionChoice({...decision,windowStartSample:-1},trial,3700),null);
});
