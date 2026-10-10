import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

/** Hidden integration check using a separate synthetic gateway, never a real device. */
export async function runLabAcquisitionCheck(window: BrowserWindow, root: string) {
  const evaluate = <T,>(body: string) => window.webContents.executeJavaScript(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    const wait=async(test,timeout=5000)=>{const begin=Date.now();while(!test()){if(Date.now()-begin>timeout)throw new Error('UI wait timed out: '+document.body.innerText);await sleep(100)}};
    const set=async(select,value)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,String(value));select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(300)};
    ${body}
  })()`) as Promise<T>;
  const directory=path.join(root,"stimulus-lab"),id=fs.readdirSync(directory)[0],file=path.join(directory,id,"run.json");
  // Completed setup items are synthetic placeholders, stored only under the smoke directory.
  const record=JSON.parse(fs.readFileSync(file,"utf8"));
  record.attempts=record.items.filter((i:any)=>i.count!==6 || i.kind==="static").map((i:any)=>({trialId:crypto.randomUUID(),itemId:i.id,sessionId:crypto.randomUUID(),startedAt:new Date().toISOString(),status:"complete",attention:"confirmed",comfort:0}));
  fs.writeFileSync(file,JSON.stringify(record));
  await evaluate(`await set(document.querySelector('select'),'');await set(document.querySelector('select'),${JSON.stringify(id)});button('连接网关').click();await wait(()=>!button('开始采集').disabled);button('开始采集').click();await wait(()=>!button('开始下一批').disabled);button('开始下一批').click();await wait(()=>document.querySelector('.lab-status').innerText.includes('刺激中'),30000);`);
  const beforeCpu=process.cpuUsage(),beforeTime=performance.now();
  const samples: {atMs:number;processes:ReturnType<typeof app.getAppMetrics>}[]=[];
  samples.push({atMs:performance.now(),processes:app.getAppMetrics()});
  const monitor=setInterval(()=>samples.push({atMs:performance.now(),processes:app.getAppMetrics()}),1000);
  await evaluate(`await wait(()=>document.querySelector('.lab-status').innerText.includes('轮间休息'),15000);button('暂停 / 停止刺激').click();await wait(()=>button('暂停 / 停止刺激').disabled);await sleep(500);`);
  clearInterval(monitor);samples.push({atMs:performance.now(),processes:app.getAppMetrics()});
  const firstSample=samples[0],lastSample=samples.at(-1)!;
  const cpuSeconds=(sample:typeof firstSample)=>sample.processes.reduce((sum,p)=>sum+(p.cpu.cumulativeCPUUsage??0),0);
  const activeResources={
    peakSummedWorkingSetMiB:Math.max(...samples.map(s=>s.processes.reduce((sum,p)=>sum+p.memory.workingSetSize,0)))/1024,
    peakSummedPrivateMiB:Math.max(...samples.map(s=>s.processes.reduce((sum,p)=>sum+(p.memory.privateBytes??0),0)))/1024,
    averageCoreEquivalent:(cpuSeconds(lastSample)-cpuSeconds(firstSample))/((lastSample.atMs-firstSample.atMs)/1000),
    samples,
  };
  let run=JSON.parse(fs.readFileSync(file,"utf8"));
  const measured=run.attempts.filter((a:any)=>a.stats?.renderedFrames>0);
  if(measured.length!==1 || measured[0].status!=="complete") throw new Error("10-second six-target trial did not complete: "+JSON.stringify(run.attempts.slice(-2)));
  const stats=measured[0].stats;
  if(stats.lastFramePerformanceMs-stats.firstFramePerformanceMs<9900 || stats.renderedFrames<500) throw new Error("Stimulus duration/frame count failed");
  if(stats.maxFrameIntervalMs>=100) throw new Error("Severe frame disruption during smoke trial");
  const reset=async()=>{
    await evaluate(`if(button('确认其余试次均持续注视')){button('确认其余试次均持续注视').click();await sleep(350)}`);
    run=JSON.parse(fs.readFileSync(file,"utf8"));run.breakUntil=0;fs.writeFileSync(file,JSON.stringify(run));
    await evaluate(`await set(document.querySelector('select'),'');await set(document.querySelector('select'),${JSON.stringify(id)});await wait(()=>!button('开始下一批').disabled);`);
  };
  const start=()=>evaluate(`button('开始下一批').click();await wait(()=>document.querySelector('.lab-status').innerText.includes('刺激中'),8000);await sleep(300);`);
  const invalidCheck=(reason:string)=>{
    const updated=JSON.parse(fs.readFileSync(file,"utf8")),last=updated.attempts.at(-1);
    if(last.status!=="invalid" || !String(last.reason).includes(reason)) throw new Error("Failure not preserved: "+JSON.stringify(last));
  };
  await reset();await start();
  await evaluate(`button('暂停 / 停止刺激').click();await wait(()=>button('暂停 / 停止刺激').disabled);await sleep(300);`);invalidCheck("user_paused");
  await reset();await start();
  await evaluate(`document.querySelector('.lab-table').style.width='90%';await wait(()=>button('暂停 / 停止刺激').disabled);await sleep(300);document.querySelector('.lab-table').style.width='';await sleep(300);`);invalidCheck("stimulus_resized");
  await reset();
  fs.writeFileSync(path.join(root,"test-control.json"),JSON.stringify({failStart:true}));
  await evaluate(`button('开始下一批').click();await sleep(500);await wait(()=>button('暂停 / 停止刺激').disabled,8000);await sleep(300);`);invalidCheck("start_marker_failed");
  fs.writeFileSync(path.join(root,"test-control.json"),"{}");
  await reset();await start();
  fs.writeFileSync(path.join(root,"test-control.json"),JSON.stringify({gap:true}));
  await evaluate(`await wait(()=>button('暂停 / 停止刺激').disabled);await sleep(300);`);invalidCheck("eeg_gap");
  fs.writeFileSync(path.join(root,"test-control.json"),"{}");
  await reset();await start();
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));await wait(()=>button('暂停 / 停止刺激').disabled);await sleep(300);delete document.hidden;`);invalidCheck("window_hidden");
  await evaluate(`button('停止采集').click();await wait(()=>!button('开始采集').disabled);`);
  const cpu=process.cpuUsage(beforeCpu),elapsed=performance.now()-beforeTime;
  fs.writeFileSync(path.join(root,"lab-acquisition-check.json"),JSON.stringify({synthetic:true,stats,activeResources,mainCpuMs:(cpu.user+cpu.system)/1000,elapsedMs:elapsed,checks:["10-second-complete","pause","resize","marker-failure","sample-gap","window-hidden"],attempts:JSON.parse(fs.readFileSync(file,"utf8")).attempts.slice(-6)},null,2));
  console.log("LAB_ACQUISITION_CHECK="+JSON.stringify({success:true,stats}));
}
