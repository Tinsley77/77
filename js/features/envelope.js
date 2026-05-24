let envelopeData = { outbox: [], inbox: [] }; 
let currentEnvTab = 'outbox';
let editingEnvId = null; 
let editingEnvSection = null; 

async function loadEnvelopeData() {
    const saved = await localforage.getItem(getStorageKey('envelopeData'));
    if (saved) envelopeData = saved;
    const oldPending = await localforage.getItem(getStorageKey('pending_envelope'));
    if (oldPending && envelopeData.outbox.length === 0) {
        envelopeData.outbox.push({
            id: 'legacy_' + Date.now(),
            content: '（历史寄出的信件）',
            sentTime: oldPending.sentTime,
            replyTime: oldPending.replyTime,
            status: 'pending'
        });
        await localforage.removeItem(getStorageKey('pending_envelope'));
        saveEnvelopeData();
    }
}

function saveEnvelopeData() {
    localforage.setItem(getStorageKey('envelopeData'), envelopeData);
}

async function checkEnvelopeStatus() {
    await loadEnvelopeData();
    const now = Date.now();
    let changed = false;
    let newReplyLetter = null;
    envelopeData.outbox.forEach(letter => {
        if (letter.status === 'pending' && now >= letter.replyTime) {
            letter.status = 'replied';
            const replyContent = generateEnvelopeReplyText();
            const replyId = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
            const inboxLetter = {
                id: replyId,
                refId: letter.id,
                originalContent: letter.content,
                content: replyContent,
                receivedTime: Date.now(),
                isNew: true
            };
            envelopeData.inbox.push(inboxLetter);
            newReplyLetter = inboxLetter;
            changed = true;
            playSound('message');
        }
    });
    if (changed) {
        saveEnvelopeData();
        if (newReplyLetter) showEnvelopeReplyPopup(newReplyLetter);
    }
}

function showEnvelopeReplyPopup(letter) {
    const existing = document.getElementById('envelope-reply-popup');
    if (existing) existing.remove();
    const popup = document.createElement('div');
    popup.id = 'envelope-reply-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:20px;padding:18px 20px;z-index:8000;max-width:320px;width:88%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:26px;">💌</span>
            <div>
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);">收到了一封回信</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">Ta 给你写了回信，快去看看吧~</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('envelope-reply-popup').remove();" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后查看</button>
            <button onclick="openEnvelopeAndViewReply('${letter.id}');" style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即阅读 ✉</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

const APPEARANCE_PANEL_TITLES = {
    'theme': '主题配色', 'font': '字体设置', 'background': '聊天背景',
    'bubble': '气泡样式', 'avatar': '聊天头像', 'css': '自定义CSS',
    'font-bg': '背景 & 字体', 'bubble-css': '气泡 & CSS'
};
window.showAppearancePanel = function(panel) {
    const panelMap = {
        'font-bg': ['font', 'background'],
        'bubble-css': ['bubble', 'css']
    };
    document.getElementById('appearance-nav-grid').style.display = 'none';
    var unBtn = document.getElementById('update-notice-btn');
    if (unBtn) unBtn.style.display = 'none';
    var galleryBanner = document.getElementById('gallery-banner-entry');
    if (galleryBanner) galleryBanner.style.display = 'none';
    document.getElementById('appearance-panel-container').style.display = 'block';
    document.getElementById('appearance-panel-title').textContent = APPEARANCE_PANEL_TITLES[panel] || panel;
    document.querySelectorAll('.appearance-sub-panel').forEach(p => p.style.display = 'none');
    if (panelMap[panel]) {
        panelMap[panel].forEach(sub => {
            const target = document.getElementById('appearance-panel-' + sub);
            if (target) target.style.display = 'block';
        });
    } else {
        const target = document.getElementById('appearance-panel-' + panel);
        if (target) target.style.display = 'block';
    }
    if (panel === 'bubble' || panel === 'bubble-css') { setTimeout(() => { if (typeof window.updateBubblePreviewFn === 'function') window.updateBubblePreviewFn(); }, 50); }
};
window.hideAppearancePanel = function() {
    document.getElementById('appearance-nav-grid').style.display = 'grid';
    document.getElementById('appearance-panel-container').style.display = 'none';
    document.querySelectorAll('.appearance-sub-panel').forEach(p => p.style.display = 'none');
    var unBtn = document.getElementById('update-notice-btn');
    if (unBtn) unBtn.style.display = 'flex';
    var galleryBanner = document.getElementById('gallery-banner-entry');
    if (galleryBanner) galleryBanner.style.display = 'flex';
};

window.openEnvelopeAndViewReply = function(replyId) {
    const popup = document.getElementById('envelope-reply-popup');
    if (popup) popup.remove();
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('inbox');
        viewEnvLetter('inbox', replyId);
    }, 200);
};

function generateEnvelopeReplyText() {
    const sourcePool = [...customReplies, ...(window.wordBank || [])].filter(s => s && String(s).trim());
    if (!sourcePool.length) return '（暂无内容）';
    const sentenceCount = Math.floor(Math.random() * (20 - 8 + 1)) + 8;
    let replyContent = "";
    for (let i = 0; i < sentenceCount; i++) {
        const randomSentence = sourcePool[Math.floor(Math.random() * sourcePool.length)];
        const punctuation = Math.random() < 0.2 ? "！" : (Math.random() < 0.2 ? "..." : "。");
        replyContent += randomSentence + punctuation;
    }
    return replyContent;
}


window.switchEnvTab = function(tab) {
    currentEnvTab = tab;
    document.getElementById('env-tab-outbox').classList.toggle('active', tab === 'outbox');
    document.getElementById('env-tab-inbox').classList.toggle('active', tab === 'inbox');
    document.getElementById('env-outbox-section').style.display = tab === 'outbox' ? 'block' : 'none';
    document.getElementById('env-inbox-section').style.display = tab === 'inbox' ? 'block' : 'none';
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    renderEnvelopeLists();
};

function renderEnvelopeLists() {
    renderOutboxList();
    renderInboxList();
    const pendingCount = envelopeData.outbox.filter(l => l.status === 'pending').length;
    const newInboxCount = envelopeData.inbox.filter(l => l.isNew).length;
    const outboxBadge = document.getElementById('env-outbox-badge');
    const inboxBadge = document.getElementById('env-inbox-badge');
    if (outboxBadge) { outboxBadge.textContent = pendingCount; outboxBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none'; }
    if (inboxBadge) { inboxBadge.textContent = newInboxCount; inboxBadge.style.display = newInboxCount > 0 ? 'inline-block' : 'none'; }
    const envelopeEntryBadge = document.getElementById('env-entry-badge');
    if (envelopeEntryBadge) { envelopeEntryBadge.style.display = newInboxCount > 0 ? 'inline-block' : 'none'; }
}

function renderOutboxList() {
    const list = document.getElementById('env-outbox-list');
    if (!list) return;
    if (envelopeData.outbox.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">还没有寄出任何信件</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">提笔写下心意，寄送给Ta吧~</div>
        </div>`;
        return;
    }
    list.innerHTML = envelopeData.outbox.slice().reverse().map(letter => {
        const date = new Date(letter.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
        const isPending = letter.status === 'pending';
        const replyTime = isPending ? new Date(letter.replyTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
        const statusIcon = isPending
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
        const statusText = isPending ? `${statusIcon} 预计 ${replyTime} 回信` : `${statusIcon} 已收到回信`;
        const preview = letter.content.length > 38 ? letter.content.substring(0, 38) + '…' : letter.content;
        return `
        <div class="env-letter-item" onclick="viewEnvLetter('outbox','${letter.id}')">
            <div class="env-letter-header">
                <div class="env-letter-header-from">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
                    寄出 · ${date}
                </div>
                <div class="env-stamp">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </div>
            </div>
            <div class="env-letter-body">
                <div class="env-letter-preview">${preview}</div>
                <div class="env-letter-status">${statusText}</div>
            </div>
            <button class="env-letter-delete-btn" onclick="deleteEnvLetter(event,'outbox','${letter.id}')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }).join('');
}

function renderInboxList() {
    const list = document.getElementById('env-inbox-list');
    if (!list) return;
    if (envelopeData.inbox.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/><polyline points="22 13 12 13"/><path d="M19 16l-5-3-5 3"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">还没有收到回信</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">对方正在认真回复中，请稍候~</div>
        </div>`;
        return;
    }
    list.innerHTML = envelopeData.inbox.slice().reverse().map(letter => {
        const date = new Date(letter.receivedTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
        const preview = letter.content.length > 50 ? letter.content.substring(0, 50) + '…' : letter.content;
        const isNew = letter.isNew;
        const origPreview = letter.originalContent ? (letter.originalContent.length > 32 ? letter.originalContent.substring(0, 32) + '…' : letter.originalContent) : '';
        return `
        <div class="env-letter-item reply ${isNew ? 'env-letter-new' : ''}" onclick="viewEnvLetter('inbox','${letter.id}')">
            <div class="env-letter-header">
                <div class="env-letter-header-from">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                    收到 · ${date}
                    ${isNew ? '<span style="background:rgba(255,255,255,0.3);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:6px;">新</span>' : ''}
                </div>
                <div class="env-stamp">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
            </div>
            ${origPreview ? `<div style="padding:6px 12px 0;display:flex;align-items:flex-start;gap:6px;"><div style="width:2px;border-radius:2px;background:rgba(var(--accent-color-rgb),0.4);flex-shrink:0;align-self:stretch;min-height:14px;margin-top:1px;"></div><div style="font-size:11px;color:var(--text-secondary);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 14px);opacity:0.75;">原信: ${origPreview}</div></div>` : ''}
            <div class="env-letter-body">
                <div class="env-letter-preview">${preview}</div>
            </div>
            <button class="env-letter-delete-btn" onclick="deleteEnvLetter(event,'inbox','${letter.id}')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }).join('');
}

window.viewEnvLetter = function(section, id) {
    const letters = section === 'outbox' ? envelopeData.outbox : envelopeData.inbox;
    const letter = letters.find(l => l.id === id);
    if (!letter) return;
    if (section === 'inbox' && letter.isNew) {
        letter.isNew = false;
        saveEnvelopeData();
        renderEnvelopeLists();
    }
    editingEnvId = id;
    editingEnvSection = section;

    document.getElementById('env-view-title').textContent = section === 'outbox' ? '寄出的信' : '收到的回信';

    const dateObj = letter.timestamp ? new Date(letter.timestamp) : new Date();
    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth()+1).padStart(2,'0');
    const d = String(dateObj.getDate()).padStart(2,'0');
    const dateStr = `${y}/${mo}/${d}`;
    const weekdays = ['日','一','二','三','四','五','六'];
    const fullDateStr = dateStr + ' 星期' + weekdays[dateObj.getDay()];

    const stampEl = document.getElementById('env-view-stamp-date');
    if (stampEl) stampEl.textContent = `${mo}/${d}`;

    const dateLine = document.getElementById('env-view-date-line');
    if (dateLine) dateLine.textContent = fullDateStr;

    const toLine = document.getElementById('env-view-to-line');
    const greetingLine = document.getElementById('env-view-greeting-line');
    if (section === 'outbox') {
        const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '亲爱的';
        if (toLine) toLine.textContent = `致 ${partnerName}：`;
        if (greetingLine) greetingLine.textContent = '见字如面，望君安好。';
    } else {
        const myName = (typeof settings !== 'undefined' && settings.myName) || '你';
        if (toLine) toLine.textContent = `致 ${myName}：`;
        if (greetingLine) greetingLine.textContent = '见字如面，一切皆好。';
    }

    const textEl = document.getElementById('env-view-text');
    if (textEl) textEl.textContent = letter.content;

    const signDateEl = document.getElementById('env-view-sign-date');
    const signNameEl = document.getElementById('env-view-sign-name');
    if (signDateEl) signDateEl.textContent = fullDateStr;
    if (section === 'outbox') {
        const myName = (typeof settings !== 'undefined' && settings.myName) || '你';
        if (signNameEl) signNameEl.textContent = myName;
    } else {
        const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
        if (signNameEl) signNameEl.textContent = partnerName;
    }

    document.getElementById('env-edit-input').value = letter.content;
    document.getElementById('env-view-content').style.display = 'block';
    document.getElementById('env-view-edit').style.display = 'none';
    document.getElementById('env-view-edit-btn').style.display = 'inline-flex';
    document.getElementById('env-view-save-btn').style.display = 'none';
    const origCtx = document.getElementById('env-view-original-ctx');
    const origText = document.getElementById('env-view-original-text');
    const origExpand = document.getElementById('env-view-original-expand');
    if (origCtx && origText) {
        if (section === 'inbox' && letter.originalContent) {
            origText.textContent = letter.originalContent;
            origText.style.maxHeight = '80px';
            origCtx.style.display = 'block';
            if (origExpand) {
                origExpand.style.display = letter.originalContent.length > 120 ? 'block' : 'none';
                origExpand.textContent = '展开查看全文';
            }
        } else {
            origCtx.style.display = 'none';
        }
    }
    showModal(document.getElementById('envelope-view-modal'));
};

window.toggleEnvEdit = function() {
    const contentEl = document.getElementById('env-view-content');
    const editEl = document.getElementById('env-view-edit');
    const editBtn = document.getElementById('env-view-edit-btn');
    const saveBtn = document.getElementById('env-view-save-btn');
    const isEditing = editEl.style.display !== 'none';
    if (isEditing) {
        contentEl.style.display = 'block';
        editEl.style.display = 'none';
        editBtn.textContent = '编辑';
        saveBtn.style.display = 'none';
    } else {
        contentEl.style.display = 'none';
        editEl.style.display = 'block';
        editBtn.textContent = '取消';
        saveBtn.style.display = 'inline-flex';
    }
};

window.saveEnvEdit = function() {
    const newContent = document.getElementById('env-edit-input').value.trim();
    if (!newContent) { showNotification('内容不能为空', 'warning'); return; }
    const letters = editingEnvSection === 'outbox' ? envelopeData.outbox : envelopeData.inbox;
    const letter = letters.find(l => l.id === editingEnvId);
    if (letter) {
        letter.content = newContent;
        saveEnvelopeData();
        const textEl = document.getElementById('env-view-text');
        if (textEl) textEl.textContent = newContent;
        showNotification('已保存修改', 'success');
        toggleEnvEdit();
    }
};

window.closeEnvViewModal = function() {
    hideModal(document.getElementById('envelope-view-modal'));
};

window.deleteEnvLetter = function(event, section, id) {
    event.stopPropagation();
    if (!confirm('确定要删除这封信吗？')) return;
    if (section === 'outbox') {
        envelopeData.outbox = envelopeData.outbox.filter(l => l.id !== id);
    } else {
        envelopeData.inbox = envelopeData.inbox.filter(l => l.id !== id);
    }
    saveEnvelopeData();
    renderEnvelopeLists();
    showNotification('已删除', 'success');
};

window.openNewEnvelopeForm = function() {
    document.getElementById('env-outbox-section').style.display = 'none';
    document.getElementById('env-inbox-section').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'none';
    document.getElementById('env-compose-title').textContent = '写一封信';
    document.getElementById('envelope-input').value = '';
    document.getElementById('env-send-to-chat').checked = false;
    document.getElementById('env-compose-form').style.display = 'block';
};

window.cancelEnvelopeCompose = function() {
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    if (currentEnvTab === 'outbox') {
        document.getElementById('env-outbox-section').style.display = 'block';
    } else {
        document.getElementById('env-inbox-section').style.display = 'block';
    }
};

function handleSendEnvelope() {
    const text = document.getElementById('envelope-input').value.trim();
    if (!text) { showNotification('信件内容不能为空', 'warning'); return; }

    const sendToChat = document.getElementById('env-send-to-chat').checked;
    if (sendToChat) {
        addMessage({ id: Date.now(), sender: 'user', text: `【寄出的信】\n${text}`, timestamp: new Date(), status: 'sent', type: 'normal' });
    }

    const minHours = 4, maxHours = 6;
    const randomHours = Math.random() * (maxHours - minHours) + minHours;
    const replyTime = Date.now() + randomHours * 60 * 60 * 1000;
    const newId = 'env_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    envelopeData.outbox.push({
        id: newId, content: text,
        sentTime: Date.now(), replyTime,
        status: 'pending'
    });
    saveEnvelopeData();

    cancelEnvelopeCompose();
    switchEnvTab('outbox');
    showNotification(`信件已寄出，预计 ${Math.floor(randomHours)} 小时后收到回信 ✉️`, 'success');
}


// ── 信封导出/入 ──

window.openEnvelopeDrawer = function() {
    var total = (envelopeData.outbox || []).length + (envelopeData.inbox || []).length;

    if (!document.getElementById('dm-drawer-envelope')) {
        var dummy = document.createElement('div');
        dummy.innerHTML = '<div class="dm-action-drawer" id="dm-drawer-envelope">'
            + '<div class="dm-drawer-backdrop" id="dm-drawer-envelope-backdrop"></div>'
            + '<div class="dm-drawer-sheet">'
            + '<div class="dm-drawer-handle"></div>'
            + '<div class="dm-drawer-title">'
            + '<div class="dm-drawer-title-icon" style="background:linear-gradient(135deg,#5B9BD5,#2E6FBE);color:#fff"><i class="fas fa-envelope"></i></div>'
            + '<div><div class="dm-drawer-title-text" id="env-drawer-title-text">信封投递</div><div class="dm-drawer-subtitle">仅包含消息内容</div></div>'
            + '</div>'
            + '<div class="dm-drawer-actions">'
            + '<button class="dm-drawer-action-btn primary" id="export-envelope-btn" style="background:linear-gradient(135deg,#5B9BD5,#2E6FBE);border-color:#5B9BD5">'
            + '<div class="dm-drawer-btn-icon"><i class="fas fa-download"></i></div>'
            + '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导出信封</div><div class="dm-drawer-btn-desc">将消息记录保存为文件</div></div>'
            + '</button>'
            + '<button class="dm-drawer-action-btn" id="import-envelope-btn">'
            + '<div class="dm-drawer-btn-icon"><i class="fas fa-upload"></i></div>'
            + '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导入信封</div><div class="dm-drawer-btn-desc">从文件恢复历史消息</div></div>'
            + '</button>'
            + '</div>'
            + '<button class="dm-drawer-cancel" id="dm-drawer-envelope-cancel">取消</button>'
            + '</div></div>'
            + '<div class="dm-action-drawer" id="dm-drawer-envelope-import">'
            + '<div class="dm-drawer-backdrop" id="dm-drawer-envelope-import-backdrop"></div>'
            + '<div class="dm-drawer-sheet">'
            + '<div class="dm-drawer-handle"></div>'
            + '<div class="dm-drawer-title">'
            + '<div class="dm-drawer-title-icon" style="background:linear-gradient(135deg,#5B9BD5,#2E6FBE);color:#fff"><i class="fas fa-envelope"></i></div>'
            + '<div><div class="dm-drawer-title-text" id="env-import-drawer-title-text">信封投递</div><div class="dm-drawer-subtitle">仅包含消息内容</div></div>'
            + '</div>'
            + '<div style="padding:12px 16px 4px;display:flex;align-items:center;gap:16px;font-size:14px;color:var(--text-primary);">'
            + '<span style="opacity:0.7;">导入方式</span>'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="env-import-mode" value="append" checked style="accent-color:#5B9BD5;"> 追加</label>'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="env-import-mode" value="overwrite" style="accent-color:#5B9BD5;"> 覆盖</label>'
            + '</div>'
            + '<div style="padding:8px 16px 16px;display:flex;gap:10px;">'
            + '<button class="dm-drawer-cancel" id="dm-drawer-envelope-import-cancel" style="flex:1;border-radius:12px;margin-top:0;">取消</button>'
            + '<button id="confirm-envelope-import-btn" style="flex:2;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#5B9BD5,#2E6FBE);color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;"><i class="fas fa-download"></i> 确认</button>'
            + '</div>'
            + '</div></div>';

        while (dummy.firstElementChild) document.body.appendChild(dummy.firstElementChild);

        var envD = document.getElementById('dm-drawer-envelope');
        var envID = document.getElementById('dm-drawer-envelope-import');

        var closeEnvD = function() { envD.classList.remove('open'); document.body.style.overflow=''; };
        var closeEnvID = function() { envID.classList.remove('open'); document.body.style.overflow=''; };

        envD.querySelector('#dm-drawer-envelope-backdrop').addEventListener('click', closeEnvD);
        envD.querySelector('#dm-drawer-envelope-cancel').addEventListener('click', closeEnvD);
        envD.querySelector('#export-envelope-btn').addEventListener('click', function() {
            closeEnvD();
            window.exportEnvelopeData();
        });
        envD.querySelector('#import-envelope-btn').addEventListener('click', function() {
            closeEnvD();
            var inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json';
            inp.onchange = function(e) {
                var f = e.target.files && e.target.files[0];
                if (!f) return;
                var reader = new FileReader();
                reader.onload = function(ev) {
                    try {
                        var d = JSON.parse(ev.target.result);
                        var t = ((d.outbox||[]).length + (d.inbox||[]).length);
                        document.getElementById('env-import-drawer-title-text').textContent = '信封投递（' + t + '）';
                        window._pendingEnvelopeImportData = d;
                        envID.classList.add('open');
                        document.body.style.overflow = 'hidden';
                    } catch(err) { alert('文件格式不正确'); }
                };
                reader.readAsText(f);
            };
            inp.click();
        });

        envID.querySelector('#dm-drawer-envelope-import-backdrop').addEventListener('click', closeEnvID);
        envID.querySelector('#dm-drawer-envelope-import-cancel').addEventListener('click', closeEnvID);
        envID.querySelector('#confirm-envelope-import-btn').addEventListener('click', function() {
            var mode = (envID.querySelector('input[name="env-import-mode"]:checked') || {}).value || 'append';
            window.importEnvelopeData(window._pendingEnvelopeImportData, mode);
            closeEnvID();
        });
    }

    var titleEl = document.getElementById('env-drawer-title-text');
    if (titleEl) titleEl.textContent = '信封投递（' + total + '）';
    var drawer = document.getElementById('dm-drawer-envelope');
    if (drawer) { drawer.classList.add('open'); document.body.style.overflow = 'hidden'; }
};

window.exportEnvelopeData = function() {
    var data = JSON.stringify(envelopeData, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'envelope-backup-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showNotification === 'function') showNotification('信封已导出 ✉️', 'success');
};

window.importEnvelopeData = function(data, mode) {
    if (!data) return;
    if (mode === 'overwrite') {
        envelopeData.outbox = data.outbox || [];
        envelopeData.inbox  = data.inbox  || [];
    } else {
        // 追加：按 id 去重
        var existOutIds = new Set((envelopeData.outbox || []).map(l => l.id));
        var existInIds  = new Set((envelopeData.inbox  || []).map(l => l.id));
        (data.outbox || []).forEach(l => { if (!existOutIds.has(l.id)) envelopeData.outbox.push(l); });
        (data.inbox  || []).forEach(l => { if (!existInIds.has(l.id))  envelopeData.inbox.push(l); });
    }
    saveEnvelopeData();
    if (typeof renderEnvelopeList === 'function') renderEnvelopeList();
    var total = envelopeData.outbox.length + envelopeData.inbox.length;
    if (typeof showNotification === 'function') showNotification('导入完成，共 ' + total + ' 封信 ✉️', 'success');
};
