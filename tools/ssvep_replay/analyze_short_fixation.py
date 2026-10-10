from .leads import export_roi
"""Descriptive 30-trial screening. Shared static references are not replicates."""
import argparse
import csv
import itertools
import json
from pathlib import Path
import numpy as np
from .analyze_appearance import (
    SHORT_FIXATION_PROTOCOL, WINDOWS, COMPONENTS, PREDEFINED,
    metadata_exclusions, segmented_spectra, log_ratio,
)

FORMS = ('card', 'card-face', 'solid')
MODES = ('fixed', 'synchronous')


def analyze(directory):
    index = json.loads((directory/'index.json').read_text(encoding='utf8'))
    roi_indices, roi_leads = export_roi(index['channels'])
    rows=[]
    for item in index['trials']:
        if item.get('comparisonProtocol') != SHORT_FIXATION_PROTOCOL:
            continue
        reasons=metadata_exclusions(item)
        values=np.fromfile(directory/item['file'],dtype='<f4')
        raw=values.reshape(-1,4) if len(values)%4==0 else None
        if raw is None or len(raw)!=item.get('samples'):
            reasons.append('invalid_sample_dimensions')
        elif len(raw)<round(9.5*index['sampleRateHz']):
            reasons.append('incomplete_analysis_windows')
        elif not np.isfinite(raw).all() or np.any(np.ptp(raw,axis=0)==0):
            reasons.append('invalid_or_flat_data')
        first=item.get('startSampleIndex')
        sample_windows={name:{'startInclusive':first+round(lo*index['sampleRateHz']),
                              'endExclusive':first+round(hi*index['sampleRateHz'])}
                        for name,(lo,hi) in WINDOWS.items()} if isinstance(first,int) else None
        rows.append({**item,'excludeReasons':reasons,'sampleWindows':sample_windows,
                     'spectra':segmented_spectra(raw,index['sampleRateHz'],roi_indices) if not reasons else None})
    # Duplicate conditions are rejected, not silently chosen or counted twice.
    keys={}
    for row in rows:
        keys.setdefault((row['comparisonRunId'],row['targetAppearance'],row.get('fixationMode'),row['repetition'],row['condition']),[]).append(row)
    for group in keys.values():
        if len(group)>1:
            for row in group:
                row['excludeReasons'].append('duplicate_condition');row['spectra']=None
    valid=[r for r in rows if r['spectra']]
    references={}
    for r in valid:
        if r['condition']=='static':references[r['comparisonRunId'],r['targetAppearance'],r['fixationMode']]=r

    def reference(r):
        s=references.get((r['comparisonRunId'],r['targetAppearance'],r['fixationMode']))
        if not s or s['responsiveStimulusGeometry']!=r['responsiveStimulusGeometry'] or s['targets'][0].get('label')!=r['targets'][0].get('label'):
            return None
        return s

    def gain(r,hz,window='full'):
        s=reference(r)
        return None if s is None else log_ratio(r['spectra'][window][str(hz)]['roiPsdUv2PerHz'],s['spectra'][window][str(hz)]['roiPsdUv2PerHz'])

    effects=[];temporal=[];comparisons=[]
    for form,mode in itertools.product(FORMS,MODES):
        for condition,hz in PREDEFINED:
            active=[r for r in valid if r['targetAppearance']==form and r['fixationMode']==mode and r['condition']==condition]
            gains=[v for r in active if (v:=gain(r,hz)) is not None]
            effects.append({'appearance':form,'fixationMode':mode,'condition':condition,'componentHz':hz,
                            'activeTrials':len(active),'referenceAdjustedTrials':len(gains),
                            'meanEnhancementDb':float(np.mean(gains)) if gains else None,
                            'medianSnrDb':float(np.median([r['spectra']['full'][str(hz)]['roiSnrDb'] for r in active])) if active else None,
                            'positiveEnhancementTrials':sum(v>0 for v in gains),
                            'staticReferenceIds':sorted({reference(r)['trialId'] for r in active if reference(r)})})
            for r in active:
                s=reference(r)
                raw_change=log_ratio(r['spectra']['late'][str(hz)]['roiPsdUv2PerHz'],r['spectra']['early'][str(hz)]['roiPsdUv2PerHz'])
                background_change=None if s is None else log_ratio(s['spectra']['late'][str(hz)]['roiPsdUv2PerHz'],s['spectra']['early'][str(hz)]['roiPsdUv2PerHz'])
                temporal.append({'trialId':r['trialId'],'appearance':form,'fixationMode':mode,'repetition':r['repetition'],
                                 'condition':condition,'componentHz':hz,'rawLateMinusEarlyDb':raw_change,
                                 'staticLateMinusEarlyDb':background_change,
                                 'adjustedLateMinusEarlyDb':None if background_change is None else raw_change-background_change,
                                 'snrLateMinusEarlyDb':r['spectra']['late'][str(hz)]['roiSnrDb']-r['spectra']['early'][str(hz)]['roiSnrDb'],
                                 'staticReferenceId':None if s is None else s['trialId']})

    contrasts=[(kind,first,second) for kind,first,second in
               [('form',(a,m),(b,m)) for m in MODES for a,b in (('card-face','card'),('card-face','solid'),('card','solid'))]+
              [('fixation',(a,'synchronous'),(a,'fixed')) for a in FORMS]]
    for kind,first,second in contrasts:
        for condition,hz in PREDEFINED:
            pairs=[]
            for run in sorted({r['comparisonRunId'] for r in valid}):
                for repetition in (1,2):
                    selected=[]
                    for form,mode in (first,second):
                        candidates=[r for r in valid if r['comparisonRunId']==run and r['repetition']==repetition and
                                    r['condition']==condition and r['targetAppearance']==form and r['fixationMode']==mode]
                        if len(candidates)!=1:break
                        selected.append(candidates[0])
                    if len(selected)!=2:continue
                    a,b=selected
                    if a['responsiveStimulusGeometry']!=b['responsiveStimulusGeometry'] or a['targets'][0].get('label')!=b['targets'][0].get('label'):continue
                    ga,gb=gain(a,hz),gain(b,hz)
                    pairs.append({'runId':run,'repetition':repetition,'firstTrialId':a['trialId'],'secondTrialId':b['trialId'],
                                  'rawFirstMinusSecondDb':log_ratio(a['spectra']['full'][str(hz)]['roiPsdUv2PerHz'],b['spectra']['full'][str(hz)]['roiPsdUv2PerHz']),
                                  'referenceAdjustedFirstMinusSecondDb':None if ga is None or gb is None else ga-gb,
                                  'firstStaticReferenceId':reference(a)['trialId'] if reference(a) else None,
                                  'secondStaticReferenceId':reference(b)['trialId'] if reference(b) else None})
            adjusted=[p['referenceAdjustedFirstMinusSecondDb'] for p in pairs if p['referenceAdjustedFirstMinusSecondDb'] is not None]
            comparisons.append({'kind':kind,'first':list(first),'second':list(second),'condition':condition,'componentHz':hz,
                                'pairs':pairs,'pairedActiveBlocks':len(pairs),
                                'meanReferenceAdjustedDifferenceDb':float(np.mean(adjusted)) if adjusted else None,
                                'positiveAdjustedPairs':sum(v>0 for v in adjusted),'adjustedPairs':len(adjusted)})
    report={'protocol':SHORT_FIXATION_PROTOCOL,'channels':index['channels'],'roiLeads':roi_leads,'plannedTrials':30,'trials':rows,'effects':effects,
            'temporal':temporal,'comparisons':comparisons,'validTrials':len(valid),'staticReferences':len(references),
            'inference':'Descriptive screening only; two active repeats, one shared static reference per variant. No significance tests or independent static replicates.',
            'hardwareSynchronized':False,'analysisWindowsSeconds':WINDOWS}
    (directory/'short-fixation-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    with (directory/'short-fixation-spectra.csv').open('w',newline='',encoding='utf-8-sig') as file:
        writer=csv.writer(file);writer.writerow(['trialId','sequence','appearance','fixationMode','condition','repetition','window','hz','lead','PSD_uV2_Hz','SNR_dB','band_RMS_uV'])
        for r in valid:
            for window in WINDOWS:
                for hz in COMPONENTS:
                    metric=r['spectra'][window][str(hz)]
                    for ch,lead in enumerate(index['channels']):
                        writer.writerow([r['trialId'],r['sequenceIndex']+1,r['targetAppearance'],r['fixationMode'],r['condition'],r['repetition'],window,hz,lead,
                                         metric['psdUv2PerHz'][ch],metric['snrDb'][ch],metric['bandRmsUv'][ch]])
    fmt=lambda value:'缺少有效配对' if value is None else f'{value:+.2f}'
    lines=['# 短版注视点与刺激形式筛选','',f'导联：{" / ".join(index["channels"])}；功率 ROI：{" / ".join(roi_leads)}。',f'有效 {len(valid)}/{len(rows)} 次，计划 30 次；有效一次性静态参考 {len(references)} 次。',
           f'人工确认持续注视 {sum(r.get("attentionConfirmed") is True for r in valid)}/{len(valid)} 次；未确认记录只作探索性分析。','',
           '## 基频与一次谐波','',
           '|形式|注视点|刺激|分量 Hz|有效刺激次数|局部 SNR 中位数 dB|相对静态增强均值 dB|正增强次数|',
           '|---|---|---|---:|---:|---:|---:|---:|']
    for e in effects:
        lines.append(f'|{e["appearance"]}|{e["fixationMode"]}|{e["condition"]}|{e["componentHz"]}|{e["activeTrials"]}|{fmt(e["medianSnrDb"])}|{fmt(e["meanEnhancementDb"])}|{e["positiveEnhancementTrials"]}/{e["referenceAdjustedTrials"]}|')
    lines+=['','## 两两比较（正值表示前者更强）','',
            '|类型|前者|后者|刺激|分量 Hz|调整后差异均值 dB|正向配对|','|---|---|---|---|---:|---:|---:|']
    for c in comparisons:
        lines.append(f'|{c["kind"]}|{"/".join(c["first"])}|{"/".join(c["second"])}|{c["condition"]}|{c["componentHz"]}|{fmt(c["meanReferenceAdjustedDifferenceDb"])}|{c["positiveAdjustedPairs"]}/{c["adjustedPairs"]}|')
    lines+=['','## 同试次前后变化','',
            '|试次|形式|注视点|分量 Hz|刺激功率晚减早 dB|静态功率晚减早 dB|扣静态后 dB|SNR 晚减早 dB|',
            '|---|---|---|---:|---:|---:|---:|---:|']
    for t in temporal:
        lines.append(f'|{t["trialId"]}|{t["appearance"]}|{t["fixationMode"]}|{t["componentHz"]}|{fmt(t["rawLateMinusEarlyDb"])}|{fmt(t["staticLateMinusEarlyDb"])}|{fmt(t["adjustedLateMinusEarlyDb"])}|{fmt(t["snrLateMinusEarlyDb"])}|')
    lines+=['','## 试次审计','']
    for r in rows:
        lines.append(f'- 第 {r["sequenceIndex"]+1} 次：'+('有效' if not r['excludeReasons'] else ', '.join(r['excludeReasons'])))
    lines+=['','## 解释范围','',
            '- 每个条件只有两次刺激，一次静态参考被重复使用；静态参考没有独立重复，不能据此给出显著性或稳定诱发结论。',
            '- 同步注视点与目标使用同一频率、相位和亮度时钟；固定点与同步点各自有静态参考，未把二者合并。',
            '- 整次连续 2–45 Hz 滤波后切完整 1.5–9.5 秒、早 1.5–5.5 秒、晚 5.5–9.5 秒。半窗不是独立重复，4 秒和 8 秒 SNR 不直接比较。',
            '- 相对静态增强与邻频 SNR 分别列出；静态背景下降也会增加调整后变化。SNR 高于零本身不能证明神经诱发。',
            '- 外围、整牌和纯色的空间图案、面积、物理亮度仍有区别。36/45 Hz 仅描述，45 Hz 位于低通截止处。',
            '- 网关到达估计不是硬件级同步；没有测量游戏准确率。历史协议与本轮严格分开。','']
    (directory/'short-fixation-analysis.md').write_text('\n'.join(lines),encoding='utf8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);args=parser.parse_args()
    r=analyze(args.folder)
    print(json.dumps({'validTrials':r['validTrials'],'staticReferences':r['staticReferences'],'out':str(args.folder)},ensure_ascii=True))
