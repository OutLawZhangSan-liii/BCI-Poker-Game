"""Complete 225-item offline fixture; does not connect to hardware or establish SSVEP efficacy."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import uuid
import numpy as np

def fixture(root):
    spec=json.loads(subprocess.check_output(['node','tools/stimulus_lab/fixture_protocol.mjs'],text=True,encoding='utf-8'))
    run=spec['run'];sid='00000000-0000-0000-0000-000000000043';directory=root/'sessions'/sid;directory.mkdir(parents=True)
    run['sessions']=[sid];run['geometrySignatures']={count:json.dumps(g) for count,g in spec['geometry'].items()}
    (directory/'session.json').write_text(json.dumps({'status':'completed','sampleUnit':'μV','syntheticFixture':True,'deviceProperties':{'sample_rate_hz':250,'lead_names':['P3','P4','Oz','Pz']}}),encoding='utf-8')
    markers=[];first=0;seq=0;rng=np.random.default_rng(318)
    with (directory/'eeg.bin').open('wb') as out:
        out.write(b'BGEG\x01\x00')
        for item in run['items']:
            tid=str(uuid.uuid4());count=str(item['count']);targets=spec['templates'][count]['targets'];g=spec['geometry'][count]
            run['attempts'].append({'trialId':tid,'itemId':item['id'],'sessionId':sid,'startedAt':'2026-10-10T00:00:00Z','status':'complete','attention':'confirmed','comfort':0})
            start={'markerType':'stimulus_start','trialId':tid,'markerSampleIndex':first,'comparisonProtocol':run['protocol'],'comparisonRunId':run['id'],'planItemId':item['id'],'baselineCommit':run['baselineCommit'],'targetAppearance':item['appearance'],'targetCount':item['count'],'cuedTargetIndex':item['cue'],'targets':targets,'fixationMode':'fixed','responsiveStimulusGeometry':g,'modulatedRegionGeometry':[{'outer':t['ring'],'excluded':t['card']} if item['appearance']=='card' else {'outer':t['card'],'excluded':None} for t in g['targets']],'luminanceBaseline':.5,'modulationAmplitude':0 if item['kind']=='static' else .45,'rendererCallbackDelayMs':0}
            markers.append(start)
            t=np.arange(2500)/250;f=targets[item['cue']]['frequencyHz'];phase=targets[item['cue']]['phaseRad']
            signal=12*np.sin(2*np.pi*f*t+phase)+4*np.sin(4*np.pi*f*t+phase*.8)+2*np.sin(6*np.pi*f*t+.3)
            if item['kind']=='static':signal=signal*0
            data=(20000+signal[:,None]*np.array([.8,.9,1.,.95])+rng.normal(0,1.,(2500,4))).astype('<f4')
            for offset in range(0,2500,100):
                frame=b'\xaa\x05'+struct.pack('<HI',400,1600)+data[offset:offset+100].tobytes()+b'\x55'
                out.write(struct.pack('<QQQI',seq,first+offset,0,len(frame)));out.write(frame);seq+=1
            markers.append({'markerType':'stimulus_end','trialId':tid,'markerSampleIndex':first+2500,'endReason':'lab_complete','renderedFrames':600,'maxFrameIntervalMs':16.67,'rendererCallbackDelayMs':0,'suspectedDroppedFrames':0,'maxDrawDurationMs':2.})
            first+=2500
    (directory/'markers.jsonl').write_text('\n'.join(json.dumps(m) for m in markers),encoding='utf-8')
    run_file=root/'run.json';run_file.write_text(json.dumps(run),encoding='utf-8');return run_file

class EndToEnd(unittest.TestCase):
    def test_complete_protocol_replay_and_final_freeze(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run_file=fixture(root);output=root/'analysis'
            args=[sys.executable,'-m','tools.stimulus_lab.analyze','--run',str(run_file),'--sessions',str(root/'sessions'),'--out',str(output)]
            env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','PYTHONUTF8':'1'}
            subprocess.run(args,check=True,env=env)
            dev=json.loads((output/'development-summary.json').read_text(encoding='utf-8'))
            self.assertEqual(dev['validActiveTrials'],144);self.assertEqual(len(dev['settings']),36);self.assertTrue(dev['verification']['passed']);self.assertFalse(dev['excludedTrials'])
            subprocess.run(args+['--final'],check=True,env=env)
            result=json.loads((output/'final-summary.json').read_text(encoding='utf-8'));lock=json.loads((output/'evaluation-lock.json').read_text(encoding='utf-8'))
            self.assertEqual(result['validActiveTrials'],72);self.assertEqual(result['settings'],dev['settings']);self.assertEqual(lock['settings'],dev['settings']);self.assertEqual(len(result['selectedMetrics']),36)
            self.assertFalse(result['unavailable']);self.assertFalse(result['excludedTrials'])
            for row in result['selectedMetrics']:
                self.assertEqual(row['n'],row['count']*2)
                self.assertGreaterEqual(row['accuracy'],.95,row)
            for suffix in ('report.html','spectra.csv','predictions.csv','excluded.csv','summary.json'):self.assertTrue((output/('final-'+suffix)).exists())
            self.assertTrue(result['spectralComparisons']['earlyLate']);self.assertTrue(result['spectralComparisons']['pairedFundamentalSnr']);self.assertTrue(result['training'])
            self.assertEqual(len(result['classificationPairs']),36)
            before=(output/'final-summary.json').read_bytes();subprocess.run(args+['--final'],check=True,env=env);self.assertEqual(before,(output/'final-summary.json').read_bytes())
            # After a failed/incomplete final export, changing inputs cannot bypass the lock.
            (output/'final-summary.json').unlink();run=json.loads(run_file.read_text());run['revision']+=1;run_file.write_text(json.dumps(run))
            rejected=subprocess.run(args+['--final'],capture_output=True,text=True,env=env)
            self.assertNotEqual(rejected.returncode,0);self.assertIn('cannot retune',rejected.stderr)

if __name__=='__main__':unittest.main()
