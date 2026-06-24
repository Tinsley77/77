// ==========================================================================
// 图片压缩工具
// 默认参数：最大宽度 1080px，质量 0.75
// 仅压缩 JPEG/PNG/WebP，对 GIF / SVG 等特殊格式不动
// ==========================================================================
const IMG_COMPRESS_MAX_WIDTH = 1080;
const IMG_COMPRESS_QUALITY = 0.75;
const IMG_COMPRESS_MIN_SIZE = 50 * 1024; // 小于 50KB 不压缩（已经够小了）

/**
 * 压缩 dataURL 图片
 * @param {string} dataURL - base64 编码的图片
 * @param {object} opts - 可选参数 { maxWidth, quality }
 * @returns {Promise<string>} 压缩后的 dataURL（如果无法压缩则返回原图）
 */
function compressImageDataURL(dataURL, opts) {
    return new Promise((resolve) => {
        if (!dataURL || typeof dataURL !== 'string' || dataURL.indexOf('data:image/') !== 0) {
            return resolve(dataURL);
        }
        // GIF / SVG 不压（GIF 动画会变静态，SVG 是矢量没必要）
        const mimeMatch = dataURL.match(/^data:image\/([a-zA-Z+]+);/);
        const fmt = mimeMatch ? mimeMatch[1].toLowerCase() : '';
        if (fmt === 'gif' || fmt === 'svg+xml' || fmt === 'svg') {
            return resolve(dataURL);
        }
        // 估算原图大小（base64 长度 * 0.75 ≈ 字节）
        const approxSize = (dataURL.length - dataURL.indexOf(',') - 1) * 0.75;
        if (approxSize < IMG_COMPRESS_MIN_SIZE) {
            return resolve(dataURL);
        }

        const maxWidth = (opts && opts.maxWidth) || IMG_COMPRESS_MAX_WIDTH;
        const quality = (opts && opts.quality) || IMG_COMPRESS_QUALITY;

        const img = new Image();
        img.onload = function() {
            try {
                let w = img.naturalWidth, h = img.naturalHeight;
                if (w > maxWidth) {
                    h = Math.round(h * maxWidth / w);
                    w = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(dataURL);
                ctx.drawImage(img, 0, 0, w, h);

                // 决定输出格式：PNG 转 JPEG 压得最狠，但带透明的保持 PNG
                let outType = 'image/jpeg';
                if (fmt === 'png' || fmt === 'webp') {
                    // 检测是否有透明像素
                    try {
                        const sampleData = ctx.getImageData(0, 0, Math.min(w, 50), Math.min(h, 50)).data;
                        for (let i = 3; i < sampleData.length; i += 4) {
                            if (sampleData[i] < 255) { outType = 'image/png'; break; }
                        }
                    } catch(e) {}
                }
                const out = canvas.toDataURL(outType, quality);
                // 只在压缩后变小时才采用，否则返回原图
                resolve(out.length < dataURL.length ? out : dataURL);
            } catch (e) {
                resolve(dataURL);
            }
        };
        img.onerror = function() { resolve(dataURL); };
        img.src = dataURL;
    });
}

/**
 * 压缩 File 对象，返回压缩后的 dataURL
 */
function compressImageFile(file, opts) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => {
            compressImageDataURL(e.target.result, opts).then(resolve);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

// 兼容旧函数名：暴露在 window 方便其他模块用
window.compressImageDataURL = compressImageDataURL;
window.compressImageFile = compressImageFile;

// ==========================================================================
// 一键压缩历史图片：遍历所有存储找出图片字段并压缩
// 返回 { before, after, count, errors } 的统计
// ==========================================================================
async function compressAllHistoricalImages(onProgress) {
    const stats = { before: 0, after: 0, count: 0, processed: 0, errors: 0, total: 0 };

    // 递归扫描对象/数组中的所有 data:image/* 字符串
    async function scanAndCompress(obj, path) {
        path = path || '';
        if (obj == null) return obj;
        if (typeof obj === 'string') {
            if (obj.indexOf('data:image/') === 0 && obj.length > 1000) {
                stats.before += obj.length;
                try {
                    const compressed = await compressImageDataURL(obj);
                    stats.after += compressed.length;
                    if (compressed.length < obj.length) stats.count++;
                    stats.processed++;
                    if (typeof onProgress === 'function') {
                        try { onProgress(stats); } catch(e) {}
                    }
                    return compressed;
                } catch(e) {
                    stats.errors++;
                    stats.after += obj.length;
                    return obj;
                }
            }
            return obj;
        }
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                obj[i] = await scanAndCompress(obj[i], path + '[' + i + ']');
            }
            return obj;
        }
        if (typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
                obj[k] = await scanAndCompress(obj[k], path + '.' + k);
            }
            return obj;
        }
        return obj;
    }

    // 先统计总图片数（提供进度估算）
    async function countImages(obj) {
        if (obj == null) return;
        if (typeof obj === 'string') {
            if (obj.indexOf('data:image/') === 0 && obj.length > 1000) stats.total++;
            return;
        }
        if (Array.isArray(obj)) { for (const x of obj) await countImages(x); return; }
        if (typeof obj === 'object') { for (const k of Object.keys(obj)) await countImages(obj[k]); }
    }

    // 1. 扫描 IndexedDB（通过 localforage）
    if (typeof localforage !== 'undefined') {
        try {
            const keys = await localforage.keys();
            // 先粗略统计总数
            for (const key of keys) {
                try {
                    const val = await localforage.getItem(key);
                    await countImages(val);
                } catch(e) {}
            }
            // 实际压缩
            for (const key of keys) {
                try {
                    const val = await localforage.getItem(key);
                    if (val == null) continue;
                    let processed;
                    if (typeof val === 'string') {
                        processed = await scanAndCompress(val);
                    } else if (typeof val === 'object') {
                        processed = await scanAndCompress(val);
                    } else {
                        continue;
                    }
                    await localforage.setItem(key, processed);
                } catch (e) {
                    console.warn('[ImgCompress] 处理 IndexedDB key 失败:', key, e);
                    stats.errors++;
                }
            }
        } catch (e) { console.warn('[ImgCompress] IndexedDB 扫描失败:', e); }
    }

    // 2. 扫描 localStorage
    try {
        const lsKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) lsKeys.push(k);
        }
        for (const key of lsKeys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw || raw.length < 1000) continue;
                // 尝试 JSON 解析
                let val;
                let isJson = false;
                try { val = JSON.parse(raw); isJson = true; } catch(e) { val = raw; }
                await countImages(val);
                const processed = await scanAndCompress(val);
                if (isJson) {
                    localStorage.setItem(key, JSON.stringify(processed));
                } else if (typeof processed === 'string' && processed !== raw) {
                    localStorage.setItem(key, processed);
                }
            } catch (e) {
                console.warn('[ImgCompress] 处理 localStorage key 失败:', key, e);
                stats.errors++;
            }
        }
    } catch (e) { console.warn('[ImgCompress] localStorage 扫描失败:', e); }

    return stats;
}
window.compressAllHistoricalImages = compressAllHistoricalImages;



// ==========================================================================
// 全局拦截 FileReader.readAsDataURL：所有新上传的图片自动压缩
// 这样无需改动 14+ 个分散的图片上传入口，所有新图都会被压缩
// ==========================================================================
(function setupGlobalImageCompression() {
    if (typeof FileReader === 'undefined') return;
    if (window._imgCompressInstalled) return;
    window._imgCompressInstalled = true;

    const originalReadAsDataURL = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(blob) {
        // 不是图片 → 走原逻辑
        if (!blob || !blob.type || blob.type.indexOf('image/') !== 0) {
            return originalReadAsDataURL.call(this, blob);
        }
        const reader = this;
        const tempReader = new FileReader();
        tempReader.onload = function(e) {
            const original = e.target.result;
            compressImageDataURL(original).then(function(compressed) {
                // 模拟原 FileReader 的 onload 行为
                Object.defineProperty(reader, 'result', { value: compressed, configurable: true });
                Object.defineProperty(reader, 'readyState', { value: 2, configurable: true });
                if (typeof reader.onloadstart === 'function') {
                    try { reader.onloadstart({ target: reader }); } catch(e) {}
                }
                if (typeof reader.onload === 'function') {
                    try { reader.onload({ target: reader }); } catch(e) {}
                }
                if (typeof reader.onloadend === 'function') {
                    try { reader.onloadend({ target: reader }); } catch(e) {}
                }
                try { reader.dispatchEvent(new Event('load')); } catch(e) {}
                try { reader.dispatchEvent(new Event('loadend')); } catch(e) {}
            }).catch(function() {
                // 压缩失败 → 退回原图
                Object.defineProperty(reader, 'result', { value: original, configurable: true });
                Object.defineProperty(reader, 'readyState', { value: 2, configurable: true });
                if (typeof reader.onload === 'function') try { reader.onload({ target: reader }); } catch(e) {}
                if (typeof reader.onloadend === 'function') try { reader.onloadend({ target: reader }); } catch(e) {}
            });
        };
        tempReader.onerror = function(e) {
            if (typeof reader.onerror === 'function') try { reader.onerror(e); } catch(err) {}
            if (typeof reader.onloadend === 'function') try { reader.onloadend(e); } catch(err) {}
        };
        originalReadAsDataURL.call(tempReader, blob);
    };
})();



        function safeGetItem(key) {
            try { return localStorage.getItem(key); }
            catch (e) { console.error('Error getting item:', e); return null; }
        }

        function safeSetItem(key, value) {
            try {
                if (typeof value === 'object') value = JSON.stringify(value);
                localStorage.setItem(key, value);
            } catch (e) { console.error('Error setting item:', e); }
        }

        function safeRemoveItem(key) {
            try { localStorage.removeItem(key); }
            catch (e) { console.error('Error removing item:', e); }
        }

function getRandomItem(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeStringStrict(s) {
    if (typeof s !== 'string') return '';
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function deduplicateContentArray(arr, baseSystemArray = []) {
    const seen = new Set(baseSystemArray.map(normalizeStringStrict));
    const result = [];
    let removedCount = 0;
    for (const item of arr) {
        const norm = normalizeStringStrict(item);
        if (norm !== '' && !seen.has(norm)) {
            seen.add(norm);
            result.push(item);
        } else {
            removedCount++;
        }
    }
    return { result, removedCount };
}

        function cropImageToSquare(file, maxSize = 640) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const minSide = Math.min(img.width, img.height);
                        const sx = (img.width - minSide) / 2;
                        const sy = (img.height - minSide) / 2;
                        const canvas = document.createElement('canvas');
                        canvas.width = maxSize; canvas.height = maxSize;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);
                        resolve(canvas.toDataURL('image/jpeg', 0.95));
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        function exportDataToMobileOrPC(dataString, fileName) {
            if (navigator.share && navigator.canShare) {
                try {
                    const blob = new Blob([dataString], { type: 'application/json' });
                    const file = new File([blob], fileName, { type: 'application/json' });
                    if (navigator.canShare({ files: [file] })) {
                        navigator.share({ files: [file], title: '传讯数据备份', text: '请选择"保存到文件"' })
                            .catch(() => downloadFileFallback(blob, fileName));
                        return;
                    }
                } catch (e) {}
            }
            const blob = new Blob([dataString], { type: 'application/json' });
            downloadFileFallback(blob, fileName);
        }

        function downloadFileFallback(blob, fileName) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = fileName; link.style.display = 'none';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }

        if (typeof localforage !== 'undefined') {
            localforage.config({
                driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
                name: 'ChatApp_V3', version: 1.0, storeName: 'chat_data',
                description: 'Storage for Chat App V3'
            });
        } else {
            console.warn('[storage] localforage 未加载，IndexedDB 能力不可用，将退回 localStorage/内存兜底');
        }

        function showNotification(message, type = 'info', duration = 3000) {
            const existing = document.querySelector('.notification');
            if (existing) existing.remove();
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            const iconMap = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle', warning:'fa-exclamation-triangle' };
            notification.innerHTML = `<i class="fas ${iconMap[type] || 'fa-info-circle'}"></i><span>${message}</span>`;
            document.body.appendChild(notification);
            setTimeout(() => {
                notification.classList.add('hiding');
                notification.addEventListener('animationend', () => notification.remove());
            }, duration);
        }

        let _currentAudioContext = null;
        let _currentAudio = null;

        const stopCurrentSound = () => {
            try {
                if (_currentAudio) {
                    _currentAudio.pause();
                    _currentAudio.currentTime = 0;
                    _currentAudio = null;
                }
                if (_currentAudioContext) {
                    _currentAudioContext.close();
                    _currentAudioContext = null;
                }
            } catch(e) {}
        };

        const playSound = (type) => {
            if (!settings.soundEnabled) return;
            stopCurrentSound();
            try {
                // =============== 两方音效配置 ===============
                const category = (() => {
                    // 新类型（按两方区分）
                    if (type === 'my_send') return 'my_send';
                    if (type === 'partner_message') return 'partner_message';
                    if (type === 'my_poke') return 'my_poke';
                    if (type === 'partner_poke') return 'partner_poke';
                    // 兼容旧调用
                    if (type === 'send') return 'my_send';
                    if (type === 'message') return 'partner_message';
                    if (type === 'poke') return 'my_poke';
                    return null;
                })();

                const customUrlByCategory = (() => {
                    if (!category) return '';
                    if (category === 'my_send') return settings.mySendCustomSoundUrl || '';
                    if (category === 'partner_message') return settings.partnerMessageCustomSoundUrl || '';
                    if (category === 'my_poke') return settings.myPokeCustomSoundUrl || '';
                    if (category === 'partner_poke') return settings.partnerPokeCustomSoundUrl || '';
                    return '';
                })();

                const legacyCustomUrl = (settings.customSoundUrl || '').trim();
                const resolvedCustomUrlBase = (customUrlByCategory && customUrlByCategory.trim())
                    ? customUrlByCategory.trim()
                    : legacyCustomUrl;

                const KAKAO_TALK_URL = 'https://image.uglycat.cc/jl5xf9.mp3';

                // 预设音效（无音效 / kakaoTalk）需要优先级高于自定义 URL
                const presetId = (() => {
                    if (!category) return '';
                    if (category === 'my_send') return settings.mySendSoundPreset || 'tone_low';
                    if (category === 'partner_message') return settings.partnerMessageSoundPreset || 'tone_low';
                    if (category === 'my_poke') return settings.myPokeSoundPreset || 'tone_low';
                    if (category === 'partner_poke') return settings.partnerPokeSoundPreset || 'tone_low';
                    return 'tone_low';
                })();

                if (presetId === 'mute') return;

                // kakaoTalk 作为"固定预设"，选择它就播放对应音频
                let resolvedCustomUrl = (presetId === 'kakaotalk') ? KAKAO_TALK_URL : resolvedCustomUrlBase;

                // 自定义 URL：只要填了就直接播放（不区分内置/预设）
                if (resolvedCustomUrl) {
                    const audio = new Audio(resolvedCustomUrl);
                    audio.volume = Math.min(1, Math.max(0, settings.soundVolume || 0.15));
                    _currentAudio = audio;
                    audio.play().catch(() => {});
                    audio.addEventListener('ended', () => { _currentAudio = null; });
                    return;
                }

                // =============== 内置合成音效（两方 + 预设） ===============
                const CATEGORY_BASE = {
                    my_send: { osc1Type: 'triangle', osc2Type: 'sine', freq: 520, dur: 0.18, up: 1.06, down: 0.72 },
                    partner_message: { osc1Type: 'triangle', osc2Type: 'sine', freq: 460, dur: 0.2, up: 1.04, down: 0.74 },
                    my_poke: { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 400, dur: 0.16, up: 1.08, down: 0.76 },
                    partner_poke: { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 380, dur: 0.16, up: 1.08, down: 0.76 }
                };

                const PRESET_EFFECTS = {
                    // 预设 effect：允许覆盖波形与倍率（不填则沿用基础音色）
                    tone_default: { osc1Type: 'triangle', osc2Type: 'sine', fMul: 0.92, durMul: 1.08, upMul: 1.0, downMul: 0.95 },
                    tone_soft: { osc1Type: 'sine', osc2Type: 'triangle', fMul: 0.88, durMul: 1.15, upMul: 0.98, downMul: 0.92 },
                    tone_low: { osc1Type: 'sawtooth', osc2Type: 'triangle', fMul: 0.78, durMul: 1.2, upMul: 0.96, downMul: 0.88 },
                    tone_warm: { osc1Type: 'triangle', osc2Type: 'triangle', fMul: 0.84, durMul: 1.1, upMul: 0.98, downMul: 0.9 },
                    tone_dark: { osc1Type: 'square', osc2Type: 'triangle', fMul: 0.72, durMul: 1.25, upMul: 0.95, downMul: 0.85 },
                    tone_haze: { osc1Type: 'sine', osc2Type: 'square', fMul: 0.8, durMul: 1.18, upMul: 0.97, downMul: 0.9 }
                };

                // presetId 已在上方计算

                const cfg = (() => {
                    if (category && CATEGORY_BASE[category]) {
                        const base = CATEGORY_BASE[category];
                        const fx = PRESET_EFFECTS[presetId] || PRESET_EFFECTS.tone_default;
                        const osc1Type = (typeof fx.osc1Type === 'string') ? fx.osc1Type : base.osc1Type;
                        const osc2Type = (typeof fx.osc2Type === 'string') ? fx.osc2Type : base.osc2Type;
                        const freq = base.freq * (fx.fMul || 1);
                        const dur = base.dur * (fx.durMul || 1);
                        const up = base.up * (fx.upMul || 1);
                        const down = base.down * (fx.downMul || 1);
                        return { osc1Type, osc2Type, freq, dur, up, down };
                    }

                    // 兼容其它旧声音类型（不走两方预设）
                    if (type === 'favorite') return { osc1Type: 'sine', osc2Type: 'sine', freq: 1200, dur: 0.18, up: 1.06, down: 0.70 };
                    if (type === 'anniversary') return { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 660, dur: 0.22, up: 1.10, down: 0.62 };
                    if (type === 'mood') return { osc1Type: 'sine', osc2Type: 'square', freq: 440, dur: 0.16, up: 1.12, down: 0.60 };
                    if (type === 'import') return { osc1Type: 'square', osc2Type: 'triangle', freq: 330, dur: 0.16, up: 1.25, down: 0.70 };
                    if (type === 'export') return { osc1Type: 'triangle', osc2Type: 'sine', freq: 520, dur: 0.16, up: 1.15, down: 0.66 };
                    if (type === 'error') return { osc1Type: 'sawtooth', osc2Type: 'square', freq: 180, dur: 0.14, up: 1.03, down: 0.42 };
                    return { osc1Type: 'sine', osc2Type: 'triangle', freq: 600, dur: 0.15, up: 1.05, down: 0.60 };
                })();

                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                _currentAudioContext = audioContext;
                const gainNode = audioContext.createGain();
                const vol = Math.min(0.55, Math.max(0.01, settings.soundVolume || 0.1));

                // 叠加一层泛音让音色更"厚"
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();

                osc1.connect(gainNode);
                osc2.connect(gainNode);
                gainNode.connect(audioContext.destination);

                const now = audioContext.currentTime;
                gainNode.gain.setValueAtTime(vol, now);

                const jitter = (Math.random() - 0.5) * 0.02; // 轻微随机
                const f1 = cfg.freq * (1 + jitter);
                const f2 = f1 * 2;

                osc1.type = cfg.osc1Type;
                osc2.type = cfg.osc2Type;

                osc1.frequency.setValueAtTime(f1, now);
                osc2.frequency.setValueAtTime(f2, now);

                // 频率滑动 + 音量包络
                osc1.frequency.exponentialRampToValueAtTime(f1 * cfg.up, now + 0.04);
                osc2.frequency.exponentialRampToValueAtTime(f2 * (cfg.up - 0.03), now + 0.04);

                osc1.frequency.exponentialRampToValueAtTime(f1 * cfg.down, now + cfg.dur);
                osc2.frequency.exponentialRampToValueAtTime(f2 * cfg.down, now + cfg.dur);

                const end = now + cfg.dur;
                osc1.start(now);
                osc2.start(now);

                gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

                osc1.stop(end);
                osc2.stop(end);
                audioContext.addEventListener('statechange', () => {
                    if (audioContext.state === 'closed') _currentAudioContext = null;
                });
            } catch (e) { console.warn("音频播放失败:", e); }
        };

        const throttledSaveData = () => {
            if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                try {
                    const maybePromise = saveData();
                    if (maybePromise && typeof maybePromise.catch === 'function') {
                        maybePromise.catch(e => console.error('[throttledSaveData] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[throttledSaveData] 保存失败:', e);
                }
            }, 500);
        };

async function applyCustomFont(url) {
    if (!url || !url.trim()) {
        document.documentElement.style.removeProperty('--font-family');
        document.documentElement.style.removeProperty('--message-font-family');
        return;
    }
    const fontName = 'UserCustomFont';
    try {
        const font = new FontFace(fontName, `url(${url})`);
        await font.load();
        document.fonts.add(font);
        const fontStack = `"${fontName}", 'Noto Serif SC', serif`;
        document.documentElement.style.setProperty('--font-family', fontStack);
        document.documentElement.style.setProperty('--message-font-family', fontStack);
        if (typeof settings !== 'undefined') settings.messageFontFamily = fontStack;
    } catch (e) {
        console.error('字体加载失败:', e);
        showNotification('字体加载失败，请检查链接是否有效', 'error');
    }
}

function applyCustomBubbleCss(cssCode) {
    const styleId = 'user-custom-bubble-style';
    let styleTag = document.getElementById(styleId);
    if (!cssCode || !cssCode.trim()) { if (styleTag) styleTag.remove(); return; }
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = styleId; }
    document.head.appendChild(styleTag);

    function boostSpecificity(css) {
        return css.replace(/([^{}@][^{}]*)\{([^{}]*)\}/g, (match, rawSel, body) => {
            const selectors = rawSel.split(',').map(s => s.trim()).filter(Boolean);
            const boosted = selectors.map(sel => {
                if (sel.startsWith('html') || sel.startsWith('@') || sel.startsWith('from') || sel.startsWith('to') || /^\d/.test(sel)) return sel;
                return `html body ${sel}`;
            });
            return `${boosted.join(', ')} {${body}}`;
        });
    }

    const boostedCss = boostSpecificity(cssCode);

    styleTag.textContent = boostedCss + `
/* image bubble reset — must stay !important */
html[data-theme] .message.message-image-bubble-none,
html body .message.message-image-bubble-none {
    background: transparent !important; border: none !important;
    box-shadow: none !important; padding: 0 !important; border-radius: 0 !important;
}`;

    try {
        const alreadyCustomized = (typeof settings !== 'undefined' && settings.customThemeColors) ? settings.customThemeColors : {};
        const sentMatch  = cssCode.match(/\.message-sent\s*\{([^}]*)\}/);
        const recvMatch  = cssCode.match(/\.message-received\s*\{([^}]*)\}/);
        if (sentMatch && !alreadyCustomized['--message-sent-text']) {
            const colorLine = sentMatch[1].match(/\bcolor\s*:\s*([^;}\n]+)/);
            if (colorLine) {
                const v = colorLine[1].trim().replace(/!important/g,'').trim();
                if (v && !v.startsWith('var(')) {
                    document.documentElement.style.setProperty('--message-sent-text', v);
                }
            }
        }
        if (recvMatch && !alreadyCustomized['--message-received-text']) {
            const colorLine = recvMatch[1].match(/\bcolor\s*:\s*([^;}\n]+)/);
            if (colorLine) {
                const v = colorLine[1].trim().replace(/!important/g,'').trim();
                if (v && !v.startsWith('var(')) {
                    document.documentElement.style.setProperty('--message-received-text', v);
                }
            }
        }
    } catch(e) {}
}

function applyGlobalThemeCss(cssCode) {
    const styleId = 'user-custom-global-theme-style';
    let styleTag = document.getElementById(styleId);
    if (!cssCode || !cssCode.trim()) { if (styleTag) styleTag.remove(); return; }
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = styleId; document.head.appendChild(styleTag); }
    styleTag.textContent = cssCode;
}

// 显示模块选择面板（滑块），返回 Promise<flags|null>
async function _showExportModuleSelector() {
    const modules = [
        { flag: 'inclMsgs',     icon: '💬', label: '聊天记录' },
        { flag: 'inclSet',      icon: '⚙️', label: '聊天设置' },
        { flag: 'inclCustom',   icon: '📚', label: '回复库 / 字卡' },
        { flag: 'inclStickers', icon: '🌸', label: '表情贴纸' },
        { flag: 'inclThemes',   icon: '🎨', label: '主题 / 外观' },
        { flag: 'inclAnn',      icon: '📅', label: '纪念日' },
        { flag: 'inclDg',       icon: '🔮', label: '占卜 / 运势 / 天气' },
        { flag: 'inclMood',     icon: '💭', label: '心情手账' },
        { flag: 'inclEnvelope', icon: '✉️', label: '信封投递' },
        { flag: 'inclChuanci',  icon: '✨', label: '创词（含模块/标签/历史，不含 API Key）' }
    ];

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);
            backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;
        `;

        const rows = modules.map(m => `
            <div class="bk-row" data-flag="${m.flag}" style="
                display:flex;align-items:center;justify-content:space-between;gap:12px;
                padding:14px 14px;border:1.5px solid var(--border-color);border-radius:14px;
                background:var(--primary-bg);
            ">
                <span style="font-size:14px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:10px;">
                    <span style="font-size:18px;">${m.icon}</span>${m.label}
                </span>
                <div class="bk-switch on" data-target="${m.flag}" style="
                    width:44px;height:24px;border-radius:12px;background:var(--accent-color);
                    position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;
                ">
                    <div class="bk-switch-knob" style="
                        position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;
                        top:2px;left:22px;transition:transform 0.2s, left 0.2s;
                        box-shadow:0 1px 4px rgba(0,0,0,0.2);
                    "></div>
                </div>
            </div>
        `).join('');

        overlay.innerHTML = `
            <div style="
                width:100%;max-width:560px;background:var(--secondary-bg);border-radius:24px 24px 0 0;
                box-shadow:0 -10px 60px rgba(0,0,0,0.3);
                padding:16px 18px env(safe-area-inset-bottom,16px);
                animation:bkSlideUp .3s cubic-bezier(.34,1.56,.64,1);
            ">
                <div style="width:36px;height:4px;border-radius:2px;background:var(--border-color);margin:0 auto 14px;"></div>
                <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">选择要备份的内容</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">默认全部开启，关闭后该模块不会写入备份文件</div>
                <div style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:auto;padding-right:4px;">
                    ${rows}
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;">
                    <button id="bk-export-cancel" style="
                        flex:1;padding:13px;border-radius:14px;border:none;
                        background:var(--message-received-bg);color:var(--text-primary);
                        font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
                    ">取消</button>
                    <button id="bk-export-confirm" style="
                        flex:2;padding:13px;border-radius:14px;border:none;
                        background:var(--accent-color);color:#fff;
                        font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
                    ">导出备份</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 滑块切换
        overlay.querySelectorAll('.bk-switch').forEach(sw => {
            sw.addEventListener('click', () => {
                const on = !sw.classList.contains('on');
                sw.classList.toggle('on', on);
                sw.style.background = on ? 'var(--accent-color)' : 'var(--message-received-bg)';
                const knob = sw.querySelector('.bk-switch-knob');
                if (knob) knob.style.left = on ? '22px' : '2px';
            });
        });

        const cleanup = () => overlay.remove();
        overlay.querySelector('#bk-export-cancel').addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });
        overlay.querySelector('#bk-export-confirm').addEventListener('click', () => {
            const flags = {};
            overlay.querySelectorAll('.bk-switch').forEach(sw => {
                flags[sw.dataset.target] = sw.classList.contains('on');
            });
            cleanup();
            resolve(flags);
        });
    });
}

async function exportAllData() {
    try {
        if (typeof ChatBackup === 'undefined' || !ChatBackup.buildBackupPayload || !ChatBackup.serializeBackupV4) {
            showNotification('备份模块或函数未加载，请刷新页面', 'error');
            return;
        }

        // 先让用户用滑块选择要备份的模块
        const flags = await _showExportModuleSelector();
        if (!flags) return; // 用户取消

        // 至少要选一个
        const anyOn = Object.keys(flags).some(k => flags[k]);
        if (!anyOn) {
            showNotification('请至少选择一个模块进行备份', 'warning');
            return;
        }

        if (typeof showNotification === 'function') showNotification('正在打包备份…', 'info', 3000);

        // 直接走 exportBackupToFile（带 ZIP 优化），它内部会处理下载
        if (ChatBackup.exportBackupToFile) {
            await ChatBackup.exportBackupToFile(flags);
            return;
        }
        // fallback: 纯 JSON
        const payload = await ChatBackup.buildBackupPayload(flags);
        const jsonString = ChatBackup.serializeBackupV4(payload);
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `chatapp-backup-${dateStr}.json`;
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
        downloadFileFallback(blob, fileName);
        if (typeof showNotification === 'function') showNotification('已导出 JSON 备份', 'success');
    } catch (e) {
        console.error('全量导出失败:', e);
        showNotification('全量导出失败，请重试', 'error');
    }
}

async function importAllData(file) {
    if (!file) return;
    if (file.size > 220 * 1024 * 1024) {
        showNotification('文件过大（>220MB），请确认是否为正确备份', 'error');
        return;
    }
    try {
        if (typeof ChatBackup === 'undefined' || !ChatBackup.loadBackupFromFile || !ChatBackup.applyBackupToStorage) {
            showNotification('备份模块未加载，请刷新页面重试', 'error');
            return;
        }
        const data = await ChatBackup.loadBackupFromFile(file);
        const fullLike = ChatBackup.isFullBackupShape
            ? ChatBackup.isFullBackupShape(data)
            : (
                data.type === 'full' ||
                (typeof data.type === 'string' && data.type.includes('full-backup')) ||
                !!data.indexedDB ||
                !!data.localforage
            );
        if (!fullLike) {
            if (typeof importChatHistory === 'function') importChatHistory(file);
            return;
        }
        if (!confirm('导入全量备份将按你的选择覆盖对应数据。\n\n头像/背景等如勾选导入会写入备份中的内容。\n\n确定继续吗？')) return;

        const categories = [
            {
                id: 'msgs',
                label: '💬 聊天记录',
                indexedDBNeedles: ['chatMessages', 'sessionList'],
                localStorageNeedles: []
            },
            {
                id: 'set',
                label: '⚙️ 聊天设置',
                indexedDBNeedles: ['chatSettings', 'showPartnerNameInChat', 'partnerPersonas'],
                localStorageNeedles: ['groupChatSettings']
            },
            {
                id: 'replies',
                label: '📚 回复库 / 字卡',
                indexedDBNeedles: ['customReplies', 'customPokes', 'customStatuses', 'customMottos', 'customIntros', 'customEmojis', 'customReplyGroups', 'customPokeGroups', 'customStatusGroups', 'chuanciTexts'],
                localStorageNeedles: ['disabledReplyItems', 'pokeSym_my', 'pokeSym_partner', 'pokeSym_my_custom', 'pokeSym_partner_custom']
            },
            {
                id: 'stickers',
                label: '🌸 表情贴纸',
                indexedDBNeedles: ['stickerLibrary', 'myStickerLibrary'],
                localStorageNeedles: ['disabledStickerItems']
            },
            {
                id: 'themes',
                label: '🎨 主题 / 外观',
                indexedDBNeedles: ['customThemes', 'themeSchemes', 'backgroundGallery', 'chatBackground', 'partnerAvatar', 'myAvatar'],
                localStorageNeedles: []
            },
            {
                id: 'ann',
                label: '📅 纪念日',
                indexedDBNeedles: ['anniversaries'],
                localStorageNeedles: []
            },
            {
                id: 'dg',
                label: '🔮 占卜 / 运势 / 天气',
                indexedDBNeedles: [],
                localStorageNeedles: ['dg_custom_data', 'dg_status_pool', 'weekly_fortune', 'daily_fortune'],
                localStoragePrefixes: ['customWeather_']
            },
            {
                id: 'mood',
                label: '💭 心情手账',
                indexedDBNeedles: ['moodCalendar', 'customMoodOptions', 'moodTrash'],
                localStorageNeedles: []
            },
            {
                id: 'envelope',
                label: '✉️ 信封投递',
                indexedDBNeedles: ['envelopeData', 'pending_envelope'],
                localStorageNeedles: []
            },
            {
                id: 'chuanci',
                label: '✨ 创词',
                indexedDBNeedles: [],
                localStorageNeedles: [],
                localStoragePrefixes: ['cc_']
            }
        ];

        const pickSelected = () => new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);
                backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;
            `;
            overlay.innerHTML = `
                <div style="
                    width:100%;max-width:560px;background:var(--secondary-bg);border-radius:24px 24px 0 0;
                    box-shadow:0 -10px 60px rgba(0,0,0,0.3);
                    padding:16px 18px env(safe-area-inset-bottom,0);
                ">
                    <div style="width:36px;height:4px;border-radius:2px;background:var(--border-color);margin:0 auto 14px;"></div>
                    <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:10px;">全量恢复：选择要导入的部分</div>
                    <div style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;padding-right:6px;">
                        ${categories.map(c => {
                            return `
                                <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 12px;border:1.5px solid var(--border-color);border-radius:16px;background:var(--primary-bg);">
                                    <span style="font-size:13px;font-weight:700;color:var(--text-primary);">${c.label}</span>
                                    <input type="checkbox" data-cat="${c.id}" checked style="transform:scale(1.1);accent-color:var(--accent-color);">
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div style="display:flex;gap:10px;margin-top:14px;">
                        <button id="full-imp-cancel" class="modal-btn modal-btn-secondary" style="flex:1;padding:12px 0;">取消</button>
                        <button id="full-imp-confirm" class="modal-btn modal-btn-primary" style="flex:1;padding:12px 0;">确认恢复</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { overlay.remove(); resolve(null); } });
            const fullImpCancelBtn = document.getElementById('full-imp-cancel');
            const fullImpConfirmBtn = document.getElementById('full-imp-confirm');
            if (fullImpCancelBtn) fullImpCancelBtn.onclick = () => { overlay.remove(); resolve(null); };
            if (fullImpConfirmBtn) fullImpConfirmBtn.onclick = () => {
                const selected = Array.from(overlay.querySelectorAll('input[type=checkbox]:checked'))
                    .map(i => i.dataset.cat);
                overlay.remove();
                resolve(selected);
            };
        });

        const selectedCats = await pickSelected();
        if (!selectedCats || selectedCats.length === 0) return;

        showNotification('正在恢复数据…', 'info', 3000);
        await ChatBackup.applyBackupToStorage(data, {
            selective: true,
            selectedCategoryIds: selectedCats,
            categories
        });

        showNotification('恢复完成，即将刷新页面…', 'success', 2000);
        setTimeout(() => location.reload(), 2200);
    } catch (err) {
        console.error('全量导入失败:', err);
        const msg = err && err.message ? err.message : '未知错误';
        showNotification('导入失败：' + msg, 'error', 5000);
    }
}