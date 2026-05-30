(function () {
    let pollingInterval = null;
    const INSTALL_LAUNCH_DELAY_MS = 2000;
    const INSTALL_LAUNCH_DELAY_TEXT = '2 秒';
    const UPDATE_DETAILS_URL = 'https://apps.577622.xyz/api/user_a6d12cebda652894/7h4sjhx0azr/update.txt';
    let updateDetailsRequestId = 0;

    window.updateInfo = null;

    async function checkUpdate() {
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

        renderUpdateDetails('正在加载更新详情...', 'loading');

        try {
            const detailUrl = `${UPDATE_DETAILS_URL}?t=${Date.now()}`;
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
    }

    async function startUpdate() {
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
            progressText.textContent = `点击下方按钮后，将在 ${INSTALL_LAUNCH_DELAY_TEXT} 后打开安装程序，然后自动退出当前程序`;
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

    document.addEventListener('DOMContentLoaded', () => {
        checkUpdate();

        document.getElementById('close-update-modal').addEventListener('click', hideUpdateModal);
        document.getElementById('later-btn').addEventListener('click', hideUpdateModal);
        document.getElementById('update-btn').addEventListener('click', startUpdate);
        document.getElementById('install-and-exit-btn').addEventListener('click', startInstallAndExit);
    });
})();
