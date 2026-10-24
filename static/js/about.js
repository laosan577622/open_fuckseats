(function () {
    function openExternal(url) {
        const target = String(url || '').trim();
        if (!target) return;
        if (window.CloudManager && typeof window.CloudManager.openExternalUrl === 'function') {
            window.CloudManager.openExternalUrl(target).catch(function (error) {
                if (typeof window.showToast === 'function') window.showToast(error.message || '打开链接失败');
            });
            return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
    }

    async function checkUpdate(button) {
        if (!button || button.disabled) return;
        const original = button.innerHTML;
        button.disabled = true;
        button.classList.add('is-loading');
        try {
            if (typeof window.checkForUpdates !== 'function') {
                throw new Error('更新组件尚未准备完成，请重新打开应用');
            }
            await window.checkForUpdates();
        } catch (error) {
            if (typeof window.showToast === 'function') window.showToast('检查更新失败：' + (error && error.message || String(error)));
        } finally {
            button.disabled = false;
            button.classList.remove('is-loading');
            button.innerHTML = original;
        }
    }

    async function refreshSyncState() {
        const target = document.getElementById('about-sync-state');
        if (!target) return;
        const text = target.querySelector('span');
        try {
            if (!window.CloudManager || typeof window.CloudManager.getUserInfo !== 'function') throw new Error('local');
            const user = await window.CloudManager.getUserInfo(true, { refreshSubscription: false });
            if (user && user.connection_error) {
                target.className = 'about-sync-state is-offline';
                text.textContent = '云端连接异常';
            } else if (user && user.logged_in) {
                target.className = 'about-sync-state';
                text.textContent = '云端已检查';
            } else {
                target.className = 'about-sync-state is-local';
                text.textContent = '当前使用本地数据';
            }
        } catch (error) {
            target.className = 'about-sync-state is-local';
            text.textContent = '当前使用本地数据';
        }
    }

    function initialize() {
        document.querySelectorAll('[data-external-url]').forEach(function (element) {
            element.addEventListener('click', function () { openExternal(element.dataset.externalUrl); });
        });
        ['about-check-update', 'about-panel-check-update'].forEach(function (id) {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', function () { checkUpdate(button); });
        });
        refreshSyncState();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
