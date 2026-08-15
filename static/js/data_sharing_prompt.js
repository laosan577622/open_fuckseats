(function() {
    var PROMPT_SEEN_KEY = 'fuckseats_data_sharing_prompt_seen_version';
    var AFTER_ONBOARDING_KEY = 'fuckseats_show_data_sharing_after_onboarding';
    var promptVisible = false;

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
        var payload = JSON.stringify(body);
        if (navigator.sendBeacon) {
            try {
                var blob = new Blob([payload], { type: 'application/json' });
                if (navigator.sendBeacon('/cloud/config', blob)) return;
            } catch(e) {}
        }
        fetch('/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(function(){});
    }

    function showDataSharingPrompt() {
        var overlay = document.getElementById('data-sharing-prompt-overlay');
        if (!overlay) return;
        if (promptVisible) return;

        function doShow() {
            promptVisible = true;
            overlay.style.display = '';
        }

        function dismiss(enable) {
            var version = getCurrentVersion();
            var body = { data_sharing_prompt_seen_version: version };
            if (enable) body.data_sharing_enabled = true;

            markPromptSeen(version);
            persistPromptDecision(body);

            if (enable && window.DataSharing && DataSharing.setEnabled) {
                DataSharing.setEnabled(true).catch(function(){});
            }

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
        fetch('/cloud/config')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var ds = data.data_sharing || {};
                if (ds.show_prompt && getLocalSeenVersion() !== getCurrentVersion()) {
                    setTimeout(showDataSharingPrompt, delayMs == null ? 800 : delayMs);
                }
            })
            .catch(function() {});
    }

    function showWelcomeFinale(onDone) {
        var overlay = document.getElementById('welcome-finale-overlay');
        if (!overlay) { if (typeof onDone === 'function') onDone(); return; }
        if (overlay.dataset.busy === '1') return;

        function resetAnimations() {
            var els = overlay.querySelectorAll('.wf-backdrop, .wf-card, .wf-emblem-ring, .wf-emblem-seat, .wf-emblem-glow, .wf-line, .wf-title, .wf-progress, .wf-progress-bar, .wf-skip, .wf-conf');
            els.forEach(function (el) {
                el.style.animation = 'none';
                void el.offsetWidth;
                el.style.animation = '';
            });
        }

        var finished = false;
        var timer = null;

        function play() {
            overlay.dataset.busy = '1';
            overlay.style.display = '';
            overlay.classList.remove('wf-hidden');
            resetAnimations();

            function finish() {
                if (finished) return;
                finished = true;
                if (timer) { clearTimeout(timer); timer = null; }
                overlay.classList.add('wf-hidden');
                if (window.PopupManager) PopupManager.notifyDismissed('welcome_finale');
                setTimeout(function () {
                    overlay.style.display = 'none';
                    overlay.dataset.busy = '';
                    if (typeof onDone === 'function') onDone();
                }, 620);
            }

            timer = setTimeout(finish, 11000);
            var skipBtn = document.getElementById('wf-skip');
            if (skipBtn) { skipBtn.onclick = finish; }
        }

        if (window.PopupManager) PopupManager.request('welcome_finale', play);
        else play();
    }

    function checkDataSharingPrompt() {
        if (consumeAfterOnboardingPromptRequest()) {
            showWelcomeFinale(function () { requestDataSharingPrompt(700); });
            return;
        }
        if (shouldDeferForOnboarding()) return;
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
