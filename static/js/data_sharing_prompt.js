(function() {
    var PROMPT_SEEN_KEY = 'fuckseats_data_sharing_prompt_seen_version';
    var AFTER_ONBOARDING_KEY = 'fuckseats_show_data_sharing_after_onboarding';
    var promptVisible = false;
    var promptVersion = '';
    var savingDecision = false;

    function getCurrentVersion() {
        var version = '0.0.0';
        try {
            var el = document.querySelector('[data-app-version]');
            if (el) version = el.dataset.appVersion;
        } catch(e) {}
        if (!version || version === '0.0.0') {
            version = document.body ? (document.body.dataset.appVersion || '') : '';
        }
        return version || '0.0.0';
    }

    function getLocalSeenVersion() {
        try { return localStorage.getItem(PROMPT_SEEN_KEY) || ''; } catch(e) { return ''; }
    }

    function markPromptSeen(version) {
        try { localStorage.setItem(PROMPT_SEEN_KEY, version); } catch(e) {}
    }

    function consumeAfterOnboardingPromptRequest() {
        try {
            if (sessionStorage.getItem(AFTER_ONBOARDING_KEY) !== '1') return false;
            sessionStorage.removeItem(AFTER_ONBOARDING_KEY);
            return true;
        } catch(e) {
            return false;
        }
    }

    function shouldDeferForOnboarding() {
        return window.FUCKSEATS_ONBOARDING_ACTIVE === true || window.ONBOARDING_SHOULD_SHOW === true;
    }

    function persistPromptDecision(body) {
        var token = document.querySelector('meta[name="csrf-token"]');
        return fetch('/cloud/config', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token ? token.content : '' },
            body: JSON.stringify(body),
            keepalive: true
        }).then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || data.status !== 'success') throw new Error(data.message || '无法保存数据共享选项');
                return data.data_sharing || {};
            });
        });
    }

    function showDataSharingPrompt() {
        var overlay = document.getElementById('data-sharing-prompt-overlay');
        if (!overlay) return;
        if (promptVisible) return;

        function doShow() {
            promptVisible = true;
            overlay.style.display = '';
        }

        async function dismiss(enable) {
            if (savingDecision) return;
            savingDecision = true;
            var version = promptVersion || getCurrentVersion();
            var body = { data_sharing_prompt_seen_version: version };
            if (enable) body.data_sharing_enabled = true;
            var controls = overlay.querySelectorAll('button');
            controls.forEach(function(button) { button.disabled = true; });
            try {
                await persistPromptDecision(body);
            } catch(error) {
                if (typeof window.showToast === 'function') window.showToast('未能保存选择，请重试');
                return;
            } finally {
                savingDecision = false;
                controls.forEach(function(button) { button.disabled = false; });
            }
            markPromptSeen(version);
            if (enable && window.DataSharing && window.DataSharing.refreshConfig) window.DataSharing.refreshConfig().catch(function(){});

            promptVisible = false;
            overlay.style.display = 'none';
            if (window.PopupManager) PopupManager.notifyDismissed('data_sharing');
            if (enable && typeof showToast === 'function') {
                showToast('感谢你的支持，数据共享已开启');
            }
        }

        document.getElementById('ds-prompt-skip').addEventListener('click', function() { dismiss(false); });
        document.getElementById('ds-prompt-enable').addEventListener('click', function() { dismiss(true); });
        overlay.querySelector('.ds-prompt-backdrop').addEventListener('click', function() { dismiss(false); });

        if (window.PopupManager) {
            PopupManager.request('data_sharing', doShow);
        } else {
            doShow();
        }
    }

    function requestDataSharingPrompt(delayMs) {
        fetch('/cloud/config', { credentials: 'same-origin', cache: 'no-store' })
            .then(function(r) { if (!r.ok) throw new Error('config unavailable'); return r.json(); })
            .then(function(data) {
                var ds = data.data_sharing || {};
                promptVersion = ds.prompt_version || getCurrentVersion();
                if (ds.show_prompt && getLocalSeenVersion() !== promptVersion) {
                    setTimeout(showDataSharingPrompt, delayMs == null ? 800 : delayMs);
                }
            })
            .catch(function() {});
    }

    function showWelcomeFinale(onDone) {
        if (window.WelcomeFinale) WelcomeFinale.play().then(onDone);
        else if (onDone) onDone();
    }

    function checkDataSharingPrompt() {
        if (consumeAfterOnboardingPromptRequest()) {
            requestDataSharingPrompt(700);
            return;
        }
        if (shouldDeferForOnboarding()) return;
        if (!['/', '/welcome/'].includes(window.location.pathname)) return;
        requestDataSharingPrompt(800);
    }

    window.showDataSharingPromptAfterOnboarding = function(delayMs) {
        consumeAfterOnboardingPromptRequest();
        showWelcomeFinale(function () { requestDataSharingPrompt(delayMs == null ? 500 : delayMs); });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkDataSharingPrompt);
    } else {
        checkDataSharingPrompt();
    }
})();
