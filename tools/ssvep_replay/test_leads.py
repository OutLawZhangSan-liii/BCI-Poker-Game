import unittest
import numpy as np
from device_gateway.analysis_leads import ANALYSIS_LEADS, analysis_channel_indices
from device_gateway.inspect_eeg import _dimensions
from tools.ssvep_replay.leads import export_roi
from tools.ssvep_replay.analyze_evocation import spectral_metrics
from tools.ssvep_replay.analyze_appearance import segmented_spectra


class AnalysisLeadTests(unittest.TestCase):
    def test_real_names_are_mapped_in_fixed_order_without_mutating_metadata(self):
        names = ['O1', ' pz ', 'P4', 'O2', ' OZ ', 'p3']
        original = names.copy()
        self.assertEqual(ANALYSIS_LEADS, ('P3', 'P4', 'Oz', 'Pz'))
        self.assertEqual(analysis_channel_indices(names), [5, 2, 4, 1])
        metadata = {'deviceProperties': {'sample_rate_hz':250, 'channel_count':6, 'lead_names':names}}
        self.assertEqual(_dimensions(metadata)[3], [5, 2, 4, 1])
        self.assertEqual(names, original)

    def test_old_electrodes_cannot_substitute_for_new_electrodes(self):
        with self.assertRaisesRegex(ValueError, 'Oz, Pz'):
            analysis_channel_indices(['O1','O2','P3','P4'])
        for missing in ANALYSIS_LEADS:
            with self.assertRaises(ValueError):
                analysis_channel_indices([lead for lead in ANALYSIS_LEADS if lead != missing])

    def test_historical_exports_keep_their_original_roi_and_labels(self):
        self.assertEqual(export_roi(['P3','P4','OZ','PZ']), ((2,3), ('Oz','Pz')))
        self.assertEqual(export_roi(['O1','O2','P3','P4']), ((0,1), ('O1','O2')))
        with self.assertRaises(ValueError):
            export_roi(['Oz','Pz','P3','P4'])

    def test_power_roi_uses_oz_pz_instead_of_first_two_columns(self):
        rng = np.random.default_rng(310)
        time = np.arange(2500)/250
        raw = rng.normal(0,.2,(2500,4))
        raw[:,0] += 15*np.sin(2*np.pi*12*time)
        raw[:,1] += 15*np.sin(2*np.pi*12*time)
        for metrics in [spectral_metrics(raw,250), segmented_spectra(raw,250)['full']]:
            self.assertAlmostEqual(metrics['12']['roiPsdUv2PerHz'], np.mean(metrics['12']['psdUv2PerHz'][2:]))
            self.assertLess(metrics['12']['roiPsdUv2PerHz'], np.mean(metrics['12']['psdUv2PerHz'][:2])/100)
        legacy = spectral_metrics(raw,250,(0,1))
        self.assertAlmostEqual(legacy['12']['roiPsdUv2PerHz'], np.mean(legacy['12']['psdUv2PerHz'][:2]))


if __name__ == '__main__':
    unittest.main()
