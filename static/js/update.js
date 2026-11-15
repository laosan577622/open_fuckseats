(function () {
    let pollingInterval = null;
    let pollingGeneration = 0;
    let manualUpdateRequested = false;
    let startupNoticeQueued = false;
    const INSTALL_LAUNCH_DELAY_MS = 2000;
    const INSTALL_LAUNCH_DELAY_TEXT = '2 秒';
    const STARTUP_RESULT_URL = '/api/update/startup-result/';
    const STARTUP_NOTICE_KEY = 'fuckseats_update_startup_notice';
    const appPlatform = String(document.body && document.body.dataset.appPlatform || '').toLowerCase();

    window.updateInfo = null;
    window.FUCKSEATS_UPDATE_CHECK_COMPLETE = false;

    async function requestUpdateJSON(url, options = {}, timeoutMs = 15000) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
        const headers = { ...options.headers };
        if (options.method === 'POST') {
            const token = document.querySelector('meta[name="csrf-token"]');
            headers['X-CSRFToken'] = token ? token.content : '';
        }
        try {
            const response = await fetch(url, {
                ...options, headers, cache: 'no-store', credentials: 'same-origin',
                ...(controller ? { signal: controller.signal } : {})
            });
            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(`更新接口返回的内容不是有效 JSON（HTTP ${response.status}）`);
            }
            if (!response.ok || !data || data.status !== 'success') {
                throw new Error(data && data.message || `更新请求失败（HTTP ${response.status}）`);
            }
            return data;
        } catch (error) {
            if (controller && controller.signal.aborted) {
                throw new Error(`更新请求超时（${timeoutMs / 1000} 秒），请稍后重试。`);
            }
            if (error && error.name === 'TypeError') {
                throw new Error(`无法连接本机更新接口：${error.message}`);
            }
            throw error;
        } finally {
            if (timeout !== null) window.clearTimeout(timeout);
        }
    }

    function stopPolling() {
        pollingGeneration += 1;
        if (pollingInterval !== null) window.clearTimeout(pollingInterval);
        pollingInterval = null;
    }

    function markUpdateCheckComplete() {
        if (window.FUCKSEATS_UPDATE_CHECK_COMPLETE === true) return;
        window.FUCKSEATS_UPDATE_CHECK_COMPLETE = true;
        window.dispatchEvent(new CustomEvent('fuckseats:update-check-complete'));
    }

    function hasShownStartupNotice(value) {
        try {
            return sessionStorage.getItem(STARTUP_NOTICE_KEY) === value;
        } catch (_) {
            return false;
        }
    }

    function rememberStartupNotice(value) {
        try {
            sessionStorage.setItem(STARTUP_NOTICE_KEY, value);
        } catch (_) {
            // The update can still be shown when storage is unavailable.
        }
    }

    function useManualUpdate() {
        manualUpdateRequested = true;
        if (startupNoticeQueued) {
            startupNoticeQueued = false;
            window.PopupManager?.notifyDismissed('update');
        }
    }

    function reportUpdateCheckError(error, automatic = false) {
        const message = '检查更新失败：' + (error && error.message || String(error));
        if (typeof window.showToast === 'function' && (!automatic || !hasShownStartupNotice(message))) {
            window.showToast(message, { duration: 10000 });
            if (automatic) rememberStartupNotice(message);
        }
        console.error('Update check error:', error);
        return { status: 'error', message };
    }

    async function readStartupUpdate() {
        try {
            await window.OnboardingStore?.ready;
            while (!manualUpdateRequested) {
                const data = await requestUpdateJSON(STARTUP_RESULT_URL, {}, 5000);
                if (manualUpdateRequested) return;
                if (data.state === 'checking') {
                    await new Promise((resolve) => window.setTimeout(resolve, 1000));
                    continue;
                }
                if (data.update_available === true && !hasShownStartupNotice(data.latest_version)) {
                    await window.ClientControlReady;
                    if (manualUpdateRequested || window.ClientControl?.isAvailable('check_update') === false) return;
                    window.updateInfo = data;
                    startupNoticeQueued = true;
                    showUpdateModal(true);
                }
                return;
            }
        } catch (error) {
            if (!manualUpdateRequested) reportUpdateCheckError(error, true);
        } finally {
            markUpdateCheckComplete();
        }
    }

    async function checkUpdate() {
        useManualUpdate();
        try {
            const data = await requestUpdateJSON('/api/update/check/', {}, 20000);
            if (typeof data.update_available !== 'boolean') {
                throw new Error('更新接口未返回有效的版本检查结果');
            }
            if (data.update_available) {
                window.updateInfo = data;
                showUpdateModal();
            } else {
                window.updateInfo = null;
                if (typeof window.showToast === 'function') {
                    window.showToast('当前已是最新版本 ' + data.current_version);
                }
            }
            return data;
        } catch (error) {
            return reportUpdateCheckError(error);
        } finally {
            markUpdateCheckComplete();
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

    function showUpdateDetails(info) {
        const notes = String(info.notes || '').trim();
        if (notes) {
            renderUpdateDetails(notes);
        } else if (info.mode === 'local_package') {
            renderUpdateDetails('升级包来自你选择的本地文件。');
        } else if (info.notes_error) {
            renderUpdateDetails(`暂时无法加载更新详情：${info.notes_error}`, 'error');
        } else {
            renderUpdateDetails('暂无更新详情。', 'empty');
        }
    }

    function showUpdateModal(automatic = false) {
        if (!window.updateInfo) return;
        if (window.PopupManager) {
            PopupManager.request('update', doShowUpdateModal, null, { priority: 100, allowDuringOnboarding: !automatic });
        } else {
            doShowUpdateModal();
        }
    }

    function doShowUpdateModal() {
        startupNoticeQueued = false;
        const modal = document.getElementById('update-modal');
        const currentVersion = document.getElementById('current-version');
        const latestVersion = document.getElementById('latest-version');
        const promptDiv = document.getElementById('update-prompt');
        const progressDiv = document.getElementById('update-progress');
        const closeBtn = document.getElementById('close-update-modal');
        const canInstall = window.updateInfo.supported !== false;

        currentVersion.textContent = window.updateInfo.current_version;
        latestVersion.textContent = window.updateInfo.latest_version;
        document.getElementById('update-prompt-message').textContent = canInstall
            ? '是否立即更新？'
            : '当前环境无法在应用内安装更新。';
        document.getElementById('update-btn').style.display = canInstall ? '' : 'none';
        document.getElementById('later-btn').textContent = canInstall ? '稍后提醒' : '知道了';

        promptDiv.style.display = 'block';
        progressDiv.style.display = 'none';
        closeBtn.style.display = '';
        resetUpdateProgressView();

        showUpdateDetails(window.updateInfo);
        modal.style.display = 'flex';
        rememberStartupNotice(window.updateInfo.latest_version);
    }

    function hideUpdateModal() {
        const modal = document.getElementById('update-modal');
        modal.style.display = 'none';
        stopPolling();
        if (window.PopupManager) PopupManager.notifyDismissed('update');
    }

    async function startUpdate() {
        if (window.updateInfo?.supported === false) return;
        const promptDiv = document.getElementById('update-prompt');
        const progressDiv = document.getElementById('update-progress');
        const closeBtn = document.getElementById('close-update-modal');

        promptDiv.style.display = 'none';
        progressDiv.style.display = 'block';
        closeBtn.style.display = 'none';
        resetUpdateProgressView();

        try {
            const data = await requestUpdateJSON('/api/update/start/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_version: window.updateInfo.latest_version })
            });
            updateProgress(data);
            if (data.state === 'downloading') {
                startPolling();
            }
        } catch (error) {
            showUpdateError(error.message || '更新请求失败');
            console.error('Update start error:', error);
        }
    }

    function showUpdateError(message) {
        stopPolling();
        const closeBtn = document.getElementById('close-update-modal');
        const statusEl = document.getElementById('update-status');
        setInstallActionVisible(false);
        statusEl.textContent = message;
        closeBtn.style.display = '';
    }

    function startPolling() {
        stopPolling();
        const generation = pollingGeneration;
        let consecutiveFailures = 0;
        const poll = async () => {
            pollingInterval = null;
            try {
                const data = await requestUpdateJSON('/api/update/status/', {}, 5000);
                if (generation !== pollingGeneration) return;
                consecutiveFailures = 0;
                updateProgress(data);
            } catch (error) {
                if (generation !== pollingGeneration) return;
                consecutiveFailures += 1;
                if (consecutiveFailures >= 5) {
                    showUpdateError('下载状态获取失败，可能是网络中断。稍后可重新检查更新。');
                }
            }
            if (generation === pollingGeneration) pollingInterval = window.setTimeout(poll, 1000);
        };
        pollingInterval = window.setTimeout(poll, 1000);
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

            const data = await requestUpdateJSON('/api/update/install/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            }, 180000);

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
            showUpdateError(error.message || '启动安装程序失败');
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
            closeBtn.style.display = '';
            if (data.progress && data.progress.percent !== null) {
                progressFill.style.width = data.progress.percent + '%';
                const receivedMB = (data.progress.received_bytes / 1024 / 1024).toFixed(1);
                const totalMB = (data.progress.total_bytes / 1024 / 1024).toFixed(1);
                progressText.textContent = `${data.progress.percent}% (${receivedMB} MB / ${totalMB} MB)`;
            }
        } else if (data.state === 'ready_to_install') {
            statusEl.textContent = '更新准备完成';
            progressFill.style.width = '100%';
            progressText.textContent = appPlatform === 'macos'
                ? 'PKG 已验证。点击下方按钮后，将打开 macOS 系统安装器并退出当前程序'
                : `点击下方按钮后，将在 ${INSTALL_LAUNCH_DELAY_TEXT} 后打开安装程序，然后自动退出当前程序`;
            closeBtn.style.display = '';
            setInstallActionVisible(true, false);
            stopPolling();
        } else if (data.state === 'installer_started') {
            setInstallActionVisible(false);
            statusEl.textContent = '安装程序已启动';
            progressFill.style.width = '100%';
            progressText.textContent = '桌面程序正在退出，请在安装界面中继续完成更新';
            closeBtn.style.display = 'none';
            stopPolling();
        } else if (data.state === 'error') {
            showUpdateError(data.last_error || '更新出错');
        } else if (data.state === 'up_to_date' || data.state === 'idle') {
            stopPolling();
            setInstallActionVisible(false);
            statusEl.textContent = data.message || '当前已是最新版本';
            closeBtn.style.display = '';
        }
    }

    window.checkForUpdates = checkUpdate;
    window.showUpdateModal = showUpdateModal;
    window.hideUpdateModal = hideUpdateModal;
    window.selectLocalMacUpdate = async function selectLocalMacUpdate() {
        if (appPlatform !== 'macos') return { status: 'unsupported' };
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
            useManualUpdate();

            const data = await requestUpdateJSON('/api/update/start/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_path: selection.path })
            }, 300000);

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
        document.getElementById('close-update-modal').addEventListener('click', hideUpdateModal);
        document.getElementById('later-btn').addEventListener('click', hideUpdateModal);
        document.getElementById('update-btn').addEventListener('click', startUpdate);
        document.getElementById('install-and-exit-btn').addEventListener('click', startInstallAndExit);

        readStartupUpdate();
    });
})();
