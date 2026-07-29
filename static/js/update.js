(function () {
    let pollingInterval = null;
    const INSTALL_LAUNCH_DELAY_MS = 2000;
    const INSTALL_LAUNCH_DELAY_TEXT = '2 秒';
    const DEFAULT_UPDATE_DETAILS_URL = '/update.txt';
    let updateDetailsRequestId = 0;
    const appPlatform = String(document.body && document.body.dataset.appPlatform || '').toLowerCase();
    const isMacosLocalUpdate = appPlatform === 'macos';

    window.updateInfo = null;

    function shouldDeferForOnboarding() {
        return window.FUCKSEATS_ONBOARDING_ACTIVE === true || window.ONBOARDING_SHOULD_SHOW === true;
    }

    async function checkUpdate() {
        // macOS is intentionally local-only: no manifest, release-note, or
        // package request is allowed from this automatic path.
        if (isMacosLocalUpdate) return;
        if (shouldDeferForOnboarding()) {
            window.setTimeout(checkUpdate, 1000);
            return;
        }
        try {
            const response = await fetch('/api/update/check/');
            const data = await response.json();

            if (data.status === 'success' && data.update_available) {
                window.updateInfo = data;
                showUpdateModal();
            }
        } catch (error) {
            console.error('Update check error:', error);
        }
    }

    function setInstallActionVisible(visible, pending = false) {
        const installActions = document.getElementById('update-install-actions');
        const installBtn = document.getElementById('install-and-exit-btn');
        installActions.style.display = visible ? 'flex' : 'none';
        installBtn.disabled = pending;
        installBtn.textContent = pending ? '正在启动安装程序...' : '开始安装并退出程序';
    }

    function resetUpdateProgressView() {
        const statusEl = document.getElementById('update-status');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        statusEl.textContent = '正在准备更新...';
        progressFill.style.width = '0%';
        progressText.textContent = '';
        setInstallActionVisible(false);
    }

    function renderUpdateDetails(text, state = 'loaded') {
        const detailsEl = document.getElementById('update-details-content');
        if (!detailsEl) return;
        detailsEl.dataset.state = state;
        detailsEl.textContent = text;
    }

    async function loadUpdateDetails() {
        const requestId = ++updateDetailsRequestId;
        const fallbackText = String((window.updateInfo && window.updateInfo.notes) || '').trim();
        const detailsEl = document.getElementById('update-details-content');
        const updateDetailsUrl = (detailsEl && detailsEl.dataset.detailsUrl) || DEFAULT_UPDATE_DETAILS_URL;

        renderUpdateDetails('正在加载更新详情...', 'loading');

        if (isMacosLocalUpdate) {
            renderUpdateDetails(fallbackText || '升级包来自你选择的本地文件，应用不会从服务器下载安装包。', 'loaded');
            return;
        }

        try {
            const detailUrl = `${updateDetailsUrl}?t=${Date.now()}`;
            const response = await fetch(detailUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const remoteText = (await response.text()).trim();
            if (requestId !== updateDetailsRequestId) return;

            if (remoteText) {
                renderUpdateDetails(remoteText, 'loaded');
                return;
            }

            if (fallbackText) {
                renderUpdateDetails(fallbackText, 'loaded');
                return;
            }

            renderUpdateDetails('暂无更新详情。', 'empty');
        } catch (error) {
            console.error('Update details fetch error:', error);
            if (requestId !== updateDetailsRequestId) return;

            if (fallbackText) {
                renderUpdateDetails(fallbackText, 'loaded');
                return;
            }

            renderUpdateDetails('暂时无法加载更新详情，请稍后重试。', 'error');
        }
    }

    function showUpdateModal() {
        if (!window.updateInfo) return;
        if (shouldDeferForOnboarding()) {
            window.setTimeout(showUpdateModal, 1000);
            return;
        }
        if (window.PopupManager) {
            PopupManager.request('update', doShowUpdateModal);
        } else {
            doShowUpdateModal();
        }
    }

    function doShowUpdateModal() {
        const modal = document.getElementById('update-modal');
        const currentVersion = document.getElementById('current-version');
        const latestVersion = document.getElementById('latest-version');
        const promptDiv = document.getElementById('update-prompt');
        const progressDiv = document.getElementById('update-progress');
        const closeBtn = document.getElementById('close-update-modal');

        currentVersion.textContent = window.updateInfo.current_version;
        latestVersion.textContent = window.updateInfo.latest_version;

        promptDiv.style.display = 'block';
        progressDiv.style.display = 'none';
        closeBtn.style.display = '';
        resetUpdateProgressView();

        modal.style.display = 'flex';
        loadUpdateDetails();
    }

    function hideUpdateModal() {
        const modal = document.getElementById('update-modal');
        modal.style.display = 'none';
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        if (window.PopupManager) PopupManager.notifyDismissed('update');
    }

    async function startUpdate() {
        if (isMacosLocalUpdate) return;
        const promptDiv = document.getElementById('update-prompt');
        const progressDiv = document.getElementById('update-progress');
        const closeBtn = document.getElementById('close-update-modal');

        promptDiv.style.display = 'none';
        progressDiv.style.display = 'block';
        closeBtn.style.display = 'none';
        resetUpdateProgressView();

        try {
            const response = await fetch('/api/update/start/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_version: window.updateInfo.latest_version })
            });
            const data = await response.json();

            if (data.status === 'success') {
                updateProgress(data);
                startPolling();
            } else {
                showUpdateError(data.message || '更新失败');
            }
        } catch (error) {
            showUpdateError('更新请求失败');
            console.error('Update start error:', error);
        }
    }

    function showUpdateError(message) {
        const closeBtn = document.getElementById('close-update-modal');
        const statusEl = document.getElementById('update-status');
        setInstallActionVisible(false);
        statusEl.textContent = message;
        closeBtn.style.display = '';
    }

    function startPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/update/status/');
                const data = await response.json();

                if (data.status === 'success') {
                    updateProgress(data);
                }
            } catch (error) {
                console.error('Status polling error:', error);
            }
        }, 1000);
    }

    async function requestDesktopExitForInstall() {
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.close_app_for_update !== 'function') {
            throw new Error('当前桌面程序不支持自动退出');
        }
        return api.close_app_for_update();
    }

    async function startInstallAndExit() {
        const statusEl = document.getElementById('update-status');
        const progressText = document.getElementById('progress-text');
        const closeBtn = document.getElementById('close-update-modal');

        statusEl.textContent = `将在 ${INSTALL_LAUNCH_DELAY_TEXT} 后打开安装程序...`;
        progressText.textContent = '请稍候，安装程序启动后将自动退出当前程序';
        closeBtn.style.display = 'none';
        setInstallActionVisible(true, true);

        try {
            await new Promise((resolve) => window.setTimeout(resolve, INSTALL_LAUNCH_DELAY_MS));

            const response = await fetch('/api/update/install/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            });
            const data = await response.json();

            if (data.status !== 'success') {
                showUpdateError(data.message || '启动安装程序失败');
                setInstallActionVisible(true, false);
                return;
            }

            updateProgress(data);
            progressText.textContent = '安装程序已启动，正在退出当前程序...';
            window.setTimeout(async () => {
                try {
                    await requestDesktopExitForInstall();
                } catch (error) {
                    console.error('Desktop exit error:', error);
                    showUpdateError('安装程序已启动，请手动关闭当前程序后继续安装');
                }
            }, 80);
        } catch (error) {
            showUpdateError('启动安装程序失败');
            setInstallActionVisible(true, false);
            console.error('Update install error:', error);
        }
    }

    function updateProgress(data) {
        const statusEl = document.getElementById('update-status');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const closeBtn = document.getElementById('close-update-modal');

        if (data.state === 'downloading') {
            setInstallActionVisible(false);
            statusEl.textContent = '正在下载更新安装包...';
            closeBtn.style.display = 'none';
            if (data.progress && data.progress.percent !== null) {
                progressFill.style.width = data.progress.percent + '%';
                const receivedMB = (data.progress.received_bytes / 1024 / 1024).toFixed(1);
                const totalMB = (data.progress.total_bytes / 1024 / 1024).toFixed(1);
                progressText.textContent = `${data.progress.percent}% (${receivedMB} MB / ${totalMB} MB)`;
            }
        } else if (data.state === 'ready_to_install') {
            statusEl.textContent = '更新准备完成';
            progressFill.style.width = '100%';
            progressText.textContent = isMacosLocalUpdate
                ? `本地 PKG 已验证。点击下方按钮后，将打开 macOS 系统安装器并退出当前程序`
                : `点击下方按钮后，将在 ${INSTALL_LAUNCH_DELAY_TEXT} 后打开安装程序，然后自动退出当前程序`;
            closeBtn.style.display = '';
            setInstallActionVisible(true, false);
            clearInterval(pollingInterval);
            pollingInterval = null;
        } else if (data.state === 'installer_started') {
            setInstallActionVisible(false);
            statusEl.textContent = '安装程序已启动';
            progressFill.style.width = '100%';
            progressText.textContent = '桌面程序正在退出，请在安装界面中继续完成更新';
            closeBtn.style.display = 'none';
            clearInterval(pollingInterval);
            pollingInterval = null;
        } else if (data.state === 'error') {
            showUpdateError(data.last_error || '更新出错');
        }
    }

    window.showUpdateModal = showUpdateModal;
    window.hideUpdateModal = hideUpdateModal;
    window.selectLocalMacUpdate = async function selectLocalMacUpdate() {
        if (!isMacosLocalUpdate) return { status: 'unsupported' };
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.select_macos_update_package !== 'function') {
            if (typeof showToast === 'function') showToast('请在 macOS 桌面版中选择升级包');
            return { status: 'unsupported' };
        }
        try {
            const selection = await api.select_macos_update_package();
            if (!selection || selection.status === 'cancelled') return { status: 'cancelled' };
            if (selection.status !== 'selected') {
                throw new Error(selection.message || '无法读取升级包');
            }

            const response = await fetch('/api/update/start/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_path: selection.path })
            });
            const data = await response.json();
            if (data.status !== 'success') throw new Error(data.message || '升级包校验失败');

            window.updateInfo = data;
            doShowUpdateModal();
            document.getElementById('update-prompt').style.display = 'none';
            document.getElementById('update-progress').style.display = 'block';
            updateProgress(data);
            if (typeof showToast === 'function') showToast('本地升级包校验完成');
            return data;
        } catch (error) {
            const message = error && error.message ? error.message : '升级包校验失败';
            if (typeof showToast === 'function') showToast(message);
            console.error('Local macOS update error:', error);
            return { status: 'error', message };
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!isMacosLocalUpdate) checkUpdate();

        document.getElementById('close-update-modal').addEventListener('click', hideUpdateModal);
        document.getElementById('later-btn').addEventListener('click', hideUpdateModal);
        document.getElementById('update-btn').addEventListener('click', startUpdate);
        document.getElementById('install-and-exit-btn').addEventListener('click', startInstallAndExit);
    });
})();
