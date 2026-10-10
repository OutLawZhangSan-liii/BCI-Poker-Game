# 神工神游 Windows 版本说明

## 软件撰写信息

| 项目 | 当前交付版本 |
| --- | --- |
| 产品名称 | 神工 · 神游 |
| Windows 程序名称 | 神工神游 |
| 当前版本 | 0.1.4（实验测试版本） |
| 主程序 | ShengongShenyou.exe |
| 平台 | Windows 10/11，64 位 x64 |
| 前端 | React、TypeScript、Vite；Electron 37.10.3 |
| 网关 | 内置 Python 3.12.14 标准库程序；PyInstaller 6.16.0 打包 |
| 安装形式 | NSIS 离线安装包，当前用户安装，桌面与开始菜单快捷方式 |
| 功能 | 游戏牌桌、教学模式、设备与实验；真实 EEG 接入、刺激呈现、信号观察、FBCCA 选牌及本地会话记录 |
| 采集依赖 | 使用真实 EEG 时仍需厂商采集软件及其数据服务；默认地址 127.0.0.1:7110 |

本版在已有打包支持上增加专属图标及一体式窗口栏。刺激参数、识别算法和页面业务流程沿用当前项目。当前版本为 0.1.4，软件文档宜与此版本对应。

本版采用用户提供的黑底白色神经元图标，用于主程序、任务栏、快捷方式及安装/卸载程序。顶部为深绿一体式窗口栏，包含品牌、页面导航、采集状态和系统原生窗口按钮；默认英文菜单栏已移除。

三个页面品牌下方的小字已移除，顶部只显示“神工 · 神游”；界面图标的黑色背景融合进深绿色窗口栏。

0.1.4 为顶部品牌和开场标题统一采用用户选中的定制瘦金风格四字字标，以本地 SVG 资源显示，无需联网或额外安装字体。翻牌结束后的神经元逐笔显现、文字出现和停留时长保持原有顺序。

## 安装与运行

1. 双击 `Shengong-Shenyou-Setup-0.1.4-x64.exe`，选择安装目录并完成安装。
2. 双击桌面“神工神游”快捷方式启动。
3. 无需另装 Node.js 或 Python；安装完成后启动界面无需互联网。
4. 正式脑控实验前，打开厂商采集软件及数据服务，再在应用中连接设备并开始采集。

安装包和主程序尚未使用代码签名证书。Windows 可能显示“未知发布者”；请核对文件来源与交付目录的 SHA256 校验文件。

`release/0.1.4/win-unpacked/` 是免安装程序目录，双击其中的 `ShengongShenyou.exe` 即可运行。复制到其他电脑时必须复制整个目录，不能只复制主 exe。

## 卸载与数据位置

- Windows 设置 → 应用 → 已安装的应用 → 神工神游 → 卸载。
- 也可运行安装目录内的 `Uninstall ShengongShenyou.exe`。
- 卸载程序删除软件文件与快捷方式，保留用户文档中的 `BrainGame/Sessions/` 实验会话及应用数据。
- 日志和本地设置位于用户 `%APPDATA%/brain-game-desktop/`。需要清理时，应先备份实验数据，再手动处理相应用户目录。

不将原始 EEG、个人实验报告、开发缓存或分析虚拟环境打入安装包。

## 从源码重新构建

需要 Windows x64、Node.js/npm、Python 3.9 或更新版本及首次下载依赖所需的网络。本次使用 Python 3.12.14 构建网关。

```powershell
npm ci
npm run typecheck
npm test
npm run dist:win
```

第一次构建网关会创建项目内 `.venv-release`。如果系统 `python` 不是需要的构建版本，可先执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/build-gateway.ps1 -Python "C:\path\to\python.exe"
```

安装器工具从 electron-builder 官方下载地址获取并校验。网络无法访问时可在构建终端设置镜像，不改变安装程序运行依赖：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist:win
```

打包文件由 `packaging/electron-builder.yml` 指定，Python 网关使用目录形式，避免单文件网关每次启动解压。文件输出到 `release/版本号/`，不会自动发布到 GitHub。

## 验证

```powershell
python packaging/verify-gateway.py release/0.1.4/win-unpacked/resources/device_gateway/device_gateway.exe
node packaging/verify-app.cjs release/0.1.4/win-unpacked/ShengongShenyou.exe
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/verify-install.ps1
```

这两项检查使用独立目录、移除开发工具搜索路径，验证网关认证与关闭、三个页面切换、内置资源和 preload。不会连接真实 EEG 设备或启动闪烁。交付目录的验证报告记录安装/卸载与构建结果；真实刺激输出、实验诱发效果与实验室电脑长期运行性能仍以实际实验测量为准。

打包参考：[electron-builder NSIS 文档](https://www.electron.build/nsis/)、[PyInstaller 使用文档](https://pyinstaller.org/en/stable/usage.html)。
