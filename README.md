# CodePeer

AI 驱动的 LeetCode 代码分析助手，以侧边栏形式集成到力扣页面。支持 DeepSeek、OpenAI、Qwen、GLM 等多种 LLM，只需填入 API Key 即可使用。

### 快速开始

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 点击 [codepeer.user.js](codepeer.user.js) 安装脚本
3. 打开 LeetCode 题目页面，点击右侧紫色竖条展开面板
4. 在设置中选择模型厂商、填入 API Key，保存
5. 点击「分析代码」按钮，AI 会自动读取题目和你的代码并给出分析

### 功能

- 分析代码：检查正确性、分析复杂度、指出边界问题
- 优化建议：给出时间/空间优化方案
- 解释思路：用通俗语言讲解算法逻辑

自动提取当前页面的题目描述和编辑器代码，发送给 LLM 分析。主题自适应 LeetCode 深色/浅色模式。
