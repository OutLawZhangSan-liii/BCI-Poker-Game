"""Predefined spectral tests for central-solid-evocation-v1; no classifier fitting."""
import argparse
import itertools
import json
from pathlib import Path
import numpy as np
from scipy import signal

PROTOCOL = 'central-solid-evocation-v1'
COMPONENTS = (12, 24, 15, 30)


def spectral_metrics(raw, fs):
    sos = np.vstack((signal.butter(4, 2, 'highpass', fs=fs, output='sos'),
                     signal.butter(4, 45, 'lowpass', fs=fs, output='sos')))
    zi = signal.sosfilt_zi(sos)[:, :, None]*raw[0][None, None, :]
    filtered, _ = signal.sosfilt(sos, raw, axis=0, zi=zi)
    samples = filtered[round(1.5*fs):round(9.5*fs)]
    if len(samples) != round(8*fs) or not np.isfinite(samples).all():
        raise ValueError('A complete finite eight-second window is required')
    f, p = signal.welch(samples, fs=fs, window='hann', nperseg=len(samples),
                        noverlap=0, detrend='constant', scaling='density', axis=0)
    result = {}
    # Mean powers, never raw waveforms: opposite phases cannot cancel the ROI.
    for hz in COMPONENTS:
        i = int(np.argmin(abs(f-hz)))
        neighbors = [int(np.argmin(abs(f-(hz+offset)))) for offset in (-1, -.75, -.5, .5, .75, 1)]
        target, noise = p[i], p[neighbors].mean(axis=0)
        result[str(hz)] = {
            'psdUv2PerHz': target.tolist(),
            'snrDb': (10*np.log10(np.maximum(target, 1e-30)/np.maximum(noise, 1e-30))).tolist(),
            'roiPsdUv2PerHz': float(target[:2].mean()),
            'roiSnrDb': float(10*np.log10(max(target[:2].mean(), 1e-30)/max(noise[:2].mean(), 1e-30))),
            'bandRmsUv': np.sqrt(p[abs(f-hz)<=.5+1e-9].sum(axis=0)*(f[1]-f[0])).tolist(),
        }
    return result


def paired_randomization(differences):
    """One-sided exact sign-flip test on independent matched blocks."""
    values = np.asarray(differences, dtype=float)
    if not len(values) or not np.isfinite(values).all():
        return None
    observed = float(values.mean())
    if len(values) <= 16:
        signs = np.array(list(itertools.product((-1, 1), repeat=len(values))))
        null = (signs*values).mean(axis=1)
        p = float(np.mean(null >= observed-1e-12))
        method = 'exact paired label-swap'
    else:
        signs = np.random.default_rng(20261007).choice((-1, 1), size=(20000, len(values)))
        null = (signs*values).mean(axis=1)
        p = float((np.sum(null >= observed-1e-12)+1)/(len(null)+1))
        method = '20000 paired label-swaps, fixed seed'
    return {'meanPowerChangeDb': observed, 'pOneSided': p, 'blocks': len(values), 'method': method}


def holm_adjust(p_values):
    order = np.argsort(p_values)
    adjusted = np.ones(len(p_values))
    prior = 0.
    for rank, index in enumerate(order):
        prior = min(1., max(prior, float(p_values[index])*(len(p_values)-rank)))
        adjusted[index] = prior
    return adjusted.tolist()


def exclusions(item, minimum_age_limit=100, freshness_multiplier=1.5):
    reasons = []
    if item.get('condition') not in ('static', '12hz', '15hz'): reasons.append('unknown_condition')
    if item['durationSeconds'] < 9.8: reasons.append('short_sample_record')
    frame = item['frameStats']
    if frame.get('endReason') != 'diagnostic_complete': reasons.append('interrupted')
    if item.get('frameDrops') != 0: reasons.append('display_drop_or_missing_stats')
    if frame.get('durationMs') is None or abs(item['durationSeconds']-frame['durationMs']/1000) > .1:
        reasons.append('sample_marker_duration_mismatch')
    if not item.get('responsiveStimulusGeometry'): reasons.append('missing_geometry')
    if item.get('rendererCallbackDelayMs') is None or item['rendererCallbackDelayMs'] > 100:
        reasons.append('late_or_missing_start_callback')
    age = item.get('lastEegAgeMs')
    packet = item.get('lastEegPacketDurationMs')
    end_age = frame.get('lastEegAgeMs')
    if age is None or end_age is None or packet is None or max(age, end_age) > max(minimum_age_limit, packet*freshness_multiplier):
        reasons.append('stale_or_missing_eeg_timing')
    targets = item['targets']
    static = item.get('condition') == 'static'
    expected = 0 if static else 12 if item.get('condition') == '12hz' else 15
    if len(targets) != 1 or targets[0]['frequencyHz'] != expected or targets[0]['x'] != .5 or targets[0]['y'] != .5:
        reasons.append('unmatched_target')
    if item.get('modulationAmplitude') != (0 if static else .45): reasons.append('unmatched_modulation')
    if item.get('activeTargetIds') != ([] if static else [targets[0]['id']] if len(targets) == 1 else None): reasons.append('unmatched_active_targets')
    return reasons


def analyze(directory):
    index = json.loads((directory/'index.json').read_text(encoding='utf8'))
    rows = []
    for item in index['trials']:
        if item.get('comparisonProtocol') != PROTOCOL: continue
        reasons = exclusions(item)
        raw = np.fromfile(directory/item['file'], dtype='<f4').reshape(-1, 4)
        if not np.isfinite(raw).all() or np.any(np.ptp(raw, axis=0) == 0): reasons.append('invalid_or_flat_data')
        rows.append({**item, 'excludeReasons': reasons,
                     'spectra': spectral_metrics(raw, index['sampleRateHz']) if not reasons else None})
    tests, pairs = [], []
    for condition, components in (('12hz', (12, 24)), ('15hz', (15, 30))):
        for hz in components:
            differences, attention = [], []
            keys = {(t['comparisonRunId'], t['repetition']) for t in rows if t['spectra']}
            for run, repetition in sorted(keys):
                group = [t for t in rows if t['spectra'] and t['comparisonRunId'] == run and t['repetition'] == repetition]
                active = [t for t in group if t['condition'] == condition]
                static = [t for t in group if t['condition'] == 'static']
                if len(active) != 1 or len(static) != 1: continue
                a, b = active[0], static[0]
                if a['responsiveStimulusGeometry'] != b['responsiveStimulusGeometry']: continue
                delta = 10*np.log10(max(a['spectra'][str(hz)]['roiPsdUv2PerHz'], 1e-30)/max(b['spectra'][str(hz)]['roiPsdUv2PerHz'], 1e-30))
                differences.append(float(delta)); attention.append(a['attentionConfirmed'] and b['attentionConfirmed'])
                pairs.append({'runId': run, 'repetition': repetition, 'condition': condition, 'componentHz': hz,
                              'powerChangeDb': float(delta), 'attentionConfirmed': bool(attention[-1])})
            test = paired_randomization(differences)
            tests.append({'condition': condition, 'componentHz': hz, 'attentionConfirmed': bool(attention and all(attention)),
                          'result': test})
    adjusted = holm_adjust([t['result']['pOneSided'] if t['result'] else 1 for t in tests])
    for t, p in zip(tests, adjusted):
        t['pHolm'] = p
        t['interpretation'] = '探索性结果；实际注视未确认' if not t['attentionConfirmed'] else '仅为频谱增强检验，尚不能单独证明神经诱发'
    report = {'channels': index['channels'], 'trials': rows, 'pairs': pairs, 'tests': tests,
              'roi': 'Mean O1/O2 powers, fixed before data collection',
              'method': '1.5–9.5 s; HP2/LP45; Hann 8s PSD; local noise at ±0.5/0.75/1 Hz; independent matched-block power changes; four one-sided label-swap tests, Holm correction',
              'phaseInference': 'Not computed: gateway packet-arrival estimates are not hardware synchronization',
              'limitations': 'Five independent pairs have minimum exact one-sided p=1/32; four Holm tests cannot reach .05 with only five pairs. This round screens repeatability; confirmation needs more independent trials. Local SNR alone is not proof of neural response; no clinical normal-amplitude cutoff.'}
    (directory/'evocation-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    lines = ['# 中央刺激诱发对照分析', '', report['method'], '',
             '局部 SNR 与刺激/静态功率增强分别计算；不根据一个正 SNR 自动判为诱发。', '',
             '|条件|频点|独立配对数|平均功率变化（dB）|单侧 p|Holm 校正 p|注视确认|', '|---|---|---:|---:|---:|---:|---|']
    for t in tests:
        v = t['result']
        lines.append(f'|{t["condition"]}|{t["componentHz"]} Hz|{v["blocks"] if v else 0}|{v["meanPowerChangeDb"]:.2f}|{v["pOneSided"]:.4f}|{t["pHolm"]:.4f}|{t["attentionConfirmed"]}|' if v else f'|{t["condition"]}|{t["componentHz"]} Hz|0|—|—|—|未确认|')
    lines += ['', f'有效试次 {sum(t["spectra"] is not None for t in rows)}/{len(rows)}。',
              '5 对试次是筛查，不足以在这四项校正检验中达到 p<0.05；未显著不代表没有响应。',
              '尚未执行基于硬件同步的相位锁定、Hotelling T² 或谱 F 检验，不把 Hann 相邻频点简单套入独立频点 F 分布。',
              '没有拟合个人模型或修改游戏识别门槛。']
    (directory/'evocation-analysis.md').write_text('\n'.join(lines), encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    r = analyze(args.directory)
    print(json.dumps({'trials': len(r['trials']), 'tests': r['tests']}, ensure_ascii=False))
