/* Drop 上线提示：云控首次开放 Drop 时弹出一次，之后不再打扰。
   弹出前先检测本机是否装有不想班管教师端，没装就把主按钮换成下载入口。
   头图是这个弹窗独有的“落水”动画：座次卡片带着模糊落下，水面随之扭曲、荡开波纹。 */
(function () {
    'use strict';

    var MODAL_ID = 'dropLaunchModal';
    var SEEN_KEY = 'fuckseats_drop_launch_seen';
    var POPUP_ID = 'drop-launch';
    var TRY_URL = '/welcome/?replay&help&lesson=drop';
    var STATUS_URL = '/api/drop/status/';
    var DOWNLOAD_URL = 'https://class.577622.xyz';
    var LAND_AT = 560;      // 卡片触水的时刻（毫秒），与 CSS 里的落下动画对齐
    var WARP_END = 2200;

    var downloadUrl = DOWNLOAD_URL;
    var warpFrame = 0;

    var ICON = {
        ready: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.8-5.2"/>',
        missing: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2v.1"/>',
        unknown: '<rect x="4" y="5" width="16" height="11" rx="2.4"/><path d="M9 20h6M12 16v4"/>',
    };

    function icon(name) {
        return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
    }

    function seen() {
        try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (error) { return false; }
    }

    function markSeen() {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (error) { /* 存不上就下次再提示 */ }
    }

    function openDownload(url) {
        var target = String(url || DOWNLOAD_URL);
        if (window.CloudManager && typeof window.CloudManager.openExternalUrl === 'function') {
            window.CloudManager.openExternalUrl(target).catch(function (error) {
                if (typeof window.showToast === 'function') window.showToast(error.message || '打开下载页失败');
            });
            return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
    }

    /* 返回 true / false；检测不了（接口失败、超时）时返回 null，按“未知”展示。 */
    function fetchInstalled() {
        return fetch(STATUS_URL, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
        }).then(function (response) {
            return response.ok ? response.json() : null;
        }).then(function (data) {
            if (!data || typeof data.installed !== 'boolean') return null;
            if (/^https:\/\//.test(String(data.download_url || ''))) downloadUrl = data.download_url;
            return data.installed;
        }).catch(function () { return null; });
    }

    function heroMarkup() {
        var seats = '';
        for (var row = 0; row < 3; row++) {
            for (var col = 0; col < 4; col++) {
                var solid = (row * 4 + col) % 5 === 0 || (row === 1 && col === 2);
                seats += '<rect x="' + (13 + col * 25) + '" y="' + (13 + row * 20) + '" width="19" height="14" rx="4" fill="#0a59f7" opacity="' + (solid ? '1' : '.2') + '"/>';
            }
        }
        // 画面讲的就是功能本身：座次图落进教室大屏，大屏随之亮起。
        return '' +
            '<div class="drop-launch-hero" aria-hidden="true">' +
                '<svg class="drop-launch-water" viewBox="0 0 440 236" preserveAspectRatio="xMidYMid slice">' +
                    '<defs>' +
                        '<filter id="dropLaunchWarp" x="-20%" y="-20%" width="140%" height="140%">' +
                            '<feTurbulence type="fractalNoise" baseFrequency="0.011 0.019" numOctaves="2" seed="7" result="noise"/>' +
                            '<feDisplacementMap id="dropLaunchWarpMap" in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>' +
                        '</filter>' +
                        '<filter id="dropLaunchGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="26"/></filter>' +
                        '<linearGradient id="dropLaunchSky" x1="0" y1="0" x2="1" y2="1">' +
                            '<stop offset="0" stop-color="#0a59f7"/><stop offset=".6" stop-color="#2f84ff"/><stop offset="1" stop-color="#62c6ff"/>' +
                        '</linearGradient>' +
                    '</defs>' +
                    '<rect width="440" height="236" fill="url(#dropLaunchSky)"/>' +
                    '<g filter="url(#dropLaunchWarp)">' +
                        '<g filter="url(#dropLaunchGlow)">' +
                            '<circle class="drop-launch-blob drop-launch-blob-a" cx="96" cy="58" r="64" fill="#8fe1ff" opacity=".75"/>' +
                            '<circle class="drop-launch-blob drop-launch-blob-b" cx="352" cy="180" r="72" fill="#ffffff" opacity=".42"/>' +
                            '<circle class="drop-launch-blob drop-launch-blob-c" cx="300" cy="34" r="46" fill="#003fd1" opacity=".55"/>' +
                        '</g>' +
                        '<g fill="none" stroke="#ffffff" stroke-width="2">' +
                            '<ellipse class="drop-launch-ring" cx="220" cy="108" rx="200" ry="104"/>' +
                            '<ellipse class="drop-launch-ring drop-launch-ring-2" cx="220" cy="108" rx="200" ry="104"/>' +
                            '<ellipse class="drop-launch-ring drop-launch-ring-3" cx="220" cy="108" rx="200" ry="104"/>' +
                        '</g>' +
                    '</g>' +
                '</svg>' +
                '<div class="drop-launch-screen"><span class="drop-launch-screen-label">教室大屏</span></div>' +
                '<div class="drop-launch-stand"></div>' +
                '<div class="drop-launch-card">' +
                    '<svg viewBox="0 0 126 84"><rect width="126" height="84" rx="10" fill="#ffffff"/>' + seats + '</svg>' +
                '</div>' +
            '</div>';
    }

    function ensureDom() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'modal drop-launch-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'dropLaunchTitle');
        modal.setAttribute('aria-describedby', 'dropLaunchLead');
        modal.style.display = 'none';
        modal.innerHTML =
            '<div class="modal-content drop-launch-content">' +
                heroMarkup() +
                '<div class="drop-launch-body">' +
                    '<h3 id="dropLaunchTitle" class="drop-launch-title">Drop 已上线</h3>' +
                    '<p class="drop-launch-lead" id="dropLaunchLead">排好的座次，一键投到教室大屏。</p>' +
                    '<ul class="drop-launch-chips">' +
                        '<li id="dropLaunchRequirement"></li>' +
                    '</ul>' +
                    '<div class="modal-actions drop-launch-actions">' +
                        '<button type="button" class="btn btn-secondary" id="dropLaunchDismiss" data-modal-cancel>知道了</button>' +
                        '<button type="button" class="btn btn-primary" id="dropLaunchGuide">立即体验</button>' +
                        '<button type="button" class="btn btn-primary" id="dropLaunchDownload" hidden>下载不想班管</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.querySelector('#dropLaunchDismiss').addEventListener('click', function () { dismiss(); });
        modal.querySelector('#dropLaunchGuide').addEventListener('click', function () {
            dismiss();
            tryNow(modal.dataset.installed === '1');
        });
        modal.querySelector('#dropLaunchDownload').addEventListener('click', function () {
            dismiss();
            openDownload(downloadUrl);
        });
        return modal;
    }

    /* 立即体验：已装教师端且正在班级页时，直接指给用户看真正的 Drop 按钮；否则进教学里的 Drop 练习。 */
    function tryNow(installed) {
        var button = document.getElementById('btn-drop-classroom');
        if (!installed || !button || button.hidden) {
            window.location.href = TRY_URL;
            return;
        }
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        button.classList.remove('drop-launch-spotlight');
        void button.offsetWidth;
        button.classList.add('drop-launch-spotlight');
        button.focus({ preventScroll: true });
        window.setTimeout(function () { button.classList.remove('drop-launch-spotlight'); }, 4200);
    }

    function applyInstallState(modal, installed) {
        modal.dataset.installed = installed === true ? '1' : '0';
        var requirement = modal.querySelector('#dropLaunchRequirement');
        var guide = modal.querySelector('#dropLaunchGuide');
        var download = modal.querySelector('#dropLaunchDownload');
        var missing = installed === false;
        var state = missing ? 'missing' : (installed === true ? 'ready' : 'unknown');
        var label = missing ? '未安装不想班管' : (installed === true ? '已安装不想班管' : '需要不想班管');
        requirement.className = 'drop-launch-chip-' + state;
        requirement.innerHTML = icon(state) + '<span></span>';
        requirement.lastChild.textContent = label;
        download.hidden = !missing;
        guide.className = missing ? 'btn btn-secondary' : 'btn btn-primary';
        return missing ? download : guide;
    }

    /* 水面扭曲：入场时从大幅扭曲收敛，卡片触水时再荡一下。逐帧改位移强度，动画只属于这个弹窗。 */
    function playWarp(modal) {
        var map = modal.querySelector('#dropLaunchWarpMap');
        window.cancelAnimationFrame(warpFrame);
        if (!map) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            map.setAttribute('scale', '0');
            return;
        }
        var start = 0;
        var step = function (now) {
            if (!start) start = now;
            var elapsed = now - start;
            var settle = Math.max(0, 1 - elapsed / 760);
            var value = 150 * settle * settle * settle;
            if (elapsed > LAND_AT) {
                var since = elapsed - LAND_AT;
                value += 64 * Math.exp(-since / 420) * Math.cos(since / 105);
            }
            if (elapsed >= WARP_END || !modal.isConnected) {
                map.setAttribute('scale', '0');
                return;
            }
            map.setAttribute('scale', value.toFixed(2));
            warpFrame = window.requestAnimationFrame(step);
        };
        map.setAttribute('scale', '150');
        warpFrame = window.requestAnimationFrame(step);
    }

    function dismiss() {
        var modal = document.getElementById(MODAL_ID);
        window.cancelAnimationFrame(warpFrame);
        markSeen();
        if (typeof window.closeModal === 'function') window.closeModal(MODAL_ID);
        if (modal) window.setTimeout(function () { modal.classList.remove('drop-launch-playing'); }, 360);
        if (window.PopupManager) window.PopupManager.notifyDismissed(POPUP_ID);
    }

    function show(installed) {
        if (typeof window.openModal !== 'function') return;
        var modal = ensureDom();
        var primary = applyInstallState(modal, installed);
        // 先摘掉再加回，保证每次打开都从头播放。
        modal.classList.remove('drop-launch-playing');
        void modal.offsetWidth;
        modal.classList.add('drop-launch-playing');
        window.openModal(MODAL_ID);
        playWarp(modal);
        window.requestAnimationFrame(function () {
            if (primary && primary.isConnected) primary.focus({ preventScroll: true });
        });
    }

    function check() {
        if (seen()) return;
        if (!window.ClientControl || window.ClientControl.isAvailable('drop') !== true) return;
        fetchInstalled().then(function (installed) {
            var display = function () { show(installed); };
            if (window.PopupManager) {
                window.PopupManager.request(POPUP_ID, display, null, { priority: 60 });
            } else {
                display();
            }
        });
    }

    window.DropLaunchNotice = { show: show, openDownload: openDownload };
    window.addEventListener('fuckseats:client-control-ready', check);
    if (window.ClientControl) check();
})();
