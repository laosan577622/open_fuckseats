/* 设置页“已授权的 Agent”：列出当前有效的授权并支持撤销。 */
(function () {
    'use strict';

    var list = document.getElementById('agent-grant-list');
    if (!list) return;

    var DURATION_LABEL = { session: '仅本次运行', '30d': '30 天', forever: '永久' };

    function csrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta && meta.content ? meta.content : '';
    }

    function formatDate(value) {
        var date = value ? new Date(value) : null;
        if (!date || isNaN(date.getTime())) return '';
        var pad = function (number) { return String(number).padStart(2, '0'); };
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function describe(grant) {
        var parts = [grant.scope === 'full' ? '读取和修改' : '只读', DURATION_LABEL[grant.duration] || '仅本次运行'];
        var granted = formatDate(grant.granted_at);
        if (granted) parts.push('授权于 ' + granted);
        var expires = formatDate(grant.expires_at);
        if (expires) parts.push('到期 ' + expires);
        return parts.join(' · ');
    }

    function message(text) {
        var empty = document.createElement('span');
        empty.className = 'agent-grant-empty';
        empty.textContent = text;
        list.replaceChildren(empty);
    }

    function render(grants) {
        if (!Array.isArray(grants) || !grants.length) {
            message('暂无已授权的程序。');
            return;
        }
        list.replaceChildren.apply(list, grants.map(function (grant) {
            var item = document.createElement('div');
            item.className = 'agent-grant-item';
            var info = document.createElement('div');
            var name = document.createElement('strong');
            name.textContent = grant.client_name || '未命名程序';
            var detail = document.createElement('span');
            detail.textContent = describe(grant);
            info.append(name, detail);
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary';
            button.textContent = '撤销';
            button.setAttribute('aria-label', '撤销 ' + (grant.client_name || '未命名程序') + ' 的授权');
            button.addEventListener('click', function () { revoke(grant, button); });
            item.append(info, button);
            return item;
        }));
    }

    function load() {
        fetch('/api/agent-access/grants/', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (response) { return response.ok ? response.json() : Promise.reject(); })
            .then(function (data) { render(data.grants); })
            .catch(function () { message('授权列表加载失败，请稍后重试。'); });
    }

    function revoke(grant, button) {
        var confirmRevoke = typeof window.showConfirmModal === 'function'
            ? window.showConfirmModal('撤销后，「' + (grant.client_name || '未命名程序') + '」需要重新申请才能访问。', { title: '撤销授权', okText: '撤销', danger: true })
            : Promise.resolve(window.confirm('确定撤销这个程序的授权？'));
        confirmRevoke.then(function (confirmed) {
            if (!confirmed) return;
            button.disabled = true;
            fetch('/api/agent-access/grants/' + encodeURIComponent(grant.id) + '/revoke/', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
            }).then(function (response) {
                return response.json().catch(function () { return {}; }).then(function (data) {
                    // 404 表示授权已经失效，列表同样按服务端返回刷新。
                    if (!response.ok && response.status !== 404) throw new Error(data.message || '撤销失败，请重试');
                    render(data.grants);
                    if (response.ok && typeof window.showToast === 'function') window.showToast('已撤销「' + (grant.client_name || '未命名程序') + '」的授权');
                });
            }).catch(function (error) {
                button.disabled = false;
                if (typeof window.showToast === 'function') window.showToast(error.message || '撤销失败，请重试');
            });
        });
    }

    window.addEventListener('fuckseats:agent-access-changed', load);
    load();
})();
