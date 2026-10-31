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

    function initializeBrandingToggle() {
        const button = document.getElementById('about-branding-toggle');
        const state = document.getElementById('about-branding-state');
        if (!button || !state || !window.AppBranding) return;
        function renderState() {
            state.textContent = '无 fuck 模式' + (AppBranding.isEnabled() ? '已开启' : '已关闭');
        }
        renderState();
        document.addEventListener('app-branding-changed', renderState);
        button.addEventListener('click', async function () {
            if (button.disabled) return;
            button.disabled = true;
            try {
                await AppBranding.refresh();
                const wasEnabled = AppBranding.isEnabled();
                const confirmed = await window.showConfirmModal(
                    wasEnabled
                        ? '确认后将关闭无 fuck 模式，并在所有界面恢复显示原英文名称。'
                        : '开启后，所有界面中的原英文名称将显示为 BuxiangSeats。',
                    { title: wasEnabled ? '开启原名显示？' : '开启无 fuck 模式？', okText: '确认开启', cancelText: '取消' },
                );
                if (!confirmed) return;
                await AppBranding.save(!wasEnabled);
                if (typeof window.showToast === 'function') window.showToast(!wasEnabled ? '无 fuck 模式已开启' : '已开启原名显示');
            } catch (error) {
                if (typeof window.showToast === 'function') window.showToast(error.message || '模式保存失败，请重试');
            } finally {
                button.disabled = false;
            }
        });
    }

    function initializeProductDisplay() {
        const copies = Array.from(document.querySelectorAll('[data-brand-about]')).map(element => ({ element, original: element.textContent }));
        const website = document.getElementById('about-product-website');
        const normalUrl = website && website.dataset.externalUrl;
        function render() {
            const branding = window.AppBranding;
            const enabled = !branding || branding.isEnabled();
            const config = branding && branding.getDisplayConfig ? branding.getDisplayConfig() : { product_name: '不想排座位', product_website: 'https://paizuowei.577622.xyz', about: {} };
            copies.forEach(({ element, original }) => {
                const key = element.dataset.brandAbout;
                const value = key === 'product_name' ? config.product_name : config.about && config.about[key];
                element.textContent = enabled && typeof value === 'string' ? value : original;
            });
            if (website) {
                const url = enabled ? config.product_website : normalUrl;
                website.dataset.externalUrl = url;
                try { website.querySelector('small').textContent = new URL(url).hostname; } catch (_) {}
            }
        }
        render();
        document.addEventListener('app-branding-changed', render);
        document.addEventListener('app-branding-config-changed', render);
    }

    function initialize() {
        initializeBrandingToggle();
        initializeProductDisplay();
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
