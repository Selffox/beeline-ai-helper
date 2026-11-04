# 芯位学习助手（Beeline Fox）

> 芯位蜜线 / 芯位教育（beeline-ai.com）的自动刷课脚本。
> 基于 [lxjuyn/xinwei-beeline-auto](https://github.com/lxjuyn/xinwei-beeline-auto)（GPL-3.0）重构。
> 原作者：Zerox（原版）、lxjuyn（新域名适配）。

## 安装

脚本文件：`xinwei-beeline-helper.user.js`

### 方式一：脚本猫（ScriptCat）（推荐）

1. 打开 [脚本猫官网](https://scriptcat.org/)，安装浏览器扩展
2. 用法教程见官方文档：[https://docs.scriptcat.org/docs/use/use](https://docs.scriptcat.org/docs/use/use)
3. 打开脚本猫商店页，点「安装脚本」：

   **https://scriptcat.org/zh-CN/script-show-page/8841**

4. 也可以直接用 raw 地址安装，或把链接粘贴到脚本猫的「导入」里：

   **https://raw.githubusercontent.com/Selffox/beeline-ai-helper/main/xinwei-beeline-helper.user.js**

### 方式二：Tampermonkey

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开下面的链接，Tampermonkey 会自动弹出安装页，点「安装」：

   **https://raw.githubusercontent.com/Selffox/beeline-ai-helper/main/xinwei-beeline-helper.user.js**

3. 装好后在脚本列表里显示为「芯位学习助手」（英文环境显示「Beeline Fox」）

> 两种管理器二选一即可，同一浏览器不要同时装两个管理器运行同一个脚本。

### 首次运行

- 浏览器会询问是否允许访问 `tk.enncy.cn`（题库），点**允许**
- 刷新课程页面，左下角出现一条 40px 状态条即安装成功

## 基于前者优化了什么

与项目底座 lxjuyn/xinwei-beeline-auto 对比：

| 项目 | lxjuyn 版 | 本版 0.10.4 |
|---|---|---|
| 包体与依赖 | 22.5 KiB 单文件 | **55.4 KiB 单文件，零依赖、不连 CDN** |
| 跳转时机 | 固定延迟点按钮 | **只认平台自己弹出的完成浮层** |
| 完成判定 | 看目录图标是否打勾 | **读平台学习进度，要求真实观看 ≥99.5%** |
| 播放卡住 | 无处理 | **三级重试：重试播放 → 刷新 → 停止** |
| 倍速 | 直接设 `playbackRate` | **只点平台自带倍速菜单，被拒回退 1x** |
| 答题 | 无 | **题库优先 → 本地缓存 → AI 兜底，且有匹配校验** |
| 面板 | 可折叠面板 | **40px 状态条 + 主面板 + 三页签 + ⓘ 关于页** |
| 更新方式 | 仓库手动 | **本仓库 raw 链接 + `@updateURL` 自动更新** |

其中两处是实测差异，不是猜测：

- 平台在**已观看 85%~91%** 时就会把小节标记为完成，按图标判定会**提前跳**；本版改为读平台学习进度，要求真实观看达到 99.5% 才跳。
- 题库返回的题目可能是「相似题」（例如把「以下哪个**是**」答成「以下哪个**不是**」）。本版加了否定词一致性与题干相似度校验，**宁可留空也不填错**。

## 功能

- **自动刷课**：自动播放、自动静音、切后台继续播放
- **播完才跳**：只认平台自己的完成浮层，不抢跑
- **跳过已完成**：按平台学习进度的真实观看秒数判断
- **平台倍速**：只点播放器自带的倍速菜单（最高档）；平台没提供就保持 1x
- **三级重试**：播放停滞 60 秒 → 重试播放 → 刷新页面（每节最多 2 次）→ 停止
- **AI 答题（测试）**：题库优先（言溪题库）→ 本地缓存 → 可选 AI 兜底；默认只填不提交，作业页可一键提交（需二次确认），考试页不提交
- **题目匹配校验**：否定词一致性 + 题干相似度，防止把「相似题」的答案填错
- **极简面板**：平时一条 40px 状态条，点开才显示主面板

## 配置

点左下角状态条 → ⚙ 设置，三个页签（「关于」是右上角 ⓘ 单独的一页，不在页签里）：

| 页签 | 说明 |
|---|---|
| 播放 | 自动静音 / 播完下一节 / 跳过已完成 / 平台倍速 / 非视频停留（秒） |
| 答题 | 言溪题库 token（必填）、📖 配置教程、🔑 取 token、AI Key（可选） |
| 日志 | 操作日志 |

ⓘ **关于页**（独立，不在页签里）：版本 · GPL-3.0 · 维护者 · GitHub · 重置所有设置。

题库 token 获取：登录 [言溪题库](https://tk.enncy.cn/) → 个人中心 → 更多配置，复制 token。

## 致谢

本项目的思路与实现参考了以下项目，在此感谢作者：

| 项目 | 作者 | 借鉴内容 |
|---|---|---|
| [lxjuyn/xinwei-beeline-auto](https://github.com/lxjuyn/xinwei-beeline-auto) | lxjuyn | 项目底座（GPL-3.0）：刷课主流程、章节切换、面板结构 |
| [poi-yee/51xinweiauto](https://github.com/poi-yee/51xinweiauto) | PoiYee | 更早的原型（GPL-3.0），明确了平台接口与页面结构 |
| [芯位网课辅助 (Xinwei AutoStudy)](https://scriptcat.org/zh-CN/script-show-page/8163) | wikkd | 作业页 DOM 选择器（.homework-*）、提交前安全校验（未作答提示 / 按钮禁用）、平台风控提示监听、逐题确认模式思路（MIT） |
| [XF芯位](https://scriptcat.org/zh-CN/script-show-page/6630) | XF | 首次运行免责声明的写法 |
| [言溪题库](https://tk.enncy.cn/) | 言溪 | 题库查询 API |
| [OCS 网课助手文档](https://docs.ocsjs.com/docs/work) | OCS | 题库配置教程 |

脚本图标（狐狸读书）由 [marktuwen1179-gif](https://github.com/marktuwen1179-gif) 提供，已获授权使用。原始文件见 [](assets/fox.jpg)。

lxjuyn 与 poi-yee 的项目为 GPL-3.0，本仓库同样以 GPL-3.0 发布；
AutoStudy 为 MIT，本项目仅借鉴其思路与页面选择器，未复制其代码。

## 来源与许可

- 本仓库是 [lxjuyn/xinwei-beeline-auto](https://github.com/lxjuyn/xinwei-beeline-auto) 的二次开发版本
- 更早的原型：[poi-yee/51xinweiauto](https://github.com/poi-yee/51xinweiauto)
- 改动：去掉 Vue / SystemJS 打包，改为单文件原生 JS；重写刷课判定，新增完成度判定、平台倍速、三级重试、题库/AI 答题
- 许可：**GPL-3.0**，见 [LICENSE](LICENSE)。原作者署名保留（Zerox · lxjuyn）

同一个页面**只启用一个**刷课脚本，多个会互相抢节。

## 免责声明

仅供个人学习与测试使用，禁止商业用途。使用风险自负，作者不对使用后果负责。
