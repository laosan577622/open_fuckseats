(function () {
    var showToast = window.showToast || function () {};
    var headerArea = document.getElementById('cloud-header-area');
    if (!headerArea) return;
    headerArea.dataset.cloudHeaderManaged = 'classroom';

    var classroomRoot = document.getElementById('classroom-root');
    var classroomId = Number(classroomRoot && classroomRoot.dataset.classroomId ? classroomRoot.dataset.classroomId : 0);
    var classroomName = classroomRoot ? (classroomRoot.dataset.classroomName || '') : '';
    var syncMeta = readInitialSyncMeta();
    var cloudEntryScreen = document.getElementById('cloud-entry-sync-screen');
    var isCloudBackedUp = classroomRoot && classroomRoot.dataset.cloudBackedUp === '1';
    var currentUser = null;
    var pillButton = null;
    var autoOpenSyncStarted = false;
    var usingLocalMode = false;
    var skipAutoSyncOnce = consumeAutoSyncSkipFlag();
    var entryMark = cloudEntryScreen ? cloudEntryScreen.querySelector('.cloud-entry-sync-mark') : null;
    var entrySyncMarkHtml = entryMark ? entryMark.innerHTML : '';
    var entryRetryButton = cloudEntryScreen ? cloudEntryScreen.querySelector('[data-cloud-entry-retry]') : null;
    var entryLocalButton = cloudEntryScreen ? cloudEntryScreen.querySelector('[data-cloud-entry-local]') : null;

    function readInitialSyncMeta() {
        var node = document.getElementById('classroom-sync-meta');
        if (!node) return {};
        try {
            return JSON.parse(node.textContent || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    function updateStatusbarSync(status) {
        var statusbar = document.getElementById('classroom-sync-status');
        if (!statusbar) return;
        var state = status && status.state ? String(status.state) : 'checking';
        var labels = {
            checking: '检查中',
            login: '未登录',
            'not-backed-up': '未启用云同步',
            syncing: '同步中',
            synced: '已同步',
            dirty: '待同步',
            offline: '离线',
            error: '同步失败',
        };
        statusbar.dataset.state = state;
        var label = document.querySelector('[data-sync-status-label]');
        if (label) label.textContent = '同步状态：' + (labels[state] || '检查中');
    }

    function consumeAutoSyncSkipFlag() {
        var shouldSkip = false;
        try {
            var url = new URL(window.location.href);
            var cloudSyncReason = url.searchParams.get('cloud_sync');
            if (cloudSyncReason === 'return' || cloudSyncReason === 'pulled' || cloudSyncReason === 'import-return') {
                shouldSkip = true;
                url.searchParams.delete('cloud_sync');
                window.history.replaceState(null, '', url.pathname + url.search + url.hash);
            }
        } catch (error) {
            // URL 清理失败时继续尝试消费 sessionStorage 标记。
        }
        try {
            var importReturnSyncKey = 'fuckseats_cloud_import_return_' + classroomId;
            if (sessionStorage.getItem(importReturnSyncKey) === '1') {
                sessionStorage.removeItem(importReturnSyncKey);
                shouldSkip = true;
            }
        } catch (error) {}
        try {
            var referrerUrl = new URL(document.referrer);
            var importOptionsPath = classroomRoot ? (classroomRoot.dataset.importOptionsPath || '') : '';
            var importLayoutPath = classroomRoot ? (classroomRoot.dataset.importLayoutPath || '') : '';
            if (
                referrerUrl.origin === window.location.origin
                && (
                    referrerUrl.pathname === importOptionsPath
                    || referrerUrl.pathname === importLayoutPath
                )
            ) {
                shouldSkip = true;
            }
        } catch (error) {}
        return shouldSkip;
    }

    function reloadAfterPull(options) {
        if (options && options.auto) {
            try {
                var url = new URL(window.location.href);
                url.searchParams.set('cloud_sync', 'pulled');
                window.location.replace(url.pathname + url.search + url.hash);
                return;
            } catch (error) {}
        }
        window.location.reload();
    }

    function setCloudEntryStatus(title, subText, state) {
        if (!cloudEntryScreen) return;
        cloudEntryScreen.dataset.state = state || 'syncing';
        var titleEl = cloudEntryScreen.querySelector('[data-cloud-entry-title]');
        var subEl = cloudEntryScreen.querySelector('[data-cloud-entry-sub]');
        if (titleEl && title) titleEl.textContent = title;
        if (subEl && subText) subEl.textContent = subText;
        if (entryMark) {
            entryMark.innerHTML = state === 'offline'
                ? CloudManager.getOfflineIconMarkup()
                : entrySyncMarkHtml;
        }
        if (entryRetryButton) entryRetryButton.textContent = state === 'offline' ? '继续尝试' : '重试同步';
    }

    function showEntryFailure(message, state) {
        var offline = state === 'offline';
        setCloudEntryStatus(
            offline ? '您似乎未联网' : '暂时无法同步云端数据',
            message || (offline ? '是否仍要继续尝试云同步？' : '你可以重试，或先使用本地数据。'),
            offline ? 'offline' : 'error'
        );
        setPillStatus({
            state: offline ? 'offline' : 'error',
            text: offline ? '离线使用' : '同步失败，点击重试',
            title: message || '点击重试云同步',
            offline: offline,
        });
    }

    function useLocalClassroom() {
        usingLocalMode = true;
        setPillStatus({ state: 'offline', text: '离线使用', title: '当前使用本地数据，点击重试云同步', offline: true });
        revealClassroomContent();
    }

    function revealClassroomContent() {
        if (classroomRoot) {
            classroomRoot.classList.remove('cloud-entry-pending');
        }
        if (cloudEntryScreen) {
            cloudEntryScreen.classList.add('done');
        }
    }

    function shouldGateCloudEntry() {
        return Boolean(isCloudBackedUp && !skipAutoSyncOnce);
    }

    function normalizeSyncMeta(meta) {
        var next = meta || {};
        var localVersion = Number(next.local_version || 0);
        var cloudVersion = Number(next.cloud_version || 0);
        var backedUp = Boolean(next.backed_up || (next.last_sync_at && cloudVersion > 0));
        var lastOperationAt = next.last_operation_at || next.local_operation_at || syncMeta.last_operation_at || null;
        return {
            uuid: next.uuid || syncMeta.uuid || '',
            local_version: localVersion,
            cloud_version: cloudVersion,
            last_operation_at: lastOperationAt,
            last_sync_at: next.last_sync_at || null,
            last_error: next.last_error || '',
            backed_up: backedUp,
            has_local_changes: Boolean(backedUp && (next.has_local_changes || localVersion > cloudVersion)),
            state: next.state || (!backedUp ? 'not_backed_up' : (localVersion > cloudVersion ? 'dirty' : 'synced')),
        };
    }

    function statusForMeta(user, meta) {
        if (!user || !user.logged_in) {
            return { state: 'login', text: '登录后云同步', title: '登录老三账户后自动同步' };
        }
        if (!meta.backed_up) {
            return { state: 'not-backed-up', text: '点击上云', title: '该班级还没有云端备份，点击同步到云端' };
        }
        if (meta.has_local_changes) {
            return { state: 'dirty', text: '有更新，点击更新云端版本', title: '本地有新改动，点击更新云端版本' };
        }
        return { state: 'synced', text: '完成', title: '云端已是最新' };
    }

    function setPillStatus(status) {
        updateStatusbarSync(status);
        if (!pillButton) return;
        pillButton.dataset.state = status.state;
        // 不使用原生 disabled：disabled 按钮会强制使用 default 光标，
        // 在 macOS 壳中会让“点击上云”看起来像不可点击。重复点击由
        // handlePillClick 的状态守卫处理，同时保留无障碍状态提示。
        var isSyncing = status.state === 'syncing';
        pillButton.disabled = false;
        pillButton.setAttribute('aria-busy', isSyncing ? 'true' : 'false');
        pillButton.setAttribute('aria-disabled', isSyncing ? 'true' : 'false');
        pillButton.title = status.title || status.text;
        pillButton.querySelector('.cloud-sync-pill-text').textContent = status.text;
        var icon = pillButton.querySelector('.cloud-sync-pill-icon');
        var dot = pillButton.querySelector('.cloud-sync-dot');
        if (icon) icon.innerHTML = status.offline ? CloudManager.getOfflineIconMarkup() : '';
        if (dot) dot.style.display = status.offline ? 'none' : '';
    }

    function renderPill() {
        if (usingLocalMode) {
            setPillStatus({ state: 'offline', text: '离线使用', title: '当前使用本地数据，点击重试云同步', offline: true });
            return;
        }
        setPillStatus(statusForMeta(currentUser, syncMeta));
    }

    function updateSyncMeta(meta) {
        syncMeta = normalizeSyncMeta(meta);
        renderPill();
    }

    function buildAvatarHtml(user) {
        if (!user || !user.logged_in) {
            return '<div class="cloud-header-avatar cloud-header-avatar-login" aria-hidden="true">' + CloudManager.getLoginIconMarkup() + '</div>';
        }
        return '<div class="cloud-header-avatar cloud-header-avatar-placeholder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z" fill="currentColor"/></svg></div>';
    }

    function appendAvatar(target, user) {
        if (user && user.logged_in && user.avatar_url) {
            var img = document.createElement('img');
            img.src = user.avatar_url;
            img.className = 'cloud-header-avatar';
            img.alt = '';
            target.appendChild(img);
            return;
        }
        target.innerHTML = buildAvatarHtml(user);
    }

    function buildCloudHeader(user) {
        currentUser = user || { logged_in: false };
        var cluster = document.createElement('div');
        cluster.className = 'cloud-header-sync-cluster';

        pillButton = document.createElement('button');
        pillButton.type = 'button';
        pillButton.className = 'cloud-sync-pill';
        pillButton.setAttribute('aria-live', 'polite');
        pillButton.innerHTML = '<span class="cloud-sync-dot"></span><span class="cloud-sync-pill-icon" aria-hidden="true"></span><span class="cloud-sync-pill-text"></span>';
        pillButton.addEventListener('click', function (event) {
            event.preventDefault();
            handlePillClick();
        });
        cluster.appendChild(pillButton);

        var wrapper = document.createElement('div');
        wrapper.className = 'cloud-header-dropdown-wrap';
        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cloud-header-trigger';
        appendAvatar(trigger, currentUser);
        trigger.title = currentUser.logged_in ? (currentUser.nickname || '云服务') + ' (' + (currentUser.tier_display || '') + ')' : '云服务';

        var panel = document.createElement('div');
        panel.className = 'cloud-header-panel';

        var pullBtn = document.createElement('button');
        pullBtn.type = 'button';
        pullBtn.className = 'cloud-header-panel-action';
        pullBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 4v12m0 0l4-4m-4 4l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 18H4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>从云恢复</span>';
        pullBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            wrapper.classList.remove('open');
            restoreFromCloud();
        });
        panel.appendChild(pullBtn);

        var settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'cloud-header-panel-action cloud-header-panel-action-secondary';
        settingsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>云服务设置</span>';
        settingsBtn.addEventListener('click', function () { window.location.href = headerArea.dataset.settingsUrl || '/settings/'; });
        panel.appendChild(settingsBtn);

        wrapper.appendChild(trigger);
        wrapper.appendChild(panel);
        trigger.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (!currentUser.logged_in) {
                CloudManager.openLogin();
                return;
            }
            wrapper.classList.toggle('open');
        });
        document.addEventListener('click', function (event) {
            if (!event.target.closest('.cloud-header-dropdown-wrap')) {
                wrapper.classList.remove('open');
            }
        });

        cluster.appendChild(wrapper);
        renderPill();
        return cluster;
    }

    async function ensureLoggedIn(interactive) {
        var user = await CloudManager.getUserInfo(true, { refreshSubscription: false });
        currentUser = user || { logged_in: false };
        if (!currentUser.logged_in) {
            if (interactive !== false) {
                showToast('请先登录云服务');
                CloudManager.openLogin();
            }
            renderPill();
            return false;
        }
        renderPill();
        return true;
    }

    async function syncCurrentClass(options) {
        options = options || {};
        usingLocalMode = false;
        // 先更新按钮状态，再等待登录态/网络，避免首次“点击上云”时界面没有任何反馈。
        setPillStatus({ state: 'syncing', text: '同步中', title: '正在准备同步到云端' });
        if (options.preflight) {
            setCloudEntryStatus('正在同步云端数据', '进入班级前先确认云端是否有更新。', 'syncing');
        }
        try {
            if (!(await ensureLoggedIn(!options.preflight))) {
                if (options.preflight) revealClassroomContent();
                return;
            }
        } catch (error) {
            var loginError = (error && error.message) || '云服务登录状态检查失败';
            setPillStatus({ state: 'error', text: '同步失败，点击重试', title: loginError });
            if (options.preflight) showEntryFailure(loginError, 'error');
            if (!options.silent) showToast(loginError);
            return;
        }
        setPillStatus({ state: 'syncing', text: '同步中', title: '正在同步到云端' });
        try {
            var result = await CloudManager.sync([classroomId], options);
            var rows = result && Array.isArray(result.results) ? result.results : [];
            var row = rows.find(function(item) { return Number(item && item.classroom_id || 0) === Number(classroomId); });
            if (!row) {
                setPillStatus({ state: 'error', text: '同步失败，点击重试', title: '同步失败，点击重试' });
                if (options.preflight) showEntryFailure('云端没有返回当前班级的同步结果。', 'error');
                return;
            }
            if (row.status === 'ok' || row.status === 'up_to_date' || row.status === 'pulled') {
                updateSyncMeta(row.sync_meta || row);
                if (!options || !options.silent) {
                    showToast(row.status === 'up_to_date' ? '云端已是最新' : (row.status === 'pulled' ? classroomName + ' 已从云端更新' : classroomName + ' 已同步到云端'));
                }
                if (row.status === 'pulled') {
                    reloadAfterPull(options || {});
                } else if (options.preflight) {
                    revealClassroomContent();
                }
                return;
            }
            if (row.status === 'conflict') {
                updateSyncMeta(row.sync_meta || row);
                setPillStatus({ state: 'error', text: '云端有冲突', title: row.message || '本地与云端均有修改，请先导出本地副本再处理冲突' });
                showToast('双方修改已保留，请先导出本地副本再处理冲突');
                if (options.preflight) showEntryFailure(row.message || '本地与云端均有修改，请稍后处理冲突。', 'error');
                return;
            }
            setPillStatus({ state: 'error', text: '同步失败，点击重试', title: row.message || '同步失败，点击重试' });
            if (!options.silent) showToast(row.message || '同步失败');
            if (options.preflight) showEntryFailure(row.message || '云同步失败，请重试。', 'error');
        } catch (error) {
            setPillStatus({ state: 'error', text: '同步失败，点击重试', title: (error && error.message) || '同步失败，点击重试' });
            if (!options.silent) showToast((error && error.message) || '同步失败');
            if (options.preflight) showEntryFailure((error && error.message) || '云同步失败，请重试。', 'error');
        }
    }

    function handlePillClick() {
        if (!currentUser || !currentUser.logged_in) {
            CloudManager.openLogin();
            return;
        }
        if (pillButton && pillButton.dataset.state === 'syncing') return;
        if (!syncMeta.backed_up || syncMeta.has_local_changes || (pillButton && (pillButton.dataset.state === 'error' || pillButton.dataset.state === 'offline'))) {
            syncCurrentClass({ force: false, deviceId: 'classroom-manual' }).catch(function (error) {
                var message = (error && error.message) || '同步失败';
                setPillStatus({ state: 'error', text: '同步失败，点击重试', title: message });
                showToast(message);
            });
            return;
        }
        showToast('云端已是最新');
    }

    async function restoreFromCloud() {
        if (!(await ensureLoggedIn(true))) return;
        if (!syncMeta.backed_up || !syncMeta.uuid) {
            showToast('该班级还没有云端记录，请先同步本地数据');
            return;
        }
        if (!await window.showConfirmModal('从云恢复会覆盖本地当前班级 ' + classroomName + '，确定继续？', { title: '从云恢复' })) {
            return;
        }
        showToast('正在恢复...');
        try {
            var pullResult = await CloudManager.pullClassroom(syncMeta.uuid);
            if (pullResult && pullResult.status === 'success') {
                updateSyncMeta(pullResult);
                showToast((pullResult.name || classroomName) + ' 已从云恢复');
                window.location.reload();
                return;
            }
            showToast((pullResult && pullResult.message) || '恢复失败');
        } catch (err) {
            showToast((err && err.message) || '恢复失败');
        }
    }

    window.FuckSeatsCloudSync = {
        update: updateSyncMeta,
        syncAfterLogin: function (loginResult) {
            return CloudManager.getUserInfo(true, { refreshSubscription: false }).then(function (user) {
                currentUser = user || { logged_in: false };
                renderPill();
                var rows = loginResult && Array.isArray(loginResult.results) ? loginResult.results : [];
                var matched = null;
                for (var i = 0; i < rows.length; i++) {
                    if (Number(rows[i].classroom_id || 0) === Number(classroomId)) {
                        matched = rows[i];
                        break;
                    }
                }
                if (matched && (matched.status === 'ok' || matched.status === 'up_to_date' || matched.status === 'pulled')) {
                    updateSyncMeta(matched.sync_meta || matched);
                    if (matched.status === 'pulled') {
                        reloadAfterPull({ auto: true });
                    }
                    return null;
                }
                if (matched && matched.status === 'conflict') {
                    updateSyncMeta(matched.sync_meta || matched);
                    setPillStatus({ state: 'error', text: '云端有冲突', title: matched.message || '本地与云端均有修改，请先导出本地副本再处理冲突' });
                    return null;
                }
                return syncCurrentClass({ auto: true, silent: true, deviceId: 'classroom-login' });
            });
        },
        markDirty: function () {
            if (!syncMeta.backed_up) return;
            syncMeta.last_operation_at = new Date().toISOString();
            syncMeta.has_local_changes = true;
            syncMeta.state = 'dirty';
            renderPill();
        },
    };

    var cloudManagerWaitStartedAt = Date.now();
    var CLOUD_MANAGER_WAIT_LIMIT_MS = 15000;

    function startCloudHeader() {
        if (!window.CloudManager) {
            // 等待超过 15 秒说明 cloud.js 加载失败，放行本地数据，避免云班级永久停留在遮罩。
            if (Date.now() - cloudManagerWaitStartedAt >= CLOUD_MANAGER_WAIT_LIMIT_MS) {
                revealClassroomContent();
                return;
            }
            setTimeout(startCloudHeader, 50);
            return;
        }
        var shouldGate = shouldGateCloudEntry();
        if (!shouldGate) {
            revealClassroomContent();
        }
        var preflight = shouldGate
            ? CloudManager.prepareEntrySync({ promptOffline: false })
            : CloudManager.getUserInfo(false, { refreshSubscription: false }).then(function(user) {
                return { shouldSync: false, reason: 'local_classroom', user: user };
            });
        preflight.then(function (context) {
            var user = context && context.user ? context.user : { logged_in: false };
            headerArea.innerHTML = '';
            syncMeta = normalizeSyncMeta(syncMeta);
            headerArea.appendChild(buildCloudHeader(user));
            if (user && user.logged_in && syncMeta.backed_up && !autoOpenSyncStarted && shouldGate) {
                autoOpenSyncStarted = true;
                setCloudEntryStatus('正在检查网络', '检测到这是云班级，进入前先确认联网状态。', 'syncing');
                if (!context.shouldSync && context.reason === 'offline') {
                    showEntryFailure('当前系统未检测到可用网络，是否仍要继续尝试云同步？', 'offline');
                    return;
                }
                syncCurrentClass({ auto: true, silent: true, preflight: true, deviceId: 'classroom-entry' });
            } else {
                revealClassroomContent();
            }
        }).catch(function () {
            revealClassroomContent();
        });
    }

    if (entryRetryButton) entryRetryButton.addEventListener('click', function() {
        syncCurrentClass({ auto: true, silent: true, preflight: true, deviceId: 'classroom-entry-retry' });
    });
    if (entryLocalButton) entryLocalButton.addEventListener('click', useLocalClassroom);

    startCloudHeader();
})();
