import copy
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from tools.ssvep_replay.analyze_appearance import (
    PROTOCOL, CARD_FACE_PROTOCOL, THREE_FORM_PROTOCOL, WINDOWS, analyze, segmented_spectra, metadata_exclusions, paired_two_sided,
)
from tools.ssvep_replay.analyze_evocation import spectral_metrics, holm_adjust


def fixture(directory):
    rng = np.random.default_rng(71)
    time = np.arange(2500)/250
    trials = []
    for repetition in range(1, 9):
        common_noise = rng.normal(0, .4, (2500, 4))
        for appearance in ('card', 'solid'):
            for condition, hz in (('static', 0), ('12hz', 12), ('15hz', 15)):
                filename = f'{repetition}-{appearance}-{condition}.f32'
                raw = common_noise.copy()
                if hz:
                    # Synthetic spectral fixture; never interpreted as human data.
                    amplitude = (2 if appearance=='card' else 1)*np.where(time<5.5, 1, 3)
                    waveform = amplitude*(np.sin(2*np.pi*hz*time)+.6*np.sin(4*np.pi*hz*time))
                    raw += np.column_stack((waveform, -waveform, waveform*.7, waveform*.5))
                raw.astype('<f4').tofile(directory/filename)
                trials.append({
                    'trialId': filename, 'file': filename, 'comparisonProtocol': PROTOCOL,
                    'comparisonRunId': 'synthetic-only', 'repetition': repetition, 'condition': condition,
                    'sequenceIndex': len(trials), 'comparisonSegment': 1 if repetition<=4 else 2,
                    'targetAppearance': appearance, 'analysisWindowsSeconds': WINDOWS,
                    'fixationPoint': 'light-dark-concentric', 'luminanceBaseline': .5,
                    'plannedDurationMs': 10000, 'samples': 2500, 'durationSeconds': 10,
                    'startSampleIndex': len(trials)*6000, 'endSampleIndex': len(trials)*6000+2500,
                    'frameDrops': 0, 'frameStats': {'endReason': 'diagnostic_complete',
                        'durationMs': 10000, 'lastEegAgeMs': 16, 'rendererCallbackDelayMs': 1},
                    'responsiveStimulusGeometry': {'cssWidth': 1200}, 'rendererCallbackDelayMs': 1,
                    'lastEegAgeMs': 12, 'lastEegPacketDurationMs': 16,
                    'targets': [{'id': 'center', 'frequencyHz': hz, 'x': .5, 'y': .5, 'phaseRad': 0, 'label': '7♣'}],
                    'modulationAmplitude': .45 if hz else 0, 'activeTargetIds': ['center'] if hz else [],
                    'attentionConfirmed': False,
                })
    return {'sampleRateHz': 250, 'channels': ['O1', 'O2', 'P3', 'P4'], 'trials': trials}


def three_fixture(directory):
    index=fixture(directory); old=index['trials']; trials=[]
    card={'x':100,'y':100,'width':160,'height':225}
    ring={'x':80,'y':80,'width':200,'height':265}
    for rep in range(1,9):
        for appearance in ('card','card-face','solid'):
            for condition in ('static','12hz','15hz'):
                t=copy.deepcopy(next(t for t in old if t['repetition']==rep and t['condition']==condition and t['targetAppearance']==('card' if appearance=='card-face' else appearance)))
                if appearance=='card-face':
                    data=np.fromfile(directory/t['file'],dtype='<f4')
                    t['file']=f'{rep}-face-{condition}.f32'; t['trialId']=t['file']
                    (data*(2 if condition!='static' else 1)).tofile(directory/t['file'])
                peripheral=appearance=='card'
                t.update(comparisonProtocol=THREE_FORM_PROTOCOL,targetAppearance=appearance,sequenceIndex=len(trials),
                         startSampleIndex=len(trials)*6000,endSampleIndex=len(trials)*6000+2500,
                         stimulusFootprint='seat' if peripheral else 'card',outerFlicker=peripheral,
                         brightnessMethod={'card':'static-card-overlay','card-face':'black-overlay-linear-rgb-v1','solid':'uniform-rgb-v1'}[appearance],
                         rgbLevelMapping='42+178*luminance-v1',rgbChannelStyle='legacy-blue-plus5' if peripheral else 'achromatic',
                         responsiveStimulusGeometry={'targets':[{'card':card,'ring':ring}]},
                         modulatedRegionGeometry=[{**(ring if peripheral else card),'cornerRadius':16 if peripheral else 10}],
                         excludedFromModulationGeometry=[{**card,'cornerRadius':10}] if peripheral else [])
                trials.append(t)
    index['trials']=trials;return index


class AppearanceAnalysisTests(unittest.TestCase):
    def test_three_form_protocol_has_all_pairwise_and_temporal_comparisons(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary); index=three_fixture(directory)
            self.assertTrue(all(not metadata_exclusions(t) for t in index['trials']))
            (directory/'index.json').write_text(json.dumps(index),encoding='utf8')
            report=analyze(directory,THREE_FORM_PROTOCOL)
            self.assertEqual(len(report['trials']),72)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']],[8]*12)
            self.assertEqual([t['result']['blocks'] for t in report['timeTests']],[8]*12)
            self.assertEqual({(t['firstAppearance'],t['secondAppearance']) for t in report['formTests']},
                             {('card-face','card'),('card-face','solid'),('card','solid')})
            self.assertGreaterEqual(min(t['pHolm'] for t in report['formTests']),12*2/256)
            self.assertEqual(len((directory/'appearance-trial-spectra.csv').read_text(encoding='utf-8-sig').splitlines()),5185)
            self.assertEqual(len(analyze(directory,CARD_FACE_PROTOCOL)['trials']),0)

    def test_three_form_bad_trial_excludes_only_its_related_pairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary); index=three_fixture(directory)
            index['trials'][5]['outerFlicker']=True  # first card-face15 trial
            self.assertIn('unmatched_three_form_footprint',metadata_exclusions(index['trials'][5]))
            (directory/'index.json').write_text(json.dumps(index),encoding='utf8')
            report=analyze(directory,THREE_FORM_PROTOCOL)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']],[8,8,7,7,8,8,7,7,8,8,8,8])
            self.assertEqual([t['result']['blocks'] for t in report['timeTests']],[8,8,8,8,8,8,7,7,8,8,8,8])
            self.assertIn('unmatched_occlusion_geometry',metadata_exclusions({**index['trials'][0],'excludedFromModulationGeometry':[]}))

    def test_face_protocol_requires_equal_modulated_regions_and_remains_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary); index=fixture(directory)
            for t in index['trials']:
                t['comparisonProtocol']=CARD_FACE_PROTOCOL
                t['targetAppearance']='card-face' if t['targetAppearance']=='card' else 'solid'
                t.update(stimulusFootprint='card', outerFlicker=False, rgbLevelMapping='42+178*luminance-v1',
                         brightnessMethod='black-overlay-linear-rgb-v1' if t['targetAppearance']=='card-face' else 'uniform-rgb-v1')
                region={'x':100,'y':100,'width':160,'height':225}
                t['responsiveStimulusGeometry']={'targets':[{'card':region}]}
                t['modulatedRegionGeometry']=[{**region,'cornerRadius':10}]
            self.assertEqual(metadata_exclusions(index['trials'][0]),[])
            self.assertIn('unmatched_face_footprint',metadata_exclusions({**index['trials'][0],'outerFlicker':True}))
            self.assertIn('unmatched_modulated_region',metadata_exclusions({**index['trials'][0],'modulatedRegionGeometry':[]}))
            (directory/'index.json').write_text(json.dumps(index),encoding='utf8')
            self.assertEqual(len(analyze(directory)['trials']),0)
            report=analyze(directory,CARD_FACE_PROTOCOL)
            self.assertEqual(report['protocol'],CARD_FACE_PROTOCOL)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']],[8]*4)
            self.assertEqual({t['targetAppearance'] for t in report['trials']},{'card-face','solid'})

    def test_filter_once_then_split_and_preserve_full_window(self):
        t = np.arange(2500)/250
        raw = np.column_stack([np.sin(2*np.pi*12*t)*(1 if i%2==0 else -1) for i in range(4)])
        raw += np.random.default_rng(9).normal(0, .02, raw.shape)
        result = segmented_spectra(raw, 250)
        shifted = segmented_spectra(raw+17000, 250)
        original = spectral_metrics(raw, 250)
        for hz in ('12', '24', '15', '30'):
            self.assertEqual(result['full'][hz], original[hz])
        np.testing.assert_allclose(result['late']['12']['psdUv2PerHz'], shifted['late']['12']['psdUv2PerHz'], atol=1e-9)
        self.assertGreater(result['early']['12']['roiSnrDb'], 20)
        with self.assertRaises(ValueError): segmented_spectra(raw[:1000], 250)
        with self.assertRaises(ValueError): segmented_spectra(raw[:0], 250)

    def test_two_sided_sign_swap_is_direction_symmetric(self):
        a = paired_two_sided([5]*8); b = paired_two_sided([-5]*8)
        self.assertEqual(a['pTwoSided'], 2/256)
        self.assertEqual(a['pTwoSided'], b['pTwoSided'])
        self.assertEqual(paired_two_sided([0]*8)['pTwoSided'], 1)
        self.assertLess(max(holm_adjust([a['pTwoSided']]*4)), .05)
        self.assertGreater(max(holm_adjust([a['pTwoSided']]*8)), .05)
        self.assertIsNone(paired_two_sided([]))

    def test_complete_protocol_has_eight_pairs_and_separate_early_late_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); index = fixture(directory)
            (directory/'index.json').write_text(json.dumps(index), encoding='utf8')
            report = analyze(directory)
            self.assertEqual(sum(t['spectra'] is not None for t in report['trials']), 48)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']], [8]*4)
            self.assertEqual([t['result']['blocks'] for t in report['timeTests']], [8]*8)
            self.assertTrue(all(t['result']['meanPowerChangeDb']>3 for t in report['formTests']))
            self.assertTrue(all(t['lateMeanEnhancementDb']>t['earlyMeanEnhancementDb']+5 for t in report['timeTests']))
            self.assertTrue(all(not t['attentionConfirmed'] for t in report['formTests']+report['timeTests']))
            self.assertEqual(set(report['trials'][0]['spectra']['full']), {'12','24','36','15','30','45'})
            self.assertEqual(report['trials'][0]['sampleWindows']['early'], {'startInclusive':375,'endExclusive':1375})
            self.assertEqual(report['trials'][0]['sampleWindows']['late'], {'startInclusive':1375,'endExclusive':2375})
            self.assertEqual(len((directory/'appearance-trial-spectra.csv').read_text(encoding='utf-8-sig').splitlines()), 3457)

    def test_bad_timing_and_unmatched_geometry_remove_only_affected_pairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); index = fixture(directory)
            index['trials'][5]['durationSeconds'] = 10.34  # solid 15 Hz, first block
            index['trials'][7]['responsiveStimulusGeometry'] = {'cssWidth': 1190}  # card12, second block
            (directory/'index.json').write_text(json.dumps(index), encoding='utf8')
            report = analyze(directory)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']], [7]*4)
            self.assertEqual([t['result']['blocks'] for t in report['timeTests']], [7,7,8,8,8,8,7,7])
            self.assertIn('sample_marker_duration_mismatch', report['trials'][5]['excludeReasons'])

    def test_duplicate_static_and_metadata_mismatch_are_not_pooled(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); index = fixture(directory)
            item = index['trials'][0]
            self.assertEqual(metadata_exclusions(item), [])
            self.assertIn('missing_run_id', metadata_exclusions({**item,'comparisonRunId':None}))
            self.assertIn('unmatched_execution_segment', metadata_exclusions({**item,'comparisonSegment':2}))
            self.assertIn('unmatched_analysis_windows', metadata_exclusions({**item,'analysisWindowsSeconds':{}}))
            index['trials'] = index['trials'][:24]+[copy.deepcopy(item)]
            (directory/'index.json').write_text(json.dumps(index), encoding='utf8')
            report = analyze(directory)
            self.assertEqual([t['result']['blocks'] for t in report['formTests']], [3]*4)
            self.assertEqual([t['result']['blocks'] for t in report['timeTests']], [3]*4+[4]*4)


if __name__ == '__main__': unittest.main()
