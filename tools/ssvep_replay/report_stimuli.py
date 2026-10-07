"""Scientific figures and descriptive summary from the read-only comparison export."""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from tools.ssvep_replay.compare_stimuli import metrics


def spectrum(raw, fs):
    sos = np.vstack((signal.butter(4, 2, 'highpass', fs=fs, output='sos'),
                     signal.butter(4, 45, 'lowpass', fs=fs, output='sos')))
    zi = signal.sosfilt_zi(sos)[:, :, None]*raw[0][None, None, :]
    filtered, _ = signal.sosfilt(sos, raw, axis=0, zi=zi)
    samples = filtered[round(1.25*fs):round(5.25*fs)]
    return signal.welch(samples, fs=fs, window='hann', nperseg=len(samples),
                        noverlap=0, detrend='constant', scaling='density', axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    r = json.loads((args.directory/'stimulus-comparison.json').read_text(encoding='utf8'))
    index = json.loads((args.directory/'index.json').read_text(encoding='utf8'))
    fs = index['sampleRateHz']
    valid = [t for t in r['trials'] if t['metrics']]
    fmt = lambda values: ' / '.join(f'{v:.2f}' for v in values[:2])
    lines = ['# 12 次真实刺激对照分析', '',
        f'会话：`{index["sessionId"]}`；250 Hz；O1 / O2 / P3 / P4；单位 μV。', '',
        '方法：每次取刺激标记后 1.25–5.25 秒的 4 秒窗，2–45 Hz 因果带通、去均值、Hann PSD，频点间隔 0.25 Hz。前置静息取结束前同长数据，采用相同处理。', '',
        '## 结论', '',
        '- 12 次起止记录完整，原始采集无序号/样本断档、无非有限值；12 次渲染均 361 帧，约 59.88 Hz，疑似丢帧 0，最大帧间隔 17.8 ms。软件统计不能替代光电测量。',
        '- 第 3 次（15 Hz 纯色）渲染约 6 秒，但采样标记覆盖 6.344 秒；首标记对应的最后已到达样本比其余试次落后约 0.34 秒。主要比较排除这次，其余 11 次可用，形成 5 对完整比较。该问题属于标记/采集到达时间不齐，不能说刺激多闪了 0.34 秒。',
        '- 12 Hz 纯色的 24 Hz 二次谐波在 O1/O2 三次均为正局部 SNR，较牌面更突出；基波优势并非每次都一致。存在频率相关响应线索，但仍需确认实际注视。',
        '- 与各次前置静息比较，12 Hz 纯色的 24 Hz 谐波仅 2/3 次增强，第 2 次重复低于静息。因此这里的线索仍不能当作已经验证的稳定诱发。',
        '- 15 Hz 在 O1/O2 缺乏重复稳定的基波及 30 Hz 谐波增强；不能判定纯色块全面优于扑克牌，也不能据此证明游戏已稳定可玩。',
        '- 频带 RMS 含背景脑电，不能称为纯 SSVEP 诱发幅度；本测试无法判断是否达到某个通用“正常幅度”。', '',
        '## 分组结果', '',
        '以下为每导联分别计算、再跨重复取中位数，列出 O1 / O2；没有先平均原始波形。SNR 是目标 PSD 与 ±0.5–1 Hz 邻近频点均值的比值（dB），不是识别正确概率。', '',
        '|频率 / 形式|有效重复|基波 SNR（dB）|二次谐波 SNR（dB）|基波频带 RMS（μV）|',
        '|---|---:|---|---|---|']
    summaries = []
    fig, axes = plt.subplots(2, 2, figsize=(12, 7), constrained_layout=True)
    colors = {'card': '#793033', 'solid': '#326553'}
    for row, hz in enumerate((12, 15)):
        displayed_power = []
        for form in ('card', 'solid'):
            ts = [t for t in valid if t['frequencyHz'] == hz and t['targetAppearance'] == form]
            summary = {'frequencyHz': hz, 'appearance': form, 'n': len(ts)}
            for key, order, metric in (('fundamentalSnrDb', '1', 'snrDb'), ('harmonicSnrDb', '2', 'snrDb'), ('bandRmsUv', '1', 'bandRmsUv')):
                summary[key] = np.median([t['metrics'][order][metric] for t in ts], axis=0).tolist()
            summaries.append(summary)
            lines.append(f'|{hz} Hz / {"扑克牌" if form == "card" else "纯色块"}|{len(ts)}|{fmt(summary["fundamentalSnrDb"])}|{fmt(summary["harmonicSnrDb"])}|{fmt(summary["bandRmsUv"])}|')
            psds, idle = [], []
            for t in ts:
                f, p = spectrum(np.fromfile(args.directory/t['file'], dtype='<f4').reshape(-1, 4), fs)
                psds.append(p[:, :2].mean(axis=1))  # PSD mean, not waveform mean.
                if t['baselineFile']:
                    b = np.fromfile(args.directory/t['baselineFile'], dtype='<f4').reshape(-1, 4)
                    _, bp = spectrum(b[-round(5.25*fs):], fs)
                    idle.append(bp[:, :2].mean(axis=1))
            axes[row, 0].semilogy(f, np.median(psds, axis=0), color=colors[form], label=f'{form} (n={len(ts)})')
            axes[row, 0].semilogy(f, np.median(idle, axis=0), color=colors[form], alpha=.5, ls=':', label=f'{form} pre-rest')
            visible = (f >= 5) & (f <= 35)
            displayed_power.extend(np.median(psds, axis=0)[visible])
            displayed_power.extend(np.median(idle, axis=0)[visible])
            xs = [t['repetition'] + (-.07 if form == 'card' else .07) for t in ts]
            for order, marker in (('1', 'o'), ('2', '^')):
                ys = [np.mean(t['metrics'][order]['snrDb'][:2]) for t in ts]
                axes[row, 1].scatter(xs, ys, c=colors[form], marker=marker, label=f'{form} '+('f' if order == '1' else '2f'))
        axes[row, 0].set(xlim=(5, 35), xlabel='Frequency (Hz)', ylabel='PSD (μV²/Hz)', title=f'{hz} Hz: median O1/O2 mean PSD')
        axes[row, 0].set_ylim(max(min(displayed_power)*.65, 1e-8), max(displayed_power)*1.5)
        for target in (hz, hz*2):
            axes[row, 0].axvline(target, color='#777777', lw=.8, ls='--')
        axes[row, 1].axhline(0, color='#777777', lw=.8)
        axes[row, 1].set(xticks=(1, 2, 3), xlabel='Repetition', ylabel='Local SNR (dB)', title=f'{hz} Hz: O1/O2 mean SNR per trial')
        for ax in axes[row]:
            ax.grid(alpha=.15); ax.legend(fontsize=8)
    fig.savefig(args.directory/'comparison-summary.png', dpi=170)
    plt.close(fig)
    lines += ['', '## 逐次数据与静息对照', '',
              '|次序|形式 / 频率|基波 SNR：O1 / O2|静息基波 SNR|二次谐波 SNR|静息二次谐波 SNR|基波频带 RMS：O1 / O2（μV）|用途|', '|---|---|---|---|---|---|---|---|']
    for t in sorted(r['trials'], key=lambda t: t['sequenceIndex']):
        m = t['metrics']
        b = t['baselineMetrics']
        if not m:
            raw = np.fromfile(args.directory/t['file'], dtype='<f4').reshape(-1, 4)
            m = metrics(raw, fs, t['targets'][t['cueIndex']]['frequencyHz'])
        hz = t['targets'][t['cueIndex']]['frequencyHz']
        lines.append(f'|{t["sequenceIndex"]+1}|{t["targetAppearance"]} / {hz} Hz|{fmt(m["1"]["snrDb"])}|{fmt(b["1"]["snrDb"]) if b else "—"}|{fmt(m["2"]["snrDb"])}|{fmt(b["2"]["snrDb"]) if b else "—"}|{fmt(m["1"]["bandRmsUv"])}|{"排除：采样标记偏差" if t["excludeReasons"] else "主要比较"}|')
    lines += ['', '## 限制与修改方向', '',
        '- 所有原始标记均未自动确认注视；用户报告已完成 12 次，但是否每次按提示持续注视仍需本人确认。这里是探索性分析。',
        '- 12 Hz 静息也可能有同频背景（第 2 次前置静息 O1/O2 局部 SNR 约 9 dB）；不能仅看 12 Hz 有峰就判定诱发。24 Hz 与重复一致性提供补充信息。',
        '- 15 Hz 若把第 3 次未对齐数据纳入，纯色 O1/O2 基波中位数仍为 -2.61 / -1.58 dB，方向未转为稳定增强。',
        '- 两种形式同位置、同外框，但牌面中心静止，纯色整块闪烁。外框约 207×269 CSS px，牌面约 156×218 px；不计圆角的可见闪烁面积比约 2.54 倍，同时存在空间亮度/图案差异，不能只归因为面积。',
        '- 这轮先保留强度、频率、识别门槛，给纯色块加入与牌面一致的固定中心注视点，改善注视定位。之后用新协议复核 15 Hz，并单独验证游戏选牌正确/错误/拒识率。',
        '- 尚未验证显示器物理光输出；没有新增 Oz、没有个人校准，也没有根据这批小样本调低识别门槛。', '',
        '![频谱和逐次 SNR](comparison-summary.png)']
    (args.directory/'analysis-report.md').write_text('\n'.join(lines), encoding='utf8')
    (args.directory/'group-summary.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(summaries, ensure_ascii=False))


if __name__ == '__main__':
    main()
