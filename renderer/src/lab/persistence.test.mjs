import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {validateLabRecord} from '../../../desktop/main/labRecord.ts';
const fresh=()=>JSON.parse(execFileSync(process.execPath,['tools/stimulus_lab/fixture_protocol.mjs'],{encoding:'utf8'})).run;
test('append-only attempts preserve interruption/retry and forbid a duplicate completed item',()=>{
 const run=fresh();validateLabRecord(run);
 const trial={trialId:randomUUID(),sessionId:randomUUID(),itemId:run.items[0].id,startedAt:'fixed',status:'started',attention:'pending'};
 const started={...run,attempts:[trial]};validateLabRecord(started,run);
 const failed={...started,attempts:[{...trial,status:'invalid',reason:'marker_failure'}]};validateLabRecord(failed,started);
 const retry={...failed,attempts:[...failed.attempts,{...trial,trialId:randomUUID()}]};validateLabRecord(retry,failed);
 const complete={...retry,attempts:[retry.attempts[0],{...retry.attempts[1],status:'complete',stats:{renderedFrames:600}}]};validateLabRecord(complete,retry);
 const confirmed={...complete,attempts:[complete.attempts[0],{...complete.attempts[1],attention:'confirmed'}]};validateLabRecord(confirmed,complete);
 assert.throws(()=>validateLabRecord({...confirmed,attempts:confirmed.attempts.slice(1)},confirmed));
 assert.throws(()=>validateLabRecord({...confirmed,attempts:[...confirmed.attempts,{...trial,trialId:randomUUID()}]},confirmed),/already completed/);
 assert.throws(()=>validateLabRecord({...confirmed,attempts:[{...confirmed.attempts[0],reason:'changed'},confirmed.attempts[1]]},confirmed),/immutable/);
 const excluded={...complete,attempts:[complete.attempts[0],{...complete.attempts[1],attention:'excluded'}]};validateLabRecord(excluded,complete);
 validateLabRecord({...excluded,attempts:[...excluded.attempts,{...trial,trialId:randomUUID()}]},excluded);
});
test('protocol and per-count geometry cannot be rewritten on resume',()=>{
 const run=fresh();const old={...run,geometrySignatures:{'6':'fixed'}};
 assert.throws(()=>validateLabRecord({...old,geometrySignatures:{'6':'changed'}},old),/geometry lock/);
 const changed=structuredClone(run);changed.items[0].cue=1;assert.throws(()=>validateLabRecord(changed,run),/protocol item/);
 const order=structuredClone(run);[order.items[0],order.items[1]]=[order.items[1],order.items[0]];assert.throws(()=>validateLabRecord(order,run),/immutable/);
});
