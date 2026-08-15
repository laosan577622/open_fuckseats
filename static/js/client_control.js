(function () {
    const CONFIG_URL = '/api/client-control/config/';
    const ANNOUNCEMENT_URL = '/api/client-control/announcement/';
    const SEEN_ANNOUNCEMENT_KEY = 'fuckseats_client_control_seen_announcement';
    const UPDATE_WAIT_LIMIT_MS = 8000;

    let state = null;
    let disabledClickGuardInstalled = false;
    window.FUCKSEATS_ANNOUNCEMENT_CHECK_COMPLETE = false;

    function markAnnouncementCheckComplete() {
        if (window.FUCKSEATS_ANNOUNCEMENT_CHECK_COMPLETE === true) return;
        window.FUCKSEATS_ANNOUNCEMENT_CHECK_COMPLETE = true;
        window.dispatchEvent(new CustomEvent('fuckseats:announcement-check-complete'));
    }

    async function fetchJSON(url) {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            // 接口黑洞时尽快放弃，按加载失败处理，别拖住特性管控和公告检查。
            signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `请求失败（${response.status}）`);
        return payload;
    }

    function feature(name) {
        const features = state && state.features;
        return features && features[name] ? features[name] : { available: true, mode: 'disable', message: '' };
    }

    function installDisabledClickGuard() {
        if (disabledClickGuardInstalled) return;
        disabledClickGuardInstalled = true;
        document.addEventListener('click', function (event) {
            const target = event.target && event.target.closest ? event.target.closest('[data-client-feature-disabled="1"]') : null;
            if (!target) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const message = target.dataset.clientFeatureMessage || '此功能暂时不可用';
            if (typeof window.showToast === 'function') window.showToast(message);
        }, true);
    }

    function applyFeatureAvailability() {
        installDisabledClickGuard();
        document.querySelectorAll('[data-client-feature]').forEach(function (element) {
            const item = feature(element.dataset.clientFeature);
            const restoreDisabledState = function () {
                element.removeAttribute('aria-disabled');
                element.removeAttribute('data-client-feature-disabled');
                element.removeAttribute('data-client-feature-message');
                element.classList.remove('client-feature-disabled');
                element.querySelectorAll('[data-client-control-disabled="1"]').forEach(function (control) {
                    control.disabled = false;
                    control.removeAttribute('data-client-control-disabled');
                });
            };
            if (item.available !== false) {
                element.hidden = false;
                restoreDisabledState();
                return;
            }

            const mode = element.dataset.clientFeatureMode || item.mode || 'disable';
            if (mode === 'hide') {
                restoreDisabledState();
                element.hidden = true;
                return;
            }

            element.classList.add('client-feature-disabled');
            element.setAttribute('aria-disabled', 'true');
            element.dataset.clientFeatureDisabled = '1';
            element.dataset.clientFeatureMessage = item.message || '此功能暂时不可用';
            element.querySelectorAll('button, input, select, textarea').forEach(function (control) {
                if (!control.disabled) control.dataset.clientControlDisabled = '1';
                control.disabled = true;
            });
        });
        document.documentElement.dataset.clientControlRevision = String(state && state.revision || '');
    }

    function waitForUpdateCheck() {
        if (window.FUCKSEATS_UPDATE_CHECK_COMPLETE === true) return Promise.resolve();
        return new Promise(function (resolve) {
            let finished = false;
            const done = function () {
                if (finished) return;
                finished = true;
                window.removeEventListener('fuckseats:update-check-complete', done);
                resolve();
            };
            window.addEventListener('fuckseats:update-check-complete', done, { once: true });
            window.setTimeout(done, UPDATE_WAIT_LIMIT_MS);
        });
    }

    function showAnnouncement(payload) {
        const modal = document.getElementById('announcement-modal');
        const content = document.getElementById('announcement-content');
        const confirmButton = document.getElementById('announcement-confirm-btn');
        if (!modal || !content || !confirmButton) return;

        content.textContent = payload.content;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        confirmButton.focus();

        confirmButton.onclick = function () {
            try {
                localStorage.setItem(SEEN_ANNOUNCEMENT_KEY, payload.id);
            } catch (error) {
                console.warn('保存公告已读状态失败', error);
            }
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            if (window.PopupManager) window.PopupManager.notifyDismissed('announcement');
        };
    }

    async function checkAnnouncement() {
        try {
            await waitForUpdateCheck();
            if (feature('announcement').available === false) return;
            const payload = await fetchJSON(ANNOUNCEMENT_URL);
            const announcementId = String(payload.id || '').trim();
            const content = String(payload.content || '').trim();
            if (!announcementId || !content) return;
            let seenAnnouncementId = '';
            try {
                seenAnnouncementId = localStorage.getItem(SEEN_ANNOUNCEMENT_KEY) || '';
            } catch (error) {
                console.warn('读取公告已读状态失败', error);
            }
            if (seenAnnouncementId === announcementId) return;

            const display = function () { showAnnouncement({ id: announcementId, content: content }); };
            if (window.PopupManager) {
                window.PopupManager.request('announcement', display, null, { priority: 80 });
            } else {
                display();
            }
        } catch (error) {
            console.warn('公告检查失败', error);
        } finally {
            markAnnouncementCheckComplete();
        }
    }

    async function initialize() {
        try {
            state = await fetchJSON(CONFIG_URL);
        } catch (error) {
            console.warn('云控配置加载失败，使用页面默认能力', error);
            state = { features: {}, feature_flags: {}, experiments: {}, source: 'default' };
        }
        window.ClientControl = {
            getState: function () { return state; },
            isAvailable: function (name) { return feature(name).available !== false; },
            getExperiment: function (name) { return state && state.experiments ? state.experiments[name] : 'control'; },
            refresh: initialize
        };
        applyFeatureAvailability();
        window.dispatchEvent(new CustomEvent('fuckseats:client-control-ready', { detail: state }));
        await checkAnnouncement();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
