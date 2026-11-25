(function () {
    let pollingInterval = null;
    let pollingGeneration = 0;
    let manualCheck = null;
    let automaticPromptQueued = false;
    const INSTALL_LAUNCH_DELAY_MS = 2000;
    const INSTALL_LAUNCH_DELAY_TEXT = '2 秒';
    const CHECK_POLL_INTERVAL_MS = 1000;
    const UPDATE_STATE_URL = '/api/update/state/';
    const UPDATE_CHECK_URL = '/api/update/check/';
    const UPDATE_DISMISS_URL = '/api/update/dismiss/';
    const ERROR_NOTICE_KEY = 'fuckseats_update_error_notice';
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

    // 同一条自动检查的失败提示在一个窗口内只显示一次，避免每次切换页面都重复提示。
    function hasShownErrorNotice(value) {
        try {
            return sessionStorage.getItem(ERROR_NOTICE_KEY) === value;
        } catch (_) {
            return false;
        }
    }

    function rememberErrorNotice(value) {
        try {
            sessionStorage.setItem(ERROR_NOTICE_KEY, value);
        } catch (_) {
            // The error can still be shown when storage is unavailable.
        }
    }

    function reportUpdateCheckError(error, automatic = false) {
        const message = '检查更新失败：' + (error && error.message || String(error));
        if (typeof window.showToast === 'function' && (!automatic || !hasShownErrorNotice(message))) {
            window.showToast(message, { duration: 10000 });
            if (automatic) rememberErrorNotice(message);
        }
        console.error('Update check error:', error);
        return { status: 'error', message };
    }

    function isUpdateModalVisible() {
        const modal = document.getElementById('update-modal');
        return Boolean(modal && modal.style.display === 'flex');
    }

    // 后端在独立线程中检查更新，这里只读取状态：离开页面或再次检查都不会打断它。
    async function waitForCheckResult(minimumCheckId = 0) {
        for (;;) {
            const data = await requestUpdateJSON(UPDATE_STATE_URL, {}, 5000);
            if (data.state !== 'checking' && Number(data.check_id || 0) >= minimumCheckId) return data;
            await new Promise((resolve) => window.setTimeout(resolve, CHECK_POLL_INTERVAL_MS));
        }
    }

    // 本次运行中发现的更新，只要用户没有关闭提示，就在每个页面弹出。
    async function followUpdateState() {
        try {
            await window.OnboardingStore?.ready;
            const data = await waitForCheckResult();
            if (data.state === 'error' && !manualCheck) {
                reportUpdateCheckError(new Error(data.message || '更新检查失败'), true);
            }
            if (data.update_available !== true || data.dismissed === true) return;
            await window.ClientControlReady;
            if (window.ClientControl?.isAvailable('check_update') === false) return;
            if (manualCheck || automaticPromptQueued || isUpdateModalVisible()) return;
            window.updateInfo = data;
            automaticPromptQueued = true;
            showUpdateModal(true);
        } catch (error) {
            if (!manualCheck) reportUpdateCheckError(error, true);
        } finally {
            markUpdateCheckComplete();
        }
    }

    async function runManualCheck() {
        try {
            const started = await requestUpdateJSON(UPDATE_CHECK_URL, { method: 'POST' }, 20000);
            const data = started.state === 'checking'
                ? await waitForCheckResult(Number(started.check_id || 0))
                : started;
            if (data.state === 'error') {
                throw new Error(data.message || '更新检查失败');
            }
            if (typeof data.update_available !== 'boolean') {
                throw new Error('更新接口未返回有效的版本检查结果');
            }
            if (data.update_available) {
                if (automaticPromptQueued) {
                    // 尚未显示的自动提示由这次手动检查的结果取代。
                    automaticPromptQueued = false;
                    window.PopupManager?.notifyDismissed('update');
                }
                const showing = isUpdateModalVisible();
                if (!showing || window.updateInfo?.latest_version !== data.latest_version) {
                    window.updateInfo = data;
                    if (showing) doShowUpdateModal();
                    else showUpdateModal();
                }
            } else {
                if (!isUpdateModalVisible()) window.updateInfo = null;
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

    function checkUpdate() {
        if (!manualCheck) {
            manualCheck = runManualCheck().finally(() => { manualCheck = null; });
        }
        return manualCheck;
    }

    function reportUpdateDismissed() {
        const version = window.updateInfo && window.updateInfo.latest_version;
        if (!version) return;
        requestUpdateJSON(UPDATE_DISMISS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version }),
            keepalive: true
        }, 5000).catch((error) => console.error('Update dismiss error:', error));
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
        automaticPromptQueued = false;
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
        resumeUpdateProgress(window.updateInfo);
    }

    // 切换页面前已经开始的下载或已准备好的安装包，在新页面直接接着显示进度。
    async function resumeUpdateProgress(info) {
        if (info.install_target !== info.latest_version) return;
        if (info.install_state !== 'downloading' && info.install_state !== 'ready_to_install') return;
        try {
            const data = await requestUpdateJSON('/api/update/status/', {}, 5000);
            if (window.updateInfo !== info || !isUpdateModalVisible()) return;
            if (data.target_version !== info.latest_version) return;
            if (data.state !== 'downloading' && data.state !== 'ready_to_install') return;
            if (document.getElementById('update-prompt').style.display === 'none') return;
            document.getElementById('update-prompt').style.display = 'none';
            document.getElementById('update-progress').style.display = 'block';
            updateProgress(data);
            if (data.state === 'downloading') startPolling();
        } catch (error) {
            console.error('Update progress resume error:', error);
        }
    }

    // 只有用户主动关闭才算关闭提示，之后本次运行不再自动弹出该版本。
    function hideUpdateModal() {
        reportUpdateDismissed();
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
            if (automaticPromptQueued) {
                automaticPromptQueued = false;
                window.PopupManager?.notifyDismissed('update');
            }

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

        followUpdateState();
    });
})();
