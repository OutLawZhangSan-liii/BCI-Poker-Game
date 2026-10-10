"""Offline, trial-level evaluation. Test labels are never read by model selection."""
import argparse
import csv
import hashlib
import html
import itertools
import json
import math
from pathlib import Path
import struct
import subprocess
import time
import numpy as np
from .algorithms import bandpass, cca_scores, train_trca, trca_scores, verification, ALGORITHM_VERSION
from device_gateway.analysis_leads import ANALYSIS_LEADS, analysis_channel_indices

PROTOCOL = "multi-target-form-algorithm-v1"
MAIN_BASELINE = "e1ceefd6a0d52ad5d00b7e1f68c5155db6f31025"
WINDOWS = {"full": (1.5,9.5), "early": (1.5,5.5), "late": (5.5,9.5)}
FORMS = ["solid", "card", "card-face"]
METHODS = ["CCA", "FBCCA-main", "TRCA", "eTRCA"]

def read_json(file): return json.loads(Path(file).read_text(encoding="utf-8"))
def write_json(file, value): Path(file).write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
def json_lines(file): return [json.loads(line) for line in Path(file).read_text(encoding="utf-8").splitlines() if line.strip()]

def validate_geometry(run, item, start):
    """Compare the actual first-frame geometry with the persisted per-count lock."""
    geometry=start.get("responsiveStimulusGeometry",{})
    expected=run.get("geometrySignatures",{}).get(str(item["count"]))
    if not expected or geometry!=json.loads(expected): return "geometry_lock_mismatch"
    if geometry.get("targetCount")!=item["count"] or len(geometry.get("targets",[]))!=item["count"]: return "geometry_target_count_mismatch"
    phase=[i*np.pi/2 for i in range(item["count"])] if item["count"]!=6 else [i*np.pi/3 for i in range(6)]
    if any(abs(t.get("phaseRad",float("inf"))-p)>1e-12 for t,p in zip(start.get("targets",[]),phase)): return "phase_mapping_mismatch"
    if start.get("baselineCommit")!=MAIN_BASELINE or run.get("baselineCommit")!=MAIN_BASELINE: return "main_baseline_mismatch"
    regions=start.get("modulatedRegionGeometry",[])
    expected_regions=[{"outer":t["ring"],"excluded":t["card"]} if item["appearance"]=="card" else {"outer":t["card"],"excluded":None} for t in geometry["targets"]]
    if regions!=expected_regions: return "modulated_region_mismatch"
    return None

def load_trials(run, sessions, include_test=False):
    """Load only selected 10-second slices; never allocate a whole multi-hour session."""
    items = {x["id"]:x for x in run["items"]}
    attempts, excluded, chosen = [], [], set()
    for a in reversed(run["attempts"]):
        item = items[a["itemId"]]
        if item["split"] == "test" and not include_test: continue
        reason = None
        if a["status"] != "complete": reason = a.get("reason", "incomplete")
        elif a["attention"] != "confirmed": reason = "attention_not_confirmed"
        elif a["itemId"] in chosen: reason = "superseded_attempt"
        if reason: excluded.append({"trialId":a["trialId"],"itemId":a["itemId"],"reason":reason}); continue
        chosen.add(a["itemId"]); attempts.append((a,item))
    trials = []
    for sid in sorted(set(a["sessionId"] for a,_ in attempts)):
        if len(sid)!=36 or any(c not in "0123456789abcdef-" for c in sid.lower()): raise ValueError("Invalid session id")
        directory = sessions/sid
        meta = read_json(directory/"session.json")
        if meta.get("status") in ("recording", "in_progress"): raise ValueError("Stop acquisition before analysis")
        props=meta["deviceProperties"]; fs=int(props["sample_rate_hz"])
        indices=analysis_channel_indices(props["lead_names"]); nch=len(props["lead_names"])
        if meta.get("sampleUnit") not in (None,"μV","uV","µV"): raise ValueError("EEG unit must be μV")
        markers=json_lines(directory/"markers.jsonl")
        starts={m["trialId"]:m for m in markers if m.get("markerType")=="stimulus_start"}
        ends={m["trialId"]:m for m in markers if m.get("markerType")=="stimulus_end"}
        rows=[]
        for a,item in [p for p in attempts if p[0]["sessionId"]==sid]:
            start,end=starts.get(a["trialId"]),ends.get(a["trialId"])
            reason=None
            if not start or not end: reason="missing_marker"
            elif start.get("comparisonProtocol")!=PROTOCOL or start.get("comparisonRunId")!=run["id"] or start.get("planItemId")!=item["id"]: reason="protocol_mismatch"
            elif start.get("targetAppearance")!=item["appearance"] or start.get("targetCount")!=item["count"] or start.get("cuedTargetIndex")!=item["cue"]: reason="configuration_mismatch"
            elif start.get("fixationMode")!="fixed" or not start.get("responsiveStimulusGeometry"): reason="geometry_or_fixation_missing"
            elif end.get("endReason")!="lab_complete": reason="interrupted_stimulus"
            elif end.get("maxFrameIntervalMs",999)>=100: reason="timing_window_invalid"
            elif start.get("rendererCallbackDelayMs",999)>100 or end.get("rendererCallbackDelayMs",999)>100: reason="marker_callback_delayed"
            else:
                expected={2:[12,15],4:[7.5,8.57,10,12],6:[7.5,8.57,10,12,13.33,14]}[item["count"]]
                if [t["frequencyHz"] for t in start.get("targets",[])]!=expected: reason="frequency_mapping_mismatch"
                if start.get("modulationAmplitude")!=(0 if item["kind"]=="static" else .45) or start.get("luminanceBaseline")!=.5: reason="modulation_mismatch"
                if not reason: reason=validate_geometry(run,item,start)
            if not reason:
                first,last=int(start["markerSampleIndex"]),int(end["markerSampleIndex"])
                if first<0 or last-first<math.ceil(9.5*fs) or last-first>math.ceil(11*fs): reason="invalid_sample_duration"
            if reason:
                excluded.append({"trialId":a["trialId"],"itemId":item["id"],"reason":reason}); continue
            raw=np.full((last-first,4),np.nan,dtype=np.float32)
            rows.append({"trialId":a["trialId"],"item":item,"attempt":a,"fs":fs,"start":start,"end":end,"first":first,"last":last,"raw":raw,"gap":False})
        prior=None
        with (directory/"eeg.bin").open("rb") as source:
            if source.read(6)!=b"BGEG\x01\x00": raise ValueError("Invalid EEG file")
            while True:
                header=source.read(28)
                if not header: break
                if len(header)!=28: raise ValueError("Truncated EEG record")
                seq,first,ns,size=struct.unpack("<QQQI",header)
                if size>16*1024*1024: raise ValueError("Invalid EEG frame size")
                frame=source.read(size)
                if len(frame)!=size or size<9 or frame[:2]!=b"\xaa\x05" or frame[-1]!=0x55: raise ValueError("Invalid EEG frame")
                n,payload=struct.unpack("<HI",frame[2:8])
                if payload!=n*4 or size!=payload+9 or n%nch: raise ValueError("Invalid EEG dimensions")
                last=first+n//nch
                broken=prior is not None and (seq!=prior[0]+1 or first!=prior[1]); prior=(seq,last)
                block=None
                for row in rows:
                    if broken and row["first"]<first<row["last"]: row["gap"]=True
                    lo,hi=max(first,row["first"]),min(last,row["last"])
                    if hi>lo:
                        if block is None: block=np.frombuffer(frame,dtype="<f4",count=n,offset=8).reshape(-1,nch)[:,indices]
                        row["raw"][lo-row["first"]:hi-row["first"]]=block[lo-first:hi-first]
        for row in rows:
            if row["gap"] or not np.isfinite(row["raw"]).all(): excluded.append({"trialId":row["trialId"],"itemId":row["item"]["id"],"reason":"sample_or_sequence_gap"}); continue
            row["filtered"]=bandpass(row["raw"],row["fs"])
            trials.append(row)
    return trials,excluded

def exact_psd(data, fs, frequency):
    w=np.hanning(len(data)); x=(data-data.mean(axis=0))*w[:,None]
    coefficient=np.exp(-2j*np.pi*frequency*np.arange(len(data))/fs)@x
    return 2*np.abs(coefficient)**2/(fs*np.sum(w*w))

def spectral_metrics(data,fs,frequencies,cue):
    duration=len(data)/fs; guard=2/duration
    tagged=[f*h for f in frequencies for h in (1,2,3) if f*h<=45]
    result=[]
    for harmonic in (1,2,3):
        f=frequencies[cue]*harmonic
        if f>=45: result.append({"harmonic":harmonic,"frequencyHz":f,"psd":None,"snrDb":None,"reason":"at_or_above_filter_cutoff"}); continue
        neighbors=[f+d*sign for d in (.5,.75,1,1.5,2) for sign in (-1,1)]
        neighbors=[n for n in neighbors if 2<n<45 and all(abs(n-t)>guard+1e-8 for t in tagged)]
        psd=exact_psd(data,fs,f)
        noise=np.mean([exact_psd(data,fs,n) for n in neighbors],axis=0) if len(neighbors)>=4 else None
        snr=10*np.log10(psd/np.maximum(noise,1e-30)) if noise is not None else None
        result.append({"harmonic":harmonic,"frequencyHz":f,"psd":psd.tolist(),"snrDb":snr.tolist() if snr is not None else None,
                       "roiPsd":float(np.mean(psd[2:4])),"roiSnrDb":float(10*np.log10(np.mean(psd[2:4])/max(np.mean(noise[2:4]),1e-30))) if noise is not None else None,
                       "noiseFrequencies":neighbors,"reason":None if noise is not None else "insufficient_uncontaminated_noise_bins"})
    return result

def rank(scores):
    scores=np.asarray(scores); index=int(np.argmax(scores)); positive=np.maximum(scores,0)
    order=np.sort(positive); total=float(positive.sum())
    return {"candidate":index,"confidence":float(positive[index]/total) if total else 0.,"margin":float((order[-1]-order[-2])/max(order[-1],1e-12)),"scores":scores.tolist()}

def decision(rows, margin, confidence=0., votes_required=2):
    votes=[]; first=None; first_correct=None
    for r in rows:
        bad=r.get("flat",False) or r["confidence"]<confidence or r["margin"]<margin
        votes.append(-1 if bad else r["candidate"]); votes=votes[-votes_required:]
        accepted=not bad and len(votes)==votes_required and all(v==r["candidate"] for v in votes)
        if accepted and first is None: first={"candidate":r["candidate"],"time":r["endSeconds"]}
        if accepted and r["candidate"]==r["cue"] and first_correct is None: first_correct=r["endSeconds"]
    return {"candidate":first["candidate"] if first else None,"decisionTime":first["time"] if first else None,"firstCorrectTime":first_correct,
            "elapsedMs":sum(r["elapsedMs"] for r in rows)}

def classify(trial, method, seconds, model=None):
    fs=trial["fs"]; data=trial["filtered"]; rows=[]
    start=round(1.5*fs); count=round(seconds*fs); hop=round(.25*fs)
    for end in range(start+count,math.floor(6*fs)+1,hop):
        x=data[end-count:end]; before=time.perf_counter()
        # Phase-sensitive templates must have the same onset-relative position as the test window.
        scores=cca_scores(x,fs,trial["frequencies"]) if method=="CCA" else trca_scores(x,model["byEnd"][end],method=="eTRCA")
        row=rank(scores); row.update({"endSeconds":end/fs,"cue":trial["item"]["cue"],"flat":bool(np.any(np.std(trial["raw"][end-count:end],axis=0)<1e-6)),"elapsedMs":(time.perf_counter()-before)*1000});rows.append(row)
    return rows

def model_for(training,seconds):
    if not training or len({t["fs"] for t in training})!=1: raise ValueError("TRCA training requires one sample rate per configuration")
    fs=training[0]["fs"]; count=round(seconds*fs); start=round(1.5*fs); hop=round(.25*fs)
    by_end={}; training_seconds=0.
    for end in range(start+count,math.floor(6*fs)+1,hop):
        model=train_trca([t["filtered"][end-count:end] for t in training],[t["item"]["cue"] for t in training],training[0]["item"]["count"])
        by_end[end]=model;training_seconds+=model["trainingSeconds"]
    return {"byEnd":by_end,"trainingSeconds":training_seconds,"trainingTrials":len(training)}

def evaluate_configuration(rows, training, verification_ok, replay):
    predictions=[]; models={}; unavailable=[]
    for method in METHODS:
        for seconds in (2,3,4):
            model=None
            if method in ("TRCA","eTRCA"):
                if not verification_ok: unavailable.append({"method":method,"seconds":seconds,"reason":"reference_verification_failed"});continue
                try:
                    if seconds not in models: models[seconds]=model_for(training,seconds)
                    model=models[seconds]
                except (ValueError,np.linalg.LinAlgError) as error:
                    unavailable.append({"method":method,"seconds":seconds,"reason":str(error)});continue
            for trial in rows:
                if method=="FBCCA-main":
                    reference=replay[trial["trialId"]]; fixed=reference["windows"][str(seconds)]
                    ranking={"candidate":fixed["candidateIndex"],"confidence":fixed["confidence"],"margin":fixed["margin"],"elapsedMs":fixed["elapsedMs"]}
                    online=[{"candidate":r["candidateIndex"],"confidence":r["confidence"],"margin":r["margin"],"flat":r["flat"],"elapsedMs":r["elapsedMs"],"endSeconds":r["endSeconds"],"cue":trial["item"]["cue"]} for r in reference["online"]]
                    policies=[("main",reference["policy"]["marginThreshold"],reference["policy"]["confidenceThreshold"],reference["policy"]["requiredVotes"])]
                else:
                    online=classify(trial,method,seconds,model)
                    if not online: continue
                    ranking=online[0]
                    policies=[(str(margin),margin,0.,2) for margin in (0.,.05,.1)]
                for policy,margin,confidence,votes in policies:
                    selected=decision(online,margin,confidence,votes)
                    predictions.append({"trialId":trial["trialId"],"itemId":trial["item"]["id"],"group":trial["item"]["group"],"appearance":trial["item"]["appearance"],"count":trial["item"]["count"],"cue":trial["item"]["cue"],"method":method,"seconds":seconds,"policy":policy,"forcedCandidate":ranking["candidate"],"forcedCorrect":ranking["candidate"]==trial["item"]["cue"],"correct":selected["candidate"]==trial["item"]["cue"],"rejected":selected["candidate"] is None, **selected,
                                        "trainingSeconds":model["trainingSeconds"] if model else 0.,"trainingTrials":model["trainingTrials"] if model else 0,
                                        "onlineWindowSeconds":2.5 if method=="FBCCA-main" else seconds,
                                        "preprocessMs":reference.get("preprocessMs",0.) if method=="FBCCA-main" else 0.})
    return predictions,unavailable

def aggregate(rows):
    out=[]
    keys=sorted(set((r["appearance"],r["count"],r["method"],r["seconds"],r["policy"]) for r in rows))
    for key in keys:
        group=[r for r in rows if (r["appearance"],r["count"],r["method"],r["seconds"],r["policy"])==key]
        n=len(group); accepted=[r for r in group if not r["rejected"]]
        matrix=[[0]*key[1] for _ in range(key[1])]; per_target=[]
        for r in group:
            if r["candidate"] is not None: matrix[r["cue"]][r["candidate"]]+=1
        for target in range(key[1]):
            sub=[r for r in group if r["cue"]==target]
            per_target.append({"target":target,"n":len(sub),"accuracy":sum(r["correct"] for r in sub)/len(sub) if sub else None})
        times=[r["firstCorrectTime"] for r in group if r["firstCorrectTime"] is not None]
        out.append({"appearance":key[0],"count":key[1],"method":key[2],"seconds":key[3],"policy":key[4],"n":n,"accuracy":sum(r["correct"] for r in group)/n,"balancedAccuracy":float(np.mean([r["accuracy"] for r in per_target if r["accuracy"] is not None])),"forcedAccuracy":sum(r["forcedCorrect"] for r in group)/n,"rejectionRate":sum(r["rejected"] for r in group)/n,"acceptedAccuracy":sum(r["correct"] for r in accepted)/len(accepted) if accepted else None,"meanFirstCorrectSeconds":float(np.mean(times)) if times else None,"meanReplayComputeMs":float(np.mean([r["elapsedMs"] for r in group])),"confusionMatrix":matrix,"perTarget":per_target})
    return out

def choose_settings(aggregated):
    settings=[]
    for key in sorted(set((r["appearance"],r["count"],r["method"]) for r in aggregated)):
        candidates=[r for r in aggregated if (r["appearance"],r["count"],r["method"])==key]
        if key[2]=="FBCCA-main": chosen=next(r for r in candidates if r["seconds"]==2)
        else: chosen=max(candidates,key=lambda r:(r["balancedAccuracy"],-r["rejectionRate"],-r["seconds"],-float(r["policy"])))
        settings.append({"appearance":key[0],"count":key[1],"method":key[2],"seconds":chosen["seconds"],"policy":chosen["policy"]})
    return settings

def spectral_rows(trials):
    result=[]
    for trial in trials:
        for name,(a,b) in WINDOWS.items():
            data=trial["filtered"][round(a*trial["fs"]):round(b*trial["fs"])]
            # All targets/harmonics are measured in every trial, including static references.
            for cue in range(trial["item"]["count"]):
                for metric in spectral_metrics(data,trial["fs"],trial["frequencies"],cue):
                    result.append({"trialId":trial["trialId"],"itemId":trial["item"]["id"],"group":trial["item"]["group"],"kind":trial["item"]["kind"],"appearance":trial["item"]["appearance"],"count":trial["item"]["count"],"cue":trial["item"]["cue"],"measuredTarget":cue,"window":name,**metric})
    return result

def paired_spectra(rows):
    # Only attended target, fundamental, full window, independently repeated groups.
    selected=[r for r in rows if r["kind"]=="active" and r["window"]=="full" and r["harmonic"]==1 and r["cue"]==r["measuredTarget"] and r.get("roiSnrDb") is not None]
    result=[]
    for count in (2,4,6):
        for left,right in itertools.combinations(FORMS,2):
            deltas=[]
            for group in sorted(set(r["group"] for r in selected)):
                a={r["cue"]:r["roiSnrDb"] for r in selected if r["count"]==count and r["group"]==group and r["appearance"]==left}
                b={r["cue"]:r["roiSnrDb"] for r in selected if r["count"]==count and r["group"]==group and r["appearance"]==right}
                if len(a)==count and len(b)==count: deltas.append(float(np.mean([a[i]-b[i] for i in range(count)])))
            if deltas:
                observed=abs(np.mean(deltas)); perm=[abs(np.mean(np.array(deltas)*signs)) for signs in itertools.product((-1,1),repeat=len(deltas))]
                p=sum(value>=observed-1e-12 for value in perm)/len(perm)
                result.append({"count":count,"left":left,"right":right,"independentGroups":len(deltas),"groupDeltasDb":deltas,"meanDifferenceDb":float(np.mean(deltas)),"p":p})
    ordered=sorted(result,key=lambda r:r["p"]); previous=0.
    for i,row in enumerate(ordered): previous=max(previous,min(1.,row["p"]*(len(ordered)-i)));row["holmP"]=previous
    early_late=[]
    for r in rows:
        if r["window"]!="early" or r.get("roiSnrDb") is None: continue
        late=next((v for v in rows if v["trialId"]==r["trialId"] and v["window"]=="late" and v["harmonic"]==r["harmonic"] and v["measuredTarget"]==r["measuredTarget"]),None)
        if late and late.get("roiSnrDb") is not None: early_late.append({"trialId":r["trialId"],"kind":r["kind"],"appearance":r["appearance"],"count":r["count"],"harmonic":r["harmonic"],"measuredTarget":r["measuredTarget"],"attended":r["cue"]==r["measuredTarget"],"lateMinusEarlyDb":late["roiSnrDb"]-r["roiSnrDb"]})
    static={}
    for r in rows:
        if r["kind"]=="static" and r.get("roiPsd") is not None: static[(r["appearance"],r["count"],r["measuredTarget"],r["harmonic"],r["window"])]=r["roiPsd"]
    enhancement=[]
    for r in rows:
        ref=static.get((r["appearance"],r["count"],r["measuredTarget"],r["harmonic"],r["window"]))
        if r["kind"]=="active" and ref is not None and r.get("roiPsd") is not None:
            enhancement.append({"trialId":r["trialId"],"window":r["window"],"measuredTarget":r["measuredTarget"],"harmonic":r["harmonic"],"relativeStaticDb":float(10*np.log10(max(r["roiPsd"],1e-30)/max(ref,1e-30)))})
    return {"pairedFundamentalSnr":result,"earlyLate":early_late,"staticEnhancementDescriptive":enhancement}

def paired_accuracy(predictions, settings):
    selected=[r for r in predictions if any(all(r[k]==s[k] for k in ("appearance","count","method","seconds","policy")) for s in settings)]
    result=[]
    for count,method in itertools.product((2,4,6),METHODS):
        for left,right in itertools.combinations(FORMS,2):
            deltas=[]
            for group in sorted(set(r["group"] for r in selected)):
                a={r["cue"]:int(r["correct"]) for r in selected if r["count"]==count and r["method"]==method and r["group"]==group and r["appearance"]==left}
                b={r["cue"]:int(r["correct"]) for r in selected if r["count"]==count and r["method"]==method and r["group"]==group and r["appearance"]==right}
                if len(a)==count and len(b)==count:deltas.append(float(np.mean([a[i]-b[i] for i in range(count)])))
            if deltas:
                observed=abs(np.mean(deltas));permutation=[abs(np.mean(np.array(deltas)*signs)) for signs in itertools.product((-1,1),repeat=len(deltas))]
                result.append({"count":count,"method":method,"left":left,"right":right,"independentGroups":len(deltas),"groupAccuracyDeltas":deltas,"meanAccuracyDifference":float(np.mean(deltas)),"p":sum(v>=observed-1e-12 for v in permutation)/len(permutation)})
    previous=0.
    for i,row in enumerate(sorted(result,key=lambda r:r["p"])):previous=max(previous,min(1.,row["p"]*(len(result)-i)));row["holmP"]=previous
    return result

def export_csv(file, rows):
    if not rows: Path(file).write_text("",encoding="utf-8");return
    keys=list(dict.fromkeys(k for r in rows for k in r))
    with Path(file).open("w",encoding="utf-8-sig",newline="") as out:
        writer=csv.DictWriter(out,fieldnames=keys);writer.writeheader()
        writer.writerows([{k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()} for r in rows])

def report(file, summary):
    titles={"solid":"灰度块","card":"外围闪烁","card-face":"整牌闪烁"}
    def table(rows):
        body=""
        for r in rows:
            window_label='2.5 s 在线；'+str(r['seconds'])+' s 固定窗' if r['method']=='FBCCA-main' else str(r['seconds'])+' s'
            body+=f'<tr><td>{titles[r["appearance"]]}</td><td>{r["count"]}</td><td>{r["method"]}</td><td>{window_label}</td><td>{r["n"]}</td><td>{r["accuracy"]:.1%}</td><td>{r["rejectionRate"]:.1%}</td><td>{"—" if r["acceptedAccuracy"] is None else format(r["acceptedAccuracy"],".1%")}</td><td>{r["meanReplayComputeMs"]:.1f}</td></tr>'
        return '<table><thead><tr><th>形式</th><th>数量</th><th>算法</th><th>窗口</th><th>次数</th><th>逐试次正确率</th><th>拒识率</th><th>接受后正确率</th><th>回放计算 ms/试次</th></tr></thead><tbody>'+body+'</tbody></table>'
    text='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>刺激实验分析</title><style>body{background:#f7f5f0;color:#37453a;font:16px system-ui;max-width:1400px;margin:32px auto;padding:20px}h1,h2{color:#793238}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{padding:9px;border:1px solid #d4d0c5;text-align:left}pre{white-space:pre-wrap}details{margin:20px 0}</style>'
    text+=f'<h1>{"最终锁定测试" if summary["final"] else "开发集分析"} · 刺激形式与算法</h1><p>实验 {html.escape(summary["runId"])} · 有效主动试次 {summary["validActiveTrials"]} · 排除 {len(summary["excludedTrials"])}</p>'
    text+='<p>固定 P3/P4/Oz/Pz，单位 μV、μV²/Hz、dB。主要频谱区域为 Oz/Pz 平均功率。不同数量比较的是完整配置。网关到达估计对齐，未经硬件同步；尚不能仅凭谱峰证明神经来源。</p>'
    text+='<h2>主要结果：开发集选定窗口与策略</h2><p>逐试次正确率按首 6 秒内首次接受的选择计算；首次选错不会被后续正确窗口修正。FBCCA 在线固定为生产 2.5 秒窗口；2/3/4 秒固定窗的无拒识正确率是另列的辅助指标。</p>'+table(summary["selectedMetrics"])
    text+='<h2>质量与舒适度</h2><pre>'+html.escape(json.dumps(summary["quality"],ensure_ascii=False,indent=2))+'</pre>'
    text+='<h2>三形式配对：基频局部 SNR</h2><pre>'+html.escape(json.dumps(summary["spectralComparisons"]["pairedFundamentalSnr"],ensure_ascii=False,indent=2))+'</pre>'
    text+='<details><summary>三形式配对：逐试次选牌正确率</summary><pre>'+html.escape(json.dumps(summary["classificationPairs"],ensure_ascii=False,indent=2))+'</pre></details>'
    text+='<details><summary>全部窗口与策略</summary>'+table(summary["metrics"])+'</details>'
    text+='<details><summary>混淆矩阵、逐目标指标及训练开销</summary><pre>'+html.escape(json.dumps({"metrics":summary["selectedMetrics"],"training":summary["training"]},ensure_ascii=False,indent=2))+'</pre></details>'
    text+='<details><summary>同次试次前后变化与静态参考增强</summary><pre>'+html.escape(json.dumps(summary["spectralComparisons"],ensure_ascii=False,indent=2))+'</pre></details>'
    text+='<details><summary>排除记录与不可用算法</summary><pre>'+html.escape(json.dumps({"excluded":summary["excludedTrials"],"unavailable":summary["unavailable"]},ensure_ascii=False,indent=2))+'</pre></details>'
    text+='<h2>解释边界</h2><p>未确认注视、断流或时序异常不计入正式结果。静态参考仅一次，不作为独立重复。前后窗不增加独立样本数。测试组只有两组，形式比较与训练算法优劣需结合重复实验。未测量无注视闪烁条件的误选率，拒识门槛不宣称已验证。算法分数不是概率。回放时间不等于在线端到端延迟。</p><p>PSD/CCA/TRCA使用因果 2–45 Hz 滤波；FBCCA-main使用生产的 6–45/14–45 Hz 滤波组与256点热身。45 Hz及以上谐波不用于SNR。完整窗8秒、早晚各4秒，不能直接比较不同窗长SNR。</p><p>方法：<a href="https://github.com/mnakanishi/TRCA-SSVEP">TRCA作者实现</a> · <a href="https://mne.tools/1.10/auto_tutorials/time-freq/50_ssvep.html">MNE邻频SNR</a>。详细频谱、逐试次预测及排除记录见同目录 CSV/JSON。</p></html>'
    Path(file).write_text(text,encoding="utf-8")

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--run",type=Path,required=True);parser.add_argument("--sessions",type=Path,required=True);parser.add_argument("--out",type=Path,required=True);parser.add_argument("--final",action="store_true");args=parser.parse_args()
    run=read_json(args.run)
    if run.get("protocol")!=PROTOCOL or run.get("schemaVersion")!=1: raise ValueError("Unsupported experiment protocol")
    args.out.mkdir(parents=True,exist_ok=True)
    final_file=args.out/"final-summary.json"
    if args.final and final_file.exists():
        if not (args.out/"final-report.html").exists(): raise ValueError("Frozen result is incomplete: report missing")
        print("Final evaluation already frozen; returning existing report.");return
    subprocess.run(["node","tools/stimulus_lab/fixture_protocol.mjs","--validate",str(args.run.resolve())],check=True,stdout=subprocess.PIPE)
    verified=None
    try: verified=verification()
    except Exception as error: verified={"passed":False,"reason":str(error),"version":ALGORITHM_VERSION}
    # Development loader never requests raw test data; selection sees no test labels.
    development,excluded=load_trials(run,args.sessions,False)
    active=[t for t in development if t["item"]["kind"]=="active"]
    if not active: raise ValueError("No confirmed valid development trials")
    for t in development: t["frequencies"]=[v["frequencyHz"] for v in t["start"]["targets"]]
    replay_dir=args.out/"replay";replay_dir.mkdir(exist_ok=True)
    def replay_trials(trials,name):
        manifest={"trials":[]}
        for t in trials:
            file=t["trialId"]+".f32"; t["raw"].astype("<f4").tofile(replay_dir/file)
            manifest["trials"].append({"trialId":t["trialId"],"file":file,"fs":t["fs"],"frequencies":t["frequencies"]})
        manifest_file=replay_dir/(name+"-input.json"); write_json(manifest_file,manifest)
        output=replay_dir/(name+"-output.json")
        subprocess.run(["node","tools/stimulus_lab/fbcca.mjs",str(manifest_file.resolve()),str(output.resolve())],check=True)
        return read_json(output)
    replay=replay_trials(active,"development")
    cv=[]; unavailable=[]; training_info=[]
    for appearance,count in itertools.product(FORMS,(2,4,6)):
        rows=[t for t in active if t["item"]["appearance"]==appearance and t["item"]["count"]==count]
        for group in sorted(set(t["item"]["group"] for t in rows)):
            testing=[t for t in rows if t["item"]["group"]==group]; training=[t for t in rows if t["item"]["group"]!=group]
            predictions,missing=evaluate_configuration(testing,training,verified["passed"],replay); cv.extend(predictions)
            unavailable.extend([{**m,"appearance":appearance,"count":count,"heldOutGroup":group} for m in missing])
    dev_metrics=aggregate(cv); settings=choose_settings(dev_metrics)
    prefix="development"; trials=development; predictions=cv
    if args.final:
        needed={i["id"] for i in run["items"] if i["kind"]=="active"}
        confirmed={a["itemId"] for a in run["attempts"] if a["status"]=="complete" and a["attention"]=="confirmed"}
        if not needed.issubset(confirmed): raise ValueError("Final evaluation requires all 216 active plan items confirmed and completed")
        lock_file=args.out/"evaluation-lock.json"
        source_files=[Path(f) for f in ("tools/stimulus_lab/algorithms.py","tools/stimulus_lab/fbcca.mjs","tools/stimulus_lab/fixture_protocol.mjs","desktop/main/labRecord.ts","renderer/src/lab/protocol.ts","renderer/src/game/stimulusTemplate.ts","renderer/src/bci/stimulus/types.ts","renderer/src/components/StimulusTable.tsx","renderer/src/bci/stimulus/phase.ts","renderer/src/bci/stimulus/modulation.ts","renderer/src/bci/stimulus/geometry.ts","renderer/src/bci/signal/fbcca.ts","renderer/src/bci/signal/decisionPolicy.ts")]+[Path(__file__)]
        digest=hashlib.sha256(args.run.read_bytes()+b"".join(f.read_bytes() for f in source_files))
        # Content hashes freeze the recorded data as well as labels/settings; bytes are not used for tuning.
        for sid in sorted(set(a["sessionId"] for a in run["attempts"] if a["status"]=="complete")):
            if len(sid)!=36 or any(c not in "0123456789abcdef-" for c in sid.lower()): raise ValueError("Invalid session id")
            for name in ("session.json","markers.jsonl","eeg.bin"):
                digest.update((sid+name).encode())
                with (args.sessions/sid/name).open("rb") as source:
                    for block in iter(lambda:source.read(1024*1024),b""): digest.update(block)
        fingerprint=digest.hexdigest()
        lock={"runId":run["id"],"fingerprint":fingerprint,"settings":settings,"algorithmVersion":ALGORITHM_VERSION,"lockedAt":time.strftime("%Y-%m-%dT%H:%M:%S")}
        if lock_file.exists():
            previous=read_json(lock_file)
            if previous["fingerprint"]!=fingerprint: raise ValueError("Locked evaluation inputs or code changed; cannot retune on test data")
            settings=previous["settings"]
        else: write_json(lock_file,lock)
        trials,excluded=load_trials(run,args.sessions,True)
        for t in trials: t["frequencies"]=[v["frequencyHz"] for v in t["start"]["targets"]]
        if {t["item"]["id"] for t in trials if t["item"]["kind"]=="active"}!=needed: raise ValueError("Final evaluation aborted: some confirmed trials failed marker/data quality checks")
        test=[t for t in trials if t["item"]["split"]=="test"]
        test_replay=replay_trials(test,"test");predictions=[];prefix="final"
        for appearance,count in itertools.product(FORMS,(2,4,6)):
            testing=[t for t in test if t["item"]["appearance"]==appearance and t["item"]["count"]==count]
            training=[t for t in active if t["item"]["appearance"]==appearance and t["item"]["count"]==count]
            predicted,missing=evaluate_configuration(testing,training,verified["passed"],test_replay);predictions.extend(predicted)
            unavailable.extend([{**m,"appearance":appearance,"count":count,"stage":"test"} for m in missing])
    unique_training={}
    for r in predictions:
        if r["method"] in ("TRCA","eTRCA"):
            key=(r["appearance"],r["count"],r["method"],r["seconds"],r["group"] if not args.final else 0)
            unique_training[key]={k:r[k] for k in ("appearance","count","method","seconds","trainingSeconds","trainingTrials")}
            unique_training[key]["heldOutGroup"]=r["group"] if not args.final else "5–6"
    training_info=list(unique_training.values())
    metrics=aggregate(predictions)
    selected=[r for r in metrics if any(all(r[k]==s[k] for k in ("appearance","count","method","seconds","policy")) for s in settings)]
    spectra=spectral_rows(trials)
    comparison_spectra=spectra if not args.final else [r for r in spectra if r["group"] in (0,5,6)]
    valid_active=[t for t in trials if t["item"]["kind"]=="active" and (not args.final or t["item"]["split"]=="test")]
    summary={"schemaVersion":1,"protocol":PROTOCOL,"runId":run["id"],"baselineCommit":run["baselineCommit"],"final":args.final,
             "channels":list(ANALYSIS_LEADS),"roiLeads":["Oz","Pz"],"validActiveTrials":len(valid_active),"verification":verified,
             "settings":settings,"metrics":metrics,"selectedMetrics":selected,"developmentMetrics":dev_metrics,
             "excludedTrials":excluded,"unavailable":unavailable,"training":training_info,
             "classificationPairs":paired_accuracy(predictions,settings),
             "spectralComparisons":paired_spectra(comparison_spectra),
             "quality":{"plannedActiveEvaluationTrials":72 if args.final else 144,
                        "validActiveEvaluationTrials":len(valid_active),
                        "excludedRecordFraction":len(excluded)/max(1,len(trials)+len(excluded)),
                        "invalidAttemptFraction":sum(a["status"]!="complete" or a["attention"]=="excluded" for a in run["attempts"])/max(1,len(run["attempts"])),
                        "renderedFrames":sum(t["end"].get("renderedFrames",0) for t in valid_active),
                        "suspectedDroppedFrames":sum(t["end"].get("suspectedDroppedFrames",0) for t in valid_active),
                        "maxDrawDurationMs":max((t["end"].get("maxDrawDurationMs",0) for t in valid_active),default=0),
                        "comfortByForm":{f:[t["attempt"].get("comfort") for t in valid_active if t["item"]["appearance"]==f] for f in FORMS},
                        "synchronization":"gateway-arrival-estimate","hardwareSynchronized":False}}
    export_csv(args.out/(prefix+"-predictions.csv"),predictions);export_csv(args.out/(prefix+"-spectra.csv"),spectra);export_csv(args.out/(prefix+"-excluded.csv"),excluded)
    report(args.out/(prefix+"-report.html"),summary)
    # The summary is the completion sentinel, written only after every export succeeded.
    write_json(args.out/(prefix+"-summary.json"),summary)
    print(json.dumps({"valid":len(valid_active),"report":str(args.out/(prefix+"-report.html"))},ensure_ascii=False))

if __name__=="__main__": main()
