document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const button = document.getElementById('btn-drop-classroom');
    const root = document.getElementById('classroom-root');
    if (!button || !root) return;

    const showMessage = (message, title) => {
        if (typeof window.showConfirmModal === 'function') {
            return window.showConfirmModal(message, { title, okText: '知道了', cancelText: '关闭' });
        }
        window.alert(message);
    };
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        if (!window.ClientControl || window.ClientControl.isAvailable('drop') !== true) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(button.dataset.dropUrl, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'X-CSRFToken': root.dataset.csrf, 'X-Requested-With': 'XMLHttpRequest' },
            });
            const result = await response.json().catch(() => ({}));
            if (result.status === 'not_installed') {
                await showMessage(result.message || '请先安装不想班管教师端，再使用 Drop。', '需要安装不想班管');
                return;
            }
            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || '无法唤起不想班管教师端，请重试。');
            }
            if (typeof window.showInlineToast === 'function') window.showInlineToast('已打开不想班管教师端');
        } catch (error) {
            await showMessage(error.message || '无法连接本地服务，请重试。', 'Drop 未能打开');
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    });
});
