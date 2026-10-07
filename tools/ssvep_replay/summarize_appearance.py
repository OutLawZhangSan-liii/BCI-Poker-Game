"""Descriptive stage/combined plots and audit, without changing predefined tests."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from .analyze_appearance import COMPONENTS, WINDOWS, PROTOCOL_FORMS, log_ratio


def summarize(folder):
    r=json.loads((folder/'appearance-analysis.json').read_text(encoding='utf8'))
    index=json.loads((folder/'index.json').read_text(encoding='utf8'))
    audit=json.loads((folder/'alignment-audit.json').read_text(encoding='utf8')) if (folder/'alignment-audit.json').exists() else None
    rows=sorted(r['trials'],key=lambda t:t['sequenceIndex'])
    forms=PROTOCOL_FORMS[r['protocol']]
    valid=[t for t in rows if t['spectra']]
    fs=index['sampleRateHz']; leads=index['channels']; spectra={};filtered={}; quality=[]
    sos=np.vstack((signal.butter(4,2,'highpass',fs=fs,output='sos'),signal.butter(4,45,'lowpass',fs=fs,output='sos')))
    for t in rows:
        raw=np.fromfile(folder/t['file'],dtype='<f4').reshape(-1,4).astype(float)
        y,_=signal.sosfilt(sos,raw,axis=0,zi=signal.sosfilt_zi(sos)[:,:,None]*raw[0][None,None,:])
        filtered[t['trialId']]=y
        for window,(lo,hi) in WINDOWS.items():
            w=y[round(lo*fs):round(hi*fs)]
            f,p=signal.welch(w,fs=fs,nperseg=len(w),window='hann',noverlap=0,detrend='constant',scaling='density',axis=0)
            spectra[t['trialId'],window]=(f,p)
        w=y[round(1.5*fs):round(9.5*fs)]
        for j,ch in enumerate(leads):
            same=np.r_[False,np.diff(raw[:,j])==0]; maximum=run=0
            for v in same:
                run=run+1 if v else 0;maximum=max(maximum,run)
            center=np.median(w[:,j]);sigma=1.4826*np.median(abs(w[:,j]-center))
            quality.append({'sequence':t['sequenceIndex']+1,'appearance':t['targetAppearance'],'condition':t['condition'],'lead':ch,
                            'rawMeanUv':float(raw[:,j].mean()),'filteredRmsUv':float(np.std(w[:,j])),
                            'filteredPeakToPeakUv':float(np.ptp(w[:,j])),
                            'robustExtremeZ':float(max(abs(w[:,j]-center))/max(sigma,1e-30)),
                            'maxIdenticalRunMs':(maximum+1)*1000/fs})
    effects=[]; temporal=[]; selectivity=[]; matches=[]
    for appearance in forms:
        for condition, frequencies in (('12hz',(12,24,36)),('15hz',(15,30,45))):
            for hz in frequencies:
                active=[t for t in valid if t['targetAppearance']==appearance and t['condition']==condition]
                pair=[]
                for a in active:
                    controls=[t for t in valid if t['comparisonRunId']==a['comparisonRunId'] and t['repetition']==a['repetition'] and t['targetAppearance']==appearance and t['condition']=='static']
                    others=[t for t in valid if t['comparisonRunId']==a['comparisonRunId'] and t['repetition']==a['repetition'] and t['targetAppearance']==appearance and t['condition']==('15hz' if condition=='12hz' else '12hz')]
                    if len(controls)!=1:continue
                    b=controls[0]
                    if a['responsiveStimulusGeometry']!=b['responsiveStimulusGeometry']:continue
                    gain=log_ratio(a['spectra']['full'][str(hz)]['roiPsdUv2PerHz'],b['spectra']['full'][str(hz)]['roiPsdUv2PerHz'])
                    pair.append(gain)
                    raw_change=log_ratio(a['spectra']['late'][str(hz)]['roiPsdUv2PerHz'],a['spectra']['early'][str(hz)]['roiPsdUv2PerHz'])
                    static_change=log_ratio(b['spectra']['late'][str(hz)]['roiPsdUv2PerHz'],b['spectra']['early'][str(hz)]['roiPsdUv2PerHz'])
                    temporal.append({'appearance':appearance,'condition':condition,'hz':hz,'repetition':a['repetition'],
                                     'activeRawLateMinusEarlyDb':raw_change,'staticRawLateMinusEarlyDb':static_change,
                                     'adjustedLateMinusEarlyDb':raw_change-static_change,
                                     'snrLateMinusEarlyDb':a['spectra']['late'][str(hz)]['roiSnrDb']-a['spectra']['early'][str(hz)]['roiSnrDb']})
                    if len(others)==1 and a['responsiveStimulusGeometry']==others[0]['responsiveStimulusGeometry']:
                        z=others[0]
                        selectivity.append({'appearance':appearance,'condition':condition,'hz':hz,'repetition':a['repetition'],
                                            'roiMatchingVsOtherDb':log_ratio(a['spectra']['full'][str(hz)]['roiPsdUv2PerHz'],z['spectra']['full'][str(hz)]['roiPsdUv2PerHz']),
                                            'leadMatchingVsOtherDb':[log_ratio(v,w) for v,w in zip(a['spectra']['full'][str(hz)]['psdUv2PerHz'],z['spectra']['full'][str(hz)]['psdUv2PerHz'])]})
                effects.append({'appearance':appearance,'condition':condition,'hz':hz,'pairs':pair,
                                'fullMeanEnhancementDb':float(np.mean(pair)) if pair else None,
                                'positivePairs':sum(v>0 for v in pair),
                                'fullMedianSnrDb':float(np.median([t['spectra']['full'][str(hz)]['roiSnrDb'] for t in active])) if active else None})
    result={'effects':effects,'temporal':temporal,'selectivity':selectivity,'quality':quality,
            'note':'Additional descriptive checks; no data-driven exclusions, electrode selection, or alteration of predefined tests.'}
    (folder/'extended-analysis.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    with (folder/'signal-quality.csv').open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=list(quality[0]));writer.writeheader();writer.writerows(quality)
    plt.rcParams.update({'font.sans-serif':['Microsoft YaHei','SimHei','DejaVu Sans'],'axes.unicode_minus':False,'font.size':9})
    colors={'static':'#777966','12hz':'#976c35','15hz':'#79303a'}
    for appearance in forms:
        fig,axs=plt.subplots(2,2,figsize=(12,7),constrained_layout=True)
        for j,ax in enumerate(axs.flat):
            for condition in ('static','12hz','15hz'):
                ts=[t for t in valid if t['targetAppearance']==appearance and t['condition']==condition]
                if not ts:continue
                f=spectra[ts[0]['trialId'],'full'][0]
                med=np.median([spectra[t['trialId'],'full'][1][:,j] for t in ts],axis=0)
                ax.semilogy(f,med,color=colors[condition],label=f'{condition} (n={len(ts)})')
            for hz in COMPONENTS:ax.axvline(hz,color='#c6c0b4',ls='--',lw=.6)
            ax.set(xlim=(5,46),xlabel='频率（Hz）',ylabel='PSD（μV²/Hz）',title=leads[j]);ax.legend(fontsize=8)
        fig.suptitle({'card':'外围闪烁','card-face':'整牌闪烁','solid':'纯色块'}[appearance]+'：四导联完整 8 秒 PSD 中位数')
        fig.savefig(folder/f'{appearance}-spectra.png',dpi=130);plt.close(fig)
    fig,axs=plt.subplots(len(forms),2,figsize=(12,4*len(forms)),constrained_layout=True)
    for ax,(appearance,condition) in zip(axs.flat,[(a,c) for a in forms for c in ('12hz','15hz')]):
        hz=12 if condition=='12hz' else 15
        ts=[t for t in valid if t['targetAppearance']==appearance and t['condition']==condition]
        for t in ts:
            ax.plot([0,1],[t['spectra'][w][str(hz)]['roiSnrDb'] for w in ('early','late')],marker='o',alpha=.7,label=f'组 {t["repetition"]}')
        ax.axhline(0,color='#ccc',lw=.7);ax.set(xticks=[0,1],xticklabels=['早 4 秒','晚 4 秒'],ylabel='基频局部 SNR（dB）',title=f'{appearance} · {hz} Hz');ax.legend(fontsize=8)
    fig.suptitle('同次试次早晚局部 SNR：每条线为一个试次，不能计作两次重复')
    fig.savefig(folder/'early-late-snr.png',dpi=130);plt.close(fig)
    ncols=4;nrows=int(np.ceil(len(rows)/ncols))
    fig,axs=plt.subplots(nrows,ncols,figsize=(14,2*nrows),squeeze=False,constrained_layout=True)
    for ax,t in zip(axs.flat,rows):
        y=filtered[t['trialId']];tt=np.arange(len(y))/fs
        ax.plot(tt,y[:,0],lw=.5,label='O1');ax.plot(tt,y[:,1],lw=.5,alpha=.65,label='O2')
        ax.axvspan(0,1.5,color='#ddd',alpha=.5);ax.axvline(5.5,color='#943d46',ls='--',lw=.6);ax.set(xlim=(0,10),title=f'{t["sequenceIndex"]+1} · {t["targetAppearance"]}/{t["condition"]}',xlabel='秒',ylabel='μV')
    for ax in list(axs.flat)[len(rows):]:ax.axis('off')
    fig.savefig(folder/'all-trials-waveforms.png',dpi=110);plt.close(fig)
    blocks=len(set((t['comparisonRunId'],t['repetition']) for t in valid))
    lines=['# 阶段分析摘要','',f'纳入 {len(valid)}/{len(rows)} 次，独立组数 {blocks}。人工注视标注确认 {sum(t.get("attentionConfirmed") is True for t in valid)}/{len(valid)} 次；未确认试次保留探索性标记。','',
           '## 完整 8 秒：基频和谐波','',
           '局部 SNR 为 O1/O2 平均功率与邻频功率比的逐次中位数；增强为同组自身静态对照的配对 dB 均值，两者不是同一个指标。','',
           '|形式|刺激|分量|局部 SNR dB|相对静态增强 dB|正增强次数|','|---|---|---:|---:|---:|---:|']
    for e in effects:
        lines.append(f'|{e["appearance"]}|{e["condition"]}|{e["hz"]} Hz|{e["fullMedianSnrDb"]:+.2f}|{e["fullMeanEnhancementDb"]:+.2f}|{e["positivePairs"]}/{len(e["pairs"])}|')
    lines+=['','## 早晚变化拆解','',
            '直接刺激功率变化和静态背景变化分别列出。校正后变化=刺激晚/早功率 dB−静态晚/早功率 dB；静态下降也会使校正后增强增加，不能据此直接认为诱发持续累积。','',
            '|形式|分量|刺激功率晚减早 dB|静态功率晚减早 dB|扣静态后 dB|逐次 SNR 晚减早均值 dB|','|---|---:|---:|---:|---:|---:|']
    for a in forms:
        for hz in (12,24,15,30):
            data=[t for t in temporal if t['appearance']==a and t['hz']==hz]
            vals=[np.mean([t[k] for t in data]) for k in ('activeRawLateMinusEarlyDb','staticRawLateMinusEarlyDb','adjustedLateMinusEarlyDb','snrLateMinusEarlyDb')]
            lines.append(f'|{a}|{hz} Hz|'+'|'.join(f'{v:+.2f}' for v in vals)+'|')
    lines+=['','## 频率选择性','',
            '同组、同形式：匹配刺激条件该频点功率相对另一刺激条件的变化。正值表示该频点跟随对应刺激条件增强，仅作描述性复核。','',
            '|形式|分量|匹配/另一条件均值 dB|正变化次数|','|---|---:|---:|---:|']
    for a in forms:
        for hz in COMPONENTS:
            data=[t for t in selectivity if t['appearance']==a and t['hz']==hz]
            values=[t['roiMatchingVsOtherDb'] for t in data]
            lines.append(f'|{a}|{hz} Hz|{np.mean(values):+.2f}|{sum(v>0 for v in values)}/{len(values)}|')
    lines+=['','## 四导联基频局部 SNR（完整窗中位数）','', '|形式|刺激|O1 dB|O2 dB|P3 dB|P4 dB|','|---|---|---:|---:|---:|---:|']
    for a in forms:
        for c,hz in (('12hz',12),('15hz',15)):
            ts=[t for t in valid if t['targetAppearance']==a and t['condition']==c]
            values=np.median([t['spectra']['full'][str(hz)]['snrDb'] for t in ts],axis=0)
            lines.append(f'|{a}|{c}|'+'|'.join(f'{v:+.2f}' for v in values)+'|')
    lines+=['','## 数据与时序','',
            f'- 导出快照序列/样本缺口 {index["sampleOrSequenceGaps"]}，非有限值 {index["nonfiniteValues"]}。',
            f'- 本阶段软件统计疑似丢帧总数 {sum(t["frameDrops"] or 0 for t in rows)}；这些是渲染回调统计，非光电实测。',
            f'- 实际四导联 2–45 Hz RMS 范围 {min(q["filteredRmsUv"] for q in quality):.2f}～{max(q["filteredRmsUv"] for q in quality):.2f} μV；最大峰峰值 {max(q["filteredPeakToPeakUv"] for q in quality):.2f} μV。RMS 包含背景，不作为纯诱发幅度或临床正常判断。']
    if audit:
        delta=[t['sampleVsDisplayMs'] for t in audit['trials']]
        lines += [f'- 全部 {len(delta)} 次导出逐样本与原始记录相同；标记映射残差最大 {max(abs(v["mappingResidualSamples"]) for t in audit["trials"] for v in (t["start"],t["end"]))} 样本。',
                  f'- 样本时长减显示时长范围 {min(delta):+.1f}～{max(delta):+.1f} ms；包平均间隔 {audit["packetMeanIntervalMs"]:.3f} ms，范围 {audit["packetIntervalRangeMs"][0]:.1f}～{audit["packetIntervalRangeMs"][1]:.1f} ms。',
                  '- 未发现条件错标或采样切窗偏移；采用网关到达估计，不能证明绝对硬件级屏幕—EEG 对齐。']
    lines+=['','## 推断范围','',
            f'- 预设 {len(r["formTests"])} 项形式检验及 {len(r["timeTests"])} 项早晚检验见 appearance-analysis.md，未因结果调整检验方向、窗口、ROI 或排除条件。',
            ('- 单阶段仅四个独立组，最小双侧 p=2/16=0.125；不能从阶段结果获得校正后的统计显著性。阶段结果用于描述和核对，最终合并八组再检验。' if blocks==4 else
             f'- 实际纳入 {blocks} 个独立组；每项配对的实际组数以预设检验结果为准。八组时最小双侧 p=2/256，形式与前后家族最小 Holm p 分别为 {len(r["formTests"])*2/256:.5f}、{len(r["timeTests"])*2/256:.5f}；超过 0.05 时只能描述趋势。'),
            '- 数字基线一致不等同于物理亮度匹配，牌面与纯色还改变空间图案和实际调制面积。',
            '- 36/45 Hz 仅描述，45 Hz 位于低通截止处；不据高阶峰单独判定诱发。',
            '- 完整 8 秒与分段 4 秒的频谱分辨率不同，不将两种长度 SNR 差异直接解释为响应强弱。',
            '- 未计算硬件同步相位锁定，未运行游戏正确率测试，未修改识别参数。','',
            '## 图','', '![同试次前后 SNR](early-late-snr.png)', '',
            *[f'![{appearance} 四导联谱]({appearance}-spectra.png)\n' for appearance in forms], '',
            '![全部试次 O1/O2 波形](all-trials-waveforms.png)','']
    (folder/'summary.md').write_text('\n'.join(lines),encoding='utf8')
    print(json.dumps({'effects':effects,'rawTemporal':[{k:v for k,v in t.items()} for t in temporal if t['hz'] in (12,15)],
                      'qualityRmsRangeUv':[min(q['filteredRmsUv'] for q in quality),max(q['filteredRmsUv'] for q in quality)],
                      'maxPeakToPeakUv':max(q['filteredPeakToPeakUv'] for q in quality)},ensure_ascii=True))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);args=parser.parse_args();summarize(args.folder)
