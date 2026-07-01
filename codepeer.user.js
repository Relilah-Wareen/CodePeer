// ==UserScript==
// @name         CodePeer
// @namespace    https://github.com/Relilah-Wareen/CodePeer
// @version      1.0.0
// @description  AI-powered code analysis sidebar for LeetCode. Bring your own API key — supports DeepSeek, OpenAI, Qwen, GLM and any OpenAI-compatible endpoint.
// @author       Relilah-Wareen
// @license      MIT
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.cn/problems/*
// @match        https://www.leetcode.com/problems/*
// @match        https://www.leetcode.cn/problems/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    //  SECTION 1: Provider Presets
    // ============================================================

    const AI_PROVIDER_PRESETS = [
        {
            id: 'deepseek',
            label: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            defaultModel: 'deepseek-chat',
            apiKeyPlaceholder: 'sk-...',
            models: [
                { label: 'DeepSeek Chat', value: 'deepseek-chat', recommended: true },
                { label: 'DeepSeek Reasoner', value: 'deepseek-reasoner' }
            ]
        },
        {
            id: 'openai',
            label: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-4o-mini',
            apiKeyPlaceholder: 'sk-...',
            models: [
                { label: 'GPT-4o Mini', value: 'gpt-4o-mini', recommended: true },
                { label: 'GPT-4o', value: 'gpt-4o' },
                { label: 'GPT-4.1', value: 'gpt-4.1' }
            ]
        },
        {
            id: 'dashscope',
            label: 'Qwen (DashScope)',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            defaultModel: 'qwen-plus',
            apiKeyPlaceholder: 'sk-...',
            models: [
                { label: 'Qwen Plus', value: 'qwen-plus', recommended: true },
                { label: 'Qwen Max', value: 'qwen-max' },
                { label: 'Qwen Turbo', value: 'qwen-turbo' }
            ]
        },
        {
            id: 'zhipu',
            label: 'Zhipu (GLM)',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            defaultModel: 'glm-4-flash',
            apiKeyPlaceholder: '填写智谱 API Key',
            models: [
                { label: 'GLM-4 Flash', value: 'glm-4-flash', recommended: true },
                { label: 'GLM-4', value: 'glm-4' },
                { label: 'GLM-4 Plus', value: 'glm-4-plus' }
            ]
        },
        {
            id: 'custom',
            label: '自定义',
            baseUrl: '',
            defaultModel: '',
            apiKeyPlaceholder: 'sk-...',
            models: []
        }
    ];

    function getProvider(id) {
        return AI_PROVIDER_PRESETS.find(p => p.id === id) || AI_PROVIDER_PRESETS[0];
    }

    // ============================================================
    //  SECTION 2: Default Config & Storage
    // ============================================================

    const STORAGE_KEY = 'codepeer_config';

    const DEFAULT_CONFIG = {
        provider: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2048
    };

    function loadConfig() {
        try {
            const raw = typeof GM_getValue !== 'undefined'
                ? GM_getValue(STORAGE_KEY, null)
                : localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_CONFIG };
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } catch (e) {
            return { ...DEFAULT_CONFIG };
        }
    }

    function saveConfig(cfg) {
        try {
            const json = JSON.stringify(cfg);
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(STORAGE_KEY, json);
            } else {
                localStorage.setItem(STORAGE_KEY, json);
            }
        } catch (e) {}
    }

    let config = loadConfig();

    // ============================================================
    //  SECTION 3: API Client
    // ============================================================

    function buildChatCompletionsUrl(baseUrl) {
        return baseUrl.replace(/\/+$/, '') + '/chat/completions';
    }

    function buildChatCompletionsBody(cfg, messages, stream) {
        const isOpenAI = cfg.baseUrl.includes('api.openai.com');
        const maxTokensKey = isOpenAI ? 'max_completion_tokens' : 'max_tokens';
        const body = {
            model: cfg.model,
            messages: messages,
            temperature: cfg.temperature,
            [maxTokensKey]: cfg.maxTokens,
            stream: stream
        };
        return body;
    }

    async function callAI(messages, onDelta, onError) {
        if (!config.apiKey.trim()) {
            onError('请先在设置中填写 API 密钥。');
            return '';
        }

        const body = buildChatCompletionsBody(config, messages, false);

        try {
            const resp = await fetch(buildChatCompletionsUrl(config.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + config.apiKey
                },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const errText = await resp.text();
                let errMsg = 'API error (' + resp.status + ')';
                try {
                    const errJson = JSON.parse(errText);
                    errMsg = errJson?.error?.message || errMsg;
                } catch (e) {}
                throw new Error(errMsg);
            }

            const data = await resp.json();
            const content = data?.choices?.[0]?.message?.content || '';
            onDelta(content);
            return content;
        } catch (e) {
            onError(e.message);
            return '';
        }
    }

    // ============================================================
    //  SECTION 4: Problem & Code Extraction
    // ============================================================

    function getProblemDescription() {
        // Try multiple selectors for leetcode.com and leetcode.cn
        const selectors = [
            '[data-track-load="description_content"]',
            '.elfjS',                              // leetcode new UI
            '[class*="description"]',              // generic
            '[data-cy="question-content"]',
            '.question-content',                   // leetcode.cn old UI
            '.xFUwe',                              // leetcode.cn
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 50) {
                return el.textContent.trim();
            }
        }
        return null;
    }

    function getMonacoCode() {
        try {
            const monaco = unsafeWindow.monaco;
            if (!monaco || !monaco.editor) return null;
            const models = monaco.editor.getModels();
            if (models.length > 0) {
                return models[0].getValue();
            }
        } catch (e) {}
        return null;
    }

    // ============================================================
    //  SECTION 5: Theme Detection
    // ============================================================

    function isDarkMode() {
        const html = document.documentElement;
        if (html.getAttribute('data-theme') === 'dark') return true;
        if (html.getAttribute('data-color-mode') === 'dark') return true;
        if (document.body.classList.contains('dark')) return true;
        // Fallback: check body background
        const bg = getComputedStyle(document.body).backgroundColor;
        if (bg) {
            const rgb = bg.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                return brightness < 128;
            }
        }
        return false;
    }

    function getThemeColors() {
        const dark = isDarkMode();
        return {
            dark: dark,
            bg: dark ? '#1a1a2e' : '#ffffff',
            bgSecondary: dark ? '#16213e' : '#f7f8fa',
            text: dark ? '#e0e0e0' : '#333333',
            textSecondary: dark ? '#a0a0a0' : '#666666',
            border: dark ? '#30363d' : '#e0e0e0',
            accent: '#6366f1',
            accentHover: '#5558e6',
            btnBg: dark ? '#2d2d44' : '#e8ecf1',
            btnBgHover: dark ? '#3d3d5c' : '#d8dce2',
            codeBg: dark ? '#0d1117' : '#f0f2f5',
            errorBg: dark ? '#3d1f1f' : '#fef2f2',
            errorText: dark ? '#fca5a5' : '#dc2626',
            successBg: dark ? '#1f3d1f' : '#f0fdf4',
            successText: dark ? '#86efac' : '#16a34a',
        };
    }

    // ============================================================
    //  SECTION 6: Markdown Renderer
    // ============================================================

    function renderMarkdown(text) {
        if (!text) return '';
        let html = text
            // Escape HTML
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            // Code blocks ```
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            // Inline code `
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Bold
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // Headers
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            // Unordered lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            // Ordered lists
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // Line breaks
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

        return html;
    }

    // ============================================================
    //  SECTION 7: Sidebar UI
    // ============================================================

    function buildSidebar() {
        const C = getThemeColors();

        // Remove existing sidebar if any
        const existing = document.getElementById('codepeer-sidebar');
        if (existing) existing.remove();

        // --- Container ---
        const container = document.createElement('div');
        container.id = 'codepeer-sidebar';
        container.innerHTML = `
            <div id="codepeer-tab">
                <span>A</span><span>I</span>
            </div>
            <div id="codepeer-panel">
                <div id="codepeer-header">
                    <span>CodePeer</span>
                    <button id="codepeer-close">&times;</button>
                </div>
                <div id="codepeer-actions">
                    <button data-prompt="analyze">分析代码</button>
                    <button data-prompt="optimize">优化建议</button>
                    <button data-prompt="explain">解释思路</button>
                </div>
                <div id="codepeer-output"></div>
                <div id="codepeer-settings">
                    <details>
                        <summary>设置</summary>
                        <div id="codepeer-settings-body">
                            <label>模型厂商</label>
                            <select id="codepeer-provider"></select>
                            <label>API 密钥</label>
                            <div class="codepeer-key-row">
                                <input type="password" id="codepeer-apikey" placeholder="sk-..." />
                                <button id="codepeer-toggle-key" title="显示/隐藏">&#x1f441;</button>
                            </div>
                            <label>模型</label>
                            <select id="codepeer-model"></select>
                            <label>接口地址</label>
                            <input type="text" id="codepeer-baseurl" placeholder="https://api.deepseek.com" />
                            <div id="codepeer-settings-note"></div>
                            <button id="codepeer-save-settings">保存</button>
                        </div>
                    </details>
                </div>
            </div>
        `;

        // Inject styles
        const style = document.createElement('style');
        style.textContent = `
            #codepeer-sidebar {
                position: fixed; top: 0; right: 0; height: 100vh; z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px; display: flex; flex-direction: row-reverse;
                pointer-events: none;
            }
            #codepeer-sidebar * { box-sizing: border-box; pointer-events: auto; }

            #codepeer-tab {
                width: 32px; height: 64px; position: absolute; left: -32px; top: 50%;
                transform: translateY(-50%);
                background: ${C.accent}; color: #fff; border-radius: 8px 0 0 8px;
                display: flex; flex-direction: column; align-items: center;
                justify-content: center; cursor: pointer; font-weight: 700;
                font-size: 12px; line-height: 1.2; letter-spacing: -0.5px;
                transition: opacity 0.2s; opacity: 0.85;
            }
            #codepeer-tab:hover { opacity: 1; }

            #codepeer-panel {
                width: 400px; height: 100vh; background: ${C.bg}; border-left: 1px solid ${C.border};
                display: flex; flex-direction: column; overflow: hidden;
                transform: translateX(400px); transition: transform 0.25s ease;
            }
            #codepeer-sidebar.open #codepeer-panel { transform: translateX(0); }
            #codepeer-sidebar.open #codepeer-tab { opacity: 0; pointer-events: none; }

            #codepeer-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 16px; border-bottom: 1px solid ${C.border};
                font-weight: 600; font-size: 15px; color: ${C.accent};
                flex-shrink: 0;
            }
            #codepeer-close {
                background: none; border: none; color: ${C.textSecondary};
                font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1;
            }
            #codepeer-close:hover { color: ${C.text}; }

            #codepeer-actions {
                display: flex; gap: 6px; padding: 10px 16px;
                border-bottom: 1px solid ${C.border}; flex-shrink: 0;
            }
            #codepeer-actions button {
                flex: 1; padding: 6px 4px; border: 1px solid ${C.border};
                border-radius: 6px; background: ${C.btnBg}; color: ${C.text};
                cursor: pointer; font-size: 12px; white-space: nowrap;
                transition: background 0.15s;
            }
            #codepeer-actions button:hover { background: ${C.btnBgHover}; }
            #codepeer-actions button.loading { opacity: 0.6; pointer-events: none; }

            #codepeer-output {
                flex: 1; overflow-y: auto; padding: 12px 16px;
                color: ${C.text}; line-height: 1.6;
            }
            #codepeer-output h2, #codepeer-output h3, #codepeer-output h4 {
                color: ${C.accent}; margin: 12px 0 6px; font-weight: 600;
            }
            #codepeer-output h2 { font-size: 15px; }
            #codepeer-output h3 { font-size: 14px; }
            #codepeer-output h4 { font-size: 13px; }
            #codepeer-output code {
                background: ${C.codeBg}; padding: 1px 5px; border-radius: 3px;
                font-size: 12px; font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
            }
            #codepeer-output pre {
                background: ${C.codeBg}; padding: 10px 12px; border-radius: 6px;
                overflow-x: auto; margin: 8px 0; border: 1px solid ${C.border};
            }
            #codepeer-output pre code {
                background: none; padding: 0; font-size: 12px;
            }
            #codepeer-output ul, #codepeer-output ol { padding-left: 18px; margin: 6px 0; }
            #codepeer-output li { margin: 2px 0; }
            .codepeer-error { color: ${C.errorText}; background: ${C.errorBg}; padding: 8px 12px; border-radius: 6px; margin: 8px 0; }
            .codepeer-loading { color: ${C.textSecondary}; font-style: italic; }

            #codepeer-settings {
                border-top: 1px solid ${C.border}; flex-shrink: 0;
                background: ${C.bgSecondary};
            }
            #codepeer-settings summary {
                padding: 10px 16px; cursor: pointer; color: ${C.textSecondary};
                font-size: 12px; user-select: none;
            }
            #codepeer-settings summary:hover { color: ${C.text}; }
            #codepeer-settings-body {
                padding: 8px 16px 12px; display: flex; flex-direction: column; gap: 6px;
            }
            #codepeer-settings-body label {
                font-size: 11px; color: ${C.textSecondary}; text-transform: uppercase;
                letter-spacing: 0.5px; margin-top: 4px;
            }
            #codepeer-settings-body select, #codepeer-settings-body input {
                width: 100%; padding: 7px 10px; border: 1px solid ${C.border};
                border-radius: 6px; background: ${C.bg}; color: ${C.text};
                font-size: 12px; outline: none;
            }
            #codepeer-settings-body select:focus, #codepeer-settings-body input:focus {
                border-color: ${C.accent};
            }
            .codepeer-key-row { display: flex; gap: 4px; }
            .codepeer-key-row input { flex: 1; }
            .codepeer-key-row button {
                background: ${C.btnBg}; border: 1px solid ${C.border};
                color: ${C.text}; border-radius: 6px; cursor: pointer; padding: 0 8px;
                font-size: 14px;
            }
            #codepeer-settings-note { font-size: 11px; color: ${C.textSecondary}; margin-top: 2px; }
            #codepeer-save-settings {
                margin-top: 8px; padding: 7px; border: none; border-radius: 6px;
                background: ${C.accent}; color: #fff; cursor: pointer; font-size: 12px;
                font-weight: 600;
            }
            #codepeer-save-settings:hover { background: ${C.accentHover}; }
        `;

        document.head.appendChild(style);
        document.body.appendChild(container);

        return {
            container: container,
            panel: container.querySelector('#codepeer-panel'),
            tab: container.querySelector('#codepeer-tab'),
            closeBtn: container.querySelector('#codepeer-close'),
            output: container.querySelector('#codepeer-output'),
            actionButtons: container.querySelectorAll('#codepeer-actions button'),
            providerSelect: container.querySelector('#codepeer-provider'),
            apiKeyInput: container.querySelector('#codepeer-apikey'),
            modelSelect: container.querySelector('#codepeer-model'),
            baseUrlInput: container.querySelector('#codepeer-baseurl'),
            toggleKeyBtn: container.querySelector('#codepeer-toggle-key'),
            settingsNote: container.querySelector('#codepeer-settings-note'),
            save设置Btn: container.querySelector('#codepeer-save-settings'),
        };
    }

    // ============================================================
    //  SECTION 8: Prompt Templates
    // ============================================================

    const PROMPTS = {
        analyze: 'You are a LeetCode algorithm coach. Analyze the code below:\n\n1. What approach does it use? (briefly)\n2. Time and space complexity\n3. Edge cases handled / missed\n4. 1-2 concrete improvement suggestions\n\nKeep it concise, under 200 words. Use Chinese if the problem is in Chinese.',
        optimize: 'You are a performance-focused code reviewer. Suggest optimizations for this solution:\n\n1. Can time or space complexity be improved?\n2. Are there redundant operations?\n3. Show the optimized version (key changes only)\n\nBe specific, reference line numbers if visible. Under 250 words.',
        explain: 'You are a patient algorithm tutor. Explain the solution logic step by step:\n\n1. What is the core idea? (1 sentence)\n2. Walk through the algorithm in plain language\n3. Explain WHY this works (not just what it does)\n\nUse an example to illustrate. Under 300 words.',
    };

    function buildMessages(promptType, problemDesc, code) {
        const sysPrompt = PROMPTS[promptType] || PROMPTS.analyze;
        let userContent = '';
        if (problemDesc) {
            userContent += '## Problem\n' + problemDesc + '\n\n';
        }
        if (code) {
            userContent += '## Current Code\n```\n' + code + '\n```';
        }
        if (!userContent) {
            userContent = 'Please analyze the LeetCode problem and my solution.';
        }
        return [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userContent }
        ];
    }

    // ============================================================
    //  SECTION 9: UI Setup & Event Handling
    // ============================================================

    function populateProviderSelect(select) {
        select.innerHTML = '';
        AI_PROVIDER_PRESETS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            select.appendChild(opt);
        });
        select.value = config.provider || 'deepseek';
    }

    function populateModelSelect(select, providerId) {
        const p = getProvider(providerId);
        select.innerHTML = '';
        if (p.models.length === 0) {
            const opt = document.createElement('option');
            opt.value = config.model || '';
            opt.textContent = config.model || '自定义模型';
            select.appendChild(opt);
        } else {
            p.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.value;
                opt.textContent = m.label + (m.recommended ? ' *' : '');
                select.appendChild(opt);
            });
        }
        select.value = config.model || p.defaultModel;
    }

    function refresh设置UI(elements) {
        populateProviderSelect(elements.providerSelect);
        onProviderChange(elements);

        elements.apiKeyInput.value = config.apiKey || '';
        elements.baseUrlInput.value = config.baseUrl || '';

        const p = getProvider(config.provider);
        elements.apiKeyInput.placeholder = p.apiKeyPlaceholder || 'sk-...';

        if (config.provider === 'custom') {
            elements.modelSelect.style.display = 'none';
            // Show text input for model
        } else {
            elements.modelSelect.style.display = '';
        }
    }

    function onProviderChange(elements) {
        const providerId = elements.providerSelect.value;
        const p = getProvider(providerId);

        elements.baseUrlInput.value = p.baseUrl || config.baseUrl || '';
        populateModelSelect(elements.modelSelect, providerId);

        if (providerId === 'custom') {
            elements.modelSelect.style.display = 'none';
            elements.settingsNote.textContent = '请填写自定义接口地址、模型名称和 API 密钥。';
        } else {
            elements.modelSelect.style.display = '';
            elements.settingsNote.textContent = '';
        }
    }

    function setupUI() {
        const elements = buildSidebar();

        // --- Tab click ---
        elements.tab.addEventListener('click', () => {
            elements.container.classList.add('open');
        });

        // --- Close button ---
        elements.closeBtn.addEventListener('click', () => {
            elements.container.classList.remove('open');
        });

        // --- 设置 ---
        refresh设置UI(elements);

        elements.providerSelect.addEventListener('change', () => onProviderChange(elements));
        elements.toggleKeyBtn.addEventListener('click', () => {
            const input = elements.apiKeyInput;
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        elements.save设置Btn.addEventListener('click', () => {
            const providerId = elements.providerSelect.value;
            config.provider = providerId;
            config.apiKey = elements.apiKeyInput.value.trim();
            config.baseUrl = elements.baseUrlInput.value.trim();
            config.model = elements.modelSelect.style.display === 'none'
                ? config.model
                : elements.modelSelect.value;
            saveConfig(config);
            elements.settingsNote.textContent = '已保存。';
            elements.settingsNote.style.color = getThemeColors().successText;
            setTimeout(() => {
                elements.settingsNote.textContent = '';
                elements.settingsNote.style.color = '';
            }, 2000);
        });

        // --- Action buttons ---
        const loadingSet = new Set();

        elements.actionButtons.forEach(btn => {
            btn.addEventListener('click', async () => {
                const promptType = btn.dataset.prompt;
                if (!promptType || loadingSet.has(promptType)) return;

                if (!config.apiKey.trim()) {
                    elements.output.innerHTML = '<div class="codepeer-error">请先在设置中填写 API 密钥。</div>';
                    return;
                }

                const problemDesc = getProblemDescription();
                const code = getMonacoCode();

                if (!problemDesc && !code) {
                    elements.output.innerHTML = '<div class="codepeer-error">未找到题目描述或代码。</div>';
                    return;
                }

                loadingSet.add(promptType);
                btn.classList.add('loading');
                btn.textContent = '...';
                elements.output.innerHTML = '<div class="codepeer-loading">分析中...</div>';

                const messages = buildMessages(promptType, problemDesc, code);

                let responseText = '';

                await callAI(messages,
                    (fullText) => {
                        responseText = fullText;
                        elements.output.innerHTML = renderMarkdown(fullText);
                    },
                    (error) => {
                        elements.output.innerHTML = '<div class="codepeer-error">' + error + '</div>';
                    }
                );

                loadingSet.delete(promptType);
                btn.classList.remove('loading');
                btn.textContent = btn.textContent.replace('...', getButtonLabel(promptType));
            });
        });

        // Store action button labels
        function getButtonLabel(type) {
            const map = { analyze: '分析代码', optimize: '优化建议', explain: '解释思路' };
            return map[type] || '';
        }

        return elements;
    }

    // ============================================================
    //  SECTION 10: Monaco Watch (detect code changes)
    // ============================================================

    function waitForMonaco(cb) {
        let attempts = 0;
        const iv = setInterval(() => {
            if (unsafeWindow.monaco && unsafeWindow.monaco.editor && unsafeWindow.monaco.editor.getModels) {
                clearInterval(iv);
                cb(unsafeWindow.monaco);
            }
            if (++attempts > 150) {
                clearInterval(iv);
                cb(null);
            }
        }, 200);
    }

    // ============================================================
    //  SECTION 11: Initialization
    // ============================================================

    function init() {
        try {
            const elements = setupUI();

            waitForMonaco((monaco) => {
                if (!monaco) {
                    console.warn('[CodePeer] Monaco editor not found.');
                    return;
                }
                console.log('[CodePeer] v1.0.0 loaded — AI sidebar ready.');
            });
        } catch (e) {
            console.error('[CodePeer] Init error:', e.message);
        }
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
    } else {
        setTimeout(init, 800);
    }

})();
