import copy
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from tools.ssvep_replay.test_analyze_appearance import three_fixture
from tools.ssvep_replay.analyze_appearance import SHORT_FIXATION_PROTOCOL, metadata_exclusions
from tools.ssvep_replay.analyze_short_fixation import analyze


def short_fixture(directory):
    index=three_fixture(directory);old=index['trials'];trials=[]
    plan=[(0,a,m,'static') for a in ('card','card-face','solid') for m in ('fixed','synchronous')]
    plan += [(r,a,m,c) for r in (1,2) for a in ('card','card-face','solid') for m in ('fixed','synchronous') for c in ('12hz','15hz')]
    for repetition,appearance,mode,condition in plan:
        t=copy.deepcopy(next(t for t in old if t['repetition']==max(1,repetition) and t['targetAppearance']==appearance and t['condition']==condition))
        t.update(trialId=f'short-{len(trials)}',comparisonProtocol=SHORT_FIXATION_PROTOCOL,fixationMode=mode,
                 fixationPoint='light-dark-concentric-sync' if mode=='synchronous' else 'light-dark-concentric',
                 eegFreshnessPolicy='packet-jitter-tolerance-v1',sequenceIndex=len(trials),repetition=repetition,
                 comparisonSegment=2 if repetition==2 else 1)
        t['responsiveStimulusGeometry']['targets'][0].update(centerX=180,centerY=212.5)
        t['fixationModulation']={'mode':mode,'phaseOffsetRad':0,
                                'method':'concentric-rgb-scaled-by-target-level-v1' if mode=='synchronous' else 'opaque-concentric-v1',
                                'geometry':[{'x':180,'y':212.5,'radius':10}]}
        t.update(startSampleIndex=len(trials)*6000,endSampleIndex=len(trials)*6000+2500)
        original=np.fromfile(directory/t['file'],dtype='<f4');t['file']=t['trialId']+'.f32'
        (original*(1.5 if mode=='synchronous' and condition!='static' else 1)).tofile(directory/t['file'])
        trials.append(t)
    index.update(trials=trials,sampleOrSequenceGaps=0,nonfiniteValues=0)
    return index


class ShortFixationTests(unittest.TestCase):
    def test_full_protocol_shares_references_without_counting_them_as_repeats(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);index=short_fixture(folder)
            self.assertTrue(all(not metadata_exclusions(t) for t in index['trials']))
            (folder/'index.json').write_text(json.dumps(index),encoding='utf8')
            r=analyze(folder)
            self.assertEqual((r['validTrials'],r['staticReferences']),(30,6))
            self.assertEqual(len(r['effects']),24)
            self.assertTrue(all(e['activeTrials']==2 and len(e['staticReferenceIds'])==1 for e in r['effects']))
            self.assertEqual(len(r['comparisons']),36)
            self.assertTrue(all(c['pairedActiveBlocks']==2 and 'pHolm' not in c for c in r['comparisons']))
            self.assertEqual(len(r['temporal']),48)
            self.assertEqual(r['trials'][6]['sampleWindows']['early'],{'startInclusive':36375,'endExclusive':37375})
            self.assertEqual(len((folder/'short-fixation-spectra.csv').read_text(encoding='utf-8-sig').splitlines()),2161)
            fixation=[c for c in r['comparisons'] if c['kind']=='fixation']
            self.assertTrue(all(c['meanReferenceAdjustedDifferenceDb']>3 for c in fixation))

    def test_interruption_and_bad_reference_do_not_turn_into_valid_pairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);index=short_fixture(folder)
            index['trials'][0]['frameStats']['endReason']='eeg_data_stale'
            index['trials'][6]['frameStats']['endReason']='display_timing_fault'
            (folder/'index.json').write_text(json.dumps(index),encoding='utf8')
            r=analyze(folder)
            self.assertEqual((r['validTrials'],r['staticReferences']),(28,5))
            effects=[e for e in r['effects'] if e['appearance']=='card' and e['fixationMode']=='fixed']
            self.assertTrue(all(e['referenceAdjustedTrials']==0 for e in effects))
            self.assertIn('interrupted',r['trials'][6]['excludeReasons'])

    def test_point_phase_and_freshness_policy_are_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            t=short_fixture(Path(tmp))['trials'][8]
            t['lastEegAgeMs']=605;t['lastEegPacketDurationMs']=400;t['frameStats']['lastEegAgeMs']=700
            self.assertNotIn('stale_or_missing_eeg_timing',metadata_exclusions(t))
            t['fixationModulation']['phaseOffsetRad']=1
            self.assertIn('unmatched_fixation_modulation',metadata_exclusions(t))
            t['frameStats']['lastEegAgeMs']=1201
            self.assertIn('stale_or_missing_eeg_timing',metadata_exclusions(t))

    def test_history_is_never_pooled(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);index=three_fixture(folder)
            (folder/'index.json').write_text(json.dumps(index),encoding='utf8')
            self.assertEqual(analyze(folder)['validTrials'],0)


if __name__=='__main__':unittest.main()
