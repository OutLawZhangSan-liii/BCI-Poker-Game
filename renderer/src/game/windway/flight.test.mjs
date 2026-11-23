import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSignalModule } from "../../../../tools/signal-module-harness.mjs";
import { newFlight, stepFlight, wind, gateTime, gateOffset, gateHalfOpening, gateFrameWidth, corridorHalfWidth, newMarkers, observeCommand, markGaze, clearMarkerContext } from "./flight.ts";
const { WindwayDecoder, chebyshevSections } = loadSignalModule(fileURLToPath(new URL("./decoder.ts", import.meta.url))).exports;
test("continuous and fixed gates count encounters, including misses", () => {
  for (const difficulty of ["easy","hard"]) for (const limit of [0,10]) {
    const flight = newFlight(difficulty); let done = false;
    for(let i=0; i < 120*150 && !done; i++) done=stepFlight(flight,1/120,1,limit);
    if(limit) { assert.equal(done,true); assert.equal(flight.attempts,limit); assert.ok(Math.abs(flight.time-gateTime(limit-1)) < 1e-7); }
    else { assert.equal(done,false); assert.ok(flight.attempts>30); }
    assert.ok(flight.passed < flight.attempts); assert.equal(flight.tail.length,121);
  }
});
test("easy stays still without commands; hard has alternating gusts on the same course", () => {
  const easy = newFlight(), hard = newFlight("hard");
  assert.equal(easy.difficulty, "easy");
  for (let n = 0; n < 1200; n++) assert.equal(wind(n/60,"easy"), 0);
  assert.ok(wind(1.8,"hard") > 100 && wind(6.3,"hard") < -100);
  for (let n = 0; n < 120; n++) {
    stepFlight(easy, 1/120, 0, 0);
    stepFlight(hard, 1/120, 0, 0);
  }
  assert.equal(easy.x, 0); assert.equal(easy.velocity, 0); assert.ok(hard.x > 0);
  stepFlight(easy, 1/120, -1, 0); assert.ok(easy.x < 0);
});
test("the aircraft stays within the corridor, and its limits never mark a gate", () => {
  for (const side of [-1, 1]) {
    const f = newFlight();
    for (let frame = 0; frame < 510; frame++) stepFlight(f, 1/120, side, 0);
    assert.equal(f.attempts, 0);
    assert.equal(f.lastHitGate, -1);
    const roll = f.bank * Math.PI / 180;
    const wingX = f.x + side * 100 * (1 - .14 * Math.abs(Math.sin(roll))) * Math.cos(roll) - 56 * Math.sin(roll);
    assert.ok(side * f.x > 500);
    assert.ok(Math.abs(wingX - side * corridorHalfWidth) < 1e-6);
    const atWall = f.x;
    for (let frame = 0; frame < 180; frame++) stepFlight(f, 1/120, -side, 0);
    assert.ok(side * (atWall - f.x) > 50);
  }
});

test("crossing uses the visible opening and frame thickness for passes, grazes and bypasses", () => {
  const index = 5;
  const offset = gateOffset(index);
  for (const side of [-1, 1]) {
    for (const [distance, passed, hit] of [
      [0, 1, false], [gateHalfOpening - 101, 1, false], [gateHalfOpening - 100, 0, true],
      [gateHalfOpening, 0, true], [gateHalfOpening + gateFrameWidth + 100, 0, true],
      [gateHalfOpening + gateFrameWidth + 101, 0, false]
    ]) {
      const f = newFlight();
      f.time = gateTime(index) - 1/120; f.x = offset + side * distance; f.attempts = index;
      stepFlight(f, 1/120, 0, 0);
      assert.equal(f.attempts, index + 1);
      assert.equal(f.passed, passed);
      assert.equal(f.lastHitGate, hit ? index : -1);
      stepFlight(f, 1/120, 0, 0);
      assert.equal(f.attempts, index + 1);
    }
  }
});

test("every gate has the same wing clearance at its course position, including the repeat", () => {
  for (let index = 0; index <= 10; index++) {
    const offset = gateOffset(index);
    assert.ok(Math.abs(offset - gateOffset(index + 1)) >= 140);
    assert.ok(Math.abs(offset) < 300);
    const side = offset > 0 ? -1 : 1; // Approach the post facing the middle of the corridor.
    for (const clearance of [0, 1]) {
      const f = newFlight();
      f.x = offset + side * (gateHalfOpening - 100 - clearance);
      f.attempts = index;
      f.time = gateTime(index) - 1/120;
      stepFlight(f, 1/120, 0, 0);
      assert.equal(f.passed, clearance === 1 ? 1 : 0);
      assert.equal(f.lastHitGate, clearance === 0 ? index : -1);
    }
  }
});

test("central time counts only simulated flight time inside the central quarter-span", () => {
  const f = newFlight();
  f.x=50; stepFlight(f, .25, 0, 0);
  f.x=-50; stepFlight(f, .25, 0, 0);
  f.x=51; stepFlight(f, .25, 0, 0);
  assert.equal(f.centerSeconds, .5);
  assert.equal(f.time, .75);
});

test("reference-marked metrics count episodes and suspend measurement during pauses", () => {
  const m=newMarkers();
  markGaze(m,-1,0); observeCommand(m,-1,1); markGaze(m,1,2); observeCommand(m,0,2.25); observeCommand(m,1,2.75);
  markGaze(m,0,3); observeCommand(m,1,3.1); observeCommand(m,0,4); observeCommand(m,-1,4.3);
  assert.deepEqual([m.switches,m.matched,m.latencySum,m.centerMarks,m.centerPushes],[1,1,.75,1,2]);
  clearMarkerContext(m); observeCommand(m,1,5); assert.equal(m.centerPushes,2);
});
test("Chebyshev front end matches a SciPy sosfilt impulse", () => {
  const sos=[...chebyshevSections(250,6,true),...chebyshevSections(250,45,false)];
  const states=sos.map(()=>[0,0]); const expected=[0,.016032841382364386,.08479214882788483,.17989755776070948,.16868481123860238,-.01872203837913193,-.24765206727811329,-.3210440092528876];
  expected.forEach((val,i)=>{
    let x=Number(i===1); sos.forEach(([b0,b1,b2,a1,a2],k)=>{
      const z=states[k], y=b0*x+z[0]; z[0]=b1*x-a1*y+z[1]; z[1]=b2*x-a2*y; x=y;
    }); assert.ok(Math.abs(x-val)<1e-10);
  });
});
test("both windows follow sustained 12 → 15 Hz and emit neutral on flat input", () => {
  for (const mode of ["fixed","dynamic"]) {
    const run=(chunkSize,flat=false)=>{
      const decoder=new WindwayDecoder(250,mode), out=[];
      for(let n=0;n<2500;n+=chunkSize){
        const rows=Array.from({length:4},(_,ch)=>Float32Array.from({length:Math.min(chunkSize,2500-n)},(_,j)=>{
          const t=(n+j)/250, hz=t<5?12:15;
          return flat ? 3000 : 3000+20*Math.sin(2*Math.PI*hz*t+.4*ch)+4*Math.sin(4*Math.PI*hz*t+.1*ch);
        }));
        decoder.push(rows,(vote,i)=>out.push([n+i+1,vote.dir]));
      } return out;
    };
    const out=run(50); assert.deepEqual(out,run(103));
    assert.ok(out.some(([n,d])=>n<=700 && d===-1)); assert.equal(out.at(-1)[1],1);
    assert.ok(run(100,true).every(v=>v[1]===0));
  }
});
