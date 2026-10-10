/** Persistence gate: immutable protocol and append-only attempt history. */
export function validateLabRecord(run: any, previous?: any): void {
  const orders = [[2,4,6],[4,6,2],[6,2,4],[2,6,4],[6,4,2],[4,2,6]];
  if (run?.schemaVersion !== 1 || run.protocol !== "multi-target-form-algorithm-v1"
    || run.baselineCommit !== "e1ceefd6a0d52ad5d00b7e1f68c5155db6f31025"
    || !Number.isInteger(run.seed) || !Number.isInteger(run.revision) || run.revision < 0
    || !Number.isFinite(run.breakUntil) || !Array.isArray(run.items) || !Array.isArray(run.attempts) || !Array.isArray(run.sessions)) throw new Error("invalid experiment record");
  const expected = new Map<string, object>();
  for (let group=1; group<=6; group++) for (let part=0;part<3;part++) {
    const count=orders[group-1][part], batch=(group-1)*3+part;
    for (const appearance of ["solid","card","card-face"]) {
      if (group===1) expected.set(`static-${count}-${appearance}`,{batch,group:0,count,appearance,cue:0,kind:"static",split:"reference"});
      for (let cue=0;cue<count;cue++) expected.set(`g${group}-${count}-${appearance}-${cue}`,{batch,group,count,appearance,cue,kind:"active",split:group<=4?"development":"test"});
    }
  }
  if (run.items.length!==225 || new Set(run.items.map((i:any)=>i.id)).size!==225) throw new Error("invalid protocol coverage");
  for (const item of run.items) {
    const spec=expected.get(item.id);
    if (!spec || Object.entries(spec).some(([key,value])=>item[key]!==value)) throw new Error("protocol item changed");
  }
  if (new Set(run.attempts.map((a:any)=>a.trialId)).size!==run.attempts.length) throw new Error("duplicate attempt id");
  for (const a of run.attempts) {
    if (!expected.has(a.itemId) || !/^[0-9a-f-]{36}$/i.test(a.trialId) || !/^[0-9a-f-]{36}$/i.test(a.sessionId)
      || !["started","complete","invalid"].includes(a.status) || !["pending","confirmed","excluded"].includes(a.attention)) throw new Error("invalid trial attempt");
  }
  if (!previous) { if (run.attempts.length) throw new Error("new experiment must have empty history"); return; }
  for (const key of ["id","seed","createdAt","items","baselineCommit","protocol"]) if (JSON.stringify(previous[key])!==JSON.stringify(run[key])) throw new Error("experiment protocol is immutable");
  if (run.attempts.length<previous.attempts.length) throw new Error("attempt history cannot be removed");
  previous.attempts.forEach((old:any,index:number)=>{
    const next=run.attempts[index];
    for (const key of ["trialId","itemId","sessionId","startedAt"]) if (old[key]!==next[key]) throw new Error("attempt identity cannot change");
    if (old.status==="invalid" || (old.status==="complete" && old.attention!=="pending")) {
      if (JSON.stringify(old)!==JSON.stringify(next)) throw new Error("reviewed attempt is immutable");
    } else if (old.status==="complete" && (next.status!=="complete" || JSON.stringify(old.stats)!==JSON.stringify(next.stats))) throw new Error("completed attempt cannot be rewritten");
    else if (old.status==="started" && !["started","complete","invalid"].includes(next.status)) throw new Error("invalid attempt transition");
  });
  for (const [count,signature] of Object.entries(previous.geometrySignatures ?? {})) if (run.geometrySignatures?.[count]!==signature) throw new Error("geometry lock cannot change");
  for (const a of run.attempts.slice(previous.attempts.length)) {
    if (a.status!=="started" || a.attention!=="pending") throw new Error("new attempt must start pending");
    if (previous.attempts.some((old:any)=>old.itemId===a.itemId && old.status==="complete" && old.attention!=="excluded")) throw new Error("plan item already completed");
  }
}
