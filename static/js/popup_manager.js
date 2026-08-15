(function () {
    if (window.PopupManager) return;

    var queue = [];
    var current = null;
    var forceHiddenIds = {};
    var requestSequence = 0;

    function isAnyShowing() {
        return current !== null;
    }

    function tryShowNext() {
        if (current !== null) return;
        // 新手引导进行中不弹任何队列弹窗，引导销毁后由 wake() 重新触发。
        if (window.FUCKSEATS_ONBOARDING_ACTIVE === true) return;
        for (var i = 0; i < queue.length; i++) {
            var item = queue[i];
            if (forceHiddenIds[item.id]) continue;
            queue.splice(i, 1);
            current = item.id;
            try {
                if (typeof item.showFn === 'function') item.showFn();
            } catch (e) {
                console.error('[PopupManager] showFn error for ' + item.id, e);
                current = null;
                tryShowNext();
            }
            return;
        }
    }

    function request(id, showFn, hideFn, options) {
        if (!id) return;
        for (var i = 0; i < queue.length; i++) {
            if (queue[i].id === id) return;
        }
        if (current === id) return;

        var priority = Number(options && options.priority);
        if (!Number.isFinite(priority)) priority = 0;
        queue.push({ id: id, showFn: showFn, hideFn: hideFn, priority: priority, sequence: requestSequence++ });
        queue.sort(function (a, b) {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.sequence - b.sequence;
        });
        tryShowNext();
    }

    function notifyDismissed(id) {
        if (current === id) {
            current = null;
        }
        for (var i = queue.length - 1; i >= 0; i--) {
            if (queue[i].id === id) queue.splice(i, 1);
        }
        tryShowNext();
    }

    function isShowing(id) {
        return current === id;
    }

    function setForceHidden(id, hidden) {
        if (hidden) {
            forceHiddenIds[id] = true;
        } else {
            delete forceHiddenIds[id];
        }
    }

    window.PopupManager = {
        request: request,
        notifyDismissed: notifyDismissed,
        isShowing: isShowing,
        isAnyShowing: isAnyShowing,
        setForceHidden: setForceHidden,
        wake: tryShowNext
    };
})();
