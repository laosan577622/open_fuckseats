/**
 * 弹窗队列管理器
 *
 * 目的：保证页面上同一时刻只有一个自动弹出的弹窗显示。
 * 三个会自动弹出的弹窗（更新提示、数据共享、QQ 群）注册到这里，
 * 当一个弹窗关闭后才会显示队列里的下一个弹窗。
 *
 * 使用方式：
 *   // 请求弹出（若当前没有弹窗则立即显示，否则进入队列等待）
 *   PopupManager.request('update', showFn, hideFn);
 *   // 弹窗被用户关闭时调用，触发下一个排队的弹窗
 *   PopupManager.notifyDismissed('update');
 */
(function () {
    if (window.PopupManager) return;

    var queue = [];            // { id, showFn, hideFn }
    var current = null;        // 当前正在显示的弹窗 id
    var forceHiddenIds = {};   // 被外部环境（如登录遮罩）临时屏蔽的弹窗 id

    function isAnyShowing() {
        return current !== null;
    }

    function tryShowNext() {
        if (current !== null) return;
        for (var i = 0; i < queue.length; i++) {
            var item = queue[i];
            if (forceHiddenIds[item.id]) continue; // 被屏蔽，跳过
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

    function request(id, showFn, hideFn) {
        if (!id) return;
        // 已存在相同 id 的请求，不重复入队
        for (var i = 0; i < queue.length; i++) {
            if (queue[i].id === id) return;
        }
        if (current === id) return;

        queue.push({ id: id, showFn: showFn, hideFn: hideFn });
        tryShowNext();
    }

    function notifyDismissed(id) {
        if (current === id) {
            current = null;
        }
        // 清理队列中残留的同 id 项
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
        setForceHidden: setForceHidden
    };
})();
