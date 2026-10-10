# -*- coding: utf-8 -*-
"""Read-only export of complete real EEG trials; never connects to the device."""
import argparse
import json
import struct
from pathlib import Path
import numpy as np
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from device_gateway.analysis_leads import ANALYSIS_LEADS, analysis_channel_indices

def jsonl(path):
    result = []
    for line in path.read_text(encoding='utf-8').splitlines():
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--annotations', type=Path)
    parser.add_argument('--protocol')
    parser.add_argument('--run-id')
    parser.add_argument('--segment', type=int, choices=(1, 2))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((args.session/'session.json').read_text(encoding='utf-8'))
    props = meta['deviceProperties']
    leads = [name.strip().upper() for name in props['lead_names']]
    selected = analysis_channel_indices(leads)
    annotations = json.loads(args.annotations.read_text(encoding='utf-8')) if args.annotations else {}
    chunks, prior, gaps, bad = [], None, 0, 0
    snapshot_size = (args.session/'eeg.bin').stat().st_size
    with (args.session/'eeg.bin').open('rb') as source:
        if source.read(6) != b'BGEG\x01\x00':
            raise ValueError('Invalid EEG header')
        while source.tell() + 28 <= snapshot_size:
            seq, first, ns, size = struct.unpack('<QQQI', source.read(28))
            if source.tell() + size > snapshot_size:
                break
            frame = source.read(size)
            if len(frame) < 9 or frame[:2] != b'\xaa\x05' or frame[-1] != 0x55:
                raise ValueError('Invalid vendor frame')
            count, payload = struct.unpack('<HI', frame[2:8])
            if size != payload + 9 or payload != count * 4 or count % len(leads):
                raise ValueError('Invalid sample dimensions')
            block = np.frombuffer(frame, dtype='<f4', count=count, offset=8).reshape(-1, len(leads))[:, selected].copy()
            if prior is not None and (seq != prior[0] + 1 or first != prior[1]):
                gaps += 1
            bad += int((~np.isfinite(block)).sum())
            prior = seq, first + len(block)
            chunks.append((first, block))
    raw = np.full((prior[1], 4), np.nan, dtype='<f4')
    for first, block in chunks:
        raw[first:first+len(block)] = block
    markers = jsonl(args.session/'markers.jsonl')
    ends = {m['trialId']: m for m in markers if m.get('markerType') == 'stimulus_end'}
    results = {m['trialId']: m for m in markers if m.get('markerType') == 'game_result'}
    fs = props['sample_rate_hz']
    index = {'sessionId': meta['sessionId'], 'sampleRateHz': fs, 'channels': list(ANALYSIS_LEADS),
             'snapshotBytes': snapshot_size, 'sampleOrSequenceGaps': gaps, 'nonfiniteValues': bad, 'trials': []}
    prior_end = 0
    for start in (m for m in markers if m.get('markerType') == 'stimulus_start'):
        if args.protocol and start.get('comparisonProtocol') != args.protocol: continue
        if args.run_id and start.get('comparisonRunId') != args.run_id: continue
        if args.segment and start.get('comparisonSegment') != args.segment: continue
        end = ends.get(start['trialId'])
        if not end:
            continue
        first, last = int(start['markerSampleIndex']), min(int(end['markerSampleIndex']), len(raw))
        baseline_first = max(prior_end + fs, first - 20*fs)
        baseline_last = first - fs
        prior_end = last
        if last <= first or not np.isfinite(raw[first:last]).all():
            continue
        trial = {'trialId': start['trialId'], 'frequencies': [t['frequencyHz'] for t in start['targets']],
                 'cueIndex': start.get('cuedTargetIndex'), 'attentionConfirmed': bool(annotations.get(start['trialId'], {}).get('attentionConfirmed')),
                 'kind': start.get('trialKind'), 'gameMode': start.get('gameMode'), 'durationSeconds': (last-first)/fs,
                 'samples': last-first, 'file': start['trialId']+'.f32', 'baselineFile': None,
                 'startSampleIndex': first, 'endSampleIndex': last,
                 'startGatewayMonotonicNs': start.get('gatewayMonotonicNs'), 'endGatewayMonotonicNs': end.get('gatewayMonotonicNs'),
                 'startRendererPerformanceMs': start.get('rendererPerformanceMs'), 'endRendererPerformanceMs': end.get('rendererPerformanceMs'),
                 'frameDrops': end.get('suspectedDroppedFrames'), 'gameResult': results.get(start['trialId'])}
        trial.update({key: start.get(key) for key in ('targetAppearance', 'comparisonRunId', 'comparisonProtocol',
                     'sequenceIndex', 'repetition', 'comparisonSegment', 'analysisWindowsSeconds', 'responsiveStimulusGeometry', 'plannedDurationMs', 'activeTargetIds', 'fixationPoint',
                     'condition', 'modulationAmplitude', 'luminanceBaseline', 'lastEegAgeMs', 'lastEegPacketDurationMs',
                     'stimulusFootprint', 'outerFlicker', 'brightnessMethod', 'modulatedRegionGeometry', 'rgbLevelMapping',
                     'excludedFromModulationGeometry', 'rgbChannelStyle', 'fixationMode', 'fixationModulation', 'eegFreshnessPolicy',
                     'rendererCallbackDelayMs', 'synchronizationMethod', 'hardwareSynchronized')})
        trial['targets'] = start['targets']
        trial['frameStats'] = {key: end.get(key) for key in ('durationMs', 'maxFrameIntervalMs', 'measuredRefreshRateHz', 'endReason',
                              'renderedFrames', 'maxDrawDurationMs', 'lastEegAgeMs', 'rendererCallbackDelayMs', 'firstFramePerformanceMs', 'lastFramePerformanceMs')}
        raw[first:last].tofile(args.out/trial['file'])
        if baseline_last-baseline_first >= 6*fs and np.isfinite(raw[baseline_first:baseline_last]).all():
            trial['baselineFile'] = start['trialId']+'-idle.f32'
            raw[baseline_first:baseline_last].tofile(args.out/trial['baselineFile'])
        index['trials'].append(trial)
    (args.out/'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'trials': len(index['trials']), 'gaps': gaps, 'invalid': bad, 'out': str(args.out)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
