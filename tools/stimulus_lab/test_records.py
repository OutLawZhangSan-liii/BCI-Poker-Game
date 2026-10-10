import json
import struct
import tempfile
import unittest
from pathlib import Path
import numpy as np
from .analyze import load_trials,evaluate_configuration,aggregate,MAIN_BASELINE
from .algorithms import verification

class RecordsTest(unittest.TestCase):
    def fixture(self,root,groups=(1,2,3),broken=False):
        sid='00000000-0000-0000-0000-000000000001';directory=root/sid;directory.mkdir()
        fs=250;leads=['O1',' pZ ','P4','O2',' Oz ','p3']
        (directory/'session.json').write_text(json.dumps({'status':'completed','sampleUnit':'μV','deviceProperties':{'sample_rate_hz':fs,'lead_names':leads}}),encoding='utf-8')
        geometry={'version':'responsive-geometry-v1','targetCount':2,'targets':[{'card':{'x':i*200,'y':0,'width':100,'height':140},'ring':{'x':i*200-30,'y':-30,'width':160,'height':200}} for i in range(2)]}
        run={'id':'run','protocol':'multi-target-form-algorithm-v1','baselineCommit':MAIN_BASELINE,'geometrySignatures':{'2':json.dumps(geometry)},'items':[],'attempts':[]};markers=[];first=0;seq=0;rng=np.random.default_rng(842)
        with (directory/'eeg.bin').open('wb') as out:
            out.write(b'BGEG\x01\x00')
            for group in groups:
                for cue,f in enumerate([12,15]):
                    tid=f'g{group}-{cue}';item={'id':tid,'group':group,'count':2,'cue':cue,'appearance':'solid','kind':'active','split':'test' if group>4 else 'development'}
                    run['items'].append(item);run['attempts'].append({'trialId':tid,'itemId':tid,'sessionId':sid,'status':'complete','attention':'confirmed'})
                    targets=[{'frequencyHz':12,'phaseRad':0},{'frequencyHz':15,'phaseRad':np.pi/2}]
                    markers.append({'markerType':'stimulus_start','trialId':tid,'markerSampleIndex':first,'comparisonProtocol':run['protocol'],'comparisonRunId':run['id'],'planItemId':tid,'targetAppearance':'solid','targetCount':2,'cuedTargetIndex':cue,'fixationMode':'fixed','responsiveStimulusGeometry':geometry,'baselineCommit':MAIN_BASELINE,'modulatedRegionGeometry':[{'outer':t['card'],'excluded':None} for t in geometry['targets']],'targets':targets,'modulationAmplitude':.45,'luminanceBaseline':.5,'rendererCallbackDelayMs':0})
                    t=np.arange(2500)/fs;wave=np.sin(2*np.pi*f*t)
                    data=np.zeros((2500,6),dtype='<f4')
                    for index,scale in [(1,.8),(2,.9),(4,1.),(5,.7)]:data[:,index]=20000+wave*scale*12+rng.normal(0,.8,2500)
                    for offset in range(0,2500,100):
                        frame=b'\xaa\x05'+struct.pack('<HI',600,2400)+data[offset:offset+100].tobytes()+b'\x55'
                        out.write(struct.pack('<QQQI',seq+(1 if broken and offset==500 else 0),first+offset,0,len(frame)));out.write(frame);seq+=1
                    markers.append({'markerType':'stimulus_end','trialId':tid,'markerSampleIndex':first+2500,'endReason':'lab_complete','maxFrameIntervalMs':16.67,'rendererCallbackDelayMs':0})
                    first+=2500
        (directory/'markers.jsonl').write_text('\n'.join(json.dumps(m) for m in markers),encoding='utf-8')
        return run
    def test_exact_channel_mapping_and_development_never_loads_test_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=self.fixture(root)
            run['items'].append({'id':'heldout','split':'test'});run['attempts'].append({'trialId':'heldout','itemId':'heldout','sessionId':'missing-test-session','status':'complete','attention':'confirmed'})
            trials,excluded=load_trials(run,root)
            self.assertEqual(len(trials),6);self.assertFalse(excluded)
            self.assertEqual(trials[0]['raw'].shape,(2500,4));self.assertTrue(np.isfinite(trials[0]['filtered']).all())
            # Flat O1/O2 are ignored; selected real posterior leads contain AC signal.
            self.assertTrue((np.std(trials[0]['raw'],axis=0)>5).all())
    def test_interrupted_attention_and_sequence_gap_are_not_valid_trials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=self.fixture(root,groups=(1,),broken=True)
            trials,excluded=load_trials(run,root);self.assertEqual(len(trials),0);self.assertEqual(len(excluded),2)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=self.fixture(root,groups=(1,));run['attempts'][0]['attention']='pending';run['attempts'][1]['status']='invalid'
            trials,excluded=load_trials(run,root);self.assertFalse(trials);self.assertEqual(len(excluded),2)
    def test_phase_matched_rolling_trca_has_independent_training_trials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=self.fixture(root);trials,_=load_trials(run,root)
            for t in trials:t['frequencies']=[12,15]
            training=[t for t in trials if t['item']['group']!=3];testing=[t for t in trials if t['item']['group']==3]
            # FBCCA fixture is separate; production parity is tested through the actual worker in Node.
            replay={t['trialId']:{'windows':{str(s):{'candidateIndex':t['item']['cue'],'confidence':.8,'margin':.5,'elapsedMs':1} for s in [2,3,4]},'online':[{'candidateIndex':t['item']['cue'],'confidence':.8,'margin':.5,'flat':False,'elapsedMs':1,'endSeconds':end} for end in [3.5,3.75]],'policy':{'confidenceThreshold':.52,'marginThreshold':.08,'requiredVotes':2}} for t in testing}
            rows,missing=evaluate_configuration(testing,training,verification()['passed'],replay)
            self.assertFalse(missing)
            for method in ('CCA','TRCA','eTRCA'):
                sub=[r for r in rows if r['method']==method and r['policy']=='0.0']
                self.assertTrue(all(r['correct'] for r in sub),method)
                if method!='CCA':self.assertTrue(all(r['trainingTrials']==4 for r in sub))
            self.assertTrue(all(r['accuracy']==1 for r in aggregate(rows)))

    def test_geometry_phase_and_region_changes_are_excluded(self):
        for key,value,reason in [('baselineCommit','changed','main_baseline_mismatch'),('modulatedRegionGeometry',[],'modulated_region_mismatch')]:
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);run=self.fixture(root,groups=(1,));file=next(root.glob('*/markers.jsonl'))
                markers=[json.loads(line) for line in file.read_text().splitlines()];markers[0][key]=value
                file.write_text('\n'.join(json.dumps(m) for m in markers))
                trials,excluded=load_trials(run,root);self.assertEqual(len(trials),1);self.assertEqual(excluded[0]['reason'],reason)

if __name__=='__main__':unittest.main()
