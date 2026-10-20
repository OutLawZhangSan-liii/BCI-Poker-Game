import type { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/** Runs only in an unpackaged window with a separate userData and no live gateway. */
export async function runChallengeSmoke(window: BrowserWindow, directory: string): Promise<void> {
  const report: Record<string, unknown> = { source: "isolated-simulation", startedAt: new Date().toISOString(), checks: [] };
  const checks = report.checks as string[];
  const evaluate = <T>(source: string): Promise<T> => window.webContents.executeJavaScript(source);
  const until = async (source: string, label: string, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate<boolean>(source)) { checks.push(label); return; }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`${label} 超时：${await evaluate<string>("document.body.innerText.slice(-1800)")}`);
  };
  const click = async (label: string) => {
    const clicked = await evaluate<boolean>(`(() => { const root = document.querySelector('dialog[open]') ?? document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled && b.getClientRects().length); if (!b) return false; b.focus(); b.click(); return true; })()`);
    if (!clicked) throw new Error(`找不到可点击的按钮：${label}`);
  };
  const capture = async (label: string) => {
    await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    await new Promise(resolve => setTimeout(resolve, 120));
    await fs.writeFile(path.join(directory, `${label}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const layout = async (label: string) => {
    const result = await evaluate<{ overflow: boolean; broken: number; width: number; height: number }>(`({ overflow: document.documentElement.scrollWidth > innerWidth + 1, broken: [...document.images].filter(i => !i.complete || !i.naturalWidth).length, width: innerWidth, height: innerHeight })`);
    if (result.overflow || result.broken) throw new Error(`${label} 布局异常 ${JSON.stringify(result)}`);
    report[label] = result; checks.push(label);
  };
  try {
    if (window.webContents.isLoadingMainFrame()) await new Promise<void>(resolve => window.webContents.once("did-finish-load", () => resolve()));
    await until("!!document.querySelector('.game-table-frame') && !!document.querySelector('.game-console__challenge') && document.body.innerText.includes('进行中') && !document.querySelector('dialog[open]') && !document.querySelector('input[name=studentId]')", "默认显示牌桌而非身份首页");
    window.setSize(960, 640);
    await new Promise(resolve => setTimeout(resolve, 150));
    await layout("setup-960"); await capture("setup-960");
    window.setSize(1920, 1080);
    await new Promise(resolve => setTimeout(resolve, 150));
    await layout("setup-1080"); await capture("setup-1080");
    await until("(() => { const c = document.querySelector('.game-console__challenge').getBoundingClientRect(), s = document.querySelector('.game-console__primary').getBoundingClientRect(); return c.bottom < s.top && document.querySelectorAll('.game-start-action button').length === 1 && document.querySelector('.game-start-action').textContent === '开始游戏'; })()", "轻量工具区与底部独立开始游戏入口");
    await click("三关挑战");
    await until("document.querySelector('dialog[open] .challenge-identity input[name=studentId]') !== null", "点击后打开精简身份弹窗");
    await until("document.querySelectorAll('dialog[open] input').length === 2 && !document.querySelector('dialog[open] details') && !document.querySelector('dialog[open] .challenge-resume')", "身份弹窗仅包含学号姓名");
    await until("[...document.querySelectorAll('dialog[open] .challenge-entry-tools button')].map(b => b.textContent).join(',') === '排行榜,继续挑战'", "排行榜和续玩入口位于身份弹窗内");
    await click("取消");
    await until("!document.querySelector('dialog[open]') && document.activeElement?.textContent === '三关挑战'", "取消关闭弹窗并归还焦点");
    await click("三关挑战");
    window.setSize(960, 640); await new Promise(resolve => setTimeout(resolve, 150));
    await layout("identity-960"); await capture("identity-960");
    window.setSize(1920, 1080); await new Promise(resolve => setTimeout(resolve, 150));
    await capture("identity-1080");
    await evaluate(`(() => { const set = (name, value) => { const input = document.querySelector('input[name="' + name + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }; set('studentId', '000123'); set('participantName', '模拟验收同学'); })()`);
    await until("![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下一步').disabled", "身份表单可提交");
    await click("排行榜");
    await until("!!document.querySelector('dialog[open] .challenge-leaderboard') && document.querySelectorAll('dialog[open]').length === 1", "弹窗内打开排行榜且不叠加遮罩");
    await click("关闭");
    await until("document.querySelector('dialog[open] input[name=studentId]')?.value === '000123' && document.querySelector('dialog[open] input[name=participantName]')?.value === '模拟验收同学'", "关闭排行榜后保留身份输入");
    await click("下一步");
    await until("document.querySelector('#challenge-entry-title')?.textContent === '挑战规则' && !document.querySelector('dialog[open] input')", "填写身份后显示简短规则");
    await capture("rules-1080");
    await click("开始挑战");
    await until("window.brainGameDesktop.listChallenges().then(x => x.records.some(r => r.rounds.filter(q => q.attempts.some(a => ['correct','incorrect','rejected'].includes(a.outcome))).length >= 2))", "完成前两轮");
    await click("← 退出本局");
    await until("!document.querySelector('.game-live') && !!document.querySelector('.game-console__challenge:not(:disabled)')", "退出后保留进度");
    window.webContents.reload();
    await until("!!document.querySelector('.game-console__challenge:not(:disabled)')", "重新加载后显示挑战入口");
    await click("三关挑战");
    await until("!![...document.querySelectorAll('dialog[open] button')].find(b => b.textContent === '继续挑战' && !b.disabled)", "挑战弹窗中可继续未完成记录");
    await click("继续挑战");
    await until("!!document.querySelector('dialog[open] .challenge-resume')", "续玩记录按需弹出");
    await click("继续");
    await until("document.querySelector('#challenge-result-title')?.textContent === '简单模式完成'", "简单10轮结算");
    await capture("simple-results-1080");
    await click("进入进阶");
    await until("document.querySelector('#challenge-result-title')?.textContent === '进阶模式完成'", "进阶10轮结算");
    await click("进入困难");
    await until("document.querySelector('#challenge-result-title')?.textContent === '三关挑战完成'", "困难10轮与三关总成绩");
    await layout("results-1080"); await capture("results-1080");
    window.setSize(960, 640); await new Promise(resolve => setTimeout(resolve, 150));
    await layout("results-960"); await capture("results-960");
    window.setSize(1920, 1080); await new Promise(resolve => setTimeout(resolve, 150));
    const records = await evaluate<any[]>("window.brainGameDesktop.listChallenges().then(x => x.records)");
    const completed = records.find(r => r.status === "completed");
    if (!completed || completed.studentId !== "000123" || completed.rounds.length !== 30 || completed.rounds.some((r: any) => r.attempts.filter((a: any) => ["correct", "incorrect", "rejected"].includes(a.outcome)).length !== 1)) throw new Error("完整记录或拒识不重试验收失败");
    report.challengeId = completed.id; report.completedRounds = completed.rounds.length;
    report.outcomes = completed.rounds.flatMap((r: any) => r.attempts).reduce((counts: any, a: any) => ({ ...counts, [a.outcome]: (counts[a.outcome] ?? 0) + 1 }), {});
    await click("返回首页");
    await until("!!document.querySelector('.game-console__primary') && !document.querySelector('dialog[open]') && !document.querySelector('input[name=studentId]')", "结算返回首页直接显示牌桌");
    await click("三关挑战"); await click("排行榜");
    await until("document.querySelector('.challenge-table .is-current') !== null", "排行榜高亮本次成绩");
    await click("展开"); await until("document.querySelectorAll('.challenge-table').length >= 2", "展开三关详情");
    await click("收起");
    for (const strategy of ["准确榜", "连胜榜", "综合榜"]) { await click(strategy); await until("document.querySelector('.challenge-table .is-current') !== null", `${strategy}展示成绩`); }
    await click("速度榜"); await until("document.body.innerText.includes('未达到速度榜70%')", "速度榜门槛说明");
    await click("综合榜");
    await capture("rankings-1080");
    window.setSize(960, 640); await new Promise(resolve => setTimeout(resolve, 150));
    await layout("rankings-960"); await capture("rankings-960");
    window.webContents.reload();
    await until("!!document.querySelector('.game-console__challenge') && !document.querySelector('dialog[open]')", "完成后重启回到牌桌");
    await click("三关挑战"); await click("排行榜"); await until("document.querySelectorAll('.challenge-leaderboard > .challenge-table-scroll tbody tr').length === 1", "重启后完整成绩仍存在");
    const alerts = await evaluate<string[]>("[...document.querySelectorAll('[role=alert]')].map(x => x.textContent)");
    if (alerts.length) throw new Error(`界面错误：${alerts.join(';')}`);
    await click("关闭"); await click("取消"); await click("开始游戏");
    await until("!!document.querySelector('.game-rules-modal')", "自由游戏规则入口");
    await evaluate("[...document.querySelectorAll('.game-rules-modal button')].find(b => b.textContent === '开始本局').click()");
    await until("document.querySelector('#game-results-title')?.textContent === '本局完成'", "自由游戏拒识仍完成10轮");
    await until("window.brainGameDesktop.listChallenges().then(x => x.records.length === 1)", "自由游戏不写入排名记录");
    report.success = true;
  } catch (error) { report.success = false; report.error = String(error); await capture("failure"); throw error; }
  finally { report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(directory, "challenge-smoke.json"), JSON.stringify(report, null, 2)); console.log(`CHALLENGE_SMOKE_RESULT=${JSON.stringify(report)}`); }
}
