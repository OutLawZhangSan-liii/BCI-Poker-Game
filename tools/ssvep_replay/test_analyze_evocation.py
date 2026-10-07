import unittest
import json
import tempfile
from pathlib import Path
import numpy as np
from tools.ssvep_replay.analyze_evocation import spectral_metrics, paired_randomization, holm_adjust, exclusions, analyze, PROTOCOL


class EvocationAnalysisTests(unittest.TestCase):
    def test_powers_preserve_opposite_phases_and_ignore_dc_offsets(self):
        fs = 250
        t = np.arange(fs*10)/fs
        s = 3*np.sin(2*np.pi*12*t)+np.sin(2*np.pi*24*t)
        noise = np.random.default_rng(17).normal(0, .2, (len(t), 4))
        raw = np.column_stack((s, -s, .5*s, -.5*s))+noise
        m, shifted = spectral_metrics(raw, fs), spectral_metrics(raw+10000, fs)
        self.assertGreater(m['12']['roiSnrDb'], 15)
        self.assertGreater(m['12']['roiPsdUv2PerHz'], 1)
        np.testing.assert_allclose(m['24']['psdUv2PerHz'], shifted['24']['psdUv2PerHz'], atol=1e-9)

    def test_five_pairs_cannot_pass_four_holm_corrected_tests(self):
        one = paired_randomization([5, 5, 5, 5, 5])
        self.assertEqual(one['pOneSided'], 1/32)
        self.assertGreater(min(holm_adjust([one['pOneSided']]*4)), .05)
        self.assertEqual(paired_randomization([0]*5)['pOneSided'], 1)
        self.assertEqual(paired_randomization([-2]*5)['pOneSided'], 1)

    def test_additional_independent_pairs_can_support_corrected_inference(self):
        p = paired_randomization([5]*10)['pOneSided']
        self.assertLess(max(holm_adjust([p]*4)), .05)
        np.testing.assert_allclose(holm_adjust([.01, .04, .02, .7]), [.04, .08, .06, .7])

    def test_static_control_is_valid_and_timing_mismatch_is_excluded(self):
        item = {'condition': 'static', 'durationSeconds': 10, 'frameDrops': 0,
                'frameStats': {'endReason': 'diagnostic_complete', 'durationMs': 9999, 'lastEegAgeMs': 16},
                'responsiveStimulusGeometry': {'cssWidth': 1200}, 'rendererCallbackDelayMs': 1,
                'lastEegAgeMs': 12, 'lastEegPacketDurationMs': 16,
                'targets': [{'id': 'diagnostic_center', 'frequencyHz': 0, 'x': .5, 'y': .5}],
                'modulationAmplitude': 0, 'activeTargetIds': []}
        self.assertEqual(exclusions(item), [])
        self.assertIn('sample_marker_duration_mismatch', exclusions({**item, 'durationSeconds': 10.34}))
        self.assertIn('stale_or_missing_eeg_timing', exclusions({**item, 'lastEegAgeMs': 340}))

    def test_export_analysis_keeps_controls_and_excludes_a_bad_trial(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            trials = []
            rng = np.random.default_rng(18)
            time = np.arange(2500)/250
            for repetition in range(1, 6):
                for condition, hz in (('static', 0), ('12hz', 12), ('15hz', 15)):
                    file = f'{repetition}-{condition}.f32'
                    raw = rng.normal(0, .3, (2500, 4))
                    if hz: raw += 2*np.sin(2*np.pi*hz*time)[:, None]
                    raw.astype('<f4').tofile(directory/file)
                    trials.append({'trialId': file, 'file': file, 'comparisonProtocol': PROTOCOL,
                        'comparisonRunId': 'fixture', 'repetition': repetition, 'condition': condition,
                        'durationSeconds': 10.34 if repetition == 1 and hz == 15 else 10,
                        'frameDrops': 0, 'frameStats': {'endReason': 'diagnostic_complete', 'durationMs': 9999, 'lastEegAgeMs': 16},
                        'responsiveStimulusGeometry': {'cssWidth': 1200}, 'rendererCallbackDelayMs': 1,
                        'lastEegAgeMs': 12, 'lastEegPacketDurationMs': 16,
                        'targets': [{'id': 'center', 'frequencyHz': hz, 'x': .5, 'y': .5}],
                        'modulationAmplitude': .45 if hz else 0, 'activeTargetIds': ['center'] if hz else [],
                        'attentionConfirmed': False})
            (directory/'index.json').write_text(json.dumps({'sampleRateHz': 250, 'channels': ['O1', 'O2', 'P3', 'P4'], 'trials': trials}), encoding='utf8')
            report = analyze(directory)
            self.assertEqual(sum(t['spectra'] is not None for t in report['trials']), 14)
            self.assertEqual([t['result']['blocks'] for t in report['tests']], [5, 5, 4, 4])
            self.assertTrue(all(not t['attentionConfirmed'] for t in report['tests']))
            self.assertEqual(set(report['trials'][0]['spectra']), {'12', '24', '15', '30'})
            self.assertIn('Not computed', report['phaseInference'])


if __name__ == '__main__':
    unittest.main()
