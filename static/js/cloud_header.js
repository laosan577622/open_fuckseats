(function() {
    var HOME_SYNC_SESSION_KEY = 'fuckseats_cloud_entry_sync_v2';
    var HOME_SYNC_RECENT_MS = 5000;
    var homeSyncRunning = false;

    function appendLoggedInAvatar(container, data) {
        if (data.avatar_url) {
            var img = document.createElement('img');
            img.src = data.avatar_url;
            img.className = 'cloud-header-avatar';
            img.alt = '';
            container.appendChild(img);
            return;
        }
        container.innerHTML = '<div class="cloud-header-avatar cloud-header-avatar-placeholder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z" fill="currentColor"/></svg></div>';
    }

    function buildLoginButton(isConnectionError) {
        return '<button type="button" class="cloud-header-login-btn" data-cloud-header-login>' +
            '<span class="cloud-header-login-icon" aria-hidden="true">' + CloudManager.getLoginIconMarkup() + '</span>' +
            '<span>' + (isConnectionError ? '云端连接异常' : '登录') + '</span></button>';
    }

    function buildHomeStatusPill() {
        return '<button type="button" class="cloud-sync-pill cloud-home-sync-pill" data-home-cloud-status data-state="syncing" title="正在检查云同步">' +
            '<span class="cloud-sync-dot"></span><span class="cloud-sync-pill-icon" aria-hidden="true"></span>' +
            '<span class="cloud-sync-pill-text">检查云同步</span></button>';
    }

    function initCloudHeader() {
        var container = document.getElementById('cloud-header-area');
        if (!container || !window.CloudManager) return Promise.resolve();
        if (container.dataset.cloudHeaderManaged === 'classroom') return Promise.resolve();
        return CloudManager.getUserInfo(false, { refreshSubscription: false }).then(function(data) {
            var isHome = window.location.pathname === '/' && document.querySelector('.home-dashboard-page');
            if (data.logged_in) {
                container.innerHTML = '<div class="cloud-header-sync-cluster">' +
                    (isHome ? buildHomeStatusPill() : '') +
                    '<a class="cloud-header-user"></a></div>';
                var userLink = container.querySelector('.cloud-header-user');
                if (userLink) {
                    userLink.href = container.dataset.settingsUrl || '/settings/';
                    userLink.title = (data.nickname || '') + ' (' + (data.tier_display || '') + ')';
                    appendLoggedInAvatar(userLink, data);
                }
                restoreHomeSyncStatus();
            } else {
                var connectionError = Boolean(data.connection_error);
                container.innerHTML = buildLoginButton(connectionError);
                var loginButton = container.querySelector('[data-cloud-header-login]');
                if (loginButton) loginButton.addEventListener('click', function() {
                    if (connectionError) {
                        loginButton.disabled = true;
                        initCloudHeader().finally(function() { loginButton.disabled = false; });
                        return;
                    }
                    CloudManager.openLogin();
                });
            }
        });
    }

    function setHomeSyncStatus(state, text, title, useOfflineIcon) {
        var pill = document.querySelector('[data-home-cloud-status]');
        if (!pill) return;
        pill.dataset.state = state;
        pill.title = title || text;
        pill.disabled = state === 'syncing';
        var textNode = pill.querySelector('.cloud-sync-pill-text');
        var iconNode = pill.querySelector('.cloud-sync-pill-icon');
        var dotNode = pill.querySelector('.cloud-sync-dot');
        if (textNode) textNode.textContent = text;
        if (iconNode) iconNode.innerHTML = useOfflineIcon ? CloudManager.getOfflineIconMarkup() : '';
        if (dotNode) dotNode.style.display = useOfflineIcon ? 'none' : '';
        pill.onclick = state === 'error' || state === 'offline' ? function() {
            try { sessionStorage.removeItem(HOME_SYNC_SESSION_KEY); } catch (error) {}
            runHomeEntrySync(true);
        } : null;
    }

    function saveHomeSyncState(value) {
        try {
            sessionStorage.setItem(HOME_SYNC_SESSION_KEY, JSON.stringify({ state: value, at: Date.now() }));
        } catch (error) {}
    }

    function readHomeSyncState() {
        var raw = '';
        try { raw = sessionStorage.getItem(HOME_SYNC_SESSION_KEY) || ''; } catch (error) {}
        if (!raw) return { state: '', at: 0 };
        try {
            var parsed = JSON.parse(raw);
            return {
                state: String(parsed.state || ''),
                at: Number(parsed.at || 0)
            };
        } catch (error) {
            return { state: raw, at: 0 };
        }
    }

    function restoreHomeSyncStatus() {
        var value = readHomeSyncState().state;
        if (value === 'done') setHomeSyncStatus('synced', '云端已检查', '本次应用会话已完成云同步检查');
        else if (value === 'updated') setHomeSyncStatus('synced', '云端已更新', '已从云端更新班级数据');
        else if (value === 'offline') setHomeSyncStatus('offline', '离线使用', '点击重新检查网络并同步', true);
        else if (value === 'error') setHomeSyncStatus('error', '同步失败', '点击重试云同步');
    }

    function countSyncedRows(result) {
        var rows = [];
        if (result && Array.isArray(result.results)) rows = rows.concat(result.results);
        if (result && Array.isArray(result.group_results)) rows = rows.concat(result.group_results);
        return rows.filter(function(row) {
            return row && (row.status === 'ok' || row.status === 'up_to_date' || row.status === 'pulled');
        }).length;
    }
    function shouldRefreshHomeAfterCloudSync(result) {
        if (window.FuckSeatsCloudSync) return false;
        if (window.location.pathname !== '/') return false;
        if (!document.querySelector('.home-dashboard-page')) return false;
        var rows = [];
        if (result && Array.isArray(result.results)) rows = rows.concat(result.results);
        if (result && Array.isArray(result.group_results)) rows = rows.concat(result.group_results);
        return rows.some(function(row) {
            return row && (
                row.remote_only ||
                row.status === 'pulled'
            );
        });
    }
    function refreshHomeAfterCloudSync(result) {
        if (!shouldRefreshHomeAfterCloudSync(result)) return;
        saveHomeSyncState('updated');
        setTimeout(function() {
            window.location.reload();
        }, 300);
    }

    function summarizeSyncResult(result) {
        var rows = [];
        if (result && Array.isArray(result.results)) rows = rows.concat(result.results);
        if (result && Array.isArray(result.group_results)) rows = rows.concat(result.group_results);
        var failed = rows.filter(function(row) { return row && (row.status === 'error' || row.status === 'conflict'); });
        return { rows: rows, failed: failed, changed: shouldRefreshHomeAfterCloudSync(result) };
    }

    function runHomeEntrySync(force) {
        if (homeSyncRunning || window.location.pathname !== '/' || !document.querySelector('.home-dashboard-page')) return;
        var saved = readHomeSyncState();
        if (!force && saved.at && Date.now() - saved.at < HOME_SYNC_RECENT_MS) {
            restoreHomeSyncStatus();
            return;
        }
        homeSyncRunning = true;
        setHomeSyncStatus('syncing', '检查云同步', '正在检测网络和云同步状态');
        CloudManager.prepareEntrySync().then(function(context) {
            if (context.reason === 'not_logged_in') return null;
            if (!context.shouldSync) {
                saveHomeSyncState('offline');
                setHomeSyncStatus('offline', '离线使用', '点击重新检查网络并同步', true);
                return null;
            }
            setHomeSyncStatus('syncing', '同步中', '正在同步已上云班级和班级组');
            return CloudManager.sync(null, { auto: true, scope: 'linked', deviceId: 'app-entry' });
        }).then(function(result) {
            if (!result) return;
            var summary = summarizeSyncResult(result);
            if (summary.failed.length) {
                saveHomeSyncState('error');
                setHomeSyncStatus('error', '同步失败', summary.failed[0].message || '点击重试云同步');
                return;
            }
            saveHomeSyncState(summary.changed ? 'updated' : 'done');
            setHomeSyncStatus('synced', summary.changed ? '云端已更新' : '云端已检查', '云同步已完成');
            refreshHomeAfterCloudSync(result);
        }).catch(function(error) {
            saveHomeSyncState('error');
            setHomeSyncStatus('error', '同步失败', (error && error.message) || '点击重试云同步');
        }).finally(function() {
            homeSyncRunning = false;
        });
    }
    function notifyOpenerCloudLogin(result) {
        if (!window.opener || window.opener.closed) return;
        try {
            window.opener.postMessage({
                type: 'fuckseats-cloud-login-sync-complete',
                result: result || null
            }, window.location.origin);
        } catch (error) {}
    }
    function autoSyncAfterCloudLogin(options) {
        options = options || {};
        if (!window.CloudManager) return;
        CloudManager.getUserInfo(true, { refreshSubscription: false }).then(function(data) {
            if (!data || !data.logged_in) return null;
            if (typeof showToast === 'function') showToast('云服务登录成功，正在自动同步');
            return CloudManager.sync(null, { auto: true, scope: 'linked', deviceId: 'login-auto-sync' });
        }).then(function(result) {
            if (!result) return;
            saveHomeSyncState('done');
            var syncedCount = countSyncedRows(result);
            if (typeof showToast === 'function') {
                showToast(syncedCount ? '自动同步完成' : '自动同步完成，没有需要更新的班级');
            }
            initCloudHeader();
            refreshHomeAfterCloudSync(result);
            if (options.notifyOpener !== false) notifyOpenerCloudLogin(result);
        }).catch(function(error) {
            if (typeof showToast === 'function') {
                showToast((error && error.message) || '自动同步失败');
            }
            if (options.notifyOpener !== false) notifyOpenerCloudLogin(null);
        });
    }
    function handleCloudLoginSyncComplete(result) {
        CloudManager.getUserInfo(true, { refreshSubscription: false }).then(function() {
            initCloudHeader();
            if (window.FuckSeatsCloudSync && typeof window.FuckSeatsCloudSync.syncAfterLogin === 'function') {
                return window.FuckSeatsCloudSync.syncAfterLogin(result);
            }
            refreshHomeAfterCloudSync(result);
            return null;
        }).catch(function(error) {
            if (typeof showToast === 'function') {
                showToast((error && error.message) || '云同步状态刷新失败');
            }
        });
    }
    window.addEventListener('message', function(event) {
        if (event.origin !== window.location.origin) return;
        var data = event.data || {};
        if (!data || data.type !== 'fuckseats-cloud-login-sync-complete') return;
        handleCloudLoginSyncComplete(data.result || null);
    });
    window.addEventListener('cloud-login-sync-complete', function(event) {
        var detail = event.detail || {};
        handleCloudLoginSyncComplete(detail.result || null);
    });
    var params = new URLSearchParams(window.location.search);
    function startCloudEntry() {
        Promise.resolve(initCloudHeader()).then(function() {
            if (params.get('cloud_login') !== 'success') runHomeEntrySync();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCloudEntry);
    else startCloudEntry();
    if (params.get('cloud_login') === 'success') {
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(function() {
            initCloudHeader();
            autoSyncAfterCloudLogin();
        }, 300);
    } else if (params.get('cloud_login') === 'failed') {
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(function() {
            if (typeof showToast === 'function') showToast('云服务登录失败，请重试');
        }, 300);
    }
})();
