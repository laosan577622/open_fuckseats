document.addEventListener('DOMContentLoaded', () => {
    const themePicker = document.getElementById('theme-picker');
    const themeStatus = document.getElementById('theme-status');

    if (themePicker && window.ThemeManager) {
        const themes = ThemeManager.THEMES;
        const currentId = ThemeManager.getThemeId();

        themePicker.setAttribute('role', 'radiogroup');
        themePicker.setAttribute('aria-label', '主题色');

        const selectTheme = (theme, originX, originY) => {
            ThemeManager.setTheme(theme.id, originX, originY);
            const cards = themePicker.querySelectorAll('.theme-card');
            cards.forEach((c) => {
                const isActive = c.getAttribute('data-theme-id') === theme.id;
                c.classList.toggle('active', isActive);
                c.setAttribute('aria-checked', isActive ? 'true' : 'false');
                c.tabIndex = isActive ? 0 : -1;
            });
            if (themeStatus) themeStatus.textContent = theme.name;
            if (typeof showToast === 'function') {
                showToast('已切换为「' + theme.name + '」');
            }
        };

        const themeList = Object.values(themes);
        themeList.forEach((theme) => {
            const card = document.createElement('div');
            card.className = 'theme-card' + (theme.id === currentId ? ' active' : '');
            card.setAttribute('data-theme-id', theme.id);
            card.setAttribute('role', 'radio');
            card.setAttribute('aria-checked', theme.id === currentId ? 'true' : 'false');
            card.tabIndex = theme.id === currentId ? 0 : -1;
            card.style.setProperty('--tc-color', theme.color);
            card.style.setProperty('--tc-color-rgb', theme.colorRgb);
            card.innerHTML =
                '<div class="theme-card-header">' +
                    '<div class="theme-card-swatch"></div>' +
                    '<span class="theme-card-title">' + theme.name + '</span>' +
                '</div>' +
                '<span class="theme-card-desc">' + theme.description + '</span>';
            card.addEventListener('click', (event) => {
                const rect = card.getBoundingClientRect();
                selectTheme(theme, rect.left + rect.width / 2, rect.top + rect.height / 2);
            });
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const rect = card.getBoundingClientRect();
                    selectTheme(theme, rect.left + rect.width / 2, rect.top + rect.height / 2);
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const cards = Array.from(themePicker.querySelectorAll('.theme-card'));
                    const currentIndex = cards.indexOf(card);
                    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                    const nextIndex = (currentIndex + (forward ? 1 : -1) + cards.length) % cards.length;
                    cards[nextIndex].focus();
                }
            });
            themePicker.appendChild(card);
        });

        if (themeStatus) themeStatus.textContent = themes[currentId].name;
    }

    const SHIFT_USE_LARGE_GROUPS_KEY = 'seats_shift_use_large_groups';
    const GROUP_MOVE_MODE_KEY = 'seats_group_move_mode';
    const SHOW_LAYOUT_SUGGESTIONS_KEY = 'seats_show_layout_suggestions';
    const SHOW_GROUP_COMPLETION_SUGGESTION_KEY = 'seats_show_group_completion_suggestion';
    const checkBtn = document.getElementById('manual-check-update-btn');
    const checkBtnOriginalHtml = checkBtn ? checkBtn.innerHTML : '';
    const checkBtnSpinnerHtml = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><path d="M12.79 8.64Q12.41 8.3 11.9 8.3Q11.4 8.3 11.06 8.66L6.05 13.68Q5.74 13.97 5.86 14.35Q5.98 14.74 6.35 14.88Q6.72 15.02 7.06 14.69L11.93 9.82L16.78 14.66Q17.09 14.98 17.46 14.84Q17.83 14.71 17.96 14.34Q18.1 13.97 17.78 13.66L12.79 8.64Z" fill="currentColor"/><path d="M12 2.5Q14.57 2.5 16.75 3.78Q18.94 5.06 20.22 7.25Q21.5 9.43 21.5 12Q21.5 14.57 20.22 16.75Q18.94 18.94 16.75 20.22Q14.57 21.5 12 21.5Q9.43 21.5 7.25 20.22Q5.06 18.94 3.78 16.75Q2.5 14.57 2.5 12Q2.5 9.43 3.78 7.25Q5.06 5.06 7.25 3.78Q9.43 2.5 12 2.5ZM12 1.01Q9 1.01 6.48 2.48Q3.96 3.96 2.48 6.48Q1.01 9 1.01 12Q1.01 14.98 2.48 17.51Q3.96 20.04 6.49 21.52Q9.02 22.99 12 22.99Q14.98 22.99 17.51 21.52Q20.04 20.04 21.52 17.51Q22.99 14.98 22.99 12Q22.99 9 21.52 6.48Q20.04 3.96 17.52 2.48Q15 1.01 12 1.01Z" fill="currentColor" fill-opacity="0.85"/></svg>检查中...';
    const groupMoveModeInputs = Array.from(document.querySelectorAll('input[name="group_move_mode"]'));
    const groupMoveModeStatus = document.getElementById('group-move-mode-status');
    const shiftUseLargeGroupsToggle = document.getElementById('settings-shift-use-large-groups-toggle');
    const shiftUseLargeGroupsStatus = document.getElementById('shift-use-large-groups-status');
    const showLayoutSuggestionsToggle = document.getElementById('settings-show-layout-suggestions-toggle');
    const showLayoutSuggestionsStatus = document.getElementById('show-layout-suggestions-status');
    const showGroupCompletionSuggestionToggle = document.getElementById('settings-show-group-completion-suggestion-toggle');
    const showGroupCompletionSuggestionStatus = document.getElementById('show-group-completion-suggestion-status');
    const GROUP_MOVE_MODE_FOLLOW = 'follow';
    const GROUP_MOVE_MODE_FIXED = 'fixed';

    const normalizeGroupMoveMode = (value) => (
        String(value || '').trim().toLowerCase() === GROUP_MOVE_MODE_FOLLOW
            ? GROUP_MOVE_MODE_FOLLOW
            : GROUP_MOVE_MODE_FIXED
    );

    const getGroupMoveModeText = (mode) => (
        mode === GROUP_MOVE_MODE_FOLLOW ? '组随人动' : '组定人动'
    );

    const syncGroupMoveModeUi = () => {
        const currentMode = normalizeGroupMoveMode(localStorage.getItem(GROUP_MOVE_MODE_KEY));
        groupMoveModeInputs.forEach((input) => {
            input.checked = input.value === currentMode;
        });
        if (groupMoveModeStatus) {
            groupMoveModeStatus.textContent = getGroupMoveModeText(currentMode);
        }
    };

    const syncShiftUseLargeGroupsUi = () => {
        if (!shiftUseLargeGroupsToggle || !shiftUseLargeGroupsStatus) return;
        const enabled = localStorage.getItem(SHIFT_USE_LARGE_GROUPS_KEY) !== '0';
        shiftUseLargeGroupsToggle.checked = enabled;
        shiftUseLargeGroupsStatus.textContent = enabled ? '按大组移动' : '按列独立移动';
    };

    syncGroupMoveModeUi();
    groupMoveModeInputs.forEach((input) => {
        input.addEventListener('change', () => {
            if (!input.checked) return;
            const currentMode = normalizeGroupMoveMode(input.value);
            localStorage.setItem(GROUP_MOVE_MODE_KEY, currentMode);
            syncGroupMoveModeUi();
            if (typeof showToast === 'function') {
                showToast(currentMode === GROUP_MOVE_MODE_FOLLOW ? '已切换为组随人动' : '已切换为组定人动');
            }
        });
    });

    if (shiftUseLargeGroupsToggle) {
        syncShiftUseLargeGroupsUi();
        shiftUseLargeGroupsToggle.addEventListener('change', () => {
            localStorage.setItem(SHIFT_USE_LARGE_GROUPS_KEY, shiftUseLargeGroupsToggle.checked ? '1' : '0');
            syncShiftUseLargeGroupsUi();
            if (typeof showToast === 'function') {
                showToast(shiftUseLargeGroupsToggle.checked ? '已默认按大组移动' : '已默认按列独立移动');
            }
        });
    }

    const syncSuggestionPreferenceUi = (toggle, status, key) => {
        if (!toggle || !status) return;
        const enabled = localStorage.getItem(key) !== '0';
        toggle.checked = enabled;
        status.textContent = enabled ? '已开启' : '已关闭';
    };

    const bindSuggestionPreference = (toggle, status, key, enabledMessage, disabledMessage) => {
        if (!toggle || !status) return;
        syncSuggestionPreferenceUi(toggle, status, key);
        toggle.addEventListener('change', () => {
            localStorage.setItem(key, toggle.checked ? '1' : '0');
            syncSuggestionPreferenceUi(toggle, status, key);
            if (typeof showToast === 'function') {
                showToast(toggle.checked ? enabledMessage : disabledMessage);
            }
        });
    };

    bindSuggestionPreference(
        showLayoutSuggestionsToggle,
        showLayoutSuggestionsStatus,
        SHOW_LAYOUT_SUGGESTIONS_KEY,
        '已开启优化建议',
        '已关闭优化建议'
    );
    bindSuggestionPreference(
        showGroupCompletionSuggestionToggle,
        showGroupCompletionSuggestionStatus,
        SHOW_GROUP_COMPLETION_SUGGESTION_KEY,
        '已开启分组完成提示',
        '已关闭分组完成提示'
    );

    window.addEventListener('storage', (event) => {
        if (event.key === SHOW_LAYOUT_SUGGESTIONS_KEY) {
            syncSuggestionPreferenceUi(showLayoutSuggestionsToggle, showLayoutSuggestionsStatus, SHOW_LAYOUT_SUGGESTIONS_KEY);
        }
        if (event.key === SHOW_GROUP_COMPLETION_SUGGESTION_KEY) {
            syncSuggestionPreferenceUi(showGroupCompletionSuggestionToggle, showGroupCompletionSuggestionStatus, SHOW_GROUP_COMPLETION_SUGGESTION_KEY);
        }
    });

    if (checkBtn) checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.innerHTML = checkBtnSpinnerHtml;

        try {
            if (typeof window.checkForUpdates !== 'function') {
                throw new Error('更新组件尚未准备完成，请重新打开应用');
            }
            await window.checkForUpdates();
        } catch (error) {
            showToast('检查更新失败：' + (error && error.message || String(error)));
            console.error('Update check error:', error);
        } finally {
            checkBtn.disabled = false;
            checkBtn.innerHTML = checkBtnOriginalHtml;
        }
    });

    const localUpdateBtn = document.getElementById('local-update-package-btn');
    if (localUpdateBtn) localUpdateBtn.addEventListener('click', async () => {
        localUpdateBtn.disabled = true;
        try {
            if (typeof window.selectLocalMacUpdate !== 'function') {
                throw new Error('本地升级组件尚未准备完成');
            }
            await window.selectLocalMacUpdate();
        } catch (error) {
            showToast(error && error.message ? error.message : '无法选择升级包');
        } finally {
            localUpdateBtn.disabled = false;
        }
    });

    var cloudSettingsWaitStart = Date.now();
    (function initCloudSettings() {
        if (!window.CloudManager) {
            // 等待超过 15 秒说明 cloud.js 加载失败，放弃初始化，避免无限空转。
            if (Date.now() - cloudSettingsWaitStart < 15000) setTimeout(initCloudSettings, 80);
            return;
        }
        const notLoggedIn = document.getElementById('cloud-not-logged-in');
        const loggedIn = document.getElementById('cloud-logged-in');
        const loginBtn = document.getElementById('cloud-login-btn');
        const logoutBtn = document.getElementById('cloud-logout-btn');
        const refreshSubBtn = document.getElementById('cloud-refresh-sub-btn');
        const saveUrlBtn = document.getElementById('cloud-save-url-btn');
        const resetUrlBtn = document.getElementById('cloud-reset-url-btn');
        const urlInput = document.getElementById('cloud-server-url-input');
        const cloudClassroomList = document.getElementById('cloud-classroom-list');
        const cloudClassroomUsage = document.getElementById('cloud-classroom-usage');
        const cloudClassroomRefreshBtn = document.getElementById('cloud-classroom-refresh-btn');
        const cloudClassroomAddBtn = document.getElementById('cloud-classroom-add-btn');
        const addModal = document.getElementById('cloud-classroom-add-modal');
        const addLocalList = document.getElementById('cloud-manager-local-list');
        const addConfirmBtn = document.getElementById('cloud-manager-add-confirm');
        const deleteModal = document.getElementById('cloud-classroom-delete-modal');
        const deleteMessage = document.getElementById('cloud-classroom-delete-message');
        const deleteConfirmBtn = document.getElementById('cloud-manager-delete-confirm');
        const localOpenAPIStatus = document.getElementById('local-open-api-status');
        const localOpenAPIEndpoint = document.getElementById('local-open-api-endpoint');
        const localOpenAPIGenerateBtn = document.getElementById('local-open-api-generate-btn');
        const localOpenAPIRevokeBtn = document.getElementById('local-open-api-revoke-btn');
        const localOpenAPIKeyPanel = document.getElementById('local-open-api-key-panel');
        const localOpenAPIKeyValue = document.getElementById('local-open-api-key-value');
        const localOpenAPICopyBtn = document.getElementById('local-open-api-copy-btn');
        const DEFAULT_CLOUD_URL = 'https://fuckseatsapi.577622.xyz';
        let currentCloudUser = null;
        let currentCloudStatus = null;
        let pendingDeleteClassroom = null;
        let addShowingResults = false;

        var loginIcon = document.querySelector('[data-cloud-settings-login-icon]');
        if (loginIcon) loginIcon.innerHTML = CloudManager.getLoginIconMarkup();

        function formatDate(iso) {
            if (!iso) return '永久';
            var d = new Date(iso);
            return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        }

        function formatDateTime(iso) {
            if (!iso) return '暂无同步时间';
            var d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '暂无同步时间';
            return d.toLocaleString('zh-CN', { hour12: false });
        }

        function showManagerModal(modal, popupId) {
            if (!modal) return;
            var show = function() {
                modal.style.display = 'flex';
                modal.setAttribute('aria-hidden', 'false');
                var focusTarget = modal.querySelector('button');
                if (focusTarget) focusTarget.focus();
            };
            if (window.PopupManager) PopupManager.request(popupId, show);
            else show();
        }

        function hideManagerModal(modal, popupId) {
            if (!modal) return;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            if (window.PopupManager) PopupManager.notifyDismissed(popupId);
        }

        [addModal, deleteModal].forEach(function(modal) {
            if (!modal) return;
            var popupId = modal === deleteModal ? 'cloud-classroom-delete' : 'cloud-classroom-add';
            modal.addEventListener('click', function(event) {
                if (event.target === modal) hideManagerModal(modal, popupId);
            });
        });
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') return;
            [addModal, deleteModal].forEach(function(modal) {
                if (modal && modal.style.display !== 'none' && modal.getAttribute('aria-hidden') === 'false') {
                    hideManagerModal(modal, modal === deleteModal ? 'cloud-classroom-delete' : 'cloud-classroom-add');
                }
            });
        });

        function buildCloudClassroomButton(text, className, handler) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn cloud-small-btn ' + className;
            button.textContent = text;
            button.addEventListener('click', handler);
            return button;
        }

        function renderLocalOpenAPIState(data) {
            if (!localOpenAPIStatus) return;
            var enabled = !!(data && data.enabled);
            localOpenAPIStatus.textContent = enabled
                ? ('已授权 · ' + (data.key_prefix || 'Key 已生成') + '...')
                : '尚未授权';
            if (localOpenAPIEndpoint) {
                localOpenAPIEndpoint.hidden = !(data && data.endpoint);
                localOpenAPIEndpoint.textContent = data && data.endpoint ? ('接口地址：' + data.endpoint) : '';
            }
            if (localOpenAPIGenerateBtn) localOpenAPIGenerateBtn.textContent = enabled ? '重新生成 Key' : '生成 Key';
            if (localOpenAPIRevokeBtn) localOpenAPIRevokeBtn.hidden = !enabled;
        }

        async function loadLocalOpenAPIState() {
            if (!localOpenAPIStatus || !window.CloudManager || !CloudManager.getLocalOpenAPIKeyStatus) return;
            localOpenAPIStatus.textContent = '正在读取授权状态...';
            try {
                renderLocalOpenAPIState(await CloudManager.getLocalOpenAPIKeyStatus());
            } catch (error) {
                localOpenAPIStatus.textContent = '授权状态读取失败';
            }
        }

        var settingsApp = document.querySelector('.settings-app');
        var classroomDetailUrlTemplate = settingsApp ? settingsApp.dataset.classroomDetailUrl || '' : '';
        function localClassroomDetailUrl(row) {
            if (row.local_detail_url) return row.local_detail_url;
            return classroomDetailUrlTemplate.replace('/0/', '/' + row.local_classroom_id + '/');
        }

        function renderCloudClassrooms(status) {
            currentCloudStatus = status || { local: [], remote: { classrooms: [] } };
            var localRows = Array.isArray(currentCloudStatus.local) ? currentCloudStatus.local : [];
            var remoteRows = currentCloudStatus.remote && Array.isArray(currentCloudStatus.remote.classrooms)
                ? currentCloudStatus.remote.classrooms : [];
            var maxClassrooms = currentCloudUser && currentCloudUser.limits
                ? Number(currentCloudUser.limits.max_classrooms) : 0;
            if (cloudClassroomUsage) {
                cloudClassroomUsage.textContent = maxClassrooms === -1
                    ? ('云端 ' + remoteRows.length + ' 个班级 · 套餐不限数量')
                    : ('云端 ' + remoteRows.length + ' / ' + (maxClassrooms || 0) + ' 个班级');
            }
            if (!cloudClassroomList) return;
            cloudClassroomList.innerHTML = '';
            if (!remoteRows.length) {
                var empty = document.createElement('div');
                empty.className = 'cloud-classroom-empty';
                empty.innerHTML = '<strong>云端还没有班级</strong><span>点击“添加班级”选择本地班级上传。</span>';
                cloudClassroomList.appendChild(empty);
                return;
            }

            remoteRows.forEach(function(row) {
                var card = document.createElement('article');
                card.className = 'cloud-classroom-row';

                var main = document.createElement('div');
                main.className = 'cloud-classroom-main';
                var titleLine = document.createElement('div');
                titleLine.className = 'cloud-classroom-title-line';
                var title = document.createElement('strong');
                title.textContent = row.name || '未命名班级';
                var state = document.createElement('span');
                state.className = 'cloud-classroom-state ' + (row.local_classroom_id ? 'is-local' : 'is-remote');
                state.textContent = row.local_classroom_id ? '已在本地' : '仅云端';
                titleLine.appendChild(title);
                titleLine.appendChild(state);
                var meta = document.createElement('span');
                meta.className = 'cloud-classroom-meta';
                meta.textContent = (row.rows || '--') + ' × ' + (row.cols || '--') + ' 座位网格 · 版本 ' + (row.version || 0) + ' · ' + formatDateTime(row.last_operation_at || row.updated_at);
                main.appendChild(titleLine);
                main.appendChild(meta);

                var actions = document.createElement('div');
                actions.className = 'cloud-classroom-actions';
                if (row.local_classroom_id) {
                    actions.appendChild(buildCloudClassroomButton('查看本地', 'btn-secondary', function() {
                        window.location.href = localClassroomDetailUrl(row);
                    }));
                } else {
                    actions.appendChild(buildCloudClassroomButton('下载到本地', 'btn-primary', async function(event) {
                        var button = event.currentTarget;
                        button.disabled = true;
                        button.textContent = '下载中...';
                        try {
                            var result = await CloudManager.pullClassroom(row.uuid);
                            showToast((result && result.name ? result.name : row.name) + ' 已下载到本地');
                            await loadCloudClassrooms();
                        } catch (error) {
                            showToast('下载失败：' + ((error && error.message) || '网络错误'));
                        } finally {
                            button.disabled = false;
                            button.textContent = '下载到本地';
                        }
                    }));
                }
                actions.appendChild(buildCloudClassroomButton('删除云端副本', 'btn-secondary cloud-classroom-delete-btn', function() {
                    pendingDeleteClassroom = row;
                    if (deleteMessage) {
                        deleteMessage.textContent = row.local_classroom_id
                            ? '只删除“' + row.name + '”的云端副本。本地班级会保留，并停止自动同步。'
                            : '确定删除云端班级“' + row.name + '”？当前设备没有它的本地副本。';
                    }
                    showManagerModal(deleteModal, 'cloud-classroom-delete');
                }));

                card.appendChild(main);
                card.appendChild(actions);
                cloudClassroomList.appendChild(card);
            });
        }

        async function loadCloudClassrooms() {
            if (!cloudClassroomList || !currentCloudUser || !currentCloudUser.logged_in) return;
            cloudClassroomList.innerHTML = '<div class="cloud-classroom-loading"><span class="cloud-login-spinner"></span><span>正在读取云端班级...</span></div>';
            if (cloudClassroomRefreshBtn) cloudClassroomRefreshBtn.disabled = true;
            if (cloudClassroomAddBtn) cloudClassroomAddBtn.disabled = true;
            try {
                var status = await CloudManager.getSyncStatus();
                renderCloudClassrooms(status);
            } catch (error) {
                currentCloudStatus = null;
                cloudClassroomList.innerHTML = '';
                var failed = document.createElement('div');
                failed.className = 'cloud-classroom-empty cloud-classroom-error';
                var message = document.createElement('strong');
                message.textContent = '云班级读取失败';
                var detail = document.createElement('span');
                detail.textContent = (error && error.message) || '请检查网络后重试';
                var retry = buildCloudClassroomButton('重新加载', 'btn-primary', loadCloudClassrooms);
                failed.appendChild(message);
                failed.appendChild(detail);
                failed.appendChild(retry);
                cloudClassroomList.appendChild(failed);
            } finally {
                if (cloudClassroomRefreshBtn) cloudClassroomRefreshBtn.disabled = false;
                if (cloudClassroomAddBtn) cloudClassroomAddBtn.disabled = !currentCloudStatus;
            }
        }

        function openAddClassroomModal() {
            if (!currentCloudStatus) return;
            var remoteRows = currentCloudStatus.remote && Array.isArray(currentCloudStatus.remote.classrooms)
                ? currentCloudStatus.remote.classrooms : [];
            var maxClassrooms = currentCloudUser && currentCloudUser.limits
                ? Number(currentCloudUser.limits.max_classrooms) : 0;
            var availableSlots = maxClassrooms === -1 ? Infinity : Math.max(0, maxClassrooms - remoteRows.length);
            var remoteUuids = new Set(remoteRows.map(function(row) { return String(row.uuid || ''); }));
            var candidates = (currentCloudStatus.local || []).filter(function(row) {
                return !row.backed_up && !remoteUuids.has(String(row.uuid || ''));
            });
            addLocalList.innerHTML = '';
            addShowingResults = false;
            addConfirmBtn.textContent = '上传所选班级';
            if (availableSlots <= 0) {
                addLocalList.innerHTML = '<div class="cloud-classroom-empty"><strong>云班级数量已达套餐上限</strong><span>请先删除不需要的云端副本，或升级套餐后再添加。</span></div>';
                addConfirmBtn.disabled = true;
            } else if (!candidates.length) {
                addLocalList.innerHTML = '<div class="cloud-classroom-empty"><strong>没有可添加的本地班级</strong><span>所有本地班级都已建立云同步关系。</span></div>';
                addConfirmBtn.disabled = true;
            } else {
                candidates.forEach(function(row) {
                    var label = document.createElement('label');
                    label.className = 'cloud-manager-local-option';
                    label.dataset.classroomId = String(row.classroom_id);
                    var checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = row.classroom_id;
                    checkbox.addEventListener('change', function() {
                        var selectedCount = addLocalList.querySelectorAll('input:checked').length;
                        if (checkbox.checked && selectedCount > availableSlots) {
                            checkbox.checked = false;
                            showToast('当前套餐本次最多还能添加 ' + availableSlots + ' 个云班级');
                        }
                        addConfirmBtn.disabled = !addLocalList.querySelector('input:checked');
                    });
                    var copy = document.createElement('span');
                    copy.className = 'cloud-manager-local-copy';
                    var name = document.createElement('strong');
                    name.textContent = row.name || '未命名班级';
                    var meta = document.createElement('span');
                    meta.textContent = row.rows + ' × ' + row.cols + ' 座位网格 · ' + (row.student_count || 0) + ' 名学生';
                    copy.appendChild(name);
                    copy.appendChild(meta);
                    label.appendChild(checkbox);
                    label.appendChild(copy);
                    addLocalList.appendChild(label);
                });
                addConfirmBtn.disabled = true;
            }
            showManagerModal(addModal, 'cloud-classroom-add');
        }

        function renderCloudUI(data) {
            currentCloudUser = data || { logged_in: false };
            var connectionErrorText = document.getElementById('cloud-connection-error-text');
            if (connectionErrorText) connectionErrorText.hidden = !(data && data.connection_error);
            if (data.logged_in) {
                notLoggedIn.style.display = 'none';
                loggedIn.style.display = 'block';
                var avatarWrap = document.getElementById('cloud-avatar-wrap');
                avatarWrap.innerHTML = '';
                if (data.avatar_url) {
                    var avatarImg = document.createElement('img');
                    avatarImg.src = data.avatar_url;
                    avatarImg.className = 'cloud-settings-avatar';
                    avatarImg.alt = '';
                    avatarWrap.appendChild(avatarImg);
                } else {
                    avatarWrap.innerHTML = '<div class="cloud-settings-avatar cloud-settings-avatar-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z" fill="currentColor"/></svg></div>';
                }
                document.getElementById('cloud-nickname').textContent = data.nickname || '用户';
                document.getElementById('cloud-email').textContent = data.email || '';
                document.getElementById('cloud-tier-badge').textContent = data.tier_display || '免费版';
                var tierBadge = document.getElementById('cloud-tier-badge');
                tierBadge.className = 'cloud-tier-badge cloud-tier-' + (data.tier || 'free');
                var expiresText = document.getElementById('cloud-expires-text');
                if (data.tier === 'free') {
                    expiresText.textContent = '当前为免费版';
                } else {
                    expiresText.textContent = data.expires_at ? formatDate(data.expires_at) : '永久有效';
                }
                loadLocalOpenAPIState();
            } else {
                notLoggedIn.style.display = 'block';
                loggedIn.style.display = 'none';
                currentCloudStatus = null;
                if (localOpenAPIStatus) localOpenAPIStatus.textContent = '登录后可生成 Key';
                if (localOpenAPIKeyPanel) localOpenAPIKeyPanel.hidden = true;
            }
            if (data.cloud_server_url && urlInput) {
                urlInput.value = data.cloud_server_url;
            }
        }

        CloudManager.getUserInfo(true).then(function(data) {
            renderCloudUI(data);
            if (data && data.logged_in) loadCloudClassrooms();
        });

        if (loginBtn) loginBtn.addEventListener('click', async function() {
            loginBtn.disabled = true;
            try {
                await CloudManager.openLogin();
                var user = await CloudManager.getUserInfo(true);
                renderCloudUI(user);
                if (user && user.logged_in) await loadCloudClassrooms();
            } finally {
                loginBtn.disabled = false;
            }
        });

        window.addEventListener('cloud-login-sync-complete', async function() {
            var user = await CloudManager.getUserInfo(true);
            renderCloudUI(user);
            await loadCloudClassrooms();
        });

        if (logoutBtn) logoutBtn.addEventListener('click', async function() {
            logoutBtn.disabled = true;
            try {
                await CloudManager.logout();
                if (typeof showToast === 'function') showToast('已退出云服务');
                renderCloudUI({ logged_in: false });
            } catch (error) {
                if (typeof showToast === 'function') showToast('退出失败：' + ((error && error.message) || '网络错误'));
            } finally {
                logoutBtn.disabled = false;
            }
        });

        if (localOpenAPIGenerateBtn) localOpenAPIGenerateBtn.addEventListener('click', async function() {
            var rotating = localOpenAPIRevokeBtn && !localOpenAPIRevokeBtn.hidden;
            if (rotating && !(await window.showConfirmModal('重新生成会立即停用旧 Key，确定继续吗？', { title: '重新生成 Key' }))) return;
            localOpenAPIGenerateBtn.disabled = true;
            localOpenAPIGenerateBtn.textContent = rotating ? '重新生成中...' : '生成中...';
            try {
                var result = await CloudManager.generateLocalOpenAPIKey();
                renderLocalOpenAPIState(result);
                if (localOpenAPIKeyValue) localOpenAPIKeyValue.value = result.key || '';
                if (localOpenAPIKeyPanel) localOpenAPIKeyPanel.hidden = !result.key;
                if (typeof showToast === 'function') showToast(rotating ? '新 Key 已生成，旧 Key 已停用' : '已授权服务器本机 API');
            } catch (error) {
                if (typeof showToast === 'function') showToast('生成失败：' + ((error && error.message) || '网络错误'));
            } finally {
                localOpenAPIGenerateBtn.disabled = false;
                localOpenAPIGenerateBtn.textContent = (localOpenAPIRevokeBtn && !localOpenAPIRevokeBtn.hidden) ? '重新生成 Key' : '生成 Key';
            }
        });

        if (localOpenAPIRevokeBtn) localOpenAPIRevokeBtn.addEventListener('click', async function() {
            if (!(await window.showConfirmModal('撤销后，使用当前 Key 的服务器本机程序会立即失去访问权限。确定撤销吗？', { title: '撤销 Key', okText: '撤销', danger: true }))) return;
            localOpenAPIRevokeBtn.disabled = true;
            try {
                var result = await CloudManager.revokeLocalOpenAPIKey();
                renderLocalOpenAPIState(result);
                if (localOpenAPIKeyValue) localOpenAPIKeyValue.value = '';
                if (localOpenAPIKeyPanel) localOpenAPIKeyPanel.hidden = true;
                if (typeof showToast === 'function') showToast('服务器本机 API 授权已撤销');
            } catch (error) {
                if (typeof showToast === 'function') showToast('撤销失败：' + ((error && error.message) || '网络错误'));
            } finally {
                localOpenAPIRevokeBtn.disabled = false;
            }
        });

        if (localOpenAPICopyBtn) localOpenAPICopyBtn.addEventListener('click', async function() {
            var value = localOpenAPIKeyValue ? localOpenAPIKeyValue.value : '';
            if (!value) return;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(value);
                } else {
                    localOpenAPIKeyValue.focus();
                    localOpenAPIKeyValue.select();
                    document.execCommand('copy');
                    localOpenAPIKeyValue.setSelectionRange(0, 0);
                }
                if (typeof showToast === 'function') showToast('Key 已复制');
            } catch (error) {
                if (typeof showToast === 'function') showToast('复制失败，请手动复制');
            }
        });

        if (cloudClassroomRefreshBtn) cloudClassroomRefreshBtn.addEventListener('click', loadCloudClassrooms);
        if (cloudClassroomAddBtn) cloudClassroomAddBtn.addEventListener('click', openAddClassroomModal);
        document.querySelectorAll('[data-cloud-manager-add-close]').forEach(function(button) {
            button.addEventListener('click', function() { hideManagerModal(addModal, 'cloud-classroom-add'); });
        });
        if (addConfirmBtn) addConfirmBtn.addEventListener('click', async function() {
            if (addShowingResults) {
                hideManagerModal(addModal, 'cloud-classroom-add');
                addShowingResults = false;
                return;
            }
            var selected = Array.from(addLocalList.querySelectorAll('input:checked')).map(function(input) { return Number(input.value); });
            if (!selected.length) return;
            var selectedNames = {};
            selected.forEach(function(classroomId) {
                var option = addLocalList.querySelector('[data-classroom-id="' + classroomId + '"]');
                var name = option && option.querySelector('strong');
                selectedNames[classroomId] = name ? name.textContent : ('班级 ' + classroomId);
            });
            addConfirmBtn.disabled = true;
            addConfirmBtn.textContent = '上传中...';
            try {
                var result = await CloudManager.sync(selected, { deviceId: 'cloud-manager-add' });
                var rows = result && Array.isArray(result.results) ? result.results : [];
                var failed = rows.filter(function(row) { return row.status !== 'ok' && row.status !== 'up_to_date'; });
                showToast(failed.length ? ('已上传 ' + (rows.length - failed.length) + ' 个，' + failed.length + ' 个失败') : ('已添加 ' + rows.length + ' 个云班级'));
                addLocalList.innerHTML = '';
                selected.forEach(function(classroomId) {
                    var row = rows.find(function(item) { return Number(item.classroom_id) === classroomId; });
                    var resultItem = document.createElement('div');
                    var succeeded = row && (row.status === 'ok' || row.status === 'up_to_date');
                    resultItem.className = 'cloud-manager-upload-result ' + (succeeded ? 'is-success' : 'is-error');
                    var copy = document.createElement('span');
                    copy.innerHTML = '<strong></strong><small></small>';
                    copy.querySelector('strong').textContent = selectedNames[classroomId];
                    copy.querySelector('small').textContent = succeeded
                        ? (row.status === 'up_to_date' ? '云端已是最新版本' : '已成功上传到云端')
                        : ((row && row.message) || '上传失败，请稍后重试');
                    var badge = document.createElement('span');
                    badge.className = 'cloud-manager-result-badge';
                    badge.textContent = succeeded ? '成功' : '失败';
                    resultItem.appendChild(copy);
                    resultItem.appendChild(badge);
                    addLocalList.appendChild(resultItem);
                });
                addShowingResults = true;
                addConfirmBtn.disabled = false;
                addConfirmBtn.textContent = '完成';
                await loadCloudClassrooms();
            } catch (error) {
                showToast('添加失败：' + ((error && error.message) || '网络错误'));
            } finally {
                if (!addShowingResults) {
                    addConfirmBtn.disabled = false;
                    addConfirmBtn.textContent = '上传所选班级';
                }
            }
        });

        document.querySelectorAll('[data-cloud-manager-delete-cancel]').forEach(function(button) {
            button.addEventListener('click', function() {
                pendingDeleteClassroom = null;
                hideManagerModal(deleteModal, 'cloud-classroom-delete');
            });
        });
        if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', async function() {
            if (!pendingDeleteClassroom) return;
            deleteConfirmBtn.disabled = true;
            deleteConfirmBtn.textContent = '删除中...';
            try {
                await CloudManager.deleteCloudClassroom(pendingDeleteClassroom.uuid, {
                    detachLocal: true,
                    deviceId: 'cloud-manager',
                });
                showToast('已删除“' + pendingDeleteClassroom.name + '”的云端副本，本地数据已保留');
                pendingDeleteClassroom = null;
                hideManagerModal(deleteModal, 'cloud-classroom-delete');
                await loadCloudClassrooms();
            } catch (error) {
                showToast('删除失败：' + ((error && error.message) || '网络错误'));
            } finally {
                deleteConfirmBtn.disabled = false;
                deleteConfirmBtn.textContent = '删除云端副本';
            }
        });

        if (refreshSubBtn) refreshSubBtn.addEventListener('click', async function() {
            refreshSubBtn.disabled = true;
            refreshSubBtn.textContent = '刷新中...';
            try {
                var data = await CloudManager.refreshSubscription();
                renderCloudUI(data);
                showToast('订阅状态已刷新');
            } catch(e) {
                showToast('刷新失败');
            } finally {
                refreshSubBtn.disabled = false;
                refreshSubBtn.textContent = '刷新订阅';
            }
        });

        if (saveUrlBtn) saveUrlBtn.addEventListener('click', async function() {
            var url = (urlInput.value || '').trim();
            if (!url) { showToast('请输入云服务器地址'); return; }
            if (!/^https?:\/\//i.test(url)) { showToast('地址需以 http:// 或 https:// 开头'); return; }
            saveUrlBtn.disabled = true;
            try {
                await CloudManager.setCloudServerUrl(url);
                showToast('云服务器地址已保存，请重新登录');
                await CloudManager.logout();
                renderCloudUI({ logged_in: false });
            } catch(e) {
                showToast('保存失败：' + ((e && e.message) || '网络错误'));
            } finally {
                saveUrlBtn.disabled = false;
            }
        });

        if (resetUrlBtn) resetUrlBtn.addEventListener('click', async function() {
            urlInput.value = DEFAULT_CLOUD_URL;
            resetUrlBtn.disabled = true;
            try {
                await CloudManager.setCloudServerUrl(DEFAULT_CLOUD_URL);
                showToast('已恢复默认服务器地址，请重新登录');
                await CloudManager.logout();
                renderCloudUI({ logged_in: false });
            } catch(e) {
                showToast('重置失败');
            } finally {
                resetUrlBtn.disabled = false;
            }
        });
    })();

    (function initSubscriptionPlans() {
        var wrap = document.getElementById('subscription-plans-wrap');
        if (!wrap) return;

        var LIMIT_LABELS = {
            max_classrooms: '班级数量',
            sync_enabled: '云同步',
            max_history_steps: '历史记录步数',
            sync_ai_conversations: 'AI 对话同步',
            max_snapshots_per_classroom: '每班快照数',
        };

        var _plansCache = null;

        function formatLimitValue(key, val) {
            if (typeof val === 'boolean') return val;
            if (val === -1 || val === '-1') return '无限';
            if (val === 0 || val === '0') {
                if (key === 'max_history_steps') return '不支持';
                return '0';
            }
            return String(val);
        }

        function checkSvg() {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>';
        }

        function crossSvg() {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/></svg>';
        }

        function getPlanPurchaseUrl(tierKey) {
            if (_plansCache) {
                var plan = _plansCache.find(function(p) { return p.key === tierKey; });
                if (plan && plan.purchase_url) return Promise.resolve(plan.purchase_url);
            }
            if (window.CloudManager && CloudManager.getPurchaseUrl) {
                return CloudManager.getPurchaseUrl(tierKey).then(function(data) {
                    return data.url || data.purchase_url || '';
                });
            }
            return Promise.resolve('');
        }

        function renderPlans(plans, currentTier) {
            _plansCache = plans;
            if (!plans || !plans.length) {
                wrap.innerHTML = '<div class="subscription-plans-loading"><span>暂无订阅计划</span></div>';
                return;
            }
            var grid = document.createElement('div');
            grid.className = 'subscription-plans-grid';

            var allLimitKeys = [];
            plans.forEach(function(p) {
                Object.keys(p.limits || {}).forEach(function(k) {
                    if (k === 'sync_ai_conversations') return;
                    if (allLimitKeys.indexOf(k) === -1) allLimitKeys.push(k);
                });
            });

            plans.forEach(function(plan) {
                var isCurrent = currentTier && plan.key === currentTier;
                var card = document.createElement('div');
                card.className = 'plan-card' + (isCurrent ? ' plan-card-current' : '');

                if (isCurrent) {
                    var badge = document.createElement('span');
                    badge.className = 'plan-card-badge plan-card-badge-current';
                    badge.textContent = '当前';
                    card.appendChild(badge);
                }

                var header = document.createElement('div');
                header.className = 'plan-card-header';
                var planName = document.createElement('div');
                planName.className = 'plan-card-name';
                planName.textContent = plan.display_name || plan.key;
                header.appendChild(planName);
                if (plan.description) {
                    var planDesc = document.createElement('div');
                    planDesc.className = 'plan-card-desc';
                    planDesc.textContent = plan.description;
                    header.appendChild(planDesc);
                }
                if (plan.price) {
                    var planPrice = document.createElement('div');
                    planPrice.className = 'plan-card-price';
                    planPrice.textContent = plan.price;
                    header.appendChild(planPrice);
                }
                card.appendChild(header);

                var limitsWrap = document.createElement('div');
                limitsWrap.className = 'plan-card-limits';
                allLimitKeys.forEach(function(key) {
                    var val = plan.limits[key];
                    var label = LIMIT_LABELS[key] || key;
                    var isBool = typeof val === 'boolean';
                    var iconClass, iconHtml, text;
                    if (isBool) {
                        iconClass = val ? 'plan-limit-icon-check' : 'plan-limit-icon-cross';
                        iconHtml = val ? checkSvg() : crossSvg();
                        text = label;
                    } else {
                        var formatted = formatLimitValue(key, val);
                        var isNone = formatted === '不支持';
                        iconClass = isNone ? 'plan-limit-icon-cross' : 'plan-limit-icon-check';
                        iconHtml = isNone ? crossSvg() : checkSvg();
                        text = label + '：' + formatted;
                    }
                    var limitRow = document.createElement('div');
                    limitRow.className = 'plan-limit-row';
                    var limitIcon = document.createElement('span');
                    limitIcon.className = 'plan-limit-icon ' + iconClass;
                    limitIcon.innerHTML = iconHtml;
                    var limitText = document.createElement('span');
                    limitText.textContent = text;
                    limitRow.appendChild(limitIcon);
                    limitRow.appendChild(limitText);
                    limitsWrap.appendChild(limitRow);
                });
                card.appendChild(limitsWrap);

                if (isCurrent) {
                    var currentFooter = document.createElement('div');
                    currentFooter.className = 'plan-card-footer';
                    var currentBtn = document.createElement('button');
                    currentBtn.className = 'btn btn-plan-current';
                    currentBtn.type = 'button';
                    currentBtn.textContent = '当前方案';
                    currentFooter.appendChild(currentBtn);
                    card.appendChild(currentFooter);
                } else if (plan.key !== 'free') {
                    var footer = document.createElement('div');
                    footer.className = 'plan-card-footer';
                    var purchaseBtn = document.createElement('button');
                    purchaseBtn.className = 'btn btn-primary plan-purchase-btn';
                    purchaseBtn.type = 'button';
                    purchaseBtn.setAttribute('data-tier', plan.key);
                    purchaseBtn.textContent = '订阅';
                    footer.appendChild(purchaseBtn);
                    card.appendChild(footer);
                }

                grid.appendChild(card);
            });

            wrap.innerHTML = '';
            wrap.appendChild(grid);

            grid.querySelectorAll('.plan-purchase-btn').forEach(function(btn) {
                btn.addEventListener('click', async function() {
                    var tier = btn.getAttribute('data-tier');
                    btn.disabled = true;
                    btn.textContent = '获取中...';
                    try {
                        var url = await getPlanPurchaseUrl(tier);
                        if (url) {
                            if (window.CloudManager && typeof CloudManager.openExternalUrl === 'function') {
                                await CloudManager.openExternalUrl(url);
                            } else {
                                window.open(url, '_blank', 'noopener,noreferrer');
                            }
                        } else {
                            showToast('暂未配置购买地址');
                        }
                    } catch(e) {
                        showToast('获取购买链接失败');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = '订阅';
                    }
                });
            });
        }

        var plansWaitStart = Date.now();
        function loadPlans() {
            if (window.CloudManager && CloudManager.getSubscriptionPlans) {
                CloudManager.getSubscriptionPlans().then(function(data) {
                    renderPlans(data.plans, data.current_tier);
                }).catch(function() {
                    wrap.innerHTML = '<div class="subscription-plans-loading"><span>加载订阅计划失败，请检查网络连接</span></div>';
                });
            } else {
                // 等待超过 15 秒说明依赖脚本加载失败，显示失败提示而不是无限轮询。
                if (Date.now() - plansWaitStart >= 15000) {
                    wrap.innerHTML = '<div class="subscription-plans-loading"><span>加载订阅计划失败，请检查网络连接</span></div>';
                    return;
                }
                setTimeout(loadPlans, 100);
            }
        }

        loadPlans();
    })();

    (function initDataSharingSettings() {
        var toggle = document.getElementById('data-sharing-toggle');
        var statusEl = document.getElementById('data-sharing-status');
        var retentionSelect = document.getElementById('data-sharing-retention');
        if (!toggle || !statusEl) return;

        function updateUI(config) {
            if (!config) return;
            var enabled = !!config.enabled;
            toggle.checked = enabled;
            statusEl.textContent = enabled ? '已开启' : '已关闭';
            if (retentionSelect && (config.local_log_retention_days || config.log_retention_days)) {
                var days = String(config.local_log_retention_days || config.log_retention_days);
                var found = false;
                for (var i = 0; i < retentionSelect.options.length; i++) {
                    if (retentionSelect.options[i].value === days) {
                        retentionSelect.selectedIndex = i;
                        found = true;
                        break;
                    }
                }
                if (!found) retentionSelect.value = '30';
                retentionSelect.dataset.lastSavedValue = retentionSelect.value;
            }
        }

        toggle.disabled = true;
        fetch('/cloud/config')
            .then(function(r) { return r.json(); })
            .then(function(data) { updateUI(data.data_sharing || {}); })
            .catch(function() { statusEl.textContent = '加载失败'; })
            .finally(function() { toggle.disabled = false; });

        toggle.addEventListener('change', function() {
            var enabled = toggle.checked;
            statusEl.textContent = '保存中...';
            toggle.disabled = true;
            if (window.DataSharing && DataSharing.setEnabled) {
                DataSharing.setEnabled(enabled).then(function(config) {
                    updateUI(config);
                    if (typeof showToast === 'function') {
                        showToast(config.enabled ? '数据共享已开启' : '数据共享已关闭');
                    }
                }).catch(function() {
                    toggle.checked = !enabled;
                    statusEl.textContent = enabled ? '已关闭' : '已开启';
                    if (typeof showToast === 'function') showToast('保存失败');
                }).finally(function() { toggle.disabled = false; });
            } else {
                fetch('/cloud/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data_sharing_enabled: enabled })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        updateUI(data.data_sharing || {});
                        if (typeof showToast === 'function') {
                            showToast(enabled ? '数据共享已开启' : '数据共享已关闭');
                        }
                    })
                    .catch(function() {
                        toggle.checked = !enabled;
                        statusEl.textContent = enabled ? '已关闭' : '已开启';
                        if (typeof showToast === 'function') showToast('保存失败');
                    })
                    .finally(function() { toggle.disabled = false; });
            }
        });

        function updateRetentionFailed() {
            if (typeof showToast === 'function') showToast('保存失败，请稍后重试');
        }

        if (retentionSelect) {
            retentionSelect.addEventListener('change', function() {
                var days = parseInt(retentionSelect.value) || 30;
                var successMessage = '本地日志保存天数已更新，不会影响服务端保存天数';
                var previousDays = retentionSelect.dataset.lastSavedValue || '30';
                var restoreSelection = function() { retentionSelect.value = previousDays; };
                var saveLocalRetention = window.DataSharing && (
                    DataSharing.setLocalLogRetentionDays || DataSharing.setLogRetentionDays
                );
                if (saveLocalRetention) {
                    (DataSharing.setLocalLogRetentionDays || DataSharing.setLogRetentionDays)(days).then(function(config) {
                        updateUI(config);
                        retentionSelect.dataset.lastSavedValue = String(days);
                        if (typeof showToast === 'function') showToast(successMessage);
                    }).catch(function() {
                        restoreSelection();
                        updateRetentionFailed();
                    });
                } else {
                    fetch('/cloud/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data_sharing_local_log_retention_days: days })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            updateUI(data.data_sharing || {});
                            retentionSelect.dataset.lastSavedValue = String(days);
                            if (typeof showToast === 'function') showToast(successMessage);
                        })
                        .catch(function() {
                            restoreSelection();
                            updateRetentionFailed();
                        });
                }
            });
        }
    })();
});

document.addEventListener('DOMContentLoaded', function () {
    var navItems = Array.from(document.querySelectorAll('[data-settings-nav]'));
    var panels = Array.from(document.querySelectorAll('[data-settings-panel]'));
    var gotoButtons = Array.from(document.querySelectorAll('[data-settings-goto]'));

    function activatePanel(key, updateHash) {
        var matched = false;
        panels.forEach(function (panel) {
            var isTarget = panel.dataset.settingsPanel === key && !panel.hidden;
            panel.classList.toggle('active', isTarget);
            if (isTarget) matched = true;
        });
        if (!matched) {
            // 目标面板被云控隐藏时回落到第一个可用面板
            var firstVisible = panels.find(function (p) { return !p.hidden; });
            if (firstVisible) firstVisible.classList.add('active');
            key = firstVisible ? firstVisible.dataset.settingsPanel : key;
        }
        navItems.forEach(function (item) {
            var usable = !item.hidden;
            item.classList.toggle('active', usable && item.dataset.settingsNav === key);
            item.setAttribute('aria-current', item.classList.contains('active') ? 'page' : 'false');
        });
        if (updateHash !== false) {
            try { history.replaceState(null, '', '#' + key); } catch (e) {}
        }
        var canvas = document.querySelector('.settings-canvas');
        if (canvas) canvas.scrollTop = 0;
    }

    navItems.forEach(function (item) {
        item.addEventListener('click', function () {
            activatePanel(item.dataset.settingsNav, true);
        });
    });
    gotoButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            activatePanel(btn.dataset.settingsGoto, true);
        });
    });

    var initialHash = (location.hash || '').replace('#', '');
    var validKeys = navItems.map(function (i) { return i.dataset.settingsNav; });
    activatePanel(validKeys.indexOf(initialHash) !== -1 ? initialHash : 'appearance', false);

    // 侧栏账户卡与云登录状态同步
    var accountChip = document.querySelector('.settings-account-chip');
    var accountName = document.getElementById('settings-account-name');
    var accountTier = document.getElementById('settings-account-tier');
    var accountAvatar = document.getElementById('settings-account-avatar');
    var accountAvatarImage = document.getElementById('settings-account-avatar-image');
    var notLoggedIn = document.getElementById('cloud-not-logged-in');
    var loggedIn = document.getElementById('cloud-logged-in');
    var pendingAvatarSrc = '';
    var syncFrame = 0;

    function clearAccountAvatar() {
        pendingAvatarSrc = '';
        if (!accountAvatar || !accountAvatarImage) return;
        accountAvatar.classList.remove('has-image');
        accountAvatarImage.hidden = true;
        accountAvatarImage.removeAttribute('src');
        accountAvatarImage.removeAttribute('data-source');
    }

    function setAccountAvatar(src) {
        if (!accountAvatar || !accountAvatarImage || !src) {
            clearAccountAvatar();
            return;
        }
        if (accountAvatarImage.getAttribute('data-source') === src && accountAvatar.classList.contains('has-image')) {
            return;
        }
        if (pendingAvatarSrc === src) return;
        pendingAvatarSrc = src;
        var preloader = new Image();
        var commitAvatar = function () {
            if (pendingAvatarSrc !== src) return;
            accountAvatarImage.src = src;
            accountAvatarImage.setAttribute('data-source', src);
            accountAvatarImage.hidden = false;
            accountAvatar.classList.add('has-image');
            pendingAvatarSrc = '';
        };
        preloader.onload = function () {
            if (typeof preloader.decode === 'function') {
                preloader.decode().then(commitAvatar).catch(commitAvatar);
            } else {
                commitAvatar();
            }
        };
        preloader.onerror = function () {
            if (pendingAvatarSrc !== src) return;
            clearAccountAvatar();
        };
        preloader.src = src;
    }

    function syncAccountChip() {
        if (!accountChip || !notLoggedIn || !loggedIn) return;
        var isLogged = loggedIn.style.display !== 'none';
        if (isLogged) {
            var nick = document.getElementById('cloud-nickname');
            var tier = document.getElementById('cloud-tier-badge');
            var avatarWrap = document.getElementById('cloud-avatar-wrap');
            if (accountName) accountName.textContent = (nick && nick.textContent) || '已登录';
            if (accountTier) accountTier.textContent = (tier && tier.textContent) || '云服务';
            if (accountAvatar && avatarWrap) {
                var img = avatarWrap.querySelector('img');
                if (img && img.src) {
                    setAccountAvatar(img.src);
                } else {
                    clearAccountAvatar();
                }
            }
        } else {
            if (accountName) accountName.textContent = '未登录云服务';
            if (accountTier) accountTier.textContent = '点击登录老三账户';
            clearAccountAvatar();
        }
    }

    function scheduleAccountChipSync() {
        if (syncFrame) return;
        syncFrame = window.requestAnimationFrame(function () {
            syncFrame = 0;
            syncAccountChip();
        });
    }

    if (notLoggedIn && loggedIn && window.MutationObserver) {
        var observer = new MutationObserver(scheduleAccountChipSync);
        observer.observe(notLoggedIn, { attributes: true, attributeFilter: ['style'] });
        observer.observe(loggedIn, {
            attributes: true,
            attributeFilter: ['style', 'src', 'class'],
            childList: true,
            characterData: true,
            subtree: true
        });
    }
    syncAccountChip();
});
