import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
from tools.ssvep_replay.analyze_appearance import PROTOCOL, WINDOWS


class PrepareTests(unittest.TestCase):
    def test_new_protocol_exports_original_sample_axis_and_window_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); session = root/'session'; session.mkdir(); out = root/'export'
            raw = np.random.default_rng(19).normal(0, 1, (2600, 4)).astype('<f4')
            payload = raw.tobytes()
            frame = b'\xaa\x05'+struct.pack('<HI', raw.size, len(payload))+payload+b'\x55'
            (session/'eeg.bin').write_bytes(b'BGEG\x01\x00'+struct.pack('<QQQI', 1, 0, 1000000000, len(frame))+frame)
            (session/'session.json').write_text(json.dumps({'sessionId':'synthetic', 'deviceProperties':{
                'lead_names':['O1','O2','P3','P4'], 'sample_rate_hz':250}}), encoding='utf8')
            start = {'markerType':'stimulus_start','trialId':'synthetic-trial','markerSampleIndex':'100',
                     'gatewayMonotonicNs':1000000000,'rendererPerformanceMs':12,
                     'targets':[{'frequencyHz':12}], 'comparisonProtocol':PROTOCOL,
                     'comparisonSegment':2,'analysisWindowsSeconds':WINDOWS,
                     'fixationMode':'synchronous','fixationModulation':{'mode':'synchronous','phaseOffsetRad':0},
                     'eegFreshnessPolicy':'packet-jitter-tolerance-v1'}
            end = {'markerType':'stimulus_end','trialId':'synthetic-trial','markerSampleIndex':'2600',
                   'gatewayMonotonicNs':11000000000,'rendererPerformanceMs':10012,
                   'firstFramePerformanceMs':12,'lastFramePerformanceMs':10012}
            markers = '\n'.join(json.dumps(m) for m in (start,end))
            (session/'markers.jsonl').write_text(markers,encoding='utf8')
            subprocess.run([sys.executable,'tools/ssvep_replay/prepare.py','--session',str(session),'--out',str(out)],
                           check=True,capture_output=True)
            trial = json.loads((out/'index.json').read_text(encoding='utf8'))['trials'][0]
            self.assertEqual((trial['startSampleIndex'],trial['endSampleIndex']), (100,2600))
            self.assertEqual((trial['startGatewayMonotonicNs'],trial['endGatewayMonotonicNs']), (1000000000,11000000000))
            self.assertEqual((trial['startRendererPerformanceMs'],trial['endRendererPerformanceMs']), (12,10012))
            self.assertEqual(trial['analysisWindowsSeconds'],WINDOWS)
            self.assertEqual(trial['comparisonSegment'],2)
            self.assertEqual(trial['fixationMode'],'synchronous')
            self.assertEqual(trial['fixationModulation'],start['fixationModulation'])
            self.assertEqual(trial['eegFreshnessPolicy'],'packet-jitter-tolerance-v1')
            self.assertFalse(trial['attentionConfirmed'])
            np.testing.assert_array_equal(np.fromfile(out/trial['file'],dtype='<f4').reshape(-1,4),raw[100:2600])
            self.assertEqual((session/'markers.jsonl').read_text(encoding='utf8'),markers)


if __name__=='__main__': unittest.main()
