(function() {
    var QQ_GROUP_KEY = 'qq_group_prompt_seen';
    var QQ_PROMPT_WAIT_LIMIT_MS = 15000;
    var firstCheckAt = Date.now();

    function shouldDeferForOnboarding() {
        return window.FUCKSEATS_ONBOARDING_ACTIVE === true || window.ONBOARDING_SHOULD_SHOW === true;
    }

    function showQQGroupPrompt() {
        var overlay = document.getElementById('qq-group-overlay');
        if (!overlay) return;

        function doShow() {
            overlay.style.display = '';
        }

        function dismiss() {
            localStorage.setItem(QQ_GROUP_KEY, '1');
            overlay.style.display = 'none';
            if (window.PopupManager) PopupManager.notifyDismissed('qq_group');
        }

        document.getElementById('qq-group-close').addEventListener('click', dismiss);
        document.getElementById('qq-group-confirm').addEventListener('click', dismiss);
        overlay.querySelector('.qq-group-backdrop').addEventListener('click', dismiss);

        if (window.PopupManager) {
            PopupManager.request('qq_group', doShow, null, { priority: 10 });
        } else {
            doShow();
        }
    }

    function checkQQGroupPrompt() {
        if (localStorage.getItem(QQ_GROUP_KEY)) return;
        // 前置条件等待超过 15 秒后不再等待，直接交给 PopupManager 排队展示。
        var waitedTooLong = Date.now() - firstCheckAt >= QQ_PROMPT_WAIT_LIMIT_MS;
        if (!waitedTooLong && shouldDeferForOnboarding()) {
            setTimeout(checkQQGroupPrompt, 1000);
            return;
        }
        if (!waitedTooLong && (window.FUCKSEATS_UPDATE_CHECK_COMPLETE !== true || window.FUCKSEATS_ANNOUNCEMENT_CHECK_COMPLETE !== true)) {
            setTimeout(checkQQGroupPrompt, 400);
            return;
        }
        setTimeout(showQQGroupPrompt, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkQQGroupPrompt);
    } else {
        checkQQGroupPrompt();
    }
})();
