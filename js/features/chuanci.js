/* ==========================================================================
   创词 Chuanci - 主项目模块
   命名空间：cc_xxx (函数) / cc-xxx (CSS类) / cc_xxx (localStorage)
   挂载点：window.Chuanci.open() / window.Chuanci.close()
   ========================================================================== */

(function() {
    'use strict';

    const DEFAULT_MODULES = [
        { id: 'm1', name: '内容方向', tags: [
            { id: 't1', label: '问候' }, { id: 't2', label: '思念' },
            { id: 't3', label: '陪伴' }, { id: 't4', label: '关心' },
            { id: 'td', label: '无', isDefault: true }
        ]},
        { id: 'm2', name: '场景', tags: [
            { id: 't5', label: '家里' }, { id: 't6', label: '公司' },
            { id: 't7', label: '咖啡厅' }, { id: 't8', label: '沙发' },
            { id: 'td2', label: '无', isDefault: true }
        ]},
        { id: 'm3', name: '语气', tags: [
            { id: 't9', label: '撒娇' }, { id: 't10', label: '温柔' },
            { id: 't11', label: '随意' }, { id: 't12', label: '俏皮' },
            { id: 't13', label: '认真' }, { id: 't14', label: '含蓄' },
            { id: 'td3', label: '无', isDefault: true }
        ]},
        { id: 'm4', name: '情绪浓度', tags: [
            { id: 't15', label: '淡淡的' }, { id: 't16', label: '普通' },
            { id: 't17', label: '浓烈' }, { id: 't18', label: '若有若无' },
            { id: 't19', label: '直白' },
            { id: 'td4', label: '无', isDefault: true }
        ]},
        { id: 'm5', name: '长度', tags: [
            { id: 't20', label: '1个词' }, { id: 't21', label: '半句' },
            { id: 't22', label: '一句' }, { id: 't23', label: '两三句' },
            { id: 'td5', label: '无', isDefault: true }
        ]}
    ];

    const API_KEY_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 2 周（14 天）

    let state = {
        modules: [],
        history: [],
        settings: { duration: 5, durationEnabled: false },
        apiConfig: { baseurl: '', model: '', apikey: '', persona: '', apikeyTimestamp: 0 },
        currentResult: null,
        pendingQueue: [],
        currentCalDate: new Date(),
        selectedDate: null,
        inputModalCallback: null,
        inputModalBatch: false,
        currentView: 'home'
    };

    let _checkTimer = null;
    let tagLongPressTimer = null;
    let tagRemoveMode = false;
    let _docClickBound = false;

    // ===== 持久化 =====
    function loadData() {
        try {
            const m = localStorage.getItem('cc_modules');
            state.modules = m ? JSON.parse(m) : JSON.parse(JSON.stringify(DEFAULT_MODULES));
            const h = localStorage.getItem('cc_history');
            state.history = h ? JSON.parse(h) : [];
            const s = localStorage.getItem('cc_settings');
            if (s) state.settings = Object.assign(state.settings, JSON.parse(s));
            const a = localStorage.getItem('cc_api_config');
            if (a) state.apiConfig = Object.assign(state.apiConfig, JSON.parse(a));
            const q = localStorage.getItem('cc_pending_queue');
            if (q) state.pendingQueue = JSON.parse(q);
            const cr = localStorage.getItem('cc_current_result');
            if (cr) state.currentResult = JSON.parse(cr);
        } catch(e) { console.error('[Chuanci] load error:', e); }
    }
    function saveModules() { localStorage.setItem('cc_modules', JSON.stringify(state.modules)); }
    function saveHistory() { localStorage.setItem('cc_history', JSON.stringify(state.history)); }
    function saveSettings() { localStorage.setItem('cc_settings', JSON.stringify(state.settings)); }
    function saveApiConfig() { localStorage.setItem('cc_api_config', JSON.stringify(state.apiConfig)); }
    function saveQueue() { localStorage.setItem('cc_pending_queue', JSON.stringify(state.pendingQueue)); }
    function saveCurrentResult() {
        if (state.currentResult) localStorage.setItem('cc_current_result', JSON.stringify(state.currentResult));
        else localStorage.removeItem('cc_current_result');
    }

    // ===== Key 过期 =====
    function isKeyExpired() {
        if (!state.apiConfig.apikey) return false;
        const ts = state.apiConfig.apikeyTimestamp || 0;
        if (!ts) return true;
        return (Date.now() - ts) >= API_KEY_TTL_MS;
    }
    function clearExpiredKeyIfNeeded() {
        if (isKeyExpired()) {
            state.apiConfig.apikey = '';
            state.apiConfig.apikeyTimestamp = 0;
            saveApiConfig();
            return true;
        }
        return false;
    }

    // ===== Toast =====
    function showToast(msg, onClick) {
        const t = document.getElementById('cc-toast');
        if (!t) return;
        t.innerHTML = msg;
        t.classList.add('show');
        t.onclick = onClick || null;
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('show'), onClick ? 4000 : 2000);
    }

    // ===== 视图切换 =====
    function openView(name) {
        state.currentView = name;
        document.querySelectorAll('#chuanci-modal .cc-view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById('cc-view-' + name);
        if (target) target.classList.add('active');
        const footer = document.getElementById('cc-footer');
        if (footer) footer.style.display = name === 'home' ? 'block' : 'none';
        if (name === 'history') renderCalendar();
        if (name === 'edit') renderEditView();
        if (name === 'api') loadApiConfigUI();
        if (name === 'home') renderHome();
    }

    // ===== 主页 =====
    function renderHome() {
        const tabbar = document.getElementById('cc-tabbar');
        if (!tabbar) return;
        tabbar.innerHTML = state.modules.map(m =>
            `<div class="cc-tab ${m.hidden ? 'is-hidden' : ''}" onclick="Chuanci.openView('edit')">${escapeHtml(m.name)}${m.hidden ? ' <i class="fas fa-eye-slash" style="font-size:10px;opacity:.7;margin-left:2px;"></i>' : ''}</div>`
        ).join('');

        const content = document.getElementById('cc-content');
        const r = state.currentResult;
        if (!r) {
            content.innerHTML = '<div class="cc-empty"><i class="fas fa-comment"></i><div>还没有生成内容，点击下方按钮开始</div></div>';
        } else if (r === 'cancelled') {
            content.innerHTML = '<div class="cc-cancelled"><i class="fas fa-times-circle" style="font-size:24px;display:block;margin-bottom:8px"></i>本次生成已取消</div>';
        } else if (r.type === 'fortune') {
            renderFortuneCard(content, r.tags);
        } else if (r.type === 'sentences') {
            content.innerHTML = r.data.map((text, i) =>
                `<div class="cc-content-item"><div class="cc-content-num">${i+1}</div><div>${escapeHtml(text)}</div></div>`
            ).join('');
        }
        renderPendingInfo();
    }

    function renderFortuneCard(container, tags) {
        const rows = Object.keys(tags).map(name => {
            const val = tags[name];
            const isNone = val === '无';
            return `<div class="cc-fortune-row">
                <span class="label">${escapeHtml(name)}</span>
                <span class="value ${isNone ? 'none' : ''}">${escapeHtml(val)}</span>
            </div>`;
        }).join('');
        const hasKey = !!state.apiConfig.apikey;
        container.innerHTML = `<div class="cc-fortune-card">
            <div class="cc-fortune-title"><i class="fas fa-wand-magic-sparkles"></i> 抽签结果</div>
            ${rows}
            ${!hasKey ? `<div class="cc-fortune-tip">填入 API 后可解读这组标签为完整句子 · <a onclick="Chuanci.openView('api')">前往填入</a></div>` : ''}
        </div>`;
    }

    function renderPendingInfo() {
        const info = document.getElementById('cc-pending-info');
        if (!info) return;
        const q = state.pendingQueue;
        if (q.length === 0) {
            info.style.display = 'none';
            return;
        }
        info.style.display = 'block';
        const earliest = q.reduce((min, item) => item.completeTime < min.completeTime ? item : min, q[0]);
        const t = formatCompleteTime(earliest.completeTime);
        info.innerHTML = q.length === 1
            ? `<b>${t}</b> 完成`
            : `<b>${t}</b> 完成 · 排队 <b>${q.length}</b> 次`;
    }

    function formatCompleteTime(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function clickGenerate() {
        const wasCleared = clearExpiredKeyIfNeeded();
        if (wasCleared) {
            showToast('<i class="fas fa-clock"></i> API Key 已过期清除（2 周安全机制），请重新填入', () => openView('api'));
            return;
        }

        const hasKey = !!state.apiConfig.apikey;
        const durationOn = state.settings.durationEnabled;
        const selectedTags = drawTags();

        // 所有大模块都被隐藏 / 模块为空时，无法抽取
        if (Object.keys(selectedTags).length === 0) {
            showToast('<i class="fas fa-exclamation-circle"></i> 当前没有可抽取的模块（请检查是否全部隐藏）');
            return;
        }

        if (!hasKey) {
            doFortuneMode(selectedTags);
            return;
        }
        if (!durationOn) {
            doInstantMode(selectedTags);
            return;
        }
        addToQueue(selectedTags);
    }

    function drawTags() {
        const result = {};
        state.modules.forEach(m => {
            // 隐藏的大模块不参与抽取，也不出现在结果里
            if (m.hidden) return;
            const nonDefault = m.tags.filter(t => !t.isDefault);
            // 80% 抽具体词 / 20% 抽到"无"
            if (Math.random() < 0.8 && nonDefault.length > 0) {
                result[m.name] = nonDefault[Math.floor(Math.random() * nonDefault.length)].label;
            } else {
                result[m.name] = '无';
            }
        });
        return result;
    }

    // ===== 对方申请追加字卡 =====
    // 检查能否触发申请（外部调用前会先看这个）
    function canPartnerRequest() {
        // Key 过期检查
        clearExpiredKeyIfNeeded();
        // 必须有 Key
        if (!state.apiConfig.apikey) return false;
        // 必须有 base_url 和 model
        if (!state.apiConfig.baseurl || !state.apiConfig.model) return false;
        return true;
    }

    // 主项目调用：弹出"对方申请追加字卡"弹窗
    // 参数：{ partnerName, partnerAvatar, myName, myAvatar }
    function showPartnerRequestModal(opts) {
        // 关键：弹窗触发时，用户可能从未打开过创词模块，apiConfig 还没从 localStorage 读出
        // 所以这里先确保数据已加载，否则后续"允许"按钮会误判 Key 未填
        if (!_initialized) {
            loadData();
            clearExpiredKeyIfNeeded();
            startQueueChecker();
            startPartnerRequestScheduler();
            _initialized = true;
        }

        const modal = document.getElementById('cc-partner-request-modal');
        if (!modal) return;

        const partnerName = opts.partnerName || '对方';
        const myName = opts.myName || '我';
        const partnerAvatar = opts.partnerAvatar || '';
        const myAvatar = opts.myAvatar || '';

        // 随机一个 emoji（从项目里有的爱心/亲昵类抽）
        const emojiPool = ['❤️', '💕', '💗', '💖', '✨', '🌸', '🍃', '💌', '🎁', '🌟', '☁️', '🤍', '💫', '🌷'];
        const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];

        // 填充弹窗内容
        const fillAvatar = (sel, av) => {
            const el = modal.querySelector(sel);
            if (!el) return;
            if (av && (av.startsWith('data:') || av.startsWith('http') || av.startsWith('blob:'))) {
                el.innerHTML = `<img src="${av}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                el.innerHTML = `<i class="fas fa-user" style="color:var(--text-secondary);font-size:24px;"></i>`;
            }
        };
        fillAvatar('.cc-pr-partner-avatar', partnerAvatar);
        fillAvatar('.cc-pr-my-avatar', myAvatar);
        modal.querySelector('.cc-pr-partner-name').textContent = partnerName;
        modal.querySelector('.cc-pr-my-name').textContent = myName;
        modal.querySelector('.cc-pr-emoji').textContent = emoji;
        modal.querySelector('.cc-pr-text').textContent = `${partnerName} 申请追加字卡，准许嘛？`;

        modal.classList.add('open');

        // 20 秒未响应自动按"拒绝"处理
        clearTimeout(state._prTimeout);
        state._prTimeout = setTimeout(() => {
            if (modal.classList.contains('open')) {
                handlePartnerRequest('reject', partnerName);
            }
        }, 20000);

        // 绑定按钮（每次重新绑定确保最新 partnerName）
        modal.querySelector('.cc-pr-btn-reject').onclick = () => handlePartnerRequest('reject', partnerName);
        modal.querySelector('.cc-pr-btn-allow').onclick = () => handlePartnerRequest('allow', partnerName);
    }

    function handlePartnerRequest(decision, partnerName) {
        clearTimeout(state._prTimeout);
        const modal = document.getElementById('cc-partner-request-modal');
        if (modal) modal.classList.remove('open');

        if (decision === 'reject') {
            // 拒绝 → 用主项目的来电被拒同款样式插入聊天系统消息
            const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
            const text = `${myName}拒绝了 ${partnerName} 的字卡追加申请`;
            if (typeof sendCallEvent === 'function') {
                // sendCallEvent(iconClass, text, ?) —— 用 ban 图标表示拒绝
                try { sendCallEvent('fa-ban', text, null); }
                catch(e) { _fallbackSysMsg(text); }
            } else {
                _fallbackSysMsg(text);
            }
        } else if (decision === 'allow') {
            // 允许 → 按手动生成的逻辑触发一次（自动抽标签 + 走相同的即时/延迟模式）
            triggerPartnerGeneration();
        }
    }

    function _fallbackSysMsg(text) {
        // 兜底：若没有 sendCallEvent，用 addMessage 写一条系统消息
        if (typeof addMessage === 'function') {
            try {
                addMessage({
                    id: Date.now(),
                    text: text,
                    timestamp: new Date(),
                    type: 'system'
                });
            } catch(e) {}
        }
    }

    // 对方申请通过后，按用户当前的"时长开关"决定即时还是延迟
    async function triggerPartnerGeneration() {
        // 双重保险：再确保数据已加载（用户可能从未打开过创词模块）
        if (!_initialized) {
            loadData();
            clearExpiredKeyIfNeeded();
            startQueueChecker();
            startPartnerRequestScheduler();
            _initialized = true;
        }
        // 先检查能不能生成，失败就用拒绝样式系统消息提示原因
        clearExpiredKeyIfNeeded();
        const cfg = state.apiConfig;
        let failReason = '';
        if (!cfg.apikey) failReason = '未填入 API Key';
        else if (!cfg.baseurl) failReason = '未填入接口地址';
        else if (!cfg.model) failReason = '未填入调用模型';

        if (failReason) {
            const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
            const text = `本次字卡生成失败，原因：${failReason}`;
            if (typeof sendCallEvent === 'function') {
                try { sendCallEvent('fa-circle-exclamation', text, null); }
                catch(e) { _fallbackSysMsg(text); }
            } else {
                _fallbackSysMsg(text);
            }
            return;
        }

        const selectedTags = drawTags();
        const durationOn = state.settings.durationEnabled;

        if (!durationOn) {
            // 即时模式：直接生成
            doInstantMode(selectedTags);
            if (typeof showNotification === 'function') {
                showNotification('字卡已增加完成', 'success', 3000);
            }
        } else {
            // 延迟模式：加入队列
            addToQueue(selectedTags);
            if (typeof showNotification === 'function') {
                showNotification('字卡生成中，请在完成后在历史记录里查看', 'info', 3500);
            }
        }
    }

    function doFortuneMode(selectedTags) {
        state.currentResult = { type: 'fortune', tags: selectedTags };
        saveCurrentResult();
        recordSession({ status: 'fortune', tags: selectedTags, content: [] });
        renderHome();
        showToast('<i class="fas fa-wand-magic-sparkles"></i> 已抽签');
    }

    async function doInstantMode(selectedTags) {
        try {
            const result = await runGenerationFlow(selectedTags);
            if (result.cancelled) {
                state.currentResult = 'cancelled';
                recordSession({ status: 'cancelled', tags: selectedTags, content: [] });
                showToast('<i class="fas fa-times-circle"></i> 本次生成已取消');
            } else {
                state.currentResult = { type: 'sentences', data: result.content };
                recordSession({ status: 'completed', tags: selectedTags, content: result.content });
                pushToMainCardLibrary(result.content);
                showToast('<i class="fas fa-check"></i> 词条已生成，前往历史记录查看 →', () => openView('history'));
            }
            saveCurrentResult();
            renderHome();
        } catch(e) {
            showToast('<i class="fas fa-exclamation-circle"></i> 生成失败：' + e.message);
        }
    }

    function addToQueue(selectedTags) {
        const now = Date.now();
        const completeTime = now + state.settings.duration * 60 * 1000;
        state.pendingQueue.push({
            id: 'p_' + now + '_' + Math.random().toString(36).slice(2,6),
            startTime: now,
            completeTime: completeTime,
            selectedTags: selectedTags
        });
        saveQueue();
        renderPendingInfo();
        showToast('<i class="fas fa-clock"></i> 已加入队列，' + formatCompleteTime(completeTime) + ' 完成');
    }

    function startQueueChecker() {
        if (_checkTimer) clearInterval(_checkTimer);
        _checkTimer = setInterval(() => {
            checkQueue();
            if (state.currentView === 'home') renderPendingInfo();
        }, 1000);
        checkQueue();
    }

    // ===== 对方申请追加字卡：独立定时器 =====
    // 每 15-60 分钟检查一次，10% 概率弹申请字卡弹窗
    let _partnerRequestTimer = null;
    function startPartnerRequestScheduler() {
        if (_partnerRequestTimer) clearTimeout(_partnerRequestTimer);
        // 随机 15-60 分钟
        const intervalMs = (15 + Math.random() * 45) * 60 * 1000;
        _partnerRequestTimer = setTimeout(() => {
            try {
                // 10% 概率触发
                if (Math.random() < 0.10) {
                    // 检查弹窗是否已显示（避免重复）
                    const modal = document.getElementById('cc-partner-request-modal');
                    const alreadyOpen = modal && modal.classList.contains('open');
                    // 检查页面是否可见（页面不可见时不弹，避免被切到后台时反复触发但用户看不到）
                    const pageVisible = !document.hidden;
                    if (!alreadyOpen && pageVisible &&
                        typeof window !== 'undefined' &&
                        typeof window.settings !== 'undefined') {
                        showPartnerRequestModal({
                            partnerName: (window.settings && window.settings.partnerName) || '对方',
                            partnerAvatar: (window.DOMElements && window.DOMElements.partner && window.DOMElements.partner.avatar && window.DOMElements.partner.avatar.src) || '',
                            myName: (window.settings && window.settings.myName) || '我',
                            myAvatar: (window.DOMElements && window.DOMElements.user && window.DOMElements.user.avatar && window.DOMElements.user.avatar.src) || ''
                        });
                    }
                }
            } catch(e) { console.warn('[Chuanci] 定时申请字卡失败:', e); }
            // 无论是否触发都要重新排程
            startPartnerRequestScheduler();
        }, intervalMs);
    }

    async function checkQueue() {
        if (state.pendingQueue.length === 0) return;
        const now = Date.now();
        const ready = state.pendingQueue.find(item => now >= item.completeTime && !item._processing);
        if (!ready) return;

        ready._processing = true;
        try {
            const result = await runGenerationFlow(ready.selectedTags);
            state.pendingQueue = state.pendingQueue.filter(item => item.id !== ready.id);
            saveQueue();

            if (result.cancelled) {
                state.currentResult = 'cancelled';
                recordSession({ status: 'cancelled', tags: ready.selectedTags, content: [] });
                showToast('<i class="fas fa-times-circle"></i> 本次生成已取消');
            } else {
                state.currentResult = { type: 'sentences', data: result.content };
                recordSession({ status: 'completed', tags: ready.selectedTags, content: result.content });
                pushToMainCardLibrary(result.content);
                showToast('<i class="fas fa-check"></i> 词条已生成，前往历史记录查看 →', () => openView('history'));
            }
            saveCurrentResult();
            if (state.currentView === 'home') renderHome();
        } catch(e) {
            ready._processing = false;
            console.error('[Chuanci] 生成失败:', e);
        }
    }

    // === 桥接：写入主字卡库（仅 AI 成功生成的词条触发，抽签结果不写入）===
    // 确保创词系统分组存在，返回该分组对象
    function _ensureChuanciSystemGroup() {
        if (typeof customReplyGroups === 'undefined') {
            // state.js 顶层声明的 customReplyGroups 可能存在 window 上
            if (typeof window !== 'undefined' && window.customReplyGroups) {
                // 用 window 的版本
            } else {
                return null;
            }
        }
        const groups = (typeof customReplyGroups !== 'undefined') ? customReplyGroups : window.customReplyGroups;
        if (!Array.isArray(groups)) return null;
        let g = groups.find(x => x && x.id === 'sys_chuanci');
        if (!g) {
            g = {
                id: 'sys_chuanci',
                name: '创词',
                color: 'var(--accent-color)',
                icon: '✨',
                system: true, // 系统保留分组，不可编辑/删除/拖动
                items: []
            };
            groups.push(g);
        }
        if (!Array.isArray(g.items)) g.items = [];
        return g;
    }

    function pushToMainCardLibrary(texts) {
        if (!Array.isArray(texts) || texts.length === 0) return;
        // customReplies 在 state.js 顶层用 let 声明（全局作用域），不在 window 上
        // chuanciTexts 在 core.js 里被显式赋给 window
        if (typeof customReplies === 'undefined') {
            console.warn('[Chuanci] customReplies 未就绪，跳过写入主字卡');
            return;
        }
        if (!window.chuanciTexts) window.chuanciTexts = new Set();

        // 确保创词分组存在
        const chuanciGroup = _ensureChuanciSystemGroup();

        let added = 0;
        texts.forEach(t => {
            const text = String(t).trim();
            if (!text) return;
            // 去重：主字卡已有则跳过，但仍标记来源
            if (customReplies.indexOf(text) === -1) {
                customReplies.push(text);
                added++;
            }
            window.chuanciTexts.add(text);
            // 加入"创词"分组（同样去重）
            if (chuanciGroup && chuanciGroup.items.indexOf(text) === -1) {
                chuanciGroup.items.push(text);
            }
        });
        // 触发主项目保存
        if (typeof throttledSaveData === 'function') throttledSaveData();
        // 若主项目回复库当前可见，触发重渲
        if (typeof renderReplyLibrary === 'function') {
            try { renderReplyLibrary(); } catch(e) {}
        }
        console.log('[Chuanci] 已写入主字卡 ' + added + ' 条新词，共标记 ' + texts.length + ' 条创词');
    }

    // 旧数据迁移：把 chuanciTexts 集合里所有还在主字卡里的文本，
    // 都加入"创词"分组（如果分组里没这条文本）
    function migrateLegacyChuanciCards() {
        if (typeof customReplies === 'undefined') return;
        if (!window.chuanciTexts || window.chuanciTexts.size === 0) return;
        const chuanciGroup = _ensureChuanciSystemGroup();
        if (!chuanciGroup) return;

        let migrated = 0;
        window.chuanciTexts.forEach(text => {
            if (customReplies.indexOf(text) === -1) return; // 主字卡里已无此条
            if (chuanciGroup.items.indexOf(text) === -1) {
                chuanciGroup.items.push(text);
                migrated++;
            }
        });
        if (migrated > 0) {
            console.log('[Chuanci] 旧数据迁移：' + migrated + ' 条字卡归入"创词"分组');
            if (typeof throttledSaveData === 'function') throttledSaveData();
        }
    }

    // ===== AI 调用（真实接入，按 base_url 自动识别） =====
    async function callAI(selectedTags) {
        const cfg = state.apiConfig;
        if (!cfg.apikey || !cfg.baseurl || !cfg.model) {
            throw new Error('API 配置不完整');
        }

        // 拼 user prompt（按权重顺序拼非"无"标签）
        const tagLines = [];
        Object.keys(selectedTags).forEach(k => {
            const v = selectedTags[k];
            if (v && v !== '无') tagLines.push(`${k}：${v}`);
        });
        const userPrompt = `请基于以下标签生成 3 段内容，每段独立一行，不加序号、不加解释、不加引号。\n\n${tagLines.length ? tagLines.join('\n') : '（无具体标签限制）'}`;

        const systemPrompt = cfg.persona || '';
        const url = cfg.baseurl.trim();
        const lc = url.toLowerCase();

        // 按 URL 自动识别 provider
        let provider;
        if (lc.includes('anthropic.com')) provider = 'claude';
        else if (lc.includes('googleapis.com') || lc.includes('generativelanguage')) provider = 'gemini';
        else provider = 'openai'; // 默认 OpenAI 兼容协议（GPT/DeepSeek/Moonshot/Qwen 等）

        let response;
        try {
            if (provider === 'claude') {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': cfg.apikey,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: cfg.model,
                        max_tokens: 300,
                        system: systemPrompt || undefined,
                        messages: [{ role: 'user', content: userPrompt }]
                    })
                });
            } else if (provider === 'gemini') {
                // Gemini: API key 拼到 URL 后面
                const sep = url.includes('?') ? '&' : '?';
                const fullUrl = url + sep + 'key=' + encodeURIComponent(cfg.apikey);
                const parts = [];
                if (systemPrompt) parts.push({ text: systemPrompt + '\n\n' + userPrompt });
                else parts.push({ text: userPrompt });
                response = await fetch(fullUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: parts }],
                        generationConfig: { maxOutputTokens: 300 }
                    })
                });
            } else {
                // OpenAI 兼容
                const messages = [];
                if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
                messages.push({ role: 'user', content: userPrompt });
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + cfg.apikey
                    },
                    body: JSON.stringify({
                        model: cfg.model,
                        max_tokens: 300,
                        messages: messages
                    })
                });
            }
        } catch (e) {
            throw new Error('网络错误，请稍后重试');
        }

        // 错误处理
        if (!response.ok) {
            if (response.status === 401) throw new Error('API Key 无效，请检查');
            if (response.status === 402 || response.status === 403) throw new Error('API 配额不足');
            if (response.status === 429) throw new Error('请求过于频繁，请稍后重试');
            let detail = '';
            try { const j = await response.json(); detail = j.error?.message || j.message || ''; } catch(e) {}
            throw new Error('请求失败 (' + response.status + ')' + (detail ? ': ' + detail : ''));
        }

        // 解析响应
        let rawText = '';
        try {
            const data = await response.json();
            if (provider === 'claude') {
                rawText = (data.content && data.content[0] && data.content[0].text) || '';
            } else if (provider === 'gemini') {
                rawText = (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) || '';
            } else {
                rawText = (data.choices && data.choices[0]?.message?.content) || '';
            }
        } catch (e) {
            throw new Error('AI 返回内容解析失败');
        }

        if (!rawText.trim()) throw new Error('AI 返回内容为空');

        // 拆分成行，过滤序号/引号/空行
        const lines = rawText.split(/\r?\n/)
            .map(s => s.trim())
            .map(s => s.replace(/^[\d]+[.、)\s]+/, '')) // 去掉 "1. " / "1、" / "1) " 前缀
            .map(s => s.replace(/^[-•*]\s+/, ''))         // 去掉 "- " / "• " 前缀
            .map(s => s.replace(/^["'「"『]/, '').replace(/["'」"』]$/, '')) // 去掉首尾引号
            .filter(s => s.length > 0);

        if (lines.length === 0) throw new Error('AI 返回内容为空');
        // 不够 3 段也用，多了截 3 段
        return lines.slice(0, 3);
    }

    // 直接使用 AI 返回的全部段落（不再随机抽 1-2 条）
    async function runGenerationFlow(selectedTags) {
        const candidates = await callAI(selectedTags);
        if (!candidates || candidates.length === 0) {
            return { cancelled: true };
        }
        return { cancelled: false, content: candidates };
    }

    function recordSession(session) {
        const now = new Date();
        const dateKey = formatDate(now);
        const timeStr = formatTime(now);
        let dayEntry = state.history.find(h => h.date === dateKey);
        if (!dayEntry) {
            dayEntry = { date: dateKey, sessions: [] };
            state.history.push(dayEntry);
        }
        dayEntry.sessions.push({ time: timeStr, ...session });
        saveHistory();
    }

    // ===== 设置弹窗 =====
    function openSettings() {
        document.getElementById('cc-duration-slider').value = state.settings.duration;
        document.getElementById('cc-duration-val').textContent = state.settings.duration;
        const toggle = document.getElementById('cc-toggle-duration');
        const sliderRow = document.getElementById('cc-slider-row');
        toggle.classList.toggle('on', state.settings.durationEnabled);
        sliderRow.classList.toggle('disabled', !state.settings.durationEnabled);
        document.getElementById('cc-settings-modal').classList.add('open');
    }
    function closeSettings() { document.getElementById('cc-settings-modal').classList.remove('open'); }
    function toggleDuration() {
        state.settings.durationEnabled = !state.settings.durationEnabled;
        saveSettings();
        const toggle = document.getElementById('cc-toggle-duration');
        const sliderRow = document.getElementById('cc-slider-row');
        toggle.classList.toggle('on', state.settings.durationEnabled);
        sliderRow.classList.toggle('disabled', !state.settings.durationEnabled);
    }
    function updateDuration(val) {
        state.settings.duration = parseInt(val);
        document.getElementById('cc-duration-val').textContent = val;
        saveSettings();
    }

    // ===== 输入弹窗 =====
    function openBatchInputModal(title, placeholder, callback) {
        document.getElementById('cc-input-modal-title').textContent = title;
        const textarea = document.getElementById('cc-input-textarea');
        textarea.style.display = 'block';
        textarea.placeholder = placeholder;
        textarea.value = '';
        state.inputModalCallback = callback;
        document.getElementById('cc-input-modal').classList.add('open');
        setTimeout(() => textarea.focus(), 100);
    }
    function closeInputModal() {
        document.getElementById('cc-input-modal').classList.remove('open');
        state.inputModalCallback = null;
    }
    function confirmInput() {
        const val = document.getElementById('cc-input-textarea').value;
        if (!val || !val.trim()) { closeInputModal(); return; }
        const cb = state.inputModalCallback;
        closeInputModal();
        if (cb) cb(val);
    }

    // ===== 编辑页 =====
    function renderEditView() {
        const container = document.getElementById('cc-edit-modules');
        if (!container) return;
        container.innerHTML = state.modules.map((m, idx) => `
            <div class="cc-edit-module" data-idx="${idx}">
                <div class="cc-edit-module-header">
                    <div class="cc-edit-module-name">${escapeHtml(m.name)} (${m.tags.length})</div>
                    <div class="cc-edit-module-actions">
                        <button class="cc-edit-action-btn clear" onclick="Chuanci.clearModule(${idx})">清除</button>
                        <button class="cc-edit-action-btn add" onclick="Chuanci.addTag(${idx})">+新增</button>
                    </div>
                </div>
                <div class="cc-edit-tags">
                    ${m.tags.map((t, ti) => renderTag(idx, ti, t)).join('')}
                </div>
            </div>
        `).join('');
        setupTagLongPress();
    }

    function renderTag(mIdx, tIdx, t) {
        if (t.isDefault) {
            return `<div class="cc-edit-tag-wrap"><div class="cc-edit-tag default">${escapeHtml(t.label)} (默认)</div></div>`;
        }
        return `<div class="cc-edit-tag-wrap" data-mod="${mIdx}" data-tag="${tIdx}">
            <div class="cc-edit-tag">${escapeHtml(t.label)}</div>
            <button class="cc-tag-remove-btn" onclick="event.stopPropagation();Chuanci.deleteTag(${mIdx},${tIdx})"><i class="fas fa-times"></i></button>
        </div>`;
    }

    function enterTagRemoveMode() { tagRemoveMode = true; applyTagRemoveMode(); }
    function exitTagRemoveMode() { tagRemoveMode = false; applyTagRemoveMode(); }
    function applyTagRemoveMode() {
        document.querySelectorAll('#chuanci-modal .cc-edit-tag-wrap[data-tag]').forEach(w => {
            w.classList.toggle('removable', tagRemoveMode);
            const tag = w.querySelector('.cc-edit-tag');
            if (tag) tag.classList.toggle('removable', tagRemoveMode);
        });
    }

    function setupTagLongPress() {
        applyTagRemoveMode();
        document.querySelectorAll('#chuanci-modal .cc-edit-tag-wrap[data-tag]').forEach(wrap => {
            const onStart = (e) => {
                if (e.target.closest('.cc-tag-remove-btn')) return;
                if (tagRemoveMode) return;
                clearTimeout(tagLongPressTimer);
                tagLongPressTimer = setTimeout(() => { enterTagRemoveMode(); }, 500);
            };
            const onCancel = () => clearTimeout(tagLongPressTimer);
            wrap.addEventListener('touchstart', onStart, { passive: true });
            wrap.addEventListener('touchend', onCancel);
            wrap.addEventListener('touchmove', onCancel);
            wrap.addEventListener('mousedown', onStart);
            wrap.addEventListener('mouseup', onCancel);
            wrap.addEventListener('mouseleave', onCancel);
        });

        if (!_docClickBound) {
            _docClickBound = true;
            document.addEventListener('click', (e) => {
                if (!tagRemoveMode) return;
                if (e.target.closest('#chuanci-modal .cc-edit-tag-wrap[data-tag]')) return;
                if (e.target.closest('.cc-tag-remove-btn')) return;
                exitTagRemoveMode();
            });
        }
    }

    // ===== 管理弹窗 =====
    function openManageModal() {
        document.getElementById('cc-manage-input').value = '';
        renderManageList();
        document.getElementById('cc-manage-modal').classList.add('open');
    }
    function closeManageModal() {
        document.getElementById('cc-manage-modal').classList.remove('open');
        renderEditView();
    }
    function addModuleFromInput() {
        const input = document.getElementById('cc-manage-input');
        const text = input.value;
        const names = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        if (names.length === 0) return;
        const base = Date.now();
        names.forEach((name, i) => {
            state.modules.push({
                id: 'm_' + base + '_' + i,
                name: name,
                tags: [{ id: 'td_' + base + '_' + i, label: '无', isDefault: true }]
            });
        });
        saveModules();
        input.value = '';
        renderManageList();
        showToast(`已新增 ${names.length} 个大模块`);
    }
    function renderManageList() {
        const list = document.getElementById('cc-manage-list');
        if (!list) return;
        if (state.modules.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">还没有大模块</div>';
            return;
        }
        list.innerHTML = state.modules.map((m, idx) => `
            <div class="cc-manage-item ${m.hidden ? 'is-hidden' : ''}" data-idx="${idx}">
                <button class="cc-manage-icon-btn drag" data-drag="${idx}" title="拖拽排序"><i class="fas fa-bars"></i></button>
                <div class="cc-manage-item-name">${escapeHtml(m.name)} <span class="cc-manage-item-count">(${m.tags.length})</span>${m.hidden ? '<span class="cc-manage-item-hidden-tag">已隐藏</span>' : ''}</div>
                <button class="cc-manage-icon-btn visibility" onclick="Chuanci.toggleModuleVisibility(${idx})" title="${m.hidden ? '显示' : '隐藏'}"><i class="fas ${m.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                <button class="cc-manage-icon-btn edit" onclick="Chuanci.editModuleName(${idx})" title="编辑名称"><i class="fas fa-pen"></i></button>
                <button class="cc-manage-icon-btn delete" onclick="Chuanci.deleteModuleConfirm(${idx})" title="删除模块"><i class="fas fa-minus-circle"></i></button>
            </div>
        `).join('');
        setupManageDrag();
    }

    function toggleModuleVisibility(idx) {
        const m = state.modules[idx];
        if (!m) return;
        m.hidden = !m.hidden;
        saveModules();
        renderManageList();
        renderHome(); // 同步刷新主页 tab 显示
        showToast(m.hidden ? '<i class="fas fa-eye-slash"></i> 已隐藏，不参与抽取' : '<i class="fas fa-eye"></i> 已显示');
    }

    function editModuleName(idx) {
        const m = state.modules[idx];
        if (!m) return;
        const newName = prompt('修改模块名称：', m.name);
        if (newName === null) return; // 取消
        const trimmed = newName.trim();
        if (!trimmed) {
            showToast('<i class="fas fa-exclamation-circle"></i> 名称不能为空');
            return;
        }
        if (trimmed === m.name) return; // 没变化
        m.name = trimmed;
        saveModules();
        renderManageList();
        showToast('已修改模块名称');
    }
    function deleteModuleConfirm(idx) {
        const m = state.modules[idx];
        if (!confirm(`确定删除"${m.name}"整个模块吗？`)) return;
        state.modules.splice(idx, 1);
        saveModules();
        renderManageList();
        showToast('已删除模块');
    }
    function setupManageDrag() {
        const list = document.getElementById('cc-manage-list');
        if (!list) return;
        const items = list.querySelectorAll('.cc-manage-item');
        items.forEach(item => {
            const dragBtn = item.querySelector('.cc-manage-icon-btn.drag');
            if (!dragBtn) return;
            const onStart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const draggingEl = item;
                draggingEl.classList.add('dragging');

                const onMove = (ev) => {
                    ev.preventDefault && ev.preventDefault();
                    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
                    const all = Array.from(list.querySelectorAll('.cc-manage-item:not(.dragging)'));
                    let nextEl = null;
                    for (const other of all) {
                        const rect = other.getBoundingClientRect();
                        const mid = rect.top + rect.height / 2;
                        if (y < mid) { nextEl = other; break; }
                    }
                    if (nextEl) {
                        if (draggingEl.nextSibling !== nextEl) list.insertBefore(draggingEl, nextEl);
                    } else {
                        if (list.lastChild !== draggingEl) list.appendChild(draggingEl);
                    }
                };
                const onEnd = () => {
                    draggingEl.classList.remove('dragging');
                    const newOrder = Array.from(list.querySelectorAll('.cc-manage-item'))
                        .map(el => parseInt(el.dataset.idx));
                    state.modules = newOrder.map(idx => state.modules[idx]);
                    saveModules();
                    renderManageList();
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('mouseup', onEnd);
                    document.removeEventListener('touchend', onEnd);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mouseup', onEnd);
                document.addEventListener('touchend', onEnd);
            };
            dragBtn.addEventListener('mousedown', onStart);
            dragBtn.addEventListener('touchstart', onStart, { passive: false });
        });
    }

    function clearModule(idx) {
        const m = state.modules[idx];
        if (!confirm(`确定清除"${m.name}"内所有用户添加的标签吗？（仅保留"无"）`)) return;
        let defaultTag = m.tags.find(t => t.isDefault);
        if (!defaultTag) defaultTag = { id: 'td_' + Date.now(), label: '无', isDefault: true };
        m.tags = [defaultTag];
        saveModules();
        renderEditView();
        showToast('已清除');
    }
    function addTag(idx) {
        openBatchInputModal('新增小标签', '在此粘贴内容，每行为一条', (text) => {
            const labels = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
            if (labels.length === 0) return;
            const m = state.modules[idx];
            const defaultIdx = m.tags.findIndex(t => t.isDefault);
            const newTags = labels.map((label, i) => ({ id: 't_' + Date.now() + '_' + i, label: label }));
            if (defaultIdx >= 0) m.tags.splice(defaultIdx, 0, ...newTags);
            else m.tags.push(...newTags);
            saveModules();
            renderEditView();
            showToast(`已新增 ${labels.length} 条小标签`);
        });
    }
    function deleteTag(mIdx, tIdx) {
        const tag = state.modules[mIdx].tags[tIdx];
        state.modules[mIdx].tags.splice(tIdx, 1);
        saveModules();
        renderEditView();
        showToast(`已删除"${tag.label}"`);
    }

    // ===== 日历 =====
    function renderCalendar() {
        const d = state.currentCalDate;
        const monthEl = document.getElementById('cc-cal-month');
        if (!monthEl) return;
        monthEl.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
        const year = d.getFullYear();
        const month = d.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startWeekday = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        const today = formatDate(new Date());
        const cells = [];
        ['日','一','二','三','四','五','六'].forEach(w => {
            cells.push(`<div class="cc-cal-weekday">${w}</div>`);
        });
        const prevMonth = new Date(year, month - 1, 0).getDate();
        for (let i = startWeekday - 1; i >= 0; i--) {
            cells.push(`<div class="cc-cal-day other-month">${prevMonth - i}</div>`);
        }
        for (let i = 1; i <= daysInMonth; i++) {
            const dateKey = `${year}-${pad(month+1)}-${pad(i)}`;
            const dayEntry = state.history.find(h => h.date === dateKey);
            const isToday = dateKey === today;
            const isSelected = state.selectedDate === dateKey;
            const hasRecord = dayEntry && dayEntry.sessions.length > 0;
            const cls = ['cc-cal-day'];
            if (isToday) cls.push('today');
            if (isSelected) cls.push('selected');
            if (hasRecord) cls.push('has-record');
            const count = hasRecord ? dayEntry.sessions.reduce((sum, s) => sum + (s.content ? s.content.length : 0), 0) : 0;
            cells.push(`<div class="${cls.join(' ')}" onclick="Chuanci.selectDate('${dateKey}')">
                <div>${i}</div>
                ${count > 0 ? `<div class="cc-cal-day-count">${count}条</div>` : ''}
            </div>`);
        }
        document.getElementById('cc-cal-grid').innerHTML = cells.join('');
        renderDayDetail();
    }
    function renderDayDetail() {
        const detail = document.getElementById('cc-day-detail');
        if (!detail) return;
        if (!state.selectedDate) { detail.innerHTML = ''; return; }
        const dayEntry = state.history.find(h => h.date === state.selectedDate);
        if (!dayEntry || dayEntry.sessions.length === 0) {
            detail.innerHTML = `<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:20px;">这天没有生成记录</div>`;
            return;
        }
        // 最新的在最上面（倒序展示，但 sIdx 保持真实数据索引）
        const sessionsRev = dayEntry.sessions.map((s, sIdx) => ({ s, sIdx })).reverse();
        detail.innerHTML = sessionsRev.map(({ s, sIdx }) => {
            const timeStr = `${state.selectedDate} ${s.time}`;
            // 标签文字（所有维度都展示，按 "维度（值）" 形式）
            const tagsText = s.tags ? Object.keys(s.tags).map(k =>
                `${escapeHtml(k)}（${escapeHtml(s.tags[k])}）`
            ).join('、') : '';

            // 不同状态下显示主体内容
            let contentBlock = '';
            if (s.status === 'cancelled') {
                contentBlock = `<div style="color:#ef4444;font-size:13px;padding:4px 0;">本次生成已取消</div>`;
            } else if (s.status === 'fortune') {
                contentBlock = `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;font-style:italic;">（抽签结果，未生成词条）</div>`;
            } else {
                contentBlock = (s.content || []).map(c =>
                    `<div style="display:flex;gap:8px;font-size:13px;line-height:1.7;color:var(--text-primary);"><span style="color:var(--accent-color);flex-shrink:0;">·</span><span style="word-break:break-word;">${escapeHtml(c)}</span></div>`
                ).join('');
            }

            return `<div class="cc-day-session-card" data-sidx="${sIdx}">
                <div class="cc-day-card-head">
                    <span class="cc-day-card-time">${timeStr}</span>
                    <button class="cc-day-card-del" onclick="Chuanci.deleteSession(${sIdx})">删除</button>
                </div>
                <div class="cc-day-card-body">
                    ${contentBlock}
                </div>
                ${tagsText ? `<div class="cc-day-card-tags">${tagsText}</div>` : ''}
            </div>`;
        }).join('');
    }

    function deleteSession(sIdx) {
        if (!state.selectedDate) return;
        const dayEntry = state.history.find(h => h.date === state.selectedDate);
        if (!dayEntry) return;
        if (!confirm('确定删除这条历史记录吗？')) return;
        dayEntry.sessions.splice(sIdx, 1);
        // 整天没记录了就移除整天
        if (dayEntry.sessions.length === 0) {
            state.history = state.history.filter(h => h.date !== state.selectedDate);
        }
        saveHistory();
        renderCalendar();
    }
    function selectDate(dateKey) {
        state.selectedDate = state.selectedDate === dateKey ? null : dateKey;
        renderCalendar();
    }
    function changeMonth(delta) {
        state.currentCalDate.setMonth(state.currentCalDate.getMonth() + delta);
        renderCalendar();
    }

    // ===== API 配置 =====
    function loadApiConfigUI() {
        const wasCleared = clearExpiredKeyIfNeeded();
        document.getElementById('cc-api-baseurl').value = state.apiConfig.baseurl || '';
        document.getElementById('cc-api-model').value = state.apiConfig.model || '';
        document.getElementById('cc-api-key').value = state.apiConfig.apikey || '';
        document.getElementById('cc-api-persona').value = state.apiConfig.persona || '';

        const noticeEl = document.getElementById('cc-api-expire-notice');
        if (noticeEl) {
            if (wasCleared) {
                noticeEl.style.display = 'flex';
                noticeEl.querySelector('.cc-api-notice-text').textContent = 'API Key 已过期清除（2 周安全机制），请重新填入';
                noticeEl.style.background = 'rgba(239,68,68,0.08)';
                noticeEl.style.color = '#ef4444';
                noticeEl.style.borderColor = 'rgba(239,68,68,0.2)';
            } else if (state.apiConfig.apikey && state.apiConfig.apikeyTimestamp) {
                const remainMs = API_KEY_TTL_MS - (Date.now() - state.apiConfig.apikeyTimestamp);
                if (remainMs > 0) {
                    const days = Math.floor(remainMs / 86400000);
                    const hours = Math.floor((remainMs % 86400000) / 3600000);
                    const mins = Math.floor((remainMs % 3600000) / 60000);
                    let remainText;
                    if (days >= 1) {
                        remainText = `${days} 天 ${hours} 小时`;
                    } else if (hours >= 1) {
                        remainText = `${hours} 小时 ${mins} 分钟`;
                    } else {
                        remainText = `${mins} 分钟`;
                    }
                    noticeEl.style.display = 'flex';
                    noticeEl.querySelector('.cc-api-notice-text').textContent = `当前 Key 将在 ${remainText}后自动清除`;
                    noticeEl.style.background = 'rgba(var(--accent-color-rgb), 0.08)';
                    noticeEl.style.color = 'var(--accent-color)';
                    noticeEl.style.borderColor = 'rgba(var(--accent-color-rgb), 0.2)';
                } else {
                    noticeEl.style.display = 'none';
                }
            } else {
                noticeEl.style.display = 'none';
            }
        }
    }
    function saveApiConfigFn() {
        const newKey = document.getElementById('cc-api-key').value.trim();
        const oldKey = state.apiConfig.apikey;
        state.apiConfig.baseurl = document.getElementById('cc-api-baseurl').value.trim();
        state.apiConfig.model = document.getElementById('cc-api-model').value.trim();
        state.apiConfig.persona = document.getElementById('cc-api-persona').value.trim();
        if (newKey !== oldKey) {
            state.apiConfig.apikey = newKey;
            state.apiConfig.apikeyTimestamp = newKey ? Date.now() : 0;
        }
        saveApiConfig();
        showToast('已保存配置');
        openView('home');
    }
    function clearApiConfigFn() {
        if (!confirm('确定清除所有 API 配置吗？')) return;
        state.apiConfig = { baseurl: '', model: '', apikey: '', persona: '', apikeyTimestamp: 0 };
        saveApiConfig();
        loadApiConfigUI();
        showToast('已清空配置');
    }

    // ===== 工具 =====
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
    function formatTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }

    // ===== 模块入口（供 listeners.js 调用） =====
    let _initialized = false;
    function open() {
        if (!_initialized) {
            loadData();
            clearExpiredKeyIfNeeded();
            startQueueChecker();
            startPartnerRequestScheduler();
            _initialized = true;
        } else {
            // 每次打开都重新检查 Key 过期
            clearExpiredKeyIfNeeded();
        }
        const modal = document.getElementById('chuanci-modal');
        if (modal && typeof showModal === 'function') {
            showModal(modal);
            openView('home');
        }
    }
    function close() {
        const modal = document.getElementById('chuanci-modal');
        if (modal && typeof hideModal === 'function') hideModal(modal);
    }

    // 暴露
    window.Chuanci = {
        open, close,
        openView, openSettings, closeSettings, toggleDuration, updateDuration,
        clickGenerate, clearModule, addTag, deleteTag,
        openManageModal, closeManageModal, addModuleFromInput, deleteModuleConfirm, editModuleName, toggleModuleVisibility,
        selectDate, changeMonth, deleteSession,
        saveApiConfig: saveApiConfigFn, clearApiConfig: clearApiConfigFn,
        closeInputModal, confirmInput,
        // 对方申请追加字卡入口
        canPartnerRequest, showPartnerRequestModal
    };

    // 兼容 inline onclick 全局函数（保持和独立版一致）
    window.cc_openView = (n) => window.Chuanci.openView(n);
    window.cc_openSettings = () => window.Chuanci.openSettings();
    window.cc_closeSettings = () => window.Chuanci.closeSettings();
    window.cc_toggleDuration = () => window.Chuanci.toggleDuration();
    window.cc_updateDuration = (v) => window.Chuanci.updateDuration(v);
    window.cc_clickGenerate = () => window.Chuanci.clickGenerate();
    window.cc_openManageModal = () => window.Chuanci.openManageModal();
    window.cc_closeManageModal = () => window.Chuanci.closeManageModal();
    window.cc_addModuleFromInput = () => window.Chuanci.addModuleFromInput();
    window.cc_saveApiConfig = () => window.Chuanci.saveApiConfig();
    window.cc_clearApiConfig = () => window.Chuanci.clearApiConfig();
    window.cc_changeMonth = (d) => window.Chuanci.changeMonth(d);
    window.cc_closeInputModal = () => window.Chuanci.closeInputModal();
    window.cc_confirmInput = () => window.Chuanci.confirmInput();
})();
