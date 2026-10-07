import unittest
import numpy as np
from tools.ssvep_replay.compare_stimuli import metrics, dimensions


class StimulusComparisonAnalysisTests(unittest.TestCase):
    def test_offsets_do_not_change_response_metrics(self):
        fs = 250
        t = np.arange(1500)/fs
        raw = np.column_stack([3*np.sin(2*np.pi*12*t+p) + np.sin(2*np.pi*24*t)
                               + .5*np.sin(2*np.pi*11.25*t) for p in (0, .2, .5, .9)])
        first, offset = metrics(raw, fs, 12), metrics(raw+5000, fs, 12)
        np.testing.assert_allclose(first['1']['bandRmsUv'], offset['1']['bandRmsUv'], atol=1e-10)
        self.assertEqual(first['2']['frequencyHz'], 24)
        self.assertGreater(first['1']['snrDb'][0], 10)

    def test_short_record_cannot_produce_metrics(self):
        with self.assertRaises(ValueError):
            metrics(np.ones((500, 4)), 250, 12)

    def test_geometry_includes_real_position_size_and_display_scale(self):
        shape = {'x': 10, 'y': 20, 'width': 100, 'height': 150}
        trial = {'cueIndex': 0, 'responsiveStimulusGeometry': {'cssWidth': 900, 'cssHeight': 500,
                 'devicePixelRatio': 1.25, 'targets': [{'card': shape, 'ring': shape}]}}
        self.assertEqual(dimensions(trial)[:3], [900, 500, 1.25])
        self.assertEqual(dimensions(trial)[3:7], [10, 20, 100, 150])
        self.assertIsNone(dimensions({'cueIndex': None}))


if __name__ == '__main__':
    unittest.main()
