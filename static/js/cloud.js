window.CloudManager = (function () {
    let _userInfo = null;
    let _syncing = false;
    let _syncQueue = Promise.resolve();
    const _syncPromises = new Map();
    let _loginFlowPromise = null;
    let _loginOverlay = null;
    let _connectivityOverlay = null;
    let _offlinePromptPromise = null;

    async function fetchJSON(url, options) {
        const resp = await fetch(url, options);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.message || data.error || `请求失败（${resp.status}）`);
        }
        return data;
    }

    function getTemplateIcon(id) {
        const template = document.getElementById(id);
        if (!template) return '';
        const root = template.content || template;
        const svg = root.querySelector ? root.querySelector('svg') : null;
        return svg ? svg.outerHTML : '';
    }

    function getLoginIconMarkup() {
        return getTemplateIcon('cloud-login-icon-template');
    }

    function getOfflineIconMarkup() {
        return getTemplateIcon('cloud-offline-icon-template');
    }

    async function getUserInfo(force, options) {
        if (_userInfo && !force) return _userInfo;
        const refreshSubscription = !options || options.refreshSubscription !== false;
        const url = refreshSubscription ? '/cloud/userinfo' : '/cloud/userinfo?refresh=0';
        try {
            const data = await fetchJSON(url);
            _userInfo = data;
            return data;
        } catch (error) {
            if (_userInfo) {
                return { ..._userInfo, connection_error: true, message: error && error.message };
            }
            return { logged_in: false, connection_error: true, message: error && error.message };
        }
    }

    async function getNetworkStatus() {
        return fetchJSON('/api/network-status');
    }

    function getConnectivityOverlay() {
        if (_connectivityOverlay) return _connectivityOverlay;
        const overlay = document.createElement('div');
        overlay.className = 'cloud-connectivity-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="cloud-connectivity-backdrop"></div>
            <div class="cloud-connectivity-dialog">
                <div class="cloud-connectivity-icon" aria-hidden="true">${getOfflineIconMarkup()}</div>
                <h3>您似乎未联网</h3>
                <p>当前系统未检测到可用网络，是否仍要继续尝试云同步？</p>
                <div class="cloud-connectivity-actions">
                    <button type="button" class="btn btn-secondary" data-cloud-use-local>使用本地数据</button>
                    <button type="button" class="btn btn-primary" data-cloud-try-anyway>继续尝试</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        _connectivityOverlay = overlay;
        return overlay;
    }

    function confirmOfflineSync() {
        if (_offlinePromptPromise) return _offlinePromptPromise;
        _offlinePromptPromise = new Promise((resolve) => {
            const overlay = getConnectivityOverlay();
            const localBtn = overlay.querySelector('[data-cloud-use-local]');
            const retryBtn = overlay.querySelector('[data-cloud-try-anyway]');
            const finish = (shouldTry) => {
                overlay.classList.remove('visible');
                overlay.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('cloud-connectivity-locked');
                if (window.PopupManager) PopupManager.notifyDismissed('cloud-connectivity');
                _offlinePromptPromise = null;
                resolve(shouldTry);
            };
            const show = () => {
                overlay.classList.add('visible');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('cloud-connectivity-locked');
                retryBtn.focus();
            };
            localBtn.onclick = () => finish(false);
            retryBtn.onclick = () => finish(true);
            if (window.PopupManager) PopupManager.request('cloud-connectivity', show);
            else show();
        });
        return _offlinePromptPromise;
    }

    async function prepareEntrySync(options) {
        const opts = options || {};
        const [user, network] = await Promise.all([
            getUserInfo(true, { refreshSubscription: false }),
            getNetworkStatus().catch(() => ({ online: null, source: 'request-error' })),
        ]);
        if (!user || !user.logged_in) {
            return { shouldSync: false, reason: 'not_logged_in', user, network };
        }
        if (network && network.online === false) {
            if (opts.promptOffline === false) {
                return { shouldSync: false, reason: 'offline', user, network };
            }
            const shouldTry = await confirmOfflineSync();
            return {
                shouldSync: shouldTry,
                reason: shouldTry ? 'offline_retry' : 'offline_local',
                user,
                network,
            };
        }
        return { shouldSync: true, reason: 'online', user, network };
    }

    function getLoginOverlay() {
        if (_loginOverlay) return _loginOverlay;

        const overlay = document.createElement('div');
        overlay.className = 'cloud-login-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
                <div class="cloud-login-dialog">
                <div class="cloud-login-icon" aria-hidden="true">${getLoginIconMarkup()}</div>
                <div class="cloud-login-title">云服务登录</div>
                <div class="cloud-login-message" data-cloud-login-message></div>
                <div class="cloud-login-progress" data-cloud-login-progress style="display:none;">
                    <span class="cloud-login-spinner"></span>
                    <span data-cloud-login-status>正在准备...</span>
                </div>
                <div class="cloud-login-actions" data-cloud-login-actions>
                    <button type="button" class="btn btn-secondary" data-cloud-login-cancel>取消</button>
                    <button type="button" class="btn btn-primary" data-cloud-login-confirm>开始登录</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        _loginOverlay = overlay;
        return overlay;
    }

    function setLoginOverlayMode(mode, message, statusText) {
        const overlay = getLoginOverlay();
        const messageEl = overlay.querySelector('[data-cloud-login-message]');
        const statusEl = overlay.querySelector('[data-cloud-login-status]');
        const actionsEl = overlay.querySelector('[data-cloud-login-actions]');
        const progressEl = overlay.querySelector('[data-cloud-login-progress]');
        overlay.style.display = 'flex';
        document.body.classList.add('cloud-login-locked');
        messageEl.textContent = message || '';
        statusEl.textContent = statusText || '';
        actionsEl.style.display = mode === 'confirm' ? 'flex' : 'none';
        progressEl.style.display = mode === 'confirm' ? 'none' : 'flex';
    }

    function hideLoginOverlay() {
        if (_loginOverlay) _loginOverlay.style.display = 'none';
        document.body.classList.remove('cloud-login-locked');
    }

    function showLoginPreparationDialog() {
        setLoginOverlayMode(
            'confirm',
            '即将打开浏览器进行登录，此过程较长，请您耐心等待并根据提示操作后再继续！',
            ''
        );
        const overlay = getLoginOverlay();
        const confirmBtn = overlay.querySelector('[data-cloud-login-confirm]');
        const cancelBtn = overlay.querySelector('[data-cloud-login-cancel]');
        return new Promise((resolve) => {
            const cleanup = () => {
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            };
            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };
            const handleCancel = () => {
                cleanup();
                hideLoginOverlay();
                resolve(false);
            };
            confirmBtn.addEventListener('click', handleConfirm, { once: true });
            cancelBtn.addEventListener('click', handleCancel, { once: true });
            confirmBtn.focus();
        });
    }

    function updateLoginStatus(statusText) {
        const overlay = getLoginOverlay();
        const statusEl = overlay.querySelector('[data-cloud-login-status]');
        if (statusEl) statusEl.textContent = statusText || '';
    }

    function countSyncedRows(result) {
        const rows = result && Array.isArray(result.results) ? result.results : [];
        return rows.filter(row => row && (
            row.status === 'ok' ||
            row.status === 'up_to_date' ||
            row.status === 'pulled'
        )).length;
    }

    function dispatchLoginSyncComplete(result, userInfo) {
        window.dispatchEvent(new CustomEvent('cloud-login-success', {
            detail: { result: result || null, user: userInfo || null }
        }));
        window.dispatchEvent(new CustomEvent('cloud-login-sync-complete', {
            detail: { result: result || null, user: userInfo || null }
        }));
    }

    async function autoSyncAfterLogin(userInfo) {
        updateLoginStatus('登录成功，正在自动同步云端数据...');
        const result = await sync(null, { auto: true, scope: 'linked', deviceId: 'login-auto-sync' });
        _userInfo = userInfo || await getUserInfo(true);
        dispatchLoginSyncComplete(result, _userInfo);
        return result;
    }

    function waitForLoginStatus() {
        let attempts = 0;
        const maxAttempts = 180;
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                attempts++;
                if (attempts > maxAttempts) {
                    clearInterval(interval);
                    reject(new Error('登录等待超时，请重新登录'));
                    return;
                }
                try {
                    const info = await getUserInfo(true, { refreshSubscription: false });
                    if (info && info.logged_in) {
                        clearInterval(interval);
                        resolve(info);
                    }
                } catch {}
            }, 2000);
        });
    }

    function openLogin() {
        if (_loginFlowPromise) return _loginFlowPromise;

        _loginFlowPromise = (async () => {
            const data = await getUserInfo(true, { refreshSubscription: false });
            if (data && data.logged_in) {
                return { status: 'already_logged_in', user: data };
            }
            const loginUrl = data.login_url;
            if (!loginUrl) throw new Error('云服务登录地址无效');

            const shouldContinue = await showLoginPreparationDialog();
            if (!shouldContinue) return { status: 'cancelled' };

            setLoginOverlayMode(
                'waiting',
                '请在打开的浏览器窗口中完成登录。登录完成前，主程序将暂时锁定，避免数据状态不一致。',
                '正在打开浏览器...'
            );
            const isDesktop = document.body.dataset.appShell === 'webview';
            if (isDesktop) {
                await fetchJSON('/cloud/open-external', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: loginUrl }),
                });
            } else {
                const popup = window.open(loginUrl, '_blank');
                if (!popup) {
                    window.location.href = loginUrl;
                    return { status: 'redirecting' };
                }
            }

            updateLoginStatus('等待浏览器登录完成...');
            const info = await waitForLoginStatus();
            const syncResult = await autoSyncAfterLogin(info);
            const syncedCount = countSyncedRows(syncResult);
            updateLoginStatus(syncedCount ? '自动同步完成' : '自动同步完成，没有需要更新的班级');
            if (typeof showToast === 'function') {
                showToast(syncedCount ? '登录成功，自动同步完成' : '登录成功，没有需要同步的班级');
            }
            if (typeof window.refreshCloudUI === 'function') window.refreshCloudUI();
            else setTimeout(() => window.dispatchEvent(new CustomEvent('cloud-ui-refresh')), 0);
            return { status: 'success', user: info, sync: syncResult };
        })();

        _loginFlowPromise = _loginFlowPromise
            .catch((error) => {
                if (typeof showToast === 'function') {
                    showToast((error && error.message) || '云服务登录失败');
                }
                return { status: 'error', error };
            })
            .finally(() => {
                setTimeout(hideLoginOverlay, 450);
                _loginFlowPromise = null;
            });

        return _loginFlowPromise;
    }

    function _pollLoginStatus() {
        return waitForLoginStatus().then(async (info) => {
            try {
                return await autoSyncAfterLogin(info);
            } catch {}
            return null;
        });
    }

    async function logout() {
        try {
            await fetchJSON('/cloud/logout', { method: 'POST' });
        } catch {}
        _userInfo = null;
    }

    async function refreshSubscription() {
        const data = await fetchJSON('/cloud/refresh-subscription', { method: 'POST' });
        if (data.logged_in) _userInfo = data;
        return data;
    }

    async function getSyncStatus(classroomId) {
        const q = classroomId ? '?classroom_id=' + encodeURIComponent(classroomId) : '';
        return fetchJSON('/cloud/sync-status' + q);
    }

    async function sync(classroomIds, options) {
        const opts = options || {};
        const normalizedIds = classroomIds
            ? (Array.isArray(classroomIds) ? classroomIds.slice() : [classroomIds]).map(Number).sort((a, b) => a - b)
            : null;
        const body = normalizedIds ? { classroom_ids: normalizedIds } : {};
        if (opts.force) body.force = true;
        if (opts.auto) body.auto = true;
        if (opts.scope) body.scope = opts.scope;
        if (opts.deviceId) body.device_id = opts.deviceId;
        const requestKey = JSON.stringify(body);
        if (_syncPromises.has(requestKey)) return _syncPromises.get(requestKey);

        const task = _syncQueue.catch(() => null).then(() => fetchJSON('/cloud/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }));
        let tracked;
        tracked = task.finally(() => {
            if (_syncPromises.get(requestKey) === tracked) _syncPromises.delete(requestKey);
            _syncing = _syncPromises.size > 0;
        });
        _syncPromises.set(requestKey, tracked);
        _syncQueue = tracked.catch(() => null);
        _syncing = true;
        return tracked;
    }

    async function pullClassroom(uuid) {
        return fetchJSON('/cloud/sync/pull/' + uuid, { method: 'POST' });
    }

    async function deleteCloudClassroom(uuid, options) {
        const opts = options || {};
        return fetchJSON('/cloud/sync/delete/' + uuid, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                detach_local: !!opts.detachLocal,
                device_id: opts.deviceId || 'cloud-manager',
            }),
        });
    }

    async function getSnapshots(classroomUuid) {
        return fetchJSON('/cloud/snapshots?classroom_uuid=' + classroomUuid);
    }

    async function createSnapshot(classroomId, name) {
        return fetchJSON('/cloud/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classroom_id: classroomId, name: name || '手动快照' }),
        });
    }

    async function restoreSnapshot(snapshotId) {
        return fetchJSON('/cloud/snapshots/' + snapshotId + '/restore', { method: 'POST' });
    }

    async function deleteSnapshot(snapshotId) {
        return fetchJSON('/cloud/snapshots/' + snapshotId + '/delete', { method: 'POST' });
    }

    async function getSubscriptionPlans() {
        return fetchJSON('/cloud/subscription/plans');
    }

    async function getPurchaseUrl(tier) {
        const q = tier ? '?tier=' + encodeURIComponent(tier) : '';
        return fetchJSON('/cloud/subscription/purchase-url' + q);
    }

    async function openExternalUrl(url) {
        const target = String(url || '').trim();
        if (!target) throw new Error('打开地址无效');
        const isDesktop = document.body.dataset.appShell === 'webview';
        if (isDesktop) {
            return fetchJSON('/cloud/open-external', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: target }),
            });
        }
        const popup = window.open(target, '_blank', 'noopener,noreferrer');
        if (!popup) {
            window.location.href = target;
        }
        return { status: 'success' };
    }

    async function setCloudServerUrl(url) {
        return fetchJSON('/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cloud_server_url: url }),
        });
    }

    function isSyncing() {
        return _syncing;
    }

    return {
        getUserInfo,
        getNetworkStatus,
        prepareEntrySync,
        confirmOfflineSync,
        getLoginIconMarkup,
        getOfflineIconMarkup,
        openLogin,
        logout,
        refreshSubscription,
        getSyncStatus,
        sync,
        pullClassroom,
        deleteCloudClassroom,
        getSnapshots,
        createSnapshot,
        restoreSnapshot,
        deleteSnapshot,
        getSubscriptionPlans,
        getPurchaseUrl,
        openExternalUrl,
        setCloudServerUrl,
        isSyncing,
    };
})();
