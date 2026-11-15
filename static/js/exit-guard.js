// 退出提醒：关闭桌面窗口前检查已上云班级是否还有未同步的本地改动，
// 避免下次打开时本地与云端版本冲突。
(function () {
    'use strict';

    if (window.FuckSeatsExitGuard) return;

    var SYNCED_STATUSES = { ok: true, up_to_date: true, pulled: true };
    var busy = false;

    function toast(message) {
        if (typeof window.showToast === 'function') window.showToast(message);
    }

    function api() {
        return window.pywebview && window.pywebview.api;
    }

    async function fetchPending() {
        try {
            var resp = await fetch('/cloud/pending-changes', { headers: { Accept: 'application/json' } });
            if (!resp.ok) return [];
            var data = await resp.json();
            return data && data.logged_in && Array.isArray(data.classrooms) ? data.classrooms : [];
        } catch (error) {
            // 本地服务异常时不阻拦退出。
            return [];
        }
    }

    function describe(classrooms) {
        var names = classrooms.slice(0, 3).map(function (item) { return '「' + item.name + '」'; }).join('、');
        var scope = classrooms.length > 3 ? names + ' 等 ' + classrooms.length + ' 个班级' : names;
        var conflicted = classrooms.some(function (item) { return item.conflict; });
        return scope + ' 的本地改动还没有同步到云端。'
            + (conflicted ? '其中有班级上次同步时与云端冲突，' : '')
            + '直接退出后，下次打开或在其他设备上修改时可能出现冲突。';
    }

    async function syncBeforeExit(classrooms) {
        if (!window.CloudManager) return { ok: false, message: '云服务组件尚未加载' };
        toast('正在同步 ' + classrooms.length + ' 个班级，完成后自动退出');
        try {
            var ids = classrooms.map(function (item) { return Number(item.classroom_id); });
            var result = await window.CloudManager.sync(ids, { deviceId: 'app-exit' });
            var rows = result && Array.isArray(result.results) ? result.results : [];
            var failed = ids.filter(function (id) {
                var row = rows.find(function (item) { return Number(item && item.classroom_id) === id; });
                return !row || !SYNCED_STATUSES[row.status];
            });
            if (!failed.length) return { ok: true };
            var firstRow = rows.find(function (item) { return Number(item && item.classroom_id) === failed[0]; });
            return { ok: false, message: (firstRow && firstRow.message) || '云端未返回同步结果' };
        } catch (error) {
            return { ok: false, message: (error && error.message) || '同步失败' };
        }
    }

    // 返回 true 表示可以退出。
    async function confirmExit() {
        var classrooms = await fetchPending();
        if (!classrooms.length) return true;
        if (typeof window.showChoiceModal !== 'function') return true;

        var choice = await window.showChoiceModal(describe(classrooms), {
            title: '有改动尚未同步到云端',
            primaryText: '同步后退出',
            altText: '直接退出',
            cancelText: '取消',
        });
        if (choice === 'cancel') return false;
        if (choice === 'cloud') return true;

        var outcome = await syncBeforeExit(classrooms);
        if (outcome.ok) return true;
        return window.showConfirmModal(
            '同步没有完成：' + String(outcome.message).replace(/[。.！!]+$/, '') + '。仍要退出吗？未同步的改动会保留在本机，下次打开时再处理。',
            { title: '同步失败', okText: '仍然退出', cancelText: '留在应用', danger: true }
        );
    }

    async function requestClose() {
        var bridge = api();
        if (busy) return;
        busy = true;
        var shouldClose = true;
        try {
            shouldClose = await confirmExit();
        } finally {
            busy = false;
        }
        if (!bridge) return;
        if (shouldClose) {
            bridge.window_action('close').catch(function () { toast('窗口操作失败，请重试'); });
        } else if (typeof bridge.cancel_exit === 'function') {
            bridge.cancel_exit().catch(function () {});
        }
    }

    window.FuckSeatsExitGuard = {
        confirmExit: confirmExit,
        requestClose: requestClose,
    };
})();
