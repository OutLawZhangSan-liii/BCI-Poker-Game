from .leads import export_roi
"""Matched central card/solid comparison, with paired early/late EEG windows.

Whole-trial causal filtering precedes segmentation. No model fitting, lag search,
channel selection, or treating halves/overlapping windows as independent trials.
"""
import argparse
import csv
import json
import itertools
from pathlib import Path
import numpy as np
from scipy import signal
from .analyze_evocation import exclusions, holm_adjust

PROTOCOL = 'central-appearance-comparison-v1'
CARD_FACE_PROTOCOL = 'central-cardface-comparison-v1'
THREE_FORM_PROTOCOL = 'central-three-form-comparison-v1'
SHORT_FIXATION_PROTOCOL = 'central-short-fixation-comparison-v1'
PROTOCOL_FORMS = {PROTOCOL: ('card','solid'), CARD_FACE_PROTOCOL: ('card-face','solid'),
                  THREE_FORM_PROTOCOL: ('card','card-face','solid')}
WINDOWS = {'full': [1.5, 9.5], 'early': [1.5, 5.5], 'late': [5.5, 9.5]}
COMPONENTS = (12, 24, 36, 15, 30, 45)
PREDEFINED = (('12hz', 12), ('12hz', 24), ('15hz', 15), ('15hz', 30))


def segmented_spectra(raw, fs, roi_indices=(2, 3)):
    if raw.ndim != 2 or raw.shape[1] != 4 or len(raw) == 0 or not np.isfinite(raw).all():
        raise ValueError('Four finite channels required')
    sos = np.vstack((signal.butter(4, 2, 'highpass', fs=fs, output='sos'),
                     signal.butter(4, 45, 'lowpass', fs=fs, output='sos')))
    filtered, _ = signal.sosfilt(sos, raw, axis=0,
                                 zi=signal.sosfilt_zi(sos)[:, :, None]*raw[0][None, None, :])
    result = {}
    for name, (start, end) in WINDOWS.items():
        samples = filtered[round(start*fs):round(end*fs)]
        if len(samples) != round((end-start)*fs):
            raise ValueError('Complete full/early/late windows required')
        frequencies, power = signal.welch(samples, fs=fs, nperseg=len(samples), noverlap=0,
                                          window='hann', detrend='constant', scaling='density', axis=0)
        result[name] = {}
        for hz in COMPONENTS:
            index = np.argmin(abs(frequencies-hz))
            neighbors = [np.argmin(abs(frequencies-(hz+offset))) for offset in (-1, -.75, -.5, .5, .75, 1)]
            target = power[index]; noise = power[neighbors].mean(axis=0)
            result[name][str(hz)] = {
                'psdUv2PerHz': target.tolist(), 'roiPsdUv2PerHz': float(target[list(roi_indices)].mean()),
                'snrDb': (10*np.log10(np.maximum(target, 1e-30)/np.maximum(noise, 1e-30))).tolist(),
                'roiSnrDb': float(10*np.log10(max(target[list(roi_indices)].mean(), 1e-30)/max(noise[list(roi_indices)].mean(), 1e-30))),
                'bandRmsUv': np.sqrt(power[abs(frequencies-hz)<=.5+1e-9].sum(axis=0)*(frequencies[1]-frequencies[0])).tolist(),
            }
    return result


def metadata_exclusions(item):
    short = item.get('comparisonProtocol') == SHORT_FIXATION_PROTOCOL
    reasons = exclusions(item, minimum_age_limit=500, freshness_multiplier=3) if short else exclusions(item)
    if not item.get('comparisonRunId'): reasons.append('missing_run_id')
    protocol = item.get('comparisonProtocol')
    forms = ('card','card-face','solid') if short else PROTOCOL_FORMS.get(protocol, ('card','solid'))
    appearance = item.get('targetAppearance')
    card_form = 'card-face' if protocol == CARD_FACE_PROTOCOL else 'card'
    if appearance not in forms: reasons.append('unknown_appearance')
    if item.get('comparisonProtocol') == CARD_FACE_PROTOCOL:
        if item.get('stimulusFootprint') != 'card' or item.get('outerFlicker') is not False: reasons.append('unmatched_face_footprint')
        method = 'black-overlay-linear-rgb-v1' if card_form == item.get('targetAppearance') else 'uniform-rgb-v1'
        if item.get('brightnessMethod') != method or item.get('rgbLevelMapping') != '42+178*luminance-v1': reasons.append('unmatched_brightness_method')
        targets = item.get('responsiveStimulusGeometry', {}).get('targets', [])
        expected = [{**t['card'], 'cornerRadius':10} for t in targets if isinstance(t.get('card'),dict)]
        if len(expected)!=1 or item.get('modulatedRegionGeometry') != expected: reasons.append('unmatched_modulated_region')
    if protocol in (THREE_FORM_PROTOCOL, SHORT_FIXATION_PROTOCOL):
        peripheral = appearance == 'card'
        if item.get('stimulusFootprint') != ('seat' if peripheral else 'card') or item.get('outerFlicker') is not peripheral:
            reasons.append('unmatched_three_form_footprint')
        methods = {'card':'static-card-overlay','card-face':'black-overlay-linear-rgb-v1','solid':'uniform-rgb-v1'}
        if item.get('brightnessMethod') != methods.get(appearance) or item.get('rgbLevelMapping') != '42+178*luminance-v1': reasons.append('unmatched_brightness_method')
        targets = item.get('responsiveStimulusGeometry', {}).get('targets', [])
        region = 'ring' if peripheral else 'card'
        expected = [{**t[region], 'cornerRadius':16 if peripheral else 10} for t in targets if isinstance(t.get(region),dict)]
        if len(expected)!=1 or item.get('modulatedRegionGeometry') != expected: reasons.append('unmatched_modulated_region')
        masks = [{**t['card'],'cornerRadius':10} for t in targets if isinstance(t.get('card'),dict)] if peripheral else []
        if item.get('excludedFromModulationGeometry') != masks: reasons.append('unmatched_occlusion_geometry')
        if item.get('rgbChannelStyle') != ('legacy-blue-plus5' if peripheral else 'achromatic'): reasons.append('unmatched_rgb_channel_style')
    if short:
        mode=item.get('fixationMode')
        if mode not in ('fixed','synchronous'): reasons.append('unknown_fixation_mode')
        if item.get('fixationPoint') != ('light-dark-concentric-sync' if mode=='synchronous' else 'light-dark-concentric'): reasons.append('unmatched_fixation')
        if item.get('eegFreshnessPolicy') != 'packet-jitter-tolerance-v1': reasons.append('unknown_freshness_policy')
        geometry=item.get('responsiveStimulusGeometry',{}).get('targets',[])
        expected={'mode':mode,'phaseOffsetRad':0,'method':'concentric-rgb-scaled-by-target-level-v1' if mode=='synchronous' else 'opaque-concentric-v1',
                  'geometry':[{'x':t.get('centerX'),'y':t.get('centerY'),'radius':10} for t in geometry]}
        if item.get('fixationModulation') != expected or len(geometry)!=1: reasons.append('unmatched_fixation_modulation')
    elif item.get('fixationPoint') != 'light-dark-concentric': reasons.append('unmatched_fixation')
    if item.get('luminanceBaseline') != .5: reasons.append('unmatched_digital_baseline')
    if item.get('plannedDurationMs') != 10000: reasons.append('unmatched_planned_duration')
    if item.get('analysisWindowsSeconds') != WINDOWS: reasons.append('unmatched_analysis_windows')
    repetition = item.get('repetition')
    if short:
        sequence=item.get('sequenceIndex')
        if not isinstance(sequence,int) or sequence not in range(30): reasons.append('invalid_sequence')
        else:
            expected_rep=0 if sequence<6 else 1 if sequence<18 else 2
            if repetition!=expected_rep: reasons.append('unmatched_sequence_block')
            if item.get('comparisonSegment')!=(2 if expected_rep==2 else 1): reasons.append('unmatched_execution_segment')
            if (item.get('condition')=='static')!=(sequence<6): reasons.append('unmatched_static_reference_sequence')
    else:
        if repetition not in range(1, 9): reasons.append('invalid_repetition')
        elif item.get('comparisonSegment') != (1 if repetition<=4 else 2): reasons.append('unmatched_execution_segment')
        block_size = len(forms)*3
        if item.get('sequenceIndex') not in range(block_size*8): reasons.append('invalid_sequence')
        elif repetition in range(1, 9) and item['sequenceIndex']//block_size+1 != repetition: reasons.append('unmatched_sequence_block')
    if len(item.get('targets', [])) != 1 or item['targets'][0].get('phaseRad') != 0: reasons.append('unmatched_phase')
    delay = item.get('frameStats', {}).get('rendererCallbackDelayMs')
    if delay is None or delay > 100: reasons.append('late_or_missing_end_callback')
    first, last = item.get('startSampleIndex'), item.get('endSampleIndex')
    if not isinstance(first, int) or not isinstance(last, int) or first < 0 or last-first != item.get('samples'):
        reasons.append('missing_or_inconsistent_sample_axis')
    return reasons


def log_ratio(a, b):
    return float(10*np.log10(max(a, 1e-30)/max(b, 1e-30)))


def paired_two_sided(differences):
    """One paired contrast per independent block, with both directions tested."""
    values = np.asarray(differences, dtype=float)
    if not len(values) or not np.isfinite(values).all(): return None
    observed = float(values.mean())
    if len(values) <= 16:
        signs = np.array(list(itertools.product((-1, 1), repeat=len(values))))
        null = (signs*values).mean(axis=1)
        p = float(np.mean(abs(null) >= abs(observed)-1e-12))
        method = 'exact two-sided paired label-swap'
    else:
        signs = np.random.default_rng(20261007).choice((-1, 1), size=(20000, len(values)))
        null = (signs*values).mean(axis=1)
        p = float((np.sum(abs(null) >= abs(observed)-1e-12)+1)/(len(null)+1))
        method = '20000 two-sided paired label-swaps, fixed seed'
    return {'meanPowerChangeDb': observed, 'pTwoSided': p, 'blocks': len(values), 'method': method}


def analyze(directory, protocol=PROTOCOL):
    if protocol not in PROTOCOL_FORMS: raise ValueError('Unknown comparison protocol')
    forms = PROTOCOL_FORMS[protocol]
    form_comparisons = [('card-face','card'),('card-face','solid'),('card','solid')] if protocol==THREE_FORM_PROTOCOL else [forms]
    index = json.loads((directory/'index.json').read_text(encoding='utf8'))
    roi_indices, roi_leads = export_roi(index['channels'])
    rows = []
    for item in index['trials']:
        if item.get('comparisonProtocol') != protocol: continue
        reasons = metadata_exclusions(item)
        values = np.fromfile(directory/item['file'], dtype='<f4')
        if len(values)%4: reasons.append('invalid_sample_dimensions'); raw = None
        else:
            raw = values.reshape(-1, 4)
            if len(raw) != item.get('samples'): reasons.append('sample_count_mismatch')
            if len(raw) < round(9.5*index['sampleRateHz']): reasons.append('incomplete_analysis_windows')
            if not np.isfinite(raw).all() or len(raw)==0 or np.any(np.ptp(raw, axis=0)==0): reasons.append('invalid_or_flat_data')
        first = item.get('startSampleIndex')
        sample_windows = {name: {'startInclusive': first+round(start*index['sampleRateHz']),
                                'endExclusive': first+round(end*index['sampleRateHz'])}
                          for name, (start, end) in WINDOWS.items()} if isinstance(first, int) else None
        rows.append({**item, 'excludeReasons': reasons, 'sampleWindows': sample_windows,
                     'spectra': segmented_spectra(raw, index['sampleRateHz'], roi_indices) if not reasons else None})
    groups = {}
    for row in rows:
        if row['spectra']:
            groups.setdefault((row['comparisonRunId'], row['repetition']), []).append(row)
    pairs, form_tests, time_tests = [], [], []

    def matched(group, condition, appearances):
        needed = [(appearance, c) for appearance in appearances for c in (condition, 'static')]
        selected = []
        for appearance, c in needed:
            candidates = [t for t in group if t['targetAppearance']==appearance and t['condition']==c]
            if len(candidates)!=1: return None
            selected.append(candidates[0])
        if any(t['responsiveStimulusGeometry'] != selected[0]['responsiveStimulusGeometry'] for t in selected): return None
        if any(t['targets'][0].get('label') != selected[0]['targets'][0].get('label') for t in selected): return None
        return selected

    def enhancement(active, static, window, hz):
        return log_ratio(active['spectra'][window][str(hz)]['roiPsdUv2PerHz'], static['spectra'][window][str(hz)]['roiPsdUv2PerHz'])

    for first_form, second_form in form_comparisons:
        for condition, hz in PREDEFINED:
            differences, attention = [], []
            for (run, repetition), group in sorted(groups.items()):
                selected = matched(group, condition, (first_form, second_form))
                if not selected: continue
                ca, cs, sa, ss = selected
                first = enhancement(ca, cs, 'full', hz); second = enhancement(sa, ss, 'full', hz)
                difference = first-second
                confirmed = all(t.get('attentionConfirmed') is True for t in selected)
                differences.append(difference); attention.append(confirmed)
                pair = {'kind':'form', 'runId':run, 'repetition':repetition, 'condition':condition, 'componentHz':hz,
                        'firstAppearance':first_form,'secondAppearance':second_form,
                        'firstEnhancementDb':first,'secondEnhancementDb':second,'firstMinusSecondDb':difference,
                        'attentionConfirmed':confirmed}
                if second_form=='solid': pair.update(cardEnhancementDb=first,solidEnhancementDb=second,cardMinusSolidDb=difference)
                pairs.append(pair)
            form_tests.append({'condition':condition, 'componentHz':hz,'firstAppearance':first_form,'secondAppearance':second_form,
                               'attentionConfirmed':bool(attention and all(attention)), 'result':paired_two_sided(differences),
                               'direction':f'Positive: {first_form} enhances more; negative: {second_form} enhances more, relative to each own static control. Two-sided comparison.'})
    adjusted = holm_adjust([t['result']['pTwoSided'] if t['result'] else 1 for t in form_tests])
    for t,p in zip(form_tests,adjusted):t['pHolm']=p
    for appearance in forms:
        for condition, hz in PREDEFINED:
            differences, attention, early, late = [], [], [], []
            for (run,repetition),group in sorted(groups.items()):
                selected = matched(group, condition, (appearance,))
                if not selected:continue
                active, static = selected
                a=enhancement(active,static,'early',hz);b=enhancement(active,static,'late',hz)
                early.append(a);late.append(b);differences.append(b-a)
                confirmed=all(t.get('attentionConfirmed') is True for t in selected);attention.append(confirmed)
                pairs.append({'kind':'time', 'runId':run, 'repetition':repetition, 'appearance':appearance,
                              'condition':condition, 'componentHz':hz, 'earlyEnhancementDb':a, 'lateEnhancementDb':b,
                              'lateMinusEarlyDb':b-a, 'attentionConfirmed':confirmed})
            time_tests.append({'appearance':appearance,'condition':condition,'componentHz':hz,
                               'earlyMeanEnhancementDb':float(np.mean(early)) if early else None,
                               'lateMeanEnhancementDb':float(np.mean(late)) if late else None,
                               'attentionConfirmed':bool(attention and all(attention)), 'result':paired_two_sided(differences),
                               'direction':'Positive: late enhancement exceeds early; negative: early exceeds late, after own matched static temporal change. Two-sided comparison.'})
    adjusted=holm_adjust([t['result']['pTwoSided'] if t['result'] else 1 for t in time_tests])
    for t,p in zip(time_tests,adjusted):t['pHolm']=p
    report={'protocol':protocol,'channels':index['channels'],'roiLeads':roi_leads,'trials':rows,'pairs':pairs,
            'formTests':form_tests,'timeTests':time_tests,'analysisWindowsSeconds':WINDOWS,
            'method':f'Continuous whole-trial HP2/LP45 then full 8s / early4s / late4s Hann PSD. Mean {"/".join(roi_leads)} powers, local noise ±0.5/0.75/1Hz. Two-sided paired label-swaps: static-adjusted pairwise form contrasts across independent blocks, {len(form_tests)} Holm tests; separate late-minus-early static-adjusted family, {len(time_tests)} Holm tests.',
            'limitations':'Segments are paired within trial, never independent trials. Digital baseline is not photometric luminance matching. '+
                          ('Face footprints match, but card artwork changes spatial modulation distribution and mean physical luminance. ' if protocol==CARD_FACE_PROTOCOL else 'Form contrast changes modulated area and card artwork. ')+
                          '36/45Hz descriptive only;45Hz at filter cutoff. No hardware phase inference, gaze verification, calibration, threshold tuning, or game accuracy inference.'}
    (directory/'appearance-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    with (directory/'appearance-trial-spectra.csv').open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.writer(file);writer.writerow(['trialId','sequence','repetition','executionSegment','appearance','condition','window','frequencyHz','lead','psdUv2PerHz','snrDb','bandRmsUv','roiSnrDb'])
        for t in rows:
            if not t['spectra']:continue
            for window,data in t['spectra'].items():
                for hz,m in data.items():
                    for j,ch in enumerate(index['channels']):
                        writer.writerow([t['trialId'],t['sequenceIndex']+1,t['repetition'],t['comparisonSegment'],t['targetAppearance'],t['condition'],window,hz,ch,m['psdUv2PerHz'][j],m['snrDb'][j],m['bandRmsUv'][j],m['roiSnrDb']])
    lines=['# 中央扑克牌 / 纯色块与前后响应比较','',report['method'],'',
           f'协议 {protocol}；有效试次 {sum(t["spectra"] is not None for t in rows)}/{len(rows)}；计划 {len(forms)*3*8} 次。注视标注来源为人工确认，未自动视为已经注视。','',
           '## 形式两两比较','',
           '增强均相对同组、同形式静态；正值表示前一形式增强更大，负值表示后一形式增强更大。双侧检验允许两个方向，采集前固定，不按结果选择方向。所有形式比较共同校正，不按比较对拆成更小家族。','',
           '|前一形式 − 后一形式|条件|分量|独立组数|差值 dB|双侧 p|Holm p|注视确认|','|---|---|---:|---:|---:|---:|---:|---|']
    for t in form_tests:
        v=t['result'];label=f'{t["firstAppearance"]} − {t["secondAppearance"]}'
        lines.append(f'|{label}|{t["condition"]}|{t["componentHz"]} Hz|{v["blocks"]}|{v["meanPowerChangeDb"]:+.2f}|{v["pTwoSided"]:.4f}|{t["pHolm"]:.4f}|{t["attentionConfirmed"]}|' if v else f'|{label}|{t["condition"]}|{t["componentHz"]} Hz|0|—|—|—|未确认|')
    lines+=['','## 前后 4 秒比较','',
            '早段 1.5–5.5 s，晚段 5.5–9.5 s；先连续滤波整次试次再切段。晚减早是刺激功率变化扣除相同形式静态的时间变化；每组只有一个配对差值。正值表示晚段增强更大。','',
            '|形式|条件|分量|组数|早段增强 dB|晚段增强 dB|晚减早 dB|Holm p|注视确认|','|---|---|---:|---:|---:|---:|---:|---:|---|']
    for t in time_tests:
        v=t['result'];lines.append(f'|{t["appearance"]}|{t["condition"]}|{t["componentHz"]} Hz|{v["blocks"] if v else 0}|{t["earlyMeanEnhancementDb"]:+.2f}|{t["lateMeanEnhancementDb"]:+.2f}|{v["meanPowerChangeDb"]:+.2f}|{t["pHolm"]:.4f}|{t["attentionConfirmed"]}|' if v else f'|{t["appearance"]}|{t["condition"]}|{t["componentHz"]} Hz|0|—|—|—|—|未确认|')
    lines += ['', '## 局部 SNR：各形式、条件与分量', '',
              f'固定 {"/".join(roi_leads)} 平均功率的局部 SNR 中位数；完整窗和两段使用各自等长窗，仅早晚可直接比较。所有条件均计算全部六个频点，便于检查响应是否跟随刺激频率。', '',
              '|形式|条件|分量 Hz|有效次数|完整 8 秒 dB|早 4 秒 dB|晚 4 秒 dB|', '|---|---|---:|---:|---:|---:|---:|']
    for appearance in forms:
        for condition in ('static', '12hz', '15hz'):
            selected = [t for t in rows if t['spectra'] and t['targetAppearance']==appearance and t['condition']==condition]
            for hz in COMPONENTS:
                values = [f'{np.median([t["spectra"][w][str(hz)]["roiSnrDb"] for t in selected]):+.2f}' if selected else '—' for w in WINDOWS]
                lines.append(f'|{appearance}|{condition}|{hz}|{len(selected)}|'+'|'.join(values)+'|')
    lines+=['','## 排除与匹配限制','']
    lines += [f'- 试次 {t["sequenceIndex"]+1}：'+', '.join(t['excludeReasons']) for t in rows if t['excludeReasons']]
    lines+=['同组出现重复、缺少对应静态/刺激或尺寸/牌面不匹配时，相关配对不进入检验；不会补齐数据。部分完成时如实报告实际独立组数。', '', report['limitations'], '',
            '主要检验与前后检验采用不同的预设校正家族，不能把两段当成样本量翻倍。主分析保留完整 8 s 窗；两种 4 s 窗仅用于相互比较，不直接拿 4 s SNR 与 8 s SNR 判断生理强弱。',
            f'8 组时双侧检验的最小精确 p=2/256；当前形式比较家族 {len(form_tests)} 项、前后家族 {len(time_tests)} 项，最小 Holm p 分别为 {len(form_tests)*2/256:.5f} 和 {len(time_tests)*2/256:.5f}。若最小值超过 0.05，则本轮只能描述趋势与重复性，未显著不能解释为形式或前后相同。',
            'PSD 单位 μV²/Hz，带内 RMS 单位 μV；RMS 含背景，不能直接定义纯诱发幅度或临床正常。局部 SNR 为相对峰指标，不能单独证明神经来源。','']
    lines += ['## 起止与切窗审计', '', '以起始标记估计的采样位置作为原点；索引采用左闭右开。JSON 保留起止显示/网关时间及切窗全局索引；这保证使用同一采样轴，但不等同于硬件级屏幕—EEG 对齐。', '',
              '|试次|执行段|形式/条件|样本数|样本/显示时长差 ms|早段全局索引|晚段全局索引|排除|',
              '|---:|---:|---|---:|---:|---|---|---|']
    for t in rows:
        display_ms = t['frameStats'].get('durationMs')
        delta = f'{t["durationSeconds"]*1000-display_ms:+.1f}' if display_ms is not None else '—'
        windows = t['sampleWindows']
        positions = [f'[{windows[w]["startInclusive"]}, {windows[w]["endExclusive"]})' if windows else '—' for w in ('early','late')]
        lines.append(f'|{t["sequenceIndex"]+1}|{t["comparisonSegment"]}|{t["targetAppearance"]}/{t["condition"]}|{t["samples"]}|{delta}|{positions[0]}|{positions[1]}|'+(', '.join(t['excludeReasons']) or '无')+'|')
    (directory/'appearance-analysis.md').write_text('\n'.join(lines),encoding='utf8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path)
    parser.add_argument('--protocol',choices=tuple(PROTOCOL_FORMS),default=PROTOCOL);args=parser.parse_args()
    r=analyze(args.directory,args.protocol)
    print(json.dumps({'trials':len(r['trials']),'valid':sum(t['spectra'] is not None for t in r['trials']),'formTests':r['formTests'],'timeTests':r['timeTests']},ensure_ascii=True))
