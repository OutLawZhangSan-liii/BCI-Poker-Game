import test from "node:test";
import assert from "node:assert/strict";
import { ReusableSpectrum } from "./reusableSpectrum.ts";
import { computePowerSpectrumWithConfig } from "./simulatedAnalysis.ts";

test("reusable PSD matches original Hann normalization, padding and invalid samples", () => {
  for (const [length, fft, rate] of [[512,512,256],[500,512,250],[257,512,1000],[128,128,256]]) {
    const input = Float32Array.from({length}, (_,i) => 3 + Math.sin(2*Math.PI*12*i/rate) + .4*Math.cos(2*Math.PI*15*i/rate));
    input[7] = NaN;
    const original = computePowerSpectrumWithConfig(input,rate,fft);
    const actual = new ReusableSpectrum().compute(input,rate,fft);
    assert.equal(actual.invalidSamples,original.invalidSamples);
    assert.equal(actual.mean,original.mean); assert.equal(actual.windowEnergy,original.windowEnergy);
    assert.deepEqual(actual.frequenciesHz,original.frequenciesHz);
    for (let i=0;i<actual.powerDensity.length;i++) assert.ok(Math.abs(actual.powerDensity[i]-original.powerDensity[i]) < 1e-12*Math.max(1,original.powerDensity[i]));
    assert.ok(Number.isNaN(input[7]),"input remains untouched");
  }
});
test("steady calculations reuse bounded FFT and PSD buffers", () => {
  const workspace = new ReusableSpectrum(), input = new Float32Array(512);
  const initial = workspace.compute(input,256,512);
  const real = workspace.real, window = workspace.window, imag = workspace.imaginary;
  for (let i=0;i<10000;i++) {input[i%512] = Math.sin(i);const result=workspace.compute(input,256,512);assert.equal(result.powerDensity,initial.powerDensity);assert.equal(result.frequenciesHz,initial.frequenciesHz);}
  assert.equal(workspace.real,real); assert.equal(workspace.window,window);assert.equal(workspace.imaginary,imag);
  assert.equal(workspace.compute([],256,512),null);
  assert.equal(workspace.compute(input,0,512),null);
});
