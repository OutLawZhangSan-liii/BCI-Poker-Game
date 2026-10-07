# -*- coding: utf-8 -*-
"""Compare matched real card/solid trials. No device connection or model fitting."""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy import signal

LEADS = ('O1', 'O2', 'P3', 'P4')


def metrics(raw, fs, hz):
    # Match the existing observation display's causal HP2 + LP45; avoid startup.
    sos = np.vstack((signal.butter(4, 2, 'highpass', fs=fs, output='sos'),
                     signal.butter(4, 45, 'lowpass', fs=fs, output='sos')))
    zi = signal.sosfilt_zi(sos)[:, :, None] * raw[0][None, None, :]
    filtered, _ = signal.sosfilt(sos, raw, axis=0, zi=zi)
    samples = filtered[round(1.25*fs):round(5.25*fs)]
    if len(samples) != round(4*fs) or not np.isfinite(samples).all():
        raise ValueError('A complete 4-second analysis window is required')
    frequencies, power = signal.welch(samples, fs=fs, window='hann', nperseg=len(samples),
                                      noverlap=0, detrend='constant', scaling='density', axis=0)
    result = {}
    for order in (1, 2, 3):
        target = hz * order
        index = int(np.argmin(abs(frequencies-target)))
        neighbors = [index+n for n in (-4, -3, -2, 2, 3, 4)]
        snr = 10*np.log10(np.maximum(power[index], 1e-30) / np.maximum(power[neighbors].mean(axis=0), 1e-30))
        band = abs(frequencies-target) <= .5 + 1e-9
        rms = np.sqrt(power[band].sum(axis=0)*(frequencies[1]-frequencies[0]))
        result[str(order)] = {'frequencyHz': target, 'snrDb': snr.tolist(), 'bandRmsUv': rms.tolist()}
    return result


def dimensions(trial):
    geometry = trial.get('responsiveStimulusGeometry')
    if not geometry or trial.get('cueIndex') is None:
        return None
    target = geometry['targets'][trial['cueIndex']]
    return [geometry['cssWidth'], geometry['cssHeight'], geometry['devicePixelRatio']] + [
        target[shape][key] for shape in ('card', 'ring') for key in ('x', 'y', 'width', 'height')]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    index = json.loads((args.directory/'index.json').read_text(encoding='utf-8'))
    fs = index['sampleRateHz']
    trials, pairs = [], []
    for item in index['trials']:
        if item.get('comparisonProtocol') not in ('matched-card-solid-v1', 'matched-card-solid-v2-large', 'matched-card-solid-v3-fixation'):
            continue
        active = [target for target in item['targets'] if target['id'] in item.get('activeTargetIds', [])]
        reasons = []
        if len(active) != 1: reasons.append('not_single_target')
        if item['durationSeconds'] < 5.5: reasons.append('too_short')
        renderer_ms = item['frameStats'].get('durationMs')
        if renderer_ms is not None and abs(item['durationSeconds'] - renderer_ms/1000) > .1:
            reasons.append('sample_marker_duration_mismatch')
        if item.get('frameDrops') != 0: reasons.append('frame_drop_or_missing_stats')
        if item['frameStats'].get('endReason') != 'diagnostic_complete': reasons.append('interrupted')
        if dimensions(item) is None: reasons.append('missing_geometry')
        raw = np.fromfile(args.directory/item['file'], dtype='<f4').reshape(-1, 4)
        if np.any(np.ptp(raw, axis=0) == 0): reasons.append('flat_required_lead')
        row = {**item, 'excludeReasons': reasons, 'metrics': None, 'baselineMetrics': None}
        if not reasons:
            row['frequencyHz'] = active[0]['frequencyHz']
            row['metrics'] = metrics(raw, fs, row['frequencyHz'])
            if item.get('baselineFile'):
                baseline = np.fromfile(args.directory/item['baselineFile'], dtype='<f4').reshape(-1, 4)
                if len(baseline) >= round(5.25*fs):
                    row['baselineMetrics'] = metrics(baseline[-round(5.25*fs):], fs, row['frequencyHz'])
        trials.append(row)
    keys = {(t['comparisonRunId'], t.get('frequencyHz'), t['repetition']) for t in trials if t['metrics']}
    for run, hz, repetition in sorted(keys):
        matched = [t for t in trials if t['metrics'] and t['comparisonRunId'] == run and t['frequencyHz'] == hz and t['repetition'] == repetition]
        cards = [t for t in matched if t['targetAppearance'] == 'card']
        solids = [t for t in matched if t['targetAppearance'] == 'solid']
        if len(cards) != 1 or len(solids) != 1: continue
        card, solid = cards[0], solids[0]
        geometry_match = np.max(np.abs(np.array(dimensions(card))-dimensions(solid))) <= 1
        pairs.append({'runId': run, 'frequencyHz': hz, 'repetition': repetition, 'geometryMatched': bool(geometry_match),
                      'attentionConfirmed': card['attentionConfirmed'] and solid['attentionConfirmed'],
                      'cardTrialId': card['trialId'], 'solidTrialId': solid['trialId'],
                      'fundamentalSnrDifferenceDb': (np.array(solid['metrics']['1']['snrDb'])-card['metrics']['1']['snrDb']).tolist()})
    report = {'channels': LEADS, 'trials': trials, 'pairs': pairs,
              'method': 'Same 1.25–5.25 s window; causal HP2/LP45; Hann 4s PSD; target power / neighboring-bin mean; μV²/Hz',
              'limitations': 'Band RMS includes background. Form comparison also changes fixation graphics and mean spatial luminance; it cannot isolate area alone. No universal amplitude cutoff or clinical claim.'}
    (args.directory/'stimulus-comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['# 扑克牌 / 纯色刺激对照', '', '只分析实际记录，使用 O1/O2/P3/P4。需人工确认注视；未确认时不能据此下响应结论。', '',
             '|频率|重复|尺寸位置匹配|已确认注视|纯色减牌面基波 SNR：O1 / O2 / P3 / P4（dB）|', '|---|---|---|---|---|']
    for p in pairs:
        lines.append(f"|{p['frequencyHz']} Hz|{p['repetition']}|{p['geometryMatched']}|{p['attentionConfirmed']}|" + ' / '.join(f'{v:+.2f}' for v in p['fundamentalSnrDifferenceDb'])+'|')
    lines += ['', f'有效试次 {sum(not t["excludeReasons"] for t in trials)}/{len(trials)}；完整匹配对 {len(pairs)}。',
              '应结合静息对照、二次谐波及重复间一致性判断。正差值只代表局部频谱对比更高，不自动证明刺激更有效；频带 RMS 包含背景脑电。',
              '两种形式改变的不仅是闪烁面积，尚包括静止牌面和中心图案。缺少匹配尺寸、注视确认或有效数据时不能归因。']
    (args.directory/'stimulus-comparison.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'trials': len(trials), 'pairs': len(pairs), 'report': str(args.directory/'stimulus-comparison.md')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
