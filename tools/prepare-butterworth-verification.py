"""Read-only source report + independent scipy SOS reference for trial deployment."""
import argparse,csv,json,hashlib
from pathlib import Path
import numpy as np
from scipy import signal
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();source=Path(a.source);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((source/'fbcca-diagnosis-20261012/manifest.json').read_text(encoding='utf-8'))['trials']
windows={t['trialId']:[] for t in manifest}
for r in csv.DictReader((source/'iir-policy-ablation-20261018/window-scores.csv').open(encoding='utf-8-sig')):
 if r['filter']=='fb_butter': windows[r['trialId']].append({'end':round(float(r['endSeconds'])*250),'scores':json.loads(r['rawScores'])})
decisions={}
for r in csv.DictReader((source/'iir-policy-ablation-20261018/trial-decisions.csv').open(encoding='utf-8-sig')):
 if r['filter']=='fb_butter' and r['normalization']=='raw' and float(r['share'])==.25 and float(r['margin'])==.08: decisions[r['trialId']]={'candidate':int(r['candidate']),'correct':int(r['correct']),'wrong':int(r['wrong']),'rejected':int(r['rejected'])}
fixtures=[]
for fs in [250,500,1000]:
 n=np.arange(1500);x=np.array([4000+c*300+20*np.sin(2*np.pi*12*n/fs+c*.4)+3*np.cos(2*np.pi*31*n/fs) for c in range(4)],dtype=np.float32);base=x.astype(float)-x[:,0,None]
 banks=[np.concatenate([signal.butter(4,lo,'highpass',fs=fs,output='sos'),signal.butter(4,45,'lowpass',fs=fs,output='sos')]) for lo in [6,14]]
 fixtures.append({'fs':fs,'input':x.tolist(),'output':[signal.sosfilt(b,base,axis=1).tolist() for b in banks]})
for t in manifest:
 t['sha256']=hashlib.sha256(Path(t['file']).read_bytes()).hexdigest();t['windows']=windows[t['trialId']];t['expected']=decisions[t['trialId']]
assert len(decisions)==360 and sum(map(len,windows.values()))==3600
(out/'reference.json').write_text(json.dumps({'fixtures':fixtures,'trials':manifest,'sources':{str(source/'iir-policy-ablation-20261018/trial-decisions.csv'):hashlib.sha256((source/'iir-policy-ablation-20261018/trial-decisions.csv').read_bytes()).hexdigest()}},ensure_ascii=False),encoding='utf-8')
print('Prepared scipy references and 360 real trial identities')
