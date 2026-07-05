document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('classroom-root');
    if (!root) return;

    const urls = {
        move: root.dataset.moveUrl,
        moveBatch: root.dataset.moveBatchUrl,
        clear: root.dataset.clearUrl,
        assign: root.dataset.assignUrl,
        groupAssign: root.dataset.groupAssignUrl,
        groupAssignBatch: root.dataset.groupAssignBatchUrl,
        groupAuto: root.dataset.groupAutoUrl,
        groupMerge: root.dataset.groupMergeUrl,
        groupRotate: root.dataset.groupRotateUrl,
        shiftLayout: root.dataset.shiftLayoutUrl,
        mirrorLayout: root.dataset.mirrorLayoutUrl,
        renameClassroom: root.dataset.renameClassroomUrl,
        state: root.dataset.stateUrl,
        undo: root.dataset.undoUrl,
        redo: root.dataset.redoUrl,
        setLeader: root.dataset.setLeaderUrl,
        toggleFixedSeat: root.dataset.toggleFixedSeatUrl,
        addStudent: root.dataset.addStudentUrl,
        tags: root.dataset.tagsUrl,
        tagsAssign: root.dataset.tagsAssignUrl,
        tagRulesCreate: root.dataset.tagRulesCreateUrl,
    };
    const csrf = root.dataset.csrf;
    const classroomIdForTags = root.dataset.classroomId || '';

    let selectedSeat = null;
    let lastHoveredSeat = null;
    let selectedUnseated = null;
    let clipboardStudentId = null;
    let groupMode = false;
    const selectedSeats = new Set();
    let selecting = false;
    let selectStart = null;
    const dragState = {
        active: false,
        mode: null,
        anchorKey: null,
        sourceKeys: [],
        sourceStudentId: null,
    };

    const seatElements = Array.from(document.querySelectorAll('.seat'));
    const quickArrangeForm = document.querySelector('.quick-arrange-form');
    const autoArrangeBtn = document.getElementById('btn-auto-arrange');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const renameClassroomBtn = document.getElementById('btn-rename-classroom');
    const groupSelect = document.getElementById('groupSelect');
    const groupAssignToggle = document.getElementById('groupAssignToggle');
    const groupApplyBtn = document.getElementById('groupApplyBtn');
    const groupAutoBtn = document.getElementById('groupAutoBtn');
    const groupAutoReferenceSelect = document.getElementById('groupAutoReferenceSelect');
    const groupAutoDetectStyleCheckbox = document.getElementById('groupAutoDetectStyleCheckbox');
    const groupAutoConfirmBtn = document.getElementById('groupAutoConfirmBtn');
    const groupMergeBtn = document.getElementById('groupMergeBtn');
    const groupRotateBtn = document.getElementById('groupRotateBtn');
    const groupClearSelectBtn = document.getElementById('groupClearSelectBtn');
    const groupMergeFromSelect = document.getElementById('groupMergeFromSelect');
    const groupMergeToSelect = document.getElementById('groupMergeToSelect');

    const shiftLayoutFrontBtn = document.getElementById('btn-shift-layout-front');
    const shiftLayoutBackBtn = document.getElementById('btn-shift-layout-back');
    const shiftLayoutLeftBtn = document.getElementById('btn-shift-layout-left');
    const shiftLayoutRightBtn = document.getElementById('btn-shift-layout-right');
    const mirrorLayoutLeftRightBtn = document.getElementById('btn-mirror-layout-lr');
    const shiftLayoutSteps = document.getElementById('shiftLayoutSteps');
    const shiftUseLargeGroupsToggle = document.getElementById('shiftUseLargeGroups');
    const shiftOptionsUseLargeGroupsToggle = document.getElementById('shiftOptionsUseLargeGroups');
    const createGroupForm = document.getElementById('createGroupForm');
    const groupList = document.getElementById('groupList');
    const unseatedSearch = document.getElementById('unseatedSearch');
    const groupBaseUrl = createGroupForm ? createGroupForm.action.replace(/group\/create\/?$/, 'group/') : '';
    const seatStage = document.querySelector('.seat-stage');
    const unseatedList = document.querySelector('.unseated-list');
    const unseatedCount = document.getElementById('unseatedCount');
    const suggestionList = document.getElementById('suggestionList');
    const constraintForm = document.getElementById('constraintForm');
    const constraintIdInput = document.getElementById('constraintIdInput');
    const constraintTypeSelect = document.getElementById('constraintTypeSelect');
    const constraintStudentSelect = document.getElementById('constraintStudentSelect');
    const constraintTargetStudentSelect = document.getElementById('constraintTargetStudentSelect');
    const constraintRowInput = document.getElementById('constraintRowInput');
    const constraintColInput = document.getElementById('constraintColInput');
    const constraintDistanceInput = document.getElementById('constraintDistanceInput');
    const constraintNoteInput = document.getElementById('constraintNoteInput');
    const constraintSubmitBtn = document.getElementById('constraintSubmitBtn');
    const constraintCancelEditBtn = document.getElementById('constraintCancelEditBtn');
    const constraintList = document.getElementById('constraintList');
    const constraintFilterGroup = document.getElementById('constraintFilterGroup');
    const constraintMetrics = document.getElementById('constraintMetrics');
    const enabledActionSuggestionTypes = new Set(['export_suggestion', 'group_balance']);
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.display = 'none';
    document.body.appendChild(selectionBox);
    const seatsImportForm = document.getElementById('seats-import-form');
    const seatsImportInput = document.getElementById('seats-import-input');
    const seatsImportTriggers = Array.from(document.querySelectorAll('[data-seats-import-trigger="1"]'));
    const fileMenuRoots = Array.from(document.querySelectorAll('.menu-dropdown[data-menu-root]'));
    const touchPointerQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    const GROUP_MOVE_MODE_KEY = 'seats_group_move_mode';
    const GROUP_MOVE_MODE_FIXED = 'fixed';
    const GROUP_MOVE_MODE_FOLLOW = 'follow';
    let suppressNextTouchClick = false;
    let touchDragCandidate = null;
    let touchDragSession = null;
    const isTouchUi = () => Boolean(
        (touchPointerQuery && touchPointerQuery.matches) ||
        navigator.maxTouchPoints > 0 ||
        'ontouchstart' in window
    );
    const markNextTouchClickSuppressed = () => {
        suppressNextTouchClick = true;
        window.setTimeout(() => {
            suppressNextTouchClick = false;
        }, 650);
    };
    const consumeSuppressedTouchClick = (event) => {
        if (!suppressNextTouchClick) return false;
        suppressNextTouchClick = false;
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        return true;
    };
    const SHIFT_USE_LARGE_GROUPS_KEY = 'seats_shift_use_large_groups';
    const parseJsonScript = (id, fallback) => {
        const node = document.getElementById(id);
        if (!node) return fallback;
        try {
            return JSON.parse(node.textContent || '');
        } catch (error) {
            console.warn(`Unable to parse JSON script: ${id}`, error);
            return fallback;
        }
    };
    const constraintTypeDefinitions = parseJsonScript('constraint-type-data', []);
    const constraintTypeMap = new Map(constraintTypeDefinitions.map((item) => [item.value, item]));
    let constraintItems = parseJsonScript('constraint-initial-data', []);
    let activeConstraintFilter = 'all';
    let editingConstraintId = null;

    const normalizeGroupMoveMode = (value) => (
        String(value || '').trim().toLowerCase() === GROUP_MOVE_MODE_FOLLOW
            ? GROUP_MOVE_MODE_FOLLOW
            : GROUP_MOVE_MODE_FIXED
    );

    const getGroupMoveMode = () => {
        try {
            return normalizeGroupMoveMode(localStorage.getItem(GROUP_MOVE_MODE_KEY));
        } catch (error) {
            console.warn('Unable to read group move mode:', error);
            return GROUP_MOVE_MODE_FIXED;
        }
    };

    const withMovePreferences = (payload) => ({
        ...payload,
        group_move_mode: getGroupMoveMode(),
    });

    const setShiftUseLargeGroups = (checked) => {
        const normalized = !!checked;
        if (shiftUseLargeGroupsToggle) {
            shiftUseLargeGroupsToggle.checked = normalized;
        }
        if (shiftOptionsUseLargeGroupsToggle) {
            shiftOptionsUseLargeGroupsToggle.checked = normalized;
        }
    };

    const getShiftUseLargeGroups = () => {
        if (shiftUseLargeGroupsToggle) {
            return !!shiftUseLargeGroupsToggle.checked;
        }
        if (shiftOptionsUseLargeGroupsToggle) {
            return !!shiftOptionsUseLargeGroupsToggle.checked;
        }
        return true;
    };

    const persistShiftUseLargeGroups = (checked) => {
        try {
            localStorage.setItem(SHIFT_USE_LARGE_GROUPS_KEY, checked ? '1' : '0');
        } catch (error) {
            console.warn('Unable to persist shift group mode:', error);
        }
    };

    const initShiftUseLargeGroupsPreference = () => {
        let initialChecked = true;
        try {
            const saved = localStorage.getItem(SHIFT_USE_LARGE_GROUPS_KEY);
            if (saved === '0' || saved === '1') {
                initialChecked = saved === '1';
            }
        } catch (error) {
            console.warn('Unable to read shift group mode:', error);
        }

        setShiftUseLargeGroups(initialChecked);

        [shiftUseLargeGroupsToggle, shiftOptionsUseLargeGroupsToggle].forEach((toggle) => {
            if (!toggle) return;
            toggle.addEventListener('change', () => {
                const checked = !!toggle.checked;
                setShiftUseLargeGroups(checked);
                persistShiftUseLargeGroups(checked);
            });
        });
    };

    const closeAllFileMenus = () => {
        fileMenuRoots.forEach((rootEl) => {
            rootEl.classList.remove('open');
            const rootTrigger = rootEl.querySelector('.menu-trigger[data-menu-toggle]');
            if (rootTrigger) {
                rootTrigger.setAttribute('aria-expanded', 'false');
            }
            rootEl.querySelectorAll('.menu-submenu.open').forEach((submenuEl) => {
                submenuEl.classList.remove('open');
            });
            rootEl.querySelectorAll('.menu-item-has-children[data-menu-toggle]').forEach((btnEl) => {
                btnEl.setAttribute('aria-expanded', 'false');
            });
        });
    };

    const initFileMenus = () => {
        if (!fileMenuRoots.length) return;

        fileMenuRoots.forEach((rootEl) => {
            const rootTrigger = rootEl.querySelector('.menu-trigger[data-menu-toggle]');
            if (rootTrigger) {
                rootTrigger.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const shouldOpen = !rootEl.classList.contains('open');
                    closeAllFileMenus();
                    if (shouldOpen) {
                        rootEl.classList.add('open');
                        rootTrigger.setAttribute('aria-expanded', 'true');
                    }
                });
            }

            rootEl.querySelectorAll('.menu-item-has-children[data-menu-toggle]').forEach((submenuTrigger) => {
                submenuTrigger.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const submenu = submenuTrigger.closest('.menu-submenu');
                    if (!submenu) return;
                    const shouldOpen = !submenu.classList.contains('open');
                    const parentPanel = submenu.parentElement;
                    if (parentPanel) {
                        parentPanel.querySelectorAll(':scope > .menu-submenu.open').forEach((sibling) => {
                            sibling.classList.remove('open');
                            const siblingTrigger = sibling.querySelector(':scope > .menu-item-has-children[data-menu-toggle]');
                            if (siblingTrigger) siblingTrigger.setAttribute('aria-expanded', 'false');
                        });
                    }
                    submenu.classList.toggle('open', shouldOpen);
                    submenuTrigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
                });
            });

            rootEl.querySelectorAll('.menu-item-link').forEach((menuLink) => {
                menuLink.addEventListener('click', () => {
                    closeAllFileMenus();
                });
            });
        });

        document.addEventListener('click', (event) => {
            if (event.target.closest('.menu-dropdown[data-menu-root]')) return;
            closeAllFileMenus();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeAllFileMenus();
            }
        });

        document.querySelectorAll('.ribbon-tab[data-ribbon-tab]').forEach((tabBtn) => {
            tabBtn.addEventListener('click', () => {
                closeAllFileMenus();
            });
        });
    };

    const initSeatsImport = () => {
        if (!seatsImportForm || !seatsImportInput || !seatsImportTriggers.length) return;
        const importWithDesktopShell = async (trigger) => {
            const desktopImport = window.FuckSeatsDesktop?.importSeatsFile;
            if (typeof desktopImport !== 'function') return false;

            if (trigger) trigger.disabled = true;
            try {
                const result = await desktopImport(seatsImportForm.getAttribute('action') || window.location.href, {
                    csrf,
                    acceptExtensions: ['.seats', '.json']
                });
                if (!result) return false;
                if (result.status === 'cancelled') return true;
                showInlineToast(`${result.filename || '文件'} 已导入`);
                setTimeout(() => window.location.reload(), 500);
                return true;
            } catch (error) {
                showInlineToast(error?.message || '导入失败');
                return true;
            } finally {
                if (trigger) trigger.disabled = false;
            }
        };

        seatsImportTriggers.forEach((trigger) => {
            trigger.addEventListener('click', async (event) => {
                event.preventDefault();
                closeAllFileMenus();
                const handledByDesktop = await importWithDesktopShell(trigger);
                if (handledByDesktop) return;
                seatsImportInput.value = '';
                seatsImportInput.click();
            });
        });
        seatsImportInput.addEventListener('change', () => {
            if (!seatsImportInput.files || !seatsImportInput.files.length) return;
            seatsImportForm.submit();
        });
    };

    const initBsceImport = () => {
        const bsceModal = document.getElementById('bsce-import-modal');
        const bsceInput = document.getElementById('bsce-import-input');
        const bsceTriggers = Array.from(document.querySelectorAll('[data-bsce-import-trigger="1"]'));
        if (!bsceModal || !bsceInput || !bsceTriggers.length) return;

        const stageChoose = document.getElementById('bsce-import-stage-choose');
        const stageLogin = document.getElementById('bsce-import-stage-login');
        const stageCloud = document.getElementById('bsce-import-stage-cloud');
        const cloudLoading = document.getElementById('bsce-cloud-loading');
        const cloudList = document.getElementById('bsce-cloud-list');
        const cloudEmpty = document.getElementById('bsce-cloud-empty');
        const btnLocal = document.getElementById('bsce-choose-local');
        const btnCloud = document.getElementById('bsce-choose-cloud');
        const btnCloudBack = document.getElementById('bsce-cloud-back');
        const btnLoginBack = document.getElementById('bsce-login-back');
        const btnLoginSubmit = document.getElementById('bsce-login-submit');
        const inputUsername = document.getElementById('bsce-cloud-username');
        const inputPassword = document.getElementById('bsce-cloud-password');
        const bsceBaseUrl = `/classroom/${classroomId}/layout/import/bsce/`;

        let bsceCredentials = { username: '', password: '' };

        const showStage = (stage) => {
            stageChoose.style.display = stage === 'choose' ? 'flex' : 'none';
            stageLogin.style.display = stage === 'login' ? 'block' : 'none';
            stageCloud.style.display = stage === 'cloud' ? 'block' : 'none';
        };

        const resetModal = () => {
            showStage('choose');
            cloudLoading.style.display = 'block';
            cloudList.style.display = 'none';
            cloudEmpty.style.display = 'none';
            cloudList.innerHTML = '';
            btnLoginSubmit.disabled = false;
            btnLoginSubmit.textContent = '登录并加载';
        };

        bsceTriggers.forEach((trigger) => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                closeAllFileMenus();
                resetModal();
                openModal('bsce-import-modal');
            });
        });

        const importBsceWithDesktopShell = async () => {
            const uploadLocalFile = window.FuckSeatsDesktop?.uploadLocalFile;
            if (typeof uploadLocalFile !== 'function') return false;

            btnLocal.disabled = true;
            try {
                const result = await uploadLocalFile(bsceBaseUrl, {
                    csrf,
                    fieldName: 'bsce_file',
                    fallbackFilename: 'import.sce',
                    acceptExtensions: ['.sce']
                });
                if (!result) return false;
                if (result.status === 'cancelled') return true;
                const response = result.response || result;
                if (response.status === 'success' || result.status === 'success') {
                    closeModal('bsce-import-modal');
                    showInlineToast(response.message || result.message || 'BSCE 导入完成');
                    setTimeout(() => window.location.reload(), 800);
                } else {
                    showInlineToast(response.message || result.message || 'BSCE 导入失败');
                }
                return true;
            } catch (error) {
                showInlineToast(error?.message || 'BSCE 导入请求失败');
                return true;
            } finally {
                btnLocal.disabled = false;
            }
        };

        btnLocal.addEventListener('click', async () => {
            const handledByDesktop = await importBsceWithDesktopShell();
            if (handledByDesktop) return;
            bsceInput.value = '';
            bsceInput.click();
        });

        bsceInput.addEventListener('change', () => {
            if (!bsceInput.files || !bsceInput.files.length) return;
            closeModal('bsce-import-modal');
            const formData = new FormData();
            formData.append('bsce_file', bsceInput.files[0]);
            fetch(bsceBaseUrl, {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrf,
                },
                body: formData,
            })
            .then((res) => res.json())
            .then((data) => {
                if (data.status === 'success') {
                    showInlineToast(data.message || 'BSCE 导入完成');
                    setTimeout(() => window.location.reload(), 800);
                } else {
                    showInlineToast(data.message || 'BSCE 导入失败');
                }
            })
            .catch(() => {
                showInlineToast('BSCE 导入请求失败');
            });
        });

        const formatSize = (bytes) => {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1048576).toFixed(1) + ' MB';
        };

        const formatTime = (iso) => {
            try {
                const d = new Date(iso);
                return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            } catch (_) {
                return iso;
            }
        };

        btnCloud.addEventListener('click', () => {
            showStage('login');
            inputUsername.focus();
        });

        btnLoginBack.addEventListener('click', () => {
            showStage('choose');
        });

        const loadWorkspaces = () => {
            showStage('cloud');
            cloudLoading.style.display = 'block';
            cloudList.style.display = 'none';
            cloudEmpty.style.display = 'none';

            fetch(bsceBaseUrl + 'cloud/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrf,
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    action: 'list',
                    username: bsceCredentials.username,
                    password: bsceCredentials.password,
                }),
            })
            .then((res) => res.json())
            .then((data) => {
                cloudLoading.style.display = 'none';
                if (data.status !== 'success' || !data.workspaces || !data.workspaces.length) {
                    cloudEmpty.style.display = 'block';
                    cloudEmpty.textContent = data.status !== 'success'
                        ? (data.message || '加载失败')
                        : '暂无云端工作区';
                    return;
                }
                cloudList.style.display = 'block';
                cloudList.innerHTML = '';
                data.workspaces.forEach((ws) => {
                    const item = document.createElement('div');
                    item.className = 'bsce-cloud-item';
                    item.innerHTML =
                        '<div class="bsce-cloud-info">' +
                            '<div class="bsce-cloud-name">' + (ws.metadata.name || ws.fileId) + '</div>' +
                            '<div class="bsce-cloud-meta">' + formatTime(ws.metadata.time) + '  ·  ' + formatSize(ws.metadata.size) + '</div>' +
                        '</div>' +
                        '<button type="button" class="btn btn-primary bsce-cloud-import-btn">导入</button>';
                    const importBtn = item.querySelector('.bsce-cloud-import-btn');
                    importBtn.addEventListener('click', () => {
                        importBtn.disabled = true;
                        importBtn.textContent = '导入中...';
                        fetch(bsceBaseUrl + 'cloud/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': csrf,
                                'X-Requested-With': 'XMLHttpRequest',
                            },
                            body: JSON.stringify({
                                action: 'import',
                                fileId: ws.fileId,
                                username: bsceCredentials.username,
                                password: bsceCredentials.password,
                            }),
                        })
                        .then((res) => res.json())
                        .then((result) => {
                            if (result.status === 'success') {
                                closeModal('bsce-import-modal');
                                showInlineToast(result.message || 'BSCE 云导入完成');
                                setTimeout(() => window.location.reload(), 800);
                            } else {
                                importBtn.disabled = false;
                                importBtn.textContent = '导入';
                                showInlineToast(result.message || 'BSCE 云导入失败');
                            }
                        })
                        .catch(() => {
                            importBtn.disabled = false;
                            importBtn.textContent = '导入';
                            showInlineToast('BSCE 云导入请求失败');
                        });
                    });
                    cloudList.appendChild(item);
                });
            })
            .catch(() => {
                cloudLoading.style.display = 'none';
                cloudEmpty.style.display = 'block';
                cloudEmpty.textContent = '加载失败，请检查网络';
            });
        };

        btnLoginSubmit.addEventListener('click', () => {
            const u = inputUsername.value.trim();
            const p = inputPassword.value.trim();
            if (!u || !p) {
                showInlineToast('请输入 BSCE 账号和密码');
                return;
            }
            bsceCredentials = { username: u, password: p };
            btnLoginSubmit.disabled = true;
            btnLoginSubmit.textContent = '登录中...';
            loadWorkspaces();
        });

        btnCloudBack.addEventListener('click', () => {
            showStage('login');
            btnLoginSubmit.disabled = false;
            btnLoginSubmit.textContent = '登录并加载';
        });
    };

    const createToastContainer = () => {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    };

    const postJson = (url, payload) => {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
            },
            body: JSON.stringify(payload)
        }).then(res => res.json());
    };

    const showInlineToast = (message) => {
        if (!message) return;
        if (window.showToast) {
            window.showToast(message, { duration: 2200 });
            return;
        }
        const container = createToastContainer();
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-header">
                <span>提示</span>
                <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">刚刚</span>
            </div>
            <div class="toast-body">${message}</div>
        `;
        container.appendChild(toast);
        if (window.updateToastStack) window.updateToastStack();
        setTimeout(() => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
                if (window.updateToastStack) window.updateToastStack();
            });
        }, 2200);
    };

    const escapeHtml = (value) => {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    };

    const escapeAttr = (value) => {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    };

    const buildStudentBadgeHtml = (student) => {
        if (!student) return '';
        const badges = [];
        if (student.podium_guardian_side === 'left') {
            badges.push('<span class="guardian-badge left-guard">左护法</span>');
        } else if (student.podium_guardian_side === 'right') {
            badges.push('<span class="guardian-badge right-guard">右护法</span>');
        }
        if (student.is_fixed_seat) {
            badges.push('<span class="fixed-seat-badge">固定座位</span>');
        }
        if (Array.isArray(student.tags)) {
            student.tags.forEach(tag => {
                badges.push(`<span class="student-tag-badge" style="background:${escapeAttr(tag.color || '#0a59f7')}22;color:${escapeAttr(tag.color || '#0a59f7')}" title="${escapeAttr(tag.name)}">${escapeHtml(tag.name)}</span>`);
            });
        }
        if (!badges.length) return '';
        return `<div class="seat-badge-row">${badges.join('')}</div>`;
    };

    const postFormData = (url, payload = {}) => {
        return fetch(url, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrf,
            },
            body: new URLSearchParams(payload),
        }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok || (data && data.status && data.status !== 'success')) {
                throw new Error(data.message || '操作失败');
            }
            return data;
        });
    };

    const deriveConstraintMetrics = (items) => {
        const safeItems = Array.isArray(items) ? items : [];
        return {
            total: safeItems.length,
            enabled: safeItems.filter((item) => item.enabled).length,
            disabled: safeItems.filter((item) => !item.enabled).length,
            with_issues: safeItems.filter((item) => Number(item.issue_count || 0) > 0).length,
        };
    };

    const renderConstraintMetrics = (metrics) => {
        if (!constraintMetrics) return;
        const merged = {
            total: Number(metrics?.total || 0),
            enabled: Number(metrics?.enabled || 0),
            disabled: Number(metrics?.disabled || 0),
            with_issues: Number(metrics?.with_issues || 0),
        };
        constraintMetrics.innerHTML = `
            <span class="constraint-metric-pill">总计 ${merged.total}</span>
            <span class="constraint-metric-pill">启用 ${merged.enabled}</span>
            <span class="constraint-metric-pill">停用 ${merged.disabled}</span>
            <span class="constraint-metric-pill">异常 ${merged.with_issues}</span>
        `;
    };

    const getConstraintStatusLabel = (status) => {
        if (status === 'disabled') return '已停用';
        if (status === 'error') return '冲突';
        if (status === 'warning') return '未满足';
        return '正常';
    };

    const matchesConstraintFilter = (item) => {
        if (activeConstraintFilter === 'issues') {
            return Number(item.issue_count || 0) > 0;
        }
        if (activeConstraintFilter === 'enabled') {
            return !!item.enabled;
        }
        if (activeConstraintFilter === 'disabled') {
            return !item.enabled;
        }
        return true;
    };

    const renderConstraintList = () => {
        if (!constraintList) return;
        const visibleItems = (constraintItems || []).filter(matchesConstraintFilter);
        if (!visibleItems.length) {
            const emptyText = activeConstraintFilter === 'all' ? '暂无约束' : '当前筛选条件下没有约束';
            constraintList.innerHTML = `<div class="empty-hint">${emptyText}</div>`;
            return;
        }

        constraintList.innerHTML = visibleItems.map((item) => {
            const status = item.status || 'ok';
            const issues = Array.isArray(item.issues) ? item.issues : [];
            const badges = [
                `<span class="constraint-badge constraint-badge-${status}">${escapeHtml(getConstraintStatusLabel(status))}</span>`,
                item.note ? '<span class="constraint-badge">有备注</span>' : '',
            ].filter(Boolean).join('');
            const issuesHtml = issues.length
                ? `<div class="constraint-issues">${issues.map((issue) => `
                    <div class="constraint-issue constraint-issue-${escapeAttr(issue.type || '')}">${escapeHtml(issue.message || '')}</div>
                `).join('')}</div>`
                : '';
            const noteHtml = item.note ? `<div class="constraint-note">备注：${escapeHtml(item.note)}</div>` : '';
            const itemClass = [
                'constraint-item',
                status !== 'ok' && status !== 'disabled' ? 'constraint-item-warning' : '',
                !item.enabled ? 'constraint-item-disabled' : '',
            ].filter(Boolean).join(' ');
            return `
                <div class="${itemClass}"
                    data-constraint-pk="${item.pk}"
                    data-constraint-type="${escapeAttr(item.constraint_type || '')}"
                    data-student-pk="${escapeAttr(item.student_pk || '')}"
                    data-target-student-pk="${escapeAttr(item.target_student_pk || '')}"
                    data-row="${escapeAttr(item.row || '')}"
                    data-col="${escapeAttr(item.col || '')}"
                    data-distance="${escapeAttr(item.distance || 1)}"
                    data-enabled="${item.enabled ? '1' : '0'}"
                    data-note="${escapeAttr(item.note || '')}"
                    data-update-url="${escapeAttr(item.update_url || '')}"
                    data-toggle-url="${escapeAttr(item.toggle_url || '')}"
                    data-delete-url="${escapeAttr(item.delete_url || '')}">
                    <div class="constraint-main">
                        <div class="constraint-title-row">
                            <div class="constraint-title">${escapeHtml(item.constraint_type_display || '')}</div>
                            <div class="constraint-badges">${badges}</div>
                        </div>
                        <div class="constraint-desc">${escapeHtml(item.summary || '')}</div>
                        ${noteHtml}
                        ${issuesHtml}
                    </div>
                    <div class="constraint-actions">
                        <button type="button" class="btn btn-secondary" data-constraint-action="edit">编辑</button>
                        <button type="button" class="btn btn-secondary" data-constraint-action="toggle">${item.enabled ? '停用' : '启用'}</button>
                        <button type="button" class="btn btn-secondary" data-constraint-action="delete">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    };

    const setConstraintFieldVisible = (fieldName, visible) => {
        if (!constraintForm) return;
        const field = constraintForm.querySelector(`[data-constraint-field="${fieldName}"]`);
        if (!field) return;
        field.hidden = !visible;
        const input = field.querySelector('input, select');
        if (!input) return;
        input.disabled = !visible;
        if (!visible) {
            if (input.tagName === 'SELECT') {
                input.value = '';
            } else if (fieldName === 'distance') {
                input.value = '1';
            } else {
                input.value = '';
            }
        }
    };

    const syncConstraintFields = () => {
        if (!constraintTypeSelect) return;
        const typeConfig = constraintTypeMap.get(constraintTypeSelect.value) || {};
        setConstraintFieldVisible('target_student_id', !!typeConfig.needs_target);
        setConstraintFieldVisible('row', !!typeConfig.needs_row);
        setConstraintFieldVisible('col', !!typeConfig.needs_col);
        setConstraintFieldVisible('distance', !!typeConfig.needs_distance);
        setConstraintFieldVisible('note', true);
    };

    const resetConstraintForm = () => {
        if (!constraintForm) return;
        editingConstraintId = null;
        constraintForm.reset();
        constraintForm.action = constraintForm.dataset.createUrl || constraintForm.action;
        if (constraintIdInput) constraintIdInput.value = '';
        if (constraintDistanceInput) constraintDistanceInput.value = '1';
        if (constraintSubmitBtn) constraintSubmitBtn.textContent = '添加约束';
        if (constraintCancelEditBtn) constraintCancelEditBtn.hidden = true;
        syncConstraintFields();
    };

    const populateConstraintForm = (item) => {
        if (!constraintForm || !item) return;
        editingConstraintId = item.pk;
        constraintForm.action = item.update_url || constraintForm.dataset.createUrl || constraintForm.action;
        if (constraintIdInput) constraintIdInput.value = item.pk;
        if (constraintTypeSelect) constraintTypeSelect.value = item.constraint_type || '';
        if (constraintStudentSelect) constraintStudentSelect.value = item.student_pk || '';
        if (constraintTargetStudentSelect) constraintTargetStudentSelect.value = item.target_student_pk || '';
        if (constraintRowInput) constraintRowInput.value = item.row || '';
        if (constraintColInput) constraintColInput.value = item.col || '';
        if (constraintDistanceInput) constraintDistanceInput.value = item.distance || 1;
        if (constraintNoteInput) constraintNoteInput.value = item.note || '';
        if (constraintSubmitBtn) constraintSubmitBtn.textContent = '保存修改';
        if (constraintCancelEditBtn) constraintCancelEditBtn.hidden = false;
        syncConstraintFields();
        constraintForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const dismissToast = (toast) => {
        if (!toast) return;
        if (window.dismissToastElement) {
            window.dismissToastElement(toast);
            return;
        }
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', () => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            if (window.updateToastStack) window.updateToastStack();
        });
    };

    const _dialogModal = document.getElementById('generic-dialog-modal');
    const _dialogTitle = document.getElementById('genericDialogTitle');
    const _dialogMessage = document.getElementById('genericDialogMessage');
    const _dialogInput = document.getElementById('genericDialogInput');
    const _dialogOk = document.getElementById('genericDialogOk');
    const _dialogCancel = document.getElementById('genericDialogCancel');
    let _dialogResolve = null;

    const _cleanupDialog = () => {
        _dialogOk.replaceWith(_dialogOk.cloneNode(true));
        _dialogCancel.replaceWith(_dialogCancel.cloneNode(true));
        const ok = document.getElementById('genericDialogOk');
        const cancel = document.getElementById('genericDialogCancel');
        return { ok, cancel };
    };

    const showConfirmModal = (message, { title = '确认操作', okText = '确定', cancelText = '取消' } = {}) => {
        return new Promise((resolve) => {
            _dialogTitle.textContent = title;
            _dialogMessage.textContent = message;
            _dialogInput.style.display = 'none';
            const { ok, cancel } = _cleanupDialog();
            ok.textContent = okText;
            cancel.textContent = cancelText;
            _dialogResolve = resolve;
            ok.addEventListener('click', () => { closeModal('generic-dialog-modal'); resolve(true); });
            cancel.addEventListener('click', () => { closeModal('generic-dialog-modal'); resolve(false); });
            openModal('generic-dialog-modal');
        });
    };

    const showPromptModal = (message, { title = '请输入', defaultValue = '', okText = '确定', cancelText = '取消' } = {}) => {
        return new Promise((resolve) => {
            _dialogTitle.textContent = title;
            _dialogMessage.textContent = message;
            _dialogInput.style.display = '';
            _dialogInput.value = defaultValue;
            const { ok, cancel } = _cleanupDialog();
            ok.textContent = okText;
            cancel.textContent = cancelText;
            _dialogResolve = resolve;
            const submit = () => { closeModal('generic-dialog-modal'); resolve(_dialogInput.value); };
            ok.addEventListener('click', submit);
            _dialogInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
            cancel.addEventListener('click', () => { closeModal('generic-dialog-modal'); resolve(null); });
            openModal('generic-dialog-modal');
            requestAnimationFrame(() => { _dialogInput.focus(); _dialogInput.select(); });
        });
    };
    window.showConfirmModal = showConfirmModal;
    window.showPromptModal = showPromptModal;

    const _sfModal = document.getElementById('student-form-modal');
    const _sfTitle = document.getElementById('studentFormTitle');
    const _sfName = document.getElementById('studentFormName');
    const _sfSid = document.getElementById('studentFormStudentId');
    const _sfGender = document.getElementById('studentFormGender');
    const _sfScore = document.getElementById('studentFormScore');
    const _sfOk = document.getElementById('studentFormSubmit');
    const _sfCancel = document.getElementById('studentFormCancel');
    let _sfResolve = null;
    let _sfOkHandler = null;
    let _sfCancelHandler = null;
    let _sfKeyHandler = null;
    let _sfBackdropHandler = null;

    function openStudentForm({ title = '添加学生', name = '', student_id = '', gender = '', score = '', tag_ids = [] } = {}) {
        return new Promise((resolve) => {
            _sfTitle.textContent = title;
            _sfName.value = name;
            _sfSid.value = student_id;
            _sfGender.value = gender;
            _sfScore.value = score;
            renderStudentFormTags(tagLibraryCache, tag_ids);
            if (_sfOkHandler) _sfOk.removeEventListener('click', _sfOkHandler);
            if (_sfCancelHandler) _sfCancel.removeEventListener('click', _sfCancelHandler);
            if (_sfKeyHandler) _sfModal.removeEventListener('keydown', _sfKeyHandler);
            if (_sfBackdropHandler) _sfModal.removeEventListener('click', _sfBackdropHandler);
            _sfResolve = resolve;
            _sfOkHandler = () => {
                const n = _sfName.value.trim();
                if (!n) { _sfName.focus(); return; }
                closeModal('student-form-modal');
                const selectedTags = getStudentFormSelectedTagIds();
                const result = { name: n, student_id: _sfSid.value.trim(), gender: _sfGender.value, score: _sfScore.value };
                if (selectedTags.length) { result.tag_ids = selectedTags; result.tag_mode = 'set'; }
                resolve(result);
            };
            _sfCancelHandler = () => { closeModal('student-form-modal'); resolve(null); };
            _sfKeyHandler = (e) => { if (e.key === 'Enter') { e.preventDefault(); _sfOkHandler(); } };
            _sfBackdropHandler = (e) => { if (e.target === _sfModal) _sfCancelHandler(); };
            _sfOk.addEventListener('click', _sfOkHandler);
            _sfCancel.addEventListener('click', _sfCancelHandler);
            _sfModal.addEventListener('keydown', _sfKeyHandler);
            _sfModal.addEventListener('click', _sfBackdropHandler);
            openModal('student-form-modal');
            requestAnimationFrame(() => _sfName.focus());
        });
    }

    document.getElementById('btn-add-student').addEventListener('click', async () => {
        const data = await openStudentForm({ title: '添加学生' });
        if (!data) return;
        handleResponse(postJson(urls.addStudent, data));
    });

    const notify = (message) => {
        showInlineToast(message);
    };

    let tagLibraryCache = [];
    let tagRulesCache = [];
    let editingTagRuleId = null;

    const tagLibraryEl = document.getElementById('tagLibrary');
    const tagAssignSelect = document.getElementById('tagAssignSelect');
    const tagAssignMode = document.getElementById('tagAssignMode');
    const tagAssignApplyBtn = document.getElementById('tagAssignApplyBtn');
    const tagRuleTagSelect = document.getElementById('tagRuleTagSelect');
    const tagRuleTypeSelect = document.getElementById('tagRuleTypeSelect');
    const tagRuleAreaFields = document.getElementById('tagRuleAreaFields');
    const tagRuleDistanceField = document.getElementById('tagRuleDistanceField');
    const tagRuleRowMin = document.getElementById('tagRuleRowMin');
    const tagRuleRowMax = document.getElementById('tagRuleRowMax');
    const tagRuleColMin = document.getElementById('tagRuleColMin');
    const tagRuleColMax = document.getElementById('tagRuleColMax');
    const tagRuleDistance = document.getElementById('tagRuleDistance');
    const tagRuleNote = document.getElementById('tagRuleNote');
    const tagRuleCreateBtn = document.getElementById('tagRuleCreateBtn');
    const tagRuleCancelEditBtn = document.getElementById('tagRuleCancelEditBtn');
    const tagRuleListEl = document.getElementById('tagRuleList');
    const btnCreateTag = document.getElementById('btn-create-tag');

    const _tagModal = document.getElementById('tag-form-modal');
    const _tagTitle = document.getElementById('tagFormTitle');
    const _tagName = document.getElementById('tagFormName');
    const _tagColor = document.getElementById('tagFormColor');
    const _tagDesc = document.getElementById('tagFormDesc');
    const _tagOk = document.getElementById('tagFormSubmit');
    const _tagCancel = document.getElementById('tagFormCancel');
    let _tagResolve = null;

    function openTagForm({ title = '创建标签', name = '', color = '#0a59f7', description = '' } = {}) {
        return new Promise((resolve) => {
            _tagTitle.textContent = title;
            _tagName.value = name;
            _tagColor.value = color;
            _tagDesc.value = description;
            _tagResolve = resolve;
            const okHandler = () => {
                const n = _tagName.value.trim();
                if (!n) { _tagName.focus(); return; }
                cleanup();
                closeModal('tag-form-modal');
                resolve({ name: n, color: _tagColor.value, description: _tagDesc.value.trim() });
            };
            const cancelHandler = () => { cleanup(); closeModal('tag-form-modal'); resolve(null); };
            const keyHandler = (e) => { if (e.key === 'Enter') { e.preventDefault(); okHandler(); } };
            const backdropHandler = (e) => { if (e.target === _tagModal) cancelHandler(); };
            const cleanup = () => {
                _tagOk.removeEventListener('click', okHandler);
                _tagCancel.removeEventListener('click', cancelHandler);
                _tagModal.removeEventListener('keydown', keyHandler);
                _tagModal.removeEventListener('click', backdropHandler);
            };
            _tagOk.addEventListener('click', okHandler);
            _tagCancel.addEventListener('click', cancelHandler);
            _tagModal.addEventListener('keydown', keyHandler);
            _tagModal.addEventListener('click', backdropHandler);
            openModal('tag-form-modal');
            requestAnimationFrame(() => _tagName.focus());
        });
    }

    function renderTagLibrary(tags) {
        tagLibraryCache = tags || [];
        if (!tagLibraryEl) return;
        if (!tagLibraryCache.length) {
            tagLibraryEl.innerHTML = '<div class="empty-hint">暂无标签，点击 + 创建</div>';
            return;
        }
        tagLibraryEl.innerHTML = tagLibraryCache.map(tag => `
            <div class="tag-library-item" data-tag-id="${tag.id}">
                <div class="tag-library-item-main">
                    <span class="tag-library-color" style="background:${escapeAttr(tag.color)}"></span>
                    <span class="tag-library-name">${escapeHtml(tag.name)}</span>
                    <span class="tag-library-meta">${tag.member_count || 0}人 / ${tag.rule_count || 0}条规则</span>
                </div>
                <div class="tag-library-actions">
                    <button type="button" class="btn btn-secondary" data-tag-action="edit">编辑</button>
                    <button type="button" class="btn btn-secondary" data-tag-action="delete">删除</button>
                </div>
            </div>
        `).join('');

        updateTagSelects(tagLibraryCache);

        tagLibraryEl.querySelectorAll('[data-tag-action="edit"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.tag-library-item');
                const tagId = item.dataset.tagId;
                const tag = tagLibraryCache.find(t => String(t.id) === tagId);
                if (!tag) return;
                const data = await openTagForm({ title: '编辑标签', name: tag.name, color: tag.color, description: tag.description || '' });
                if (!data) return;
                handleResponse(postJson(tag.update_url, data));
            });
        });

        tagLibraryEl.querySelectorAll('[data-tag-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.tag-library-item');
                const tagId = item.dataset.tagId;
                const tag = tagLibraryCache.find(t => String(t.id) === tagId);
                if (!tag) return;
                const confirmed = await showConfirmModal(`确定删除标签"${tag.name}"？关联的学生标签和规则也会被删除。`, { title: '删除标签' });
                if (!confirmed) return;
                handleResponse(postJson(tag.delete_url, {}));
            });
        });
    }

    function updateTagSelects(tags) {
        const options = tags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        if (tagAssignSelect) tagAssignSelect.innerHTML = '<option value="">选择标签</option>' + options;
        if (tagRuleTagSelect) tagRuleTagSelect.innerHTML = '<option value="">选择标签</option>' + options;
    }

    function renderTagRules(rules) {
        tagRulesCache = rules || [];
        if (!tagRuleListEl) return;
        if (!tagRulesCache.length) {
            tagRuleListEl.innerHTML = '<div class="empty-hint">暂无规则</div>';
            return;
        }
        tagRuleListEl.innerHTML = tagRulesCache.map(rule => {
            const statusLabel = !rule.enabled ? '已停用' : rule.issue_count > 0 ? '有问题' : '正常';
            const statusClass = !rule.enabled ? 'constraint-badge-disabled' : rule.issue_count > 0 ? 'constraint-badge-warning' : 'constraint-badge-ok';
            const issuesHtml = (rule.issues || []).map(i => `<div class="tag-rule-issue">${escapeHtml(i.message || '')}</div>`).join('');
            return `
                <div class="tag-rule-item${rule.enabled ? '' : ' tag-rule-item-disabled'}" data-rule-id="${rule.pk}">
                    <div class="tag-rule-item-header">
                        <span class="tag-rule-item-title">${escapeHtml(rule.rule_type_display || rule.rule_type)}</span>
                        <div class="tag-rule-item-badges">
                            <span class="student-tag-badge" style="background:${escapeAttr(rule.tag_color || '#0a59f7')}22;color:${escapeAttr(rule.tag_color || '#0a59f7')}">${escapeHtml(rule.tag_name)}</span>
                            <span class="constraint-badge ${statusClass}">${statusLabel}</span>
                        </div>
                    </div>
                    <div class="tag-rule-item-summary">${escapeHtml(rule.summary || '')}</div>
                    ${rule.note ? `<div class="tag-rule-item-summary">备注：${escapeHtml(rule.note)}</div>` : ''}
                    ${issuesHtml ? `<div class="tag-rule-item-issues">${issuesHtml}</div>` : ''}
                    <div class="tag-rule-item-actions">
                        <button type="button" class="btn btn-secondary" data-rule-action="edit">编辑</button>
                        <button type="button" class="btn btn-secondary" data-rule-action="toggle">${rule.enabled ? '停用' : '启用'}</button>
                        <button type="button" class="btn btn-secondary" data-rule-action="delete">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        tagRuleListEl.querySelectorAll('[data-rule-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ruleId = btn.closest('.tag-rule-item').dataset.ruleId;
                const rule = tagRulesCache.find(r => String(r.pk) === ruleId);
                if (!rule) return;
                editingTagRuleId = rule.pk;
                if (tagRuleTagSelect) tagRuleTagSelect.value = rule.tag_id;
                if (tagRuleTypeSelect) { tagRuleTypeSelect.value = rule.rule_type; syncTagRuleFields(); }
                if (tagRuleRowMin) tagRuleRowMin.value = rule.row_min || '';
                if (tagRuleRowMax) tagRuleRowMax.value = rule.row_max || '';
                if (tagRuleColMin) tagRuleColMin.value = rule.col_min || '';
                if (tagRuleColMax) tagRuleColMax.value = rule.col_max || '';
                if (tagRuleDistance) tagRuleDistance.value = rule.distance || 1;
                if (tagRuleNote) tagRuleNote.value = rule.note || '';
                if (tagRuleCreateBtn) tagRuleCreateBtn.textContent = '更新规则';
                if (tagRuleCancelEditBtn) tagRuleCancelEditBtn.hidden = false;
            });
        });

        tagRuleListEl.querySelectorAll('[data-rule-action="toggle"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const ruleId = btn.closest('.tag-rule-item').dataset.ruleId;
                const rule = tagRulesCache.find(r => String(r.pk) === ruleId);
                if (!rule) return;
                handleResponse(postJson(rule.toggle_url, { enabled: !rule.enabled }));
            });
        });

        tagRuleListEl.querySelectorAll('[data-rule-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ruleId = btn.closest('.tag-rule-item').dataset.ruleId;
                const rule = tagRulesCache.find(r => String(r.pk) === ruleId);
                if (!rule) return;
                const confirmed = await showConfirmModal(`确定删除标签规则"${rule.summary || rule.rule_type_display}"？`, { title: '删除规则' });
                if (!confirmed) return;
                handleResponse(postJson(rule.delete_url, {}));
            });
        });
    }

    function syncTagRuleFields() {
        if (!tagRuleTypeSelect) return;
        const type = tagRuleTypeSelect.value;
        if (tagRuleAreaFields) tagRuleAreaFields.style.display = type === 'separate_same_tag' ? 'none' : '';
        if (tagRuleDistanceField) tagRuleDistanceField.style.display = type === 'separate_same_tag' ? '' : 'none';
    }

    function resetTagRuleForm() {
        editingTagRuleId = null;
        if (tagRuleTagSelect) tagRuleTagSelect.value = '';
        if (tagRuleTypeSelect) { tagRuleTypeSelect.value = 'must_area'; syncTagRuleFields(); }
        if (tagRuleRowMin) tagRuleRowMin.value = '';
        if (tagRuleRowMax) tagRuleRowMax.value = '';
        if (tagRuleColMin) tagRuleColMin.value = '';
        if (tagRuleColMax) tagRuleColMax.value = '';
        if (tagRuleDistance) tagRuleDistance.value = '1';
        if (tagRuleNote) tagRuleNote.value = '';
        if (tagRuleCreateBtn) tagRuleCreateBtn.textContent = '添加规则';
        if (tagRuleCancelEditBtn) tagRuleCancelEditBtn.hidden = true;
    }

    if (tagRuleTypeSelect) {
        tagRuleTypeSelect.addEventListener('change', syncTagRuleFields);
        syncTagRuleFields();
    }

    if (tagRuleCancelEditBtn) {
        tagRuleCancelEditBtn.addEventListener('click', resetTagRuleForm);
    }

    if (tagRuleCreateBtn) {
        tagRuleCreateBtn.addEventListener('click', () => {
            const tagId = tagRuleTagSelect ? tagRuleTagSelect.value : '';
            const ruleType = tagRuleTypeSelect ? tagRuleTypeSelect.value : '';
            if (!tagId) { notify('请选择标签'); return; }
            const payload = { tag_id: parseInt(tagId), rule_type: ruleType, enabled: true };
            if (ruleType !== 'separate_same_tag') {
                if (tagRuleRowMin.value) payload.row_min = parseInt(tagRuleRowMin.value);
                if (tagRuleRowMax.value) payload.row_max = parseInt(tagRuleRowMax.value);
                if (tagRuleColMin.value) payload.col_min = parseInt(tagRuleColMin.value);
                if (tagRuleColMax.value) payload.col_max = parseInt(tagRuleColMax.value);
            } else {
                payload.distance = parseInt(tagRuleDistance.value) || 1;
            }
            if (tagRuleNote.value.trim()) payload.note = tagRuleNote.value.trim();
            const url = editingTagRuleId
                ? tagRulesCache.find(r => r.pk === editingTagRuleId)?.update_url
                : urls.tagRulesCreate;
            if (!url) return;
            handleResponse(postJson(url, payload), () => {
                resetTagRuleForm();
            });
        });
    }

    if (btnCreateTag) {
        btnCreateTag.addEventListener('click', async () => {
            const data = await openTagForm({ title: '创建标签' });
            if (!data) return;
            handleResponse(postJson(urls.tags, data));
        });
    }

    if (tagAssignApplyBtn) {
        tagAssignApplyBtn.addEventListener('click', () => {
            const tagId = tagAssignSelect ? tagAssignSelect.value : '';
            const mode = tagAssignMode ? tagAssignMode.value : 'add';
            if (!tagId) { notify('请选择标签'); return; }
            const studentIds = [];
            selectedSeats.forEach(key => {
                const seat = seatElements.find(el => `${el.dataset.row}-${el.dataset.col}` === key);
                if (seat && seat.dataset.studentId) studentIds.push(parseInt(seat.dataset.studentId));
            });
            if (!studentIds.length) { notify('请先选中有学生的座位'); return; }
            handleResponse(postJson(urls.tagsAssign, {
                student_ids: studentIds,
                tag_ids: [parseInt(tagId)],
                mode: mode,
            }));
        });
    }

    function renderStudentFormTags(allTags, selectedTagIds) {
        const container = document.getElementById('studentFormTags');
        if (!container) return;
        if (!allTags || !allTags.length) {
            container.innerHTML = '<span class="tag-picker-empty">暂无标签</span>';
            return;
        }
        const selectedSet = new Set((selectedTagIds || []).map(String));
        container.innerHTML = allTags.map(tag => {
            const sel = selectedSet.has(String(tag.id));
            return `<span class="tag-picker-chip${sel ? ' selected' : ''}"
                data-tag-id="${tag.id}"
                style="background:${escapeAttr(tag.color)}22;color:${escapeAttr(tag.color)}"
                >${escapeHtml(tag.name)}</span>`;
        }).join('');
        container.querySelectorAll('.tag-picker-chip').forEach(chip => {
            chip.addEventListener('click', () => chip.classList.toggle('selected'));
        });
    }

    function getStudentFormSelectedTagIds() {
        const container = document.getElementById('studentFormTags');
        if (!container) return [];
        return Array.from(container.querySelectorAll('.tag-picker-chip.selected')).map(el => parseInt(el.dataset.tagId));
    }

    document.querySelectorAll('#tagAssignToggle, #tagRuleToggle').forEach(toggle => {
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            const section = toggle.closest('.collapsible-section');
            if (section) section.classList.toggle('open');
        });
    });


    const classroomId = root.dataset.classroomId || '';
    const extensionsListUrl = root.dataset.extensionsListUrl || '/extensions/';
    const pluginHubModal = document.getElementById('plugin-hub-modal');
    const pluginHubList = document.getElementById('pluginHubList');
    const pluginHubRefreshBtn = document.getElementById('pluginHubRefreshBtn');
    const openPluginHubBtn = document.getElementById('btn-open-plugin-hub');
    const openPluginCommandBtn = document.getElementById('btn-open-plugin-command');
    const pluginQuickLaunch = document.getElementById('pluginQuickLaunch');
    const pluginCommandModal = document.getElementById('plugin-command-modal');
    const pluginCommandInput = document.getElementById('pluginCommandInput');
    const pluginCommandList = document.getElementById('pluginCommandList');
    const pluginRuntimeExtension = document.getElementById('pluginRuntimeExtension');
    const pluginRuntimeType = document.getElementById('pluginRuntimeType');
    const pluginRuntimeName = document.getElementById('pluginRuntimeName');
    const pluginRuntimeMethod = document.getElementById('pluginRuntimeMethod');
    const pluginRuntimePayload = document.getElementById('pluginRuntimePayload');
    const pluginRuntimeSendBtn = document.getElementById('pluginRuntimeSendBtn');
    const pluginRuntimeResponse = document.getElementById('pluginRuntimeResponse');
    const DEFAULT_EXTENSION_STORAGE_KEY = 'seats_default_extension';

    let cachedExtensions = [];
    let cachedPluginCommands = [];
    const workspaceScriptRuntime = new Map();
    const workspaceScriptCleanup = new Map();

    const setRuntimeResponse = (value) => {
        if (!pluginRuntimeResponse) return;
        let text = '';
        try {
            text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        } catch (_) {
            text = String(value || '');
        }
        pluginRuntimeResponse.textContent = text;
    };

    const getStoredDefaultExtension = () => {
        try {
            return localStorage.getItem(DEFAULT_EXTENSION_STORAGE_KEY) || '';
        } catch (_) {
            return '';
        }
    };

    const setStoredDefaultExtension = (extensionId) => {
        if (!extensionId) return;
        try {
            localStorage.setItem(DEFAULT_EXTENSION_STORAGE_KEY, extensionId);
        } catch (_) {
        }
    };

    const getExtensionById = (extensionId) => {
        const id = String(extensionId || '').trim();
        if (!id) return null;
        return cachedExtensions.find((item) => item.id === id) || null;
    };

    const getDefaultExtensionId = () => {
        const preferred = pluginRuntimeExtension && pluginRuntimeExtension.value ? pluginRuntimeExtension.value : '';
        if (preferred) return preferred;
        const stored = getStoredDefaultExtension();
        if (stored && getExtensionById(stored)) return stored;
        return cachedExtensions.length ? cachedExtensions[0].id : '';
    };

    const buildExtensionsListUrl = () => {
        const base = new URL(extensionsListUrl, window.location.origin);
        if (classroomId) {
            base.searchParams.set('classroom_id', classroomId);
        }
        return `${base.pathname}${base.search}`;
    };

    const requestJsonWithStatus = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const headers = Object.assign({}, options.headers || {});
        if (!headers['X-Requested-With']) {
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }

        const fetchOptions = {
            method,
            headers,
            credentials: 'same-origin',
        };

        if (method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            headers['X-CSRFToken'] = csrf;
            fetchOptions.body = JSON.stringify(options.body || {});
        }

        const response = await fetch(url, fetchOptions);
        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }
        return { ok: response.ok, status: response.status, data };
    };

    const buildUiPageUrl = (extensionId, uiName) => {
        const base = `/plugins/${encodeURIComponent(extensionId)}/ui/${encodeURIComponent(uiName)}/page/`;
        if (!classroomId) return base;
        return `${base}?classroom_id=${encodeURIComponent(classroomId)}`;
    };

    const buildManifestUrl = (extensionId) => `/extensions/${encodeURIComponent(extensionId)}/manifest.json`;
    const buildSendMessageUrl = (extensionId) => `/extensions/${encodeURIComponent(extensionId)}/runtime/send-message/`;
    const buildPermissionUrl = (extensionId) => `/extensions/${encodeURIComponent(extensionId)}/permissions/`;

    const sendRuntimeMessage = async (extensionId, message) => {
        const id = String(extensionId || '').trim() || getDefaultExtensionId();
        if (!id) {
            throw new Error('当前没有可用扩展');
        }
        const body = {
            classroom_id: classroomId || null,
            message,
        };
        const { ok, status, data } = await requestJsonWithStatus(buildSendMessageUrl(id), {
            method: 'POST',
            body,
        });
        if (!ok) {
            const msg = (data && data.message) ? data.message : `请求失败（${status}）`;
            throw new Error(msg);
        }
        return data;
    };

    const setWorkspacePermission = async (extensionId, granted, options = {}) => {
        if (!classroomId) {
            throw new Error('当前页面缺少 classroom_id，无法授权');
        }
        const { ok, status, data } = await requestJsonWithStatus(buildPermissionUrl(extensionId), {
            method: 'POST',
            body: {
                classroom_id: classroomId,
                granted: !!granted,
            },
        });
        if (!ok) {
            const msg = (data && data.message) ? data.message : `授权请求失败（${status}）`;
            throw new Error(msg);
        }

        const ext = getExtensionById(extensionId);
        if (ext) {
            ext.workspace_permission_granted = !!data.granted;
        }

        if (!options.silent) {
            showInlineToast(data.granted ? `已授权 ${extensionId} 修改页面` : `已撤销 ${extensionId} 页面修改授权`);
        }
        return !!data.granted;
    };

    const ensureWorkspacePermission = async (extensionId, options = {}) => {
        const ext = getExtensionById(extensionId);
        if (!ext) throw new Error(`扩展不存在：${extensionId}`);

        const requiresPermission = !!ext.workspace_permission_required;
        if (!requiresPermission) return true;
        if (ext.workspace_permission_granted) return true;
        if (!options.interactive) return false;

        const title = ext.name || ext.id;
        const confirmed = await showConfirmModal(`插件”${title}”请求修改当前工作页面，是否授权？`, { title: '插件授权' });
        if (!confirmed) return false;
        return setWorkspacePermission(extensionId, true, { silent: true });
    };

    const fillRuntimeExtensionSelect = () => {
        if (!pluginRuntimeExtension) return;
        const current = getDefaultExtensionId();
        pluginRuntimeExtension.innerHTML = '';
        cachedExtensions.forEach((ext) => {
            const option = document.createElement('option');
            option.value = ext.id;
            option.textContent = `${ext.name || ext.id} (${ext.id})`;
            pluginRuntimeExtension.appendChild(option);
        });
        if (current && getExtensionById(current)) {
            pluginRuntimeExtension.value = current;
            setStoredDefaultExtension(current);
        }
    };

    const updateRuntimeFieldState = () => {
        if (!pluginRuntimeType || !pluginRuntimeName || !pluginRuntimeMethod || !pluginRuntimePayload) return;
        const type = pluginRuntimeType.value;
        const hideName = type === 'manifest';
        pluginRuntimeName.disabled = hideName;
        pluginRuntimeMethod.disabled = hideName;
        if (hideName) {
            pluginRuntimeName.value = '';
            pluginRuntimeMethod.value = 'GET';
        }
    };

    const createPluginChip = (label, className, dataset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `plugin-hub-chip-btn ${className || ''}`.trim();
        btn.textContent = label;
        Object.keys(dataset || {}).forEach((key) => {
            btn.dataset[key] = dataset[key];
        });
        return btn;
    };

    const teardownWorkspaceScriptsForExtension = (extensionId) => {
        const prefix = `${extensionId}:`;
        Array.from(workspaceScriptRuntime.keys()).forEach((key) => {
            if (!key.startsWith(prefix)) return;
            const cleanup = workspaceScriptCleanup.get(key);
            if (typeof cleanup === 'function') {
                try {
                    cleanup();
                } catch (_) {
                }
            }
            workspaceScriptCleanup.delete(key);
            workspaceScriptRuntime.delete(key);
        });
    };

    const buildPluginCommands = () => {
        const rows = [];
        cachedExtensions.forEach((ext) => {
            const extName = ext.name || ext.id;

            rows.push({
                id: `${ext.id}:manifest`,
                kind: 'manifest',
                extensionId: ext.id,
                title: `${extName} · Manifest`,
                description: '查看扩展 manifest.json',
            });

            (ext.ui_scripts || []).forEach((ui) => {
                rows.push({
                    id: `${ext.id}:ui-open:${ui.name}`,
                    kind: 'uiOpen',
                    extensionId: ext.id,
                    uiName: ui.name,
                    title: `${extName} · 打开 UI · ${ui.name}`,
                    description: '打开插件界面（page 渲染）',
                });
                rows.push({
                    id: `${ext.id}:ui-json:${ui.name}`,
                    kind: 'uiJson',
                    extensionId: ext.id,
                    uiName: ui.name,
                    title: `${extName} · 读取 UI JSON · ${ui.name}`,
                    description: '调用 runtime.sendMessage(type=ui)',
                });
            });

            (ext.actions || []).forEach((action) => {
                rows.push({
                    id: `${ext.id}:action:${action.name}`,
                    kind: 'action',
                    extensionId: ext.id,
                    actionName: action.name,
                    title: `${extName} · 执行动作 · ${action.name}`,
                    description: action.description || '调用 runtime.sendMessage(type=action)',
                });
            });

            (ext.workspace_scripts || []).forEach((script) => {
                rows.push({
                    id: `${ext.id}:workspace:${script.name}`,
                    kind: 'workspaceApply',
                    extensionId: ext.id,
                    scriptName: script.name,
                    title: `${extName} · 页面改造 · ${script.name}`,
                    description: script.description || '执行页面增强脚本（需授权）',
                });
            });
        });
        cachedPluginCommands = rows;
    };

    const getPluginCommandById = (commandId) => cachedPluginCommands.find((item) => item.id === commandId) || null;

    const getFilteredPluginCommands = (keyword) => {
        const text = String(keyword || '').trim().toLowerCase();
        if (!text) return cachedPluginCommands;
        return cachedPluginCommands.filter((item) => {
            const base = `${item.title || ''} ${item.description || ''} ${item.extensionId || ''} ${item.uiName || ''} ${item.actionName || ''} ${item.scriptName || ''}`.toLowerCase();
            return base.includes(text);
        });
    };

    const renderPluginCommandList = (keyword = '') => {
        if (!pluginCommandList) return;
        pluginCommandList.innerHTML = '';

        const rows = getFilteredPluginCommands(keyword).slice(0, 60);
        if (!rows.length) {
            pluginCommandList.innerHTML = '<div class="empty-hint">未匹配到任何插件命令</div>';
            return;
        }

        rows.forEach((cmd) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'plugin-command-item';
            row.dataset.commandId = cmd.id;
            row.innerHTML = `
                <div class="plugin-command-item-main">
                    <div class="plugin-command-item-title">${cmd.title}</div>
                    <div class="plugin-command-item-desc">${cmd.description}</div>
                </div>
                <span class="plugin-command-item-kind">${cmd.kind}</span>
            `;
            pluginCommandList.appendChild(row);
        });
    };

    const renderPluginQuickLaunch = () => {
        if (!pluginQuickLaunch) return;
        pluginQuickLaunch.innerHTML = '';

        if (!cachedExtensions.length) {
            pluginQuickLaunch.innerHTML = '<span class="plugin-quick-launch-empty">暂无插件快捷入口</span>';
            return;
        }

        cachedExtensions.forEach((ext) => {
            const firstUi = (ext.ui_scripts || [])[0];
            const firstAction = (ext.actions || [])[0];
            let commandId = '';
            let label = ext.name || ext.id;
            let primary = true;

            if (firstUi && firstUi.name) {
                commandId = `${ext.id}:ui-open:${firstUi.name}`;
                label = `${ext.name || ext.id} · UI`;
            } else if (firstAction && firstAction.name) {
                commandId = `${ext.id}:action:${firstAction.name}`;
                label = `${ext.name || ext.id} · 运行`;
                primary = false;
            } else if ((ext.workspace_scripts || []).length) {
                commandId = `${ext.id}:workspace:${ext.workspace_scripts[0].name}`;
                label = `${ext.name || ext.id} · 增强`;
                primary = false;
            }

            if (!commandId) {
                commandId = `${ext.id}:manifest`;
                label = `${ext.name || ext.id} · Manifest`;
                primary = false;
            }

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `plugin-quick-launch-btn ${primary ? 'primary' : ''}`.trim();
            btn.dataset.commandId = commandId;
            btn.textContent = label;
            pluginQuickLaunch.appendChild(btn);
        });
    };

    const workspaceComponentNames = ['card', 'title', 'text', 'pill_button', 'stack', 'badge'];

    const createWorkspaceComponent = (name, props = {}) => {
        const key = String(name || '').trim().toLowerCase();
        const payload = (props && typeof props === 'object') ? props : {};

        if (key === 'card') {
            const card = document.createElement('section');
            card.style.border = '1px solid rgba(10, 89, 247, 0.18)';
            card.style.borderRadius = '14px';
            card.style.background = 'rgba(255, 255, 255, 0.94)';
            card.style.backdropFilter = 'blur(12px)';
            card.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.12)';
            card.style.padding = '12px';
            if (payload.className) card.className = String(payload.className);
            if (payload.style && typeof payload.style === 'object') {
                Object.assign(card.style, payload.style);
            }
            return card;
        }

        if (key === 'title') {
            const title = document.createElement(payload.level === 1 ? 'h1' : payload.level === 2 ? 'h2' : 'h3');
            title.textContent = String(payload.text || '');
            title.style.margin = '0';
            title.style.fontSize = payload.level === 1 ? '22px' : payload.level === 2 ? '18px' : '15px';
            title.style.fontWeight = '700';
            return title;
        }

        if (key === 'text') {
            const p = document.createElement('p');
            p.textContent = String(payload.text || '');
            p.style.margin = '0';
            p.style.fontSize = '13px';
            p.style.color = '#475569';
            return p;
        }

        if (key === 'pill_button') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = String(payload.label || '按钮');
            btn.style.border = 'none';
            btn.style.borderRadius = '999px';
            btn.style.minHeight = '34px';
            btn.style.padding = '0 14px';
            var pc = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#0a59f7';
            btn.style.background = payload.variant === 'secondary' ? 'rgba(var(--primary-color-rgb, 10, 89, 247), 0.12)' : pc;
            btn.style.color = payload.variant === 'secondary' ? pc : '#fff';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = '600';
            if (typeof payload.onClick === 'function') {
                btn.addEventListener('click', payload.onClick);
            }
            return btn;
        }

        if (key === 'badge') {
            const chip = document.createElement('span');
            chip.textContent = String(payload.text || '标签');
            chip.style.border = '1px solid rgba(var(--primary-color-rgb, 10, 89, 247), 0.22)';
            chip.style.borderRadius = '999px';
            chip.style.padding = '2px 10px';
            chip.style.fontSize = '11px';
            chip.style.color = 'var(--primary-color, #0a59f7)';
            chip.style.background = 'rgba(var(--primary-color-rgb, 10, 89, 247), 0.08)';
            return chip;
        }

        if (key === 'stack') {
            const wrap = document.createElement('div');
            wrap.style.display = 'grid';
            wrap.style.gap = `${Number(payload.gap || 8)}px`;
            return wrap;
        }

        return null;
    };

    const createWorkspaceApi = (extensionId) => {
        const callSendMessage = async (message) => sendRuntimeMessage(extensionId, message || {});

        const componentApi = {
            names: () => workspaceComponentNames.slice(),
            create: (name, props = {}) => createWorkspaceComponent(name, props),
            card: (props = {}) => createWorkspaceComponent('card', props),
            title: (text, level = 3) => createWorkspaceComponent('title', { text, level }),
            text: (text) => createWorkspaceComponent('text', { text }),
            pillButton: (label, onClick = null, variant = 'primary') => createWorkspaceComponent('pill_button', {
                label,
                onClick,
                variant,
            }),
            badge: (text) => createWorkspaceComponent('badge', { text }),
            stack: (gap = 8) => createWorkspaceComponent('stack', { gap }),
        };

        return {
            extensionId,
            classroomId,
            toast: (message) => showInlineToast(message),
            runtime: {
                sendMessage: callSendMessage,
                runAction: async (actionName, payload = {}) => {
                    return callSendMessage({
                        type: 'action',
                        name: actionName,
                        method: 'POST',
                        payload,
                    });
                },
                getUI: async (uiName, payload = {}) => {
                    return callSendMessage({
                        type: 'ui',
                        name: uiName,
                        method: 'GET',
                        payload,
                    });
                },
            },
            components: componentApi,
            dom: {
                query: (selector, parent = document) => parent.querySelector(selector),
                queryAll: (selector, parent = document) => Array.from(parent.querySelectorAll(selector)),
                create: (tag, attrs = {}, children = []) => {
                    const element = document.createElement(tag);
                    Object.keys(attrs).forEach((key) => {
                        const value = attrs[key];
                        if (key === 'style' && value && typeof value === 'object') {
                            Object.assign(element.style, value);
                            return;
                        }
                        if (key === 'className') {
                            element.className = value;
                            return;
                        }
                        if (key.startsWith('on') && typeof value === 'function') {
                            element.addEventListener(key.slice(2).toLowerCase(), value);
                            return;
                        }
                        if (value !== undefined && value !== null) {
                            element.setAttribute(key, String(value));
                        }
                    });
                    (Array.isArray(children) ? children : [children]).forEach((child) => {
                        if (child == null) return;
                        if (child instanceof Node) {
                            element.appendChild(child);
                        } else {
                            element.appendChild(document.createTextNode(String(child)));
                        }
                    });
                    return element;
                },
            },
        };
    };

    const executeWorkspaceScriptSource = async (extensionId, scriptResult, options = {}) => {
        const scriptName = String(scriptResult.name || '').trim();
        if (!scriptName) {
            throw new Error('workspace script 名称无效');
        }
        const source = String(scriptResult.source || '').trim();
        if (!source) {
            throw new Error('workspace script 内容为空');
        }

        const runtimeKey = `${extensionId}:${scriptName}`;
        if (options.force && workspaceScriptRuntime.get(runtimeKey)) {
            teardownWorkspaceScriptsForExtension(extensionId);
        }
        if (workspaceScriptRuntime.get(runtimeKey)) {
            return;
        }

        const api = createWorkspaceApi(extensionId);
        const context = {
            extensionId,
            classroomId,
            scriptName,
        };

        const runner = new Function('api', 'context', source);
        const cleanup = runner(api, context);

        workspaceScriptRuntime.set(runtimeKey, true);
        if (typeof cleanup === 'function') {
            workspaceScriptCleanup.set(runtimeKey, cleanup);
        }
    };

    const runWorkspaceScriptByName = async (extensionId, scriptName, options = {}) => {
        const ext = getExtensionById(extensionId);
        if (!ext) {
            throw new Error(`扩展不存在：${extensionId}`);
        }

        const scriptMeta = (ext.workspace_scripts || []).find((item) => item.name === scriptName);
        if (!scriptMeta) {
            throw new Error(`页面改造脚本不存在：${extensionId}.${scriptName}`);
        }

        const allowed = await ensureWorkspacePermission(extensionId, { interactive: !!options.interactivePermission });
        if (!allowed && scriptMeta.requires_permission) {
            if (!options.silent) showInlineToast('未授权，已取消页面改造');
            return;
        }

        const response = await sendRuntimeMessage(extensionId, {
            type: 'workspace_script',
            name: scriptName,
            method: 'GET',
        });
        const scriptResult = response && response.result ? response.result : {};
        await executeWorkspaceScriptSource(extensionId, scriptResult, { force: !!options.force });

        if (!options.silent) {
            showInlineToast(`页面增强已应用：${extensionId}.${scriptName}`);
            setRuntimeResponse(response);
        }
    };

    const runAutoWorkspaceScripts = async () => {
        for (const ext of cachedExtensions) {
            const scripts = Array.isArray(ext.workspace_scripts) ? ext.workspace_scripts : [];
            for (const script of scripts) {
                if (!script.auto_run) continue;
                try {
                    await runWorkspaceScriptByName(ext.id, script.name, {
                        interactivePermission: false,
                        silent: true,
                    });
                } catch (_) {
                }
            }
        }
    };

    const executePluginCommand = async (cmd, options = {}) => {
        if (!cmd) return;

        if (cmd.kind === 'uiOpen') {
            window.location.href = buildUiPageUrl(cmd.extensionId, cmd.uiName);
            return;
        }

        if (cmd.kind === 'manifest') {
            const { ok, status, data } = await requestJsonWithStatus(buildManifestUrl(cmd.extensionId), { method: 'GET' });
            if (!ok) {
                throw new Error((data && data.message) ? data.message : `请求失败（${status}）`);
            }
            setRuntimeResponse(data);
            if (!options.silent) showInlineToast(`已获取 ${cmd.extensionId} manifest`);
            return;
        }

        if (cmd.kind === 'uiJson') {
            const result = await sendRuntimeMessage(cmd.extensionId, {
                type: 'ui',
                name: cmd.uiName,
                method: 'GET',
                payload: {},
            });
            setRuntimeResponse(result);
            if (!options.silent) showInlineToast(`已读取 ${cmd.extensionId}.${cmd.uiName} UI`);
            return;
        }

        if (cmd.kind === 'workspaceApply') {
            await runWorkspaceScriptByName(cmd.extensionId, cmd.scriptName, {
                interactivePermission: true,
                silent: !!options.silent,
            });
            return;
        }

        if (cmd.kind === 'action') {
            const result = await sendRuntimeMessage(cmd.extensionId, {
                type: 'action',
                name: cmd.actionName,
                method: 'POST',
                payload: {},
            });
            setRuntimeResponse(result);
            if (!options.silent) showInlineToast(`已执行 ${cmd.extensionId}.${cmd.actionName}`);
        }
    };

    const renderPluginHubCards = () => {
        if (!pluginHubList) return;
        pluginHubList.innerHTML = '';

        if (!cachedExtensions.length) {
            pluginHubList.innerHTML = '<div class="empty-hint">当前没有可用插件</div>';
            return;
        }

        const isDevMode = document.getElementById('pluginHubDevMode')?.checked;

        cachedExtensions.forEach((ext) => {
            const card = document.createElement('article');
            card.className = 'plugin-hub-card';

            const head = document.createElement('div');
            head.className = 'plugin-hub-card-head';
            head.innerHTML = `
                <div class="plugin-hub-card-title">${ext.name || ext.id}</div>
                <div class="plugin-hub-card-version">v${ext.version || '0.0.1'}</div>
            `;
            card.appendChild(head);

            const desc = document.createElement('div');
            desc.className = 'plugin-hub-card-desc';
            desc.textContent = ext.description || '无描述';
            card.appendChild(desc);

            if (isDevMode) {
                const basicRow = document.createElement('div');
                basicRow.className = 'plugin-hub-card-row';
                basicRow.appendChild(createPluginChip('查看 Manifest', '', {
                    commandId: `${ext.id}:manifest`,
                }));
                card.appendChild(basicRow);
            }

            if (Array.isArray(ext.ui_scripts) && ext.ui_scripts.length) {
                const uiRow = document.createElement('div');
                uiRow.className = 'plugin-hub-card-row';
                ext.ui_scripts.forEach((ui) => {
                    uiRow.appendChild(createPluginChip(
                        isDevMode ? `打开 UI: ${ui.name}` : `打开 ${ui.name}`,
                        'primary',
                        { commandId: `${ext.id}:ui-open:${ui.name}` }
                    ));
                    if (isDevMode) {
                        uiRow.appendChild(createPluginChip(`取 UI JSON: ${ui.name}`, '', {
                            commandId: `${ext.id}:ui-json:${ui.name}`,
                        }));
                    }
                });
                card.appendChild(uiRow);
            }

            if (Array.isArray(ext.actions) && ext.actions.length) {
                const actionRow = document.createElement('div');
                actionRow.className = 'plugin-hub-card-row';
                ext.actions.forEach((action) => {
                    actionRow.appendChild(createPluginChip(
                        isDevMode ? `执行 ${action.name}` : action.name,
                        isDevMode ? '' : 'primary',
                        { commandId: `${ext.id}:action:${action.name}` }
                    ));
                });
                card.appendChild(actionRow);
            }

            if (Array.isArray(ext.workspace_scripts) && ext.workspace_scripts.length) {
                const workspaceRow = document.createElement('div');
                workspaceRow.className = 'plugin-hub-card-row';

                const allowBtn = createPluginChip(
                    ext.workspace_permission_granted
                        ? (isDevMode ? '撤销页面改造授权' : '已启用页面增强')
                        : (isDevMode ? '授权页面改造' : '启用页面增强'),
                    ext.workspace_permission_granted ? '' : 'primary',
                    {
                        grantPluginId: ext.id,
                        grantValue: ext.workspace_permission_granted ? '0' : '1',
                    }
                );
                workspaceRow.appendChild(allowBtn);

                if (isDevMode) {
                    ext.workspace_scripts.forEach((script) => {
                        workspaceRow.appendChild(createPluginChip(`应用增强: ${script.name}`, '', {
                            commandId: `${ext.id}:workspace:${script.name}`,
                        }));
                    });
                }

                card.appendChild(workspaceRow);
            }

            pluginHubList.appendChild(card);
        });
    };

    const openPluginCommandModal = () => {
        if (!pluginCommandModal) return;
        pluginCommandModal.style.display = 'block';
        renderPluginCommandList(pluginCommandInput ? pluginCommandInput.value : '');
        if (pluginCommandInput) {
            setTimeout(() => {
                pluginCommandInput.focus();
                pluginCommandInput.select();
            }, 0);
        }
    };

    const closePluginCommandModal = () => {
        if (!pluginCommandModal) return;
        pluginCommandModal.style.display = 'none';
    };

    const initChromeLikePluginApi = () => {
        const sendWithDefault = async (extensionId, message = {}) => {
            const targetId = String(extensionId || '').trim() || getDefaultExtensionId();
            if (!targetId) {
                throw new Error('无可用扩展，请先安装插件');
            }
            return sendRuntimeMessage(targetId, message || {});
        };

        window.chrome = window.chrome || {};
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.runtime.sendMessage = (extensionOrMessage, maybeMessage, maybeCallback) => {
            let extensionId = '';
            let message = {};
            let callback = null;

            if (typeof extensionOrMessage === 'string') {
                extensionId = extensionOrMessage;
                message = maybeMessage || {};
                callback = typeof maybeCallback === 'function' ? maybeCallback : null;
            } else {
                message = extensionOrMessage || {};
                callback = typeof maybeMessage === 'function' ? maybeMessage : null;
                extensionId = message.extensionId || message.extension_id || '';
                if (message.extensionId) delete message.extensionId;
                if (message.extension_id) delete message.extension_id;
            }

            const promise = sendWithDefault(extensionId, message)
                .then((result) => {
                    if (callback) callback(result);
                    return result;
                })
                .catch((error) => {
                    const payload = { status: 'error', message: String(error) };
                    if (callback) callback(payload);
                    throw error;
                });

            return promise;
        };

        window.SeatsComponentLibrary = {
            names() {
                return workspaceComponentNames.slice();
            },
            create(name, props = {}) {
                return createWorkspaceComponent(name, props);
            },
            card(props = {}) {
                return createWorkspaceComponent('card', props);
            },
            title(text, level = 3) {
                return createWorkspaceComponent('title', { text, level });
            },
            text(text) {
                return createWorkspaceComponent('text', { text });
            },
            pillButton(label, onClick = null, variant = 'primary') {
                return createWorkspaceComponent('pill_button', { label, onClick, variant });
            },
            badge(text) {
                return createWorkspaceComponent('badge', { text });
            },
            stack(gap = 8) {
                return createWorkspaceComponent('stack', { gap });
            },
        };

        window.SeatsPlugins = {
            listExtensions() {
                return cachedExtensions.slice();
            },
            use(extensionId) {
                if (!getExtensionById(extensionId)) return false;
                setStoredDefaultExtension(extensionId);
                if (pluginRuntimeExtension) pluginRuntimeExtension.value = extensionId;
                return true;
            },
            async sendMessage(message = {}, extensionId = '') {
                return sendWithDefault(extensionId, message);
            },
            async runAction(actionName, payload = {}, extensionId = '') {
                return sendWithDefault(extensionId, {
                    type: 'action',
                    name: actionName,
                    method: 'POST',
                    payload: payload || {},
                });
            },
            async getUI(uiName, payload = {}, extensionId = '') {
                return sendWithDefault(extensionId, {
                    type: 'ui',
                    name: uiName,
                    method: 'GET',
                    payload: payload || {},
                });
            },
            openUI(uiName, extensionId = '') {
                const targetId = String(extensionId || '').trim() || getDefaultExtensionId();
                if (!targetId) return false;
                window.location.href = buildUiPageUrl(targetId, uiName);
                return true;
            },
            async runWorkspace(scriptName, extensionId = '', options = {}) {
                const targetId = String(extensionId || '').trim() || getDefaultExtensionId();
                if (!targetId) {
                    throw new Error('无可用扩展');
                }
                return runWorkspaceScriptByName(targetId, scriptName, {
                    interactivePermission: !!options.interactivePermission,
                    silent: !!options.silent,
                    force: !!options.force,
                });
            },
        };

        document.dispatchEvent(new CustomEvent('seats:plugins-ready', {
            detail: {
                extensions: cachedExtensions.slice(),
                defaultExtension: getDefaultExtensionId(),
            },
        }));
    };

    const loadExtensionList = async () => {
        if (pluginHubList) {
            pluginHubList.innerHTML = '<div class="empty-hint">正在加载插件...</div>';
        }
        try {
            const { ok, status, data } = await requestJsonWithStatus(buildExtensionsListUrl(), { method: 'GET' });
            if (!ok || !data || data.status !== 'success') {
                const msg = (data && data.message) ? data.message : `加载失败（${status}）`;
                if (pluginHubList) {
                    pluginHubList.innerHTML = `<div class="empty-hint">${msg}</div>`;
                }
                if (pluginQuickLaunch) {
                    pluginQuickLaunch.innerHTML = `<span class="plugin-quick-launch-empty">${msg}</span>`;
                }
                return;
            }

            cachedExtensions = Array.isArray(data.extensions) ? data.extensions : [];
            buildPluginCommands();
            fillRuntimeExtensionSelect();
            renderPluginQuickLaunch();
            renderPluginHubCards();
            renderPluginCommandList(pluginCommandInput ? pluginCommandInput.value : '');
            initChromeLikePluginApi();

            if (cachedExtensions.length) {
                setRuntimeResponse({
                    status: 'ready',
                    extension: getDefaultExtensionId(),
                    tips: '快捷入口、命令面板与无感调用 API 已就绪。',
                });
                await runAutoWorkspaceScripts();
            } else {
                setRuntimeResponse('暂无扩展可调用');
            }
        } catch (error) {
            if (pluginHubList) {
                pluginHubList.innerHTML = `<div class="empty-hint">加载失败：${error}</div>`;
            }
            if (pluginQuickLaunch) {
                pluginQuickLaunch.innerHTML = `<span class="plugin-quick-launch-empty">加载失败：${error}</span>`;
            }
        }
    };

    const initPluginHub = () => {
        if (!pluginHubModal) return;

        const pluginHubDevMode = document.getElementById('pluginHubDevMode');
        const pluginHubGrid = document.querySelector('.plugin-hub-grid');
        if (pluginHubDevMode && pluginHubGrid) {
            const savedMode = localStorage.getItem('seats_plugin_dev_mode') === '1';
            pluginHubDevMode.checked = savedMode;
            if (savedMode) pluginHubGrid.classList.add('dev-mode');
            pluginHubDevMode.addEventListener('change', () => {
                pluginHubGrid.classList.toggle('dev-mode', pluginHubDevMode.checked);
                localStorage.setItem('seats_plugin_dev_mode', pluginHubDevMode.checked ? '1' : '0');
                renderPluginHubCards();
            });
        }

        if (openPluginHubBtn) {
            openPluginHubBtn.addEventListener('click', () => {
                loadExtensionList();
            });
        }

        if (openPluginCommandBtn) {
            openPluginCommandBtn.addEventListener('click', () => {
                openPluginCommandModal();
            });
        }

        if (pluginHubRefreshBtn) {
            pluginHubRefreshBtn.addEventListener('click', () => {
                loadExtensionList();
            });
        }

        if (pluginRuntimeExtension) {
            pluginRuntimeExtension.addEventListener('change', () => {
                if (pluginRuntimeExtension.value) {
                    setStoredDefaultExtension(pluginRuntimeExtension.value);
                }
            });
        }

        if (pluginRuntimeType) {
            pluginRuntimeType.addEventListener('change', () => {
                updateRuntimeFieldState();
            });
            updateRuntimeFieldState();
        }

        if (pluginHubList) {
            pluginHubList.addEventListener('click', async (event) => {
                const grantBtn = event.target.closest('button[data-grant-plugin-id]');
                if (grantBtn) {
                    const extensionId = grantBtn.dataset.grantPluginId;
                    const shouldGrant = grantBtn.dataset.grantValue === '1';
                    try {
                        await setWorkspacePermission(extensionId, shouldGrant);
                        if (shouldGrant) {
                            const ext = getExtensionById(extensionId);
                            const scripts = Array.isArray(ext && ext.workspace_scripts) ? ext.workspace_scripts : [];
                            for (const script of scripts) {
                                if (!script.auto_run) continue;
                                await runWorkspaceScriptByName(extensionId, script.name, {
                                    interactivePermission: false,
                                    silent: true,
                                });
                            }
                        } else {
                            teardownWorkspaceScriptsForExtension(extensionId);
                        }
                        buildPluginCommands();
                        renderPluginHubCards();
                        renderPluginCommandList(pluginCommandInput ? pluginCommandInput.value : '');
                    } catch (error) {
                        setRuntimeResponse({ status: 'error', message: String(error) });
                        showInlineToast(`授权更新失败：${error}`);
                    }
                    return;
                }

                const btn = event.target.closest('button[data-command-id]');
                if (!btn) return;
                const cmd = getPluginCommandById(btn.dataset.commandId);
                if (!cmd) return;
                try {
                    await executePluginCommand(cmd);
                } catch (error) {
                    setRuntimeResponse({ status: 'error', message: String(error) });
                    showInlineToast(`插件调用失败：${error}`);
                }
            });
        }

        if (pluginQuickLaunch) {
            pluginQuickLaunch.addEventListener('click', async (event) => {
                const btn = event.target.closest('button[data-command-id]');
                if (!btn) return;
                const cmd = getPluginCommandById(btn.dataset.commandId);
                if (!cmd) return;
                try {
                    await executePluginCommand(cmd);
                } catch (error) {
                    setRuntimeResponse({ status: 'error', message: String(error) });
                    showInlineToast(`插件调用失败：${error}`);
                }
            });
        }

        if (pluginRuntimeSendBtn) {
            pluginRuntimeSendBtn.addEventListener('click', async () => {
                if (!pluginRuntimeType) return;
                const extensionId = getDefaultExtensionId();
                if (!extensionId) {
                    showInlineToast('请先选择扩展');
                    return;
                }

                const type = pluginRuntimeType.value;
                const name = pluginRuntimeName ? pluginRuntimeName.value.trim() : '';
                const method = pluginRuntimeMethod ? pluginRuntimeMethod.value : 'POST';

                let messagePayload = {};
                if (pluginRuntimePayload && pluginRuntimePayload.value.trim()) {
                    try {
                        messagePayload = JSON.parse(pluginRuntimePayload.value.trim());
                    } catch (_) {
                        showInlineToast('payload 不是合法 JSON');
                        return;
                    }
                }

                const message = {
                    type,
                    method,
                };
                if (type === 'action') {
                    if (!name) {
                        showInlineToast('action 类型必须填写名称');
                        return;
                    }
                    message.name = name;
                }
                if (type === 'ui' || type === 'workspace_script') {
                    if (!name) {
                        showInlineToast(`${type} 类型必须填写名称`);
                        return;
                    }
                    message.name = name;
                }
                if (Object.keys(messagePayload || {}).length) {
                    message.payload = messagePayload;
                }

                try {
                    const result = await sendRuntimeMessage(extensionId, message);
                    setRuntimeResponse(result);
                    showInlineToast('runtime.sendMessage 调用成功');
                } catch (error) {
                    setRuntimeResponse({ status: 'error', message: String(error) });
                    showInlineToast(`runtime.sendMessage 调用失败：${error}`);
                }
            });
        }

        if (pluginCommandInput) {
            pluginCommandInput.addEventListener('input', () => {
                renderPluginCommandList(pluginCommandInput.value);
            });
            pluginCommandInput.addEventListener('keydown', async (event) => {
                if (event.key === 'Escape') {
                    closePluginCommandModal();
                    return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const rows = getFilteredPluginCommands(pluginCommandInput.value);
                if (!rows.length) return;
                try {
                    await executePluginCommand(rows[0]);
                    closePluginCommandModal();
                } catch (error) {
                    setRuntimeResponse({ status: 'error', message: String(error) });
                    showInlineToast(`插件调用失败：${error}`);
                }
            });
        }

        if (pluginCommandList) {
            pluginCommandList.addEventListener('click', async (event) => {
                const row = event.target.closest('[data-command-id]');
                if (!row) return;
                const cmd = getPluginCommandById(row.dataset.commandId);
                if (!cmd) return;
                try {
                    await executePluginCommand(cmd);
                    closePluginCommandModal();
                } catch (error) {
                    setRuntimeResponse({ status: 'error', message: String(error) });
                    showInlineToast(`插件调用失败：${error}`);
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || (event.key || '').toLowerCase() !== 'k') {
                return;
            }
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }
            event.preventDefault();
            openPluginCommandModal();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && pluginCommandModal && pluginCommandModal.style.display === 'block') {
                closePluginCommandModal();
            }
        });

        loadExtensionList();
    };

    const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const exportBridge = window.FuckSeatsDesktop || {};

    const parseAcceptExtensions = (raw = '') => {
        if (typeof exportBridge.parseAcceptExtensions === 'function') {
            return exportBridge.parseAcceptExtensions(raw);
        }
        return String(raw)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => (item.startsWith('.') ? item : `.${item}`));
    };

    const saveExportFromUrl = async (url, options = {}) => {
        if (typeof exportBridge.saveExportFromUrl === 'function') {
            return exportBridge.saveExportFromUrl(url, options);
        }
        throw new Error('导出桥接未加载');
    };

    const setExportAnchorPending = (anchor, pending) => {
        if (!anchor) return;
        if (pending) {
            anchor.dataset.pending = '1';
            anchor.dataset.prevText = anchor.textContent || '';
            anchor.style.pointerEvents = 'none';
            anchor.textContent = '保存中...';
            return;
        }
        anchor.dataset.pending = '';
        anchor.style.pointerEvents = '';
        if (anchor.dataset.prevText) {
            anchor.textContent = anchor.dataset.prevText;
        }
    };

    const bindSystemSaveLinks = () => {
        document.querySelectorAll('a[data-system-save="1"]').forEach((anchor) => {
            if (anchor.dataset.boundSystemSave === '1') return;
            anchor.dataset.boundSystemSave = '1';
            anchor.addEventListener('click', async (event) => {
                event.preventDefault();
                if (anchor.dataset.pending === '1') return;
                const href = anchor.getAttribute('href');
                const fallbackFilename = anchor.dataset.defaultFilename || '';
                const acceptMime = anchor.dataset.acceptMime || '';
                const acceptExtensions = parseAcceptExtensions(anchor.dataset.acceptExt || '');
                setExportAnchorPending(anchor, true);
                try {
                    const result = await saveExportFromUrl(href, {
                        fallbackFilename,
                        acceptMime,
                        acceptExtensions
                    });
                    if (result.status === 'saved') {
                        showInlineToast(`文件已保存：${result.filename}`);
                    } else if (result.status === 'downloaded') {
                        showInlineToast(`已开始下载：${result.filename}`);
                    }
                } catch (error) {
                    notify(error?.message || '导出失败');
                } finally {
                    setExportAnchorPending(anchor, false);
                }
            });
        });
    };

    const postForm = (url, formData = null) => {
        return fetch(url, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrf,
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: formData
        }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok || (data && data.status && data.status !== 'success')) {
                throw new Error(data.message || '操作失败');
            }
            return data;
        });
    };

    const dispatchStudentMoved = (detail = {}) => {
        document.dispatchEvent(new CustomEvent('fuckseats:student-moved', {
            detail
        }));
    };

    const handleResponse = (promise, onSuccess = null, afterRefresh = null) => {
        promise.then(data => {
            if (data && data.status && data.status !== 'success') {
                notify(data.message || '操作失败');
                return;
            }
            if (onSuccess) onSuccess(data);
            const refreshed = refreshState();
            if (afterRefresh) {
                refreshed.then(() => afterRefresh(data)).catch(() => {});
            }
        }).catch((err) => notify(err?.message || '操作失败'));
    };

    const handleHistoryResponse = (promise) => {
        promise.then(data => {
            if (data && data.status && data.status !== 'success') {
                notify(data.message || '操作失败');
                return;
            }
            window.location.reload();
        }).catch((err) => notify(err?.message || '操作失败'));
    };

    const postFormAjax = (form, { onSuccess, reload = false } = {}) => {
        const url = form.action;
        const formData = new FormData(form);
        const promise = fetch(url, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrf,
            },
            body: new URLSearchParams(formData),
        }).then(res => res.json());

        if (reload) {
            handleHistoryResponse(promise);
        } else {
            handleResponse(promise, onSuccess);
        }
    };

    const ajaxifyForm = (formSelector, options = {}) => {
        const form = typeof formSelector === 'string'
            ? document.querySelector(formSelector)
            : formSelector;
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            postFormAjax(form, options);
            if (options.resetAfter !== false) form.reset();
        });
    };

    const hasEmptyGuide = !!document.getElementById('groupEmptyGuide');
    if (hasEmptyGuide) {
        const guideForm = document.getElementById('createGroupForm');
        if (guideForm) {
            guideForm.addEventListener('submit', function () {
                localStorage.setItem('group_guide_pending', 'true');
            }, true);
        }
    }
    ajaxifyForm('#createGroupForm', {
        reload: hasEmptyGuide,
        onSuccess: hasEmptyGuide ? null : () => showInlineToast('小组已创建'),
    });

    if (!hasEmptyGuide && localStorage.getItem('group_guide_pending') === 'true') {
        if (window.FUCKSEATS_ONBOARDING_ACTIVE === true) {
            localStorage.removeItem('group_guide_pending');
        } else {
            localStorage.removeItem('group_guide_pending');
            setTimeout(() => startGroupTour(), 400);
        }
    }

    function startGroupTour() {
        if (window.FUCKSEATS_ONBOARDING_ACTIVE === true) {
            try { localStorage.removeItem('group_guide_pending'); } catch (e) {}
            return;
        }
        const driverJs = window.driver && window.driver.js;
        if (!driverJs) return;

        const switchToGroupTab = () => {
            const tab = document.querySelector('.tab-btn[data-tab="groups"]');
            if (tab) tab.click();
        };

        switchToGroupTab();

        const groupTour = driverJs.driver({
            showProgress: true,
            animate: true,
            doneBtnText: '开始使用',
            nextBtnText: '下一步',
            prevBtnText: '上一步',
            steps: [
                {
                    element: '#groupList',
                    popover: {
                        title: '小组已创建',
                        description: '这里是你的小组列表。你可以继续添加更多小组，也可以重命名或删除已有小组。',
                    },
                    onHighlightStarted: () => {
                        switchToGroupTab();
                        const section = document.querySelector('#groupToolsToggle')?.closest('.collapsible-section');
                        if (section) section.classList.add('open');
                    },
                },
                {
                    element: '#groupAssignToggle',
                    popover: {
                        title: '开启分组模式',
                        description: '点击"分组模式"后，可以在座位区框选或点击多个座位，然后批量分配到指定小组。',
                    },
                    onHighlightStarted: switchToGroupTab,
                },
                {
                    element: '#groupSelect',
                    popover: {
                        title: '选择目标小组',
                        description: '在这里选择你要分配到的小组，然后点击"应用到选中"即可将框选的座位归入该组。',
                    },
                    onHighlightStarted: switchToGroupTab,
                },
                {
                    element: '#groupAutoBtn',
                    popover: {
                        title: '自动编组',
                        description: '不想手动分？点击自动编组，系统会根据座位位置自动将学生分成小组。',
                    },
                    onHighlightStarted: switchToGroupTab,
                },
                {
                    element: '#groupRotateBtn',
                    popover: {
                        title: '小组轮换',
                        description: '一键轮换小组成员的座位，适合需要定期换座的场景。',
                    },
                    onHighlightStarted: switchToGroupTab,
                },
            ],
            onDestroyStarted: () => {
                groupTour.destroy();
            },
        });

        groupTour.drive();
    }

    if (constraintTypeSelect) {
        constraintTypeSelect.addEventListener('change', syncConstraintFields);
    }

    if (constraintCancelEditBtn) {
        constraintCancelEditBtn.addEventListener('click', () => {
            resetConstraintForm();
        });
    }

    if (constraintForm) {
        resetConstraintForm();
        renderConstraintMetrics(deriveConstraintMetrics(constraintItems));
        renderConstraintList();

        constraintForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const isEditing = editingConstraintId != null;
            const formData = new FormData(constraintForm);
            if (!isEditing) {
                formData.delete('constraint_id');
            }
            const payload = Object.fromEntries(formData.entries());
            const url = isEditing
                ? (constraintForm.action || constraintForm.dataset.createUrl)
                : constraintForm.dataset.createUrl;
            handleResponse(postFormData(url, payload), (data) => {
                showInlineToast(data?.message || (isEditing ? '约束已更新' : '约束已创建'));
                resetConstraintForm();
            });
        });
    }

    if (constraintFilterGroup) {
        constraintFilterGroup.addEventListener('click', (event) => {
            const button = event.target.closest('[data-constraint-filter]');
            if (!button) return;
            activeConstraintFilter = button.dataset.constraintFilter || 'all';
            constraintFilterGroup.querySelectorAll('[data-constraint-filter]').forEach((item) => {
                item.classList.toggle('active', item === button);
            });
            renderConstraintList();
        });
    }

    if (constraintList) {
        constraintList.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('[data-constraint-action]');
            if (!actionButton) return;
            const itemElement = actionButton.closest('.constraint-item');
            if (!itemElement) return;
            const constraintPk = itemElement.dataset.constraintPk;
            const item = (constraintItems || []).find((entry) => String(entry.pk) === String(constraintPk));
            if (!item) return;

            const action = actionButton.dataset.constraintAction;
            if (action === 'edit') {
                populateConstraintForm(item);
                return;
            }

            if (action === 'toggle') {
                const nextEnabled = item.enabled ? '0' : '1';
                handleResponse(postFormData(item.toggle_url, { enabled: nextEnabled }), (data) => {
                    showInlineToast(data?.message || (item.enabled ? '约束已停用' : '约束已启用'));
                });
                return;
            }

            if (action === 'delete') {
                const confirmed = window.showConfirmModal
                    ? await window.showConfirmModal('确定要删除这条约束吗？')
                    : window.confirm('确定要删除这条约束吗？');
                if (!confirmed) return;
                handleResponse(postFormData(item.delete_url, {}), () => {
                    if (String(editingConstraintId) === String(item.pk)) {
                        resetConstraintForm();
                    }
                    showInlineToast('约束已删除');
                });
            }
        });
    }

    const snapshotForm = document.querySelector('form[action*="save_layout_snapshot"]');
    ajaxifyForm(snapshotForm, {
        reload: true,
    });

    document.querySelectorAll('.snapshot-item form[action*="delete_layout_snapshot"]').forEach(form => {
        ajaxifyForm(form, { reload: true, resetAfter: false });
    });

    const groupToolsToggle = document.getElementById('groupToolsToggle');
    if (groupToolsToggle) {
        const section = groupToolsToggle.closest('.collapsible-section');
        const stored = localStorage.getItem('groupToolsOpen');
        if (stored === 'true') section.classList.add('open');
        groupToolsToggle.addEventListener('click', () => {
            section.classList.toggle('open');
            localStorage.setItem('groupToolsOpen', section.classList.contains('open'));
        });
    }

    const applyUnseatedFilter = () => {
        if (!unseatedList || !unseatedSearch) return;
        const keyword = unseatedSearch.value.trim().toLowerCase();
        const items = unseatedList.querySelectorAll('.unseated-item');
        items.forEach((item) => {
            const name = item.querySelector('.unseated-name')?.textContent?.trim().toLowerCase() || '';
            item.style.display = !keyword || name.includes(keyword) ? '' : 'none';
        });
    };

    const ensureGroupEmptyHint = () => {
        if (!groupList) return;
        const items = groupList.querySelectorAll('.group-item');
        const hint = groupList.querySelector('.empty-hint');
        if (items.length === 0 && !hint) {
            const div = document.createElement('div');
            div.className = 'empty-hint';
            div.textContent = '暂无小组';
            groupList.appendChild(div);
        }
        if (items.length > 0 && hint) {
            hint.remove();
        }
    };

    const getGroupSelectControls = () => {
        return Array.from(document.querySelectorAll('.group-select-control'));
    };

    const upsertGroupOption = (groupId, groupName) => {
        if (!groupId) return;
        getGroupSelectControls().forEach((selectEl) => {
            let option = selectEl.querySelector(`option[value="${groupId}"]`);
            if (!option) {
                option = document.createElement('option');
                option.value = `${groupId}`;
                selectEl.appendChild(option);
            }
            option.textContent = groupName;
        });
    };

    const removeGroupOption = (groupId) => {
        if (!groupId) return;
        getGroupSelectControls().forEach((selectEl) => {
            const option = selectEl.querySelector(`option[value="${groupId}"]`);
            if (option) option.remove();
            if (selectEl.value === `${groupId}`) {
                selectEl.value = '';
            }
        });
    };

    const buildGroupItem = (groupId, groupName) => {
        const row = document.createElement('div');
        row.className = 'group-item';
        row.dataset.groupId = `${groupId}`;
        row.dataset.groupName = groupName;
        const name = document.createElement('span');
        name.textContent = groupName;

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '4px';

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'btn btn-secondary';
        renameBtn.style.padding = '2px 8px';
        renameBtn.style.fontSize = '12px';
        renameBtn.dataset.action = 'rename-group';
        renameBtn.dataset.url = `${groupBaseUrl}${groupId}/rename/`;
        renameBtn.textContent = '重命名';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-secondary';
        deleteBtn.style.padding = '2px 8px';
        deleteBtn.style.fontSize = '12px';
        deleteBtn.dataset.action = 'delete-group';
        deleteBtn.dataset.url = `${groupBaseUrl}${groupId}/delete/`;
        deleteBtn.textContent = '删除';

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(name);
        row.appendChild(actions);
        return row;
    };

    const setSelectedSeat = (seat) => {
        if (selectedSeat) selectedSeat.classList.remove('selected');
        selectedSeat = seat;
        if (selectedSeat) selectedSeat.classList.add('selected');
    };

    const setSelectedUnseated = (item) => {
        if (selectedUnseated) selectedUnseated.classList.remove('selected');
        selectedUnseated = item;
        if (selectedUnseated) selectedUnseated.classList.add('selected');
    };

    const seatKey = (seat) => `${seat.dataset.row}-${seat.dataset.col}`;

    const clearMultiSelection = () => {
        selectedSeats.forEach(key => {
            const seat = document.querySelector(`.seat[data-seat-key="${key}"]`);
            if (seat) seat.classList.remove('multi-selected');
        });
        selectedSeats.clear();
    };

    const addToMultiSelection = (seat) => {
        const key = seatKey(seat);
        if (!selectedSeats.has(key)) {
            selectedSeats.add(key);
            seat.classList.add('multi-selected');
        }
    };

    const toggleMultiSelection = (seat) => {
        const key = seatKey(seat);
        if (selectedSeats.has(key)) {
            selectedSeats.delete(key);
            seat.classList.remove('multi-selected');
        } else {
            addToMultiSelection(seat);
        }
    };

    const getSeatByKey = (key) => document.querySelector(`.seat[data-seat-key="${key}"]`);
    const getSeatByCoord = (row, col) => document.querySelector(`.seat[data-row="${row}"][data-col="${col}"]`);

    const showQuickSwapInput = (seat) => {
        const existing = seat.querySelector('.quick-swap-input');
        if (existing) existing.remove();

        const input = document.createElement('input');
        input.className = 'quick-swap-input';
        input.placeholder = '输入姓名首字母';
        input.autocomplete = 'off';
        seat.appendChild(input);

        setTimeout(() => input.focus(), 10);

        const cleanup = () => {
            if (input.parentNode) input.remove();
        };

        input.addEventListener('blur', () => setTimeout(cleanup, 200));
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') {
                cleanup();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const query = input.value.trim();
                if (!query) return cleanup();

                try {
                    const res = await fetch(`${window.location.pathname}search-students/?q=${encodeURIComponent(query)}`);
                    const data = await res.json();
                    const matches = data.students || [];

                    if (matches.length === 0) {
                        input.style.borderColor = '#ef4444';
                        setTimeout(() => input.style.borderColor = '', 300);
                    } else if (matches.length === 1) {
                        cleanup();
                        await swapStudents(seat, matches[0].id);
                    } else {
                        cleanup();
                        showQuickSwapModal(seat, matches);
                    }
                } catch (err) {
                    input.style.borderColor = '#ef4444';
                    setTimeout(() => input.style.borderColor = '', 300);
                }
            }
        });
    };

    const swapStudents = async (seat, targetStudentId) => {
        const currentStudentId = seat.dataset.studentId;
        if (currentStudentId === targetStudentId) return;

        const row = parseInt(seat.dataset.row, 10);
        const col = parseInt(seat.dataset.col, 10);

        if (!currentStudentId) {
            handleResponse(postJson(urls.assign, withMovePreferences({
                student_id: targetStudentId,
                row,
                col
            })), null, () => dispatchStudentMoved({
                source: 'quick-swap-assign',
                student_id: targetStudentId,
                row,
                col
            }));
            return;
        }

        handleResponse(postJson(urls.move, withMovePreferences({
            student_id: targetStudentId,
            row,
            col
        })), null, () => dispatchStudentMoved({
            source: 'quick-swap',
            student_id: targetStudentId,
            row,
            col
        }));
    };

    const showQuickSwapModal = (seat, matches) => {
        const modal = document.createElement('div');
        modal.className = 'quick-swap-modal';
        modal.innerHTML = `
            <div class="quick-swap-content">
                <div class="quick-swap-title">选择学生</div>
                <div class="quick-swap-list">
                    ${matches.map((m, i) => `<div class="quick-swap-item" data-student-id="${m.id}"><span class="quick-swap-num">${i + 1}</span>${m.name}</div>`).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const cleanup = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cleanup();
            const item = e.target.closest('.quick-swap-item');
            if (item) {
                cleanup();
                swapStudents(seat, item.dataset.studentId);
            }
        });

        document.addEventListener('keydown', function handler(e) {
            const num = parseInt(e.key);
            if (num >= 1 && num <= matches.length) {
                cleanup();
                swapStudents(seat, matches[num - 1].id);
                document.removeEventListener('keydown', handler);
            } else if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', handler);
            }
        });
    };


    const clearDragFeedback = () => {
        document.querySelectorAll('.seat.drag-origin, .seat.drag-target, .seat.drop-preview-valid, .seat.drop-preview-invalid').forEach((seat) => {
            seat.classList.remove('drag-origin', 'drag-target', 'drop-preview-valid', 'drop-preview-invalid');
            seat.removeAttribute('data-drop-preview');
        });
    };

    const markSeatPreview = (seat, status, label = '') => {
        if (!seat) return;
        seat.classList.add('drag-target');
        if (status === 'valid') {
            seat.classList.add('drop-preview-valid');
        } else {
            seat.classList.add('drop-preview-invalid');
        }
        if (label) {
            seat.setAttribute('data-drop-preview', label);
        } else {
            seat.removeAttribute('data-drop-preview');
        }
    };

    const collectMovableSelectedSeats = () => {
        return Array.from(selectedSeats)
            .map((key) => getSeatByKey(key))
            .filter((seat) => seat && seat.dataset.cellType === 'seat' && seat.dataset.studentId);
    };

    const buildMultiDropPlan = (dropSeat) => {
        const anchorSeat = getSeatByKey(dragState.anchorKey);
        if (!anchorSeat || !dropSeat) {
            return { ok: false, reason: '无法识别拖拽起点' };
        }

        const deltaRow = Number(dropSeat.dataset.row) - Number(anchorSeat.dataset.row);
        const deltaCol = Number(dropSeat.dataset.col) - Number(anchorSeat.dataset.col);
        const moves = [];
        const targetKeys = [];
        const usedTarget = new Set();

        for (const key of dragState.sourceKeys) {
            const sourceSeat = getSeatByKey(key);
            if (!sourceSeat || !sourceSeat.dataset.studentId) continue;
            const row = Number(sourceSeat.dataset.row) + deltaRow;
            const col = Number(sourceSeat.dataset.col) + deltaCol;
            const targetSeat = getSeatByCoord(row, col);
            if (!targetSeat || targetSeat.dataset.cellType !== 'seat') {
                return {
                    ok: false,
                    reason: '拖拽目标超出可入座区域',
                    targetKeys
                };
            }
            const targetKey = seatKey(targetSeat);
            if (usedTarget.has(targetKey)) {
                return {
                    ok: false,
                    reason: '拖拽目标存在冲突',
                    targetKeys
                };
            }
            usedTarget.add(targetKey);
            targetKeys.push(targetKey);
            moves.push({
                student_id: sourceSeat.dataset.studentId,
                row,
                col
            });
        }

        if (!moves.length) {
            return { ok: false, reason: '没有可移动的学生' };
        }

        return {
            ok: true,
            moves,
            targetKeys,
            deltaRow,
            deltaCol
        };
    };

    const applyDragPreviewForSeat = (seat) => {
        if (!dragState.active || !seat || seat.dataset.cellType !== 'seat') return;

        clearDragFeedback();

        if (dragState.mode === 'multi') {
            dragState.sourceKeys.forEach((key) => {
                const sourceSeat = getSeatByKey(key);
                if (sourceSeat) sourceSeat.classList.add('drag-origin');
            });
            const plan = buildMultiDropPlan(seat);
            if (plan.ok) {
                plan.targetKeys.forEach((key) => {
                    const targetSeat = getSeatByKey(key);
                    markSeatPreview(targetSeat, 'valid');
                });
                markSeatPreview(seat, 'valid', `将移动 ${plan.moves.length} 人`);
            } else {
                if (plan.targetKeys && plan.targetKeys.length) {
                    plan.targetKeys.forEach((key) => {
                        const targetSeat = getSeatByKey(key);
                        markSeatPreview(targetSeat, 'invalid');
                    });
                }
                markSeatPreview(seat, 'invalid', plan.reason || '不可放置');
            }
            return;
        }

        const sourceSeat = getSeatByKey(dragState.anchorKey);
        if (sourceSeat) sourceSeat.classList.add('drag-origin');
        if (!dragState.sourceStudentId) return;
        if (!sourceSeat) {
            markSeatPreview(seat, 'valid', '将安排入座');
            return;
        }

        let label = '将移动到此';
        if (sourceSeat.dataset.seatKey === seat.dataset.seatKey) {
            label = '原位';
        } else if (seat.dataset.studentId) {
            label = '将交换';
        }
        markSeatPreview(seat, 'valid', label);
    };

    const setDragGhost = (e, label, sourceEl = null) => {
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';

        if (sourceEl) {
            const wrapper = document.createElement('div');
            wrapper.className = 'drag-preview-clone';
            wrapper.style.width = sourceEl.offsetWidth + 'px';
            wrapper.style.height = sourceEl.offsetHeight + 'px';
            
            const clone = sourceEl.cloneNode(true);
            clone.style.margin = '0';
            clone.style.transform = 'none';
            clone.style.width = '100%';
            clone.style.height = '100%';
            
            wrapper.appendChild(clone);
            ghost.appendChild(wrapper);
            
            if (label && label !== '移动' && label !== '安排入座') {
                const badge = document.createElement('div');
                badge.className = 'drag-ghost-badge';
                badge.textContent = label;
                ghost.appendChild(badge);
            }
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, sourceEl.offsetWidth / 2, sourceEl.offsetHeight / 2);
        } else {
            ghost.classList.add('drag-ghost-text');
            ghost.textContent = label;
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 20, 20);
        }

        setTimeout(() => ghost.remove(), 0);
    };

    const resetDragState = () => {
        dragState.active = false;
        dragState.mode = null;
        dragState.anchorKey = null;
        dragState.sourceKeys = [];
        dragState.sourceStudentId = null;
    };

    const getSeatFromPoint = (clientX, clientY) => {
        const target = document.elementFromPoint(clientX, clientY);
        if (!target || !target.closest) return null;
        const seat = target.closest('.seat');
        if (!seat || seat.dataset.cellType !== 'seat') return null;
        return seat;
    };

    const createTouchDragGhost = (sourceEl, label) => {
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost touch-drag-ghost';

        if (sourceEl) {
            const wrapper = document.createElement('div');
            wrapper.className = 'drag-preview-clone';
            wrapper.style.width = `${sourceEl.offsetWidth}px`;
            wrapper.style.height = `${sourceEl.offsetHeight}px`;

            const clone = sourceEl.cloneNode(true);
            clone.style.margin = '0';
            clone.style.transform = 'none';
            clone.style.width = '100%';
            clone.style.height = '100%';

            wrapper.appendChild(clone);
            ghost.appendChild(wrapper);
        }

        if (label) {
            const badge = document.createElement('div');
            badge.className = 'drag-ghost-badge';
            badge.textContent = label;
            ghost.appendChild(badge);
        }

        document.body.appendChild(ghost);
        return ghost;
    };

    const moveTouchDragGhost = (clientX, clientY) => {
        if (!touchDragSession || !touchDragSession.ghost) return;
        touchDragSession.ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
    };

    const cleanupTouchDragSession = () => {
        if (touchDragSession && touchDragSession.ghost) {
            touchDragSession.ghost.remove();
        }
        touchDragSession = null;
        touchDragCandidate = null;
        document.body.classList.remove('touch-dragging');
    };

    const beginTouchDrag = (event) => {
        if (!touchDragCandidate || groupMode) return false;
        const { sourceEl, sourceType, sourceSeat, studentId, pointerId } = touchDragCandidate;
        if (!studentId) return false;

        if (typeof clearTouchContextTimer === 'function') {
            clearTouchContextTimer();
        }

        dragState.active = true;
        dragState.sourceStudentId = studentId;

        let label = '安排入座';
        if (sourceType === 'seat') {
            const sourceKey = seatKey(sourceSeat);
            const selectedMovableSeats = collectMovableSelectedSeats();
            const canMultiDrag = selectedMovableSeats.length > 1 && selectedSeats.has(sourceKey);
            dragState.anchorKey = sourceKey;
            if (canMultiDrag) {
                dragState.mode = 'multi';
                dragState.sourceKeys = selectedMovableSeats.map((seat) => seatKey(seat));
                label = `移动 ${dragState.sourceKeys.length} 人`;
            } else {
                dragState.mode = 'single';
                dragState.sourceKeys = [sourceKey];
                label = '移动';
            }
        } else {
            dragState.mode = 'single';
            dragState.anchorKey = null;
            dragState.sourceKeys = [];
        }

        touchDragSession = {
            pointerId,
            ghost: createTouchDragGhost(sourceEl, label),
            lastSeat: null,
        };
        document.body.classList.add('touch-dragging');
        markNextTouchClickSuppressed();
        moveTouchDragGhost(event.clientX, event.clientY);

        const previewSeat = getSeatFromPoint(event.clientX, event.clientY);
        if (previewSeat) {
            applyDragPreviewForSeat(previewSeat);
            touchDragSession.lastSeat = previewSeat;
        } else if (sourceSeat) {
            sourceSeat.classList.add('drag-origin');
        }
        return true;
    };

    const updateTouchDrag = (event) => {
        if (!touchDragSession || touchDragSession.pointerId !== event.pointerId) return;
        moveTouchDragGhost(event.clientX, event.clientY);
        const seat = getSeatFromPoint(event.clientX, event.clientY);
        if (seat !== touchDragSession.lastSeat) {
            touchDragSession.lastSeat = seat;
            if (seat) {
                applyDragPreviewForSeat(seat);
            } else {
                clearDragFeedback();
                dragState.sourceKeys.forEach((key) => {
                    const sourceSeat = getSeatByKey(key);
                    if (sourceSeat) sourceSeat.classList.add('drag-origin');
                });
            }
        }
    };

    const completeTouchDrop = (dropSeat) => {
        if (!dropSeat || dropSeat.dataset.cellType !== 'seat') return;

        if (dragState.active && dragState.mode === 'multi') {
            const plan = buildMultiDropPlan(dropSeat);
            clearDragFeedback();
            if (!plan.ok) {
                notify(plan.reason || '批量拖拽失败');
                return;
            }
            if (plan.deltaRow === 0 && plan.deltaCol === 0) {
                return;
            }
            if (!urls.moveBatch) {
                notify('当前版本不支持多选拖拽');
                return;
            }
            handleResponse(postJson(urls.moveBatch, withMovePreferences({ moves: plan.moves })), () => {
                clearMultiSelection();
            }, () => {
                dispatchStudentMoved({
                    source: 'touch-drop-batch',
                    row: dropSeat.dataset.row,
                    col: dropSeat.dataset.col,
                    moves: plan.moves
                });
            });
            return;
        }

        const studentId = dragState.sourceStudentId;
        const sourceSeat = getSeatByKey(dragState.anchorKey);
        clearDragFeedback();
        if (!studentId) return;
        if (sourceSeat && sourceSeat.dataset.seatKey === dropSeat.dataset.seatKey) return;
        handleResponse(postJson(urls.move, withMovePreferences({
            student_id: studentId,
            row: dropSeat.dataset.row,
            col: dropSeat.dataset.col
        })), null, () => dispatchStudentMoved({
            source: 'touch-drop',
            student_id: studentId,
            row: dropSeat.dataset.row,
            col: dropSeat.dataset.col
        }));
    };

    const cancelTouchDrag = () => {
        clearDragFeedback();
        resetDragState();
        cleanupTouchDragSession();
    };

    const setDragEnabled = (enabled) => {
        document.querySelectorAll('.seat-content').forEach(el => {
            el.setAttribute('draggable', enabled ? 'true' : 'false');
        });
        document.querySelectorAll('.unseated-item').forEach(el => {
            el.setAttribute('draggable', enabled ? 'true' : 'false');
        });
    };

    const setGroupMode = (enabled) => {
        groupMode = enabled;
        if (groupAssignToggle) {
            groupAssignToggle.classList.toggle('active', enabled);
            groupAssignToggle.textContent = enabled ? '退出分组' : '分组模式';
        }
        if (!enabled) {
            clearMultiSelection();
        }
        setDragEnabled(!enabled);
    };

    const getSeatForAction = () => selectedSeat || lastHoveredSeat;

    const isEditableTarget = () => {
        const el = document.activeElement;
        if (!el) return false;
        return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
    };

    const updateSeatElement = (seat, data) => {
        if (!seat || !data) return;
        const hadSelected = seat.classList.contains('selected');
        const hadMulti = seat.classList.contains('multi-selected');

        Array.from(seat.classList).forEach(cls => {
            if (cls.startsWith('cell-') || cls === 'occupied' || cls === 'is-leader' || cls === 'is-fixed-seat') {
                seat.classList.remove(cls);
            }
        });

        seat.classList.add(`cell-${data.cell_type}`);
        if (data.student) {
            seat.classList.add('occupied');
            if (data.student.is_leader) {
                seat.classList.add('is-leader');
            }
            if (data.student.is_fixed_seat) {
                seat.classList.add('is-fixed-seat');
            }
        }
        if (hadSelected) seat.classList.add('selected');
        if (hadMulti) seat.classList.add('multi-selected');

        seat.dataset.cellType = data.cell_type;
        seat.dataset.studentId = data.student ? data.student.id : '';
        seat.dataset.fixedSeat = data.student && data.student.is_fixed_seat ? '1' : '0';

        const row = seat.dataset.row;
        const col = seat.dataset.col;
        seat.innerHTML = '';

        if (data.cell_type === 'seat') {
            if (data.student) {
                const content = document.createElement('div');
                content.className = 'seat-content';
                content.setAttribute('draggable', 'true');
                content.dataset.studentId = data.student.id;

                const name = document.createElement('div');
                name.className = 'seat-name';
                name.textContent = data.student.name;
                content.appendChild(name);

                const badgesHtml = buildStudentBadgeHtml(data.student);
                if (badgesHtml) {
                    content.insertAdjacentHTML('beforeend', badgesHtml);
                }

                if (data.student.score_display) {
                    const info = document.createElement('div');
                    info.className = 'seat-info';
                    info.textContent = `${data.student.score_display}分`;
                    content.appendChild(info);
                }
                seat.appendChild(content);
            } else {
                const info = document.createElement('div');
                info.className = 'seat-info seat-coord';
                info.textContent = `${row}-${col}`;
                seat.appendChild(info);
            }

            if (data.group) {
                const tag = document.createElement('div');
                tag.className = 'seat-group-tag';
                tag.textContent = data.group.name;
                seat.appendChild(tag);
            }
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'seat-placeholder';
            placeholder.textContent = data.cell_type_display;
            seat.appendChild(placeholder);
        }
    };

    const refreshState = window.refreshState = () => {
        if (!urls.state) return Promise.resolve();
        const selectedSeatKey = selectedSeat ? seatKey(selectedSeat) : null;
        const selectedUnseatedId = selectedUnseated ? selectedUnseated.dataset.studentId : null;

        const stateUrl = `${urls.state}?t=${Date.now()}`;
        return fetch(stateUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(res => res.json())
            .then(data => {
                const seatMap = new Map();
                data.seats.forEach(seat => {
                    seatMap.set(`${seat.row}-${seat.col}`, seat);
                });
                seatElements.forEach(seat => {
                    const key = seatKey(seat);
                    const info = seatMap.get(key);
                    if (info) updateSeatElement(seat, info);
                });

                if (unseatedList) {
                    if (data.unseated && data.unseated.length) {
                        unseatedList.innerHTML = data.unseated.map(student => {
                            const score = student.score_display ? `${student.score_display}分` : '';
                            const tagBadges = Array.isArray(student.tags) ? student.tags.map(tag =>
                                `<span class="student-tag-badge" style="background:${escapeAttr(tag.color || '#0a59f7')}22;color:${escapeAttr(tag.color || '#0a59f7')}" title="${escapeAttr(tag.name)}">${escapeHtml(tag.name)}</span>`
                            ).join('') : '';
                            const badges = [
                                student.podium_guardian_side === 'left' ? '<span class="guardian-badge left-guard">左护法</span>' : '',
                                student.podium_guardian_side === 'right' ? '<span class="guardian-badge right-guard">右护法</span>' : '',
                                student.is_fixed_seat ? '<span class="fixed-seat-badge">固定座位</span>' : '',
                                tagBadges,
                            ].filter(Boolean).join(' ');
                            const studentTagIds = Array.isArray(student.tags) ? student.tags.map(t => t.id).join(',') : '';
                            return `
                                <div class="unseated-item" draggable="true" data-student-id="${student.id}"
                                    data-student-sid="${escapeAttr(student.student_id || '')}"
                                    data-student-gender="${escapeAttr(student.gender || '')}"
                                    data-student-score="${student.score || 0}"
                                    data-student-tag-ids="${escapeAttr(studentTagIds)}"
                                    data-update-url="${escapeAttr(student.update_url || '')}">
                                    <div>
                                        <div class="unseated-name">${escapeHtml(student.name)}${badges ? ` ${badges}` : ''}</div>
                                        <div class="unseated-info">${score}</div>
                                    </div>
                                    <button type="button" class="icon-btn delete-student" data-delete-url="${student.delete_url}">删除</button>
                                </div>
                            `;
                        }).join('');
                    } else {
                        unseatedList.innerHTML = '<div class="empty-hint">所有学生已入座</div>';
                    }
                    applyUnseatedFilter();
                }

                if (unseatedCount) {
                    unseatedCount.textContent = `${data.unseated_count} 人`;
                }

                if (Array.isArray(data.constraints)) {
                    constraintItems = data.constraints;
                    renderConstraintMetrics(data.constraint_metrics || deriveConstraintMetrics(constraintItems));
                    renderConstraintList();
                    if (editingConstraintId != null) {
                        const editedItem = constraintItems.find((item) => String(item.pk) === String(editingConstraintId));
                        if (!editedItem) {
                            resetConstraintForm();
                        }
                    }
                }

                if (Array.isArray(data.tags)) {
                    renderTagLibrary(data.tags);
                }
                if (Array.isArray(data.tag_rules)) {
                    renderTagRules(data.tag_rules);
                }

                if (data.sync_meta && window.FuckSeatsCloudSync) {
                    window.FuckSeatsCloudSync.update(data.sync_meta);
                }

                if (data.suggestions) {
                    const toastContainer = document.getElementById('toast-container') || createToastContainer();
                    toastContainer.querySelectorAll('.toast-suggestion').forEach(el => el.remove());

                    const listItems = [];
                    data.suggestions.forEach(item => {
                        if (typeof item === 'object' && item.action_label) {
                            const suggestionType = item.type || '';
                            if (!enabledActionSuggestionTypes.has(suggestionType)) {
                                if (item.message) {
                                    listItems.push(`<div class="suggestion-item">${item.message}</div>`);
                                }
                                return;
                            }
                            const toast = document.createElement('div');
                            toast.className = 'toast-notification toast-suggestion';
                            toast.innerHTML = `
                                <div class="toast-header">
                                    <span>优化建议</span>
                                    <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">刚刚</span>
                                </div>
                                <div class="toast-body">${item.message}</div>
                                <div class="toast-actions">
                                    <button class="toast-btn primary toast-action-btn" data-url="${item.action_url}" data-msg-type="${suggestionType}">${item.action_label}</button>
                                    ${item.ignore_label ? `<button class="toast-btn secondary toast-ignore-btn" data-url="${item.ignore_url}">${item.ignore_label}</button>` : ''}
                                </div>
                            `;
                            toastContainer.appendChild(toast);
                        } else {
                            listItems.push(`<div class="suggestion-item">${item}</div>`);
                        }
                    });

                    toastContainer.querySelectorAll('.toast-action-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const url = btn.dataset.url;
                            const type = btn.dataset.msgType;

                            if (type === 'export_suggestion') {
                                const originalText = btn.textContent;
                                btn.disabled = true;
                                btn.textContent = '保存中...';
                                saveExportFromUrl(url, {
                                    fallbackFilename: '小组作业表.xlsx',
                                    acceptMime: excelMime,
                                    acceptExtensions: ['.xlsx']
                                }).then((result) => {
                                    if (result.status === 'cancelled') return;
                                    if (result.status === 'saved') {
                                        showInlineToast(`文件已保存：${result.filename}`);
                                    } else if (result.status === 'downloaded') {
                                        showInlineToast(`已开始下载：${result.filename}`);
                                    }
                                    dismissToast(btn.closest('.toast-notification'));
                                }).catch((error) => {
                                    notify(error?.message || '导出失败');
                                }).finally(() => {
                                    if (!btn.isConnected) return;
                                    btn.disabled = false;
                                    btn.textContent = originalText;
                                });
                                return;
                            }

                            if (type === 'auto_fixed') {
                                dismissToast(btn.closest('.toast-notification'));
                                return;
                            }

                            handleResponse(postJson(url, {}));
                        });
                    });

                    toastContainer.querySelectorAll('.toast-ignore-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const url = btn.dataset.url;
                            if (url && url !== '#') {
                                handleResponse(postJson(url, {}));
                            }
                            dismissToast(btn.closest('.toast-notification'));
                        });
                    });

                    if (suggestionList) {
                        if (listItems.length) {
                            suggestionList.innerHTML = listItems.join('');
                        } else {
                            suggestionList.innerHTML = '<div class="empty-hint">当前布局没有明显问题</div>';
                        }
                    }
                    if (window.updateToastStack) window.updateToastStack();
                }

                if (selectedSeatKey) {
                    const target = document.querySelector(`.seat[data-seat-key="${selectedSeatKey}"]`);
                    if (target) setSelectedSeat(target);
                }

                if (selectedUnseatedId) {
                    const target = document.querySelector(`.unseated-item[data-student-id="${selectedUnseatedId}"]`);
                    if (target) setSelectedUnseated(target);
                }

                clearDragFeedback();
                setDragEnabled(!groupMode);
            })
            .catch(() => notify('刷新失败'));
    };



    seatElements.forEach(seat => {
        seat.dataset.seatKey = seatKey(seat);
        seat.addEventListener('mouseenter', () => {
            lastHoveredSeat = seat;
        });
        seat.addEventListener('click', (e) => {
            if (consumeSuppressedTouchClick(e)) return;
            if (seat.dataset.cellType !== 'seat') return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                addToMultiSelection(seat);
                return;
            }
            if (groupMode) {
                toggleMultiSelection(seat);
                return;
            }
            if (isTouchUi() && selectedUnseated && !seat.dataset.studentId) {
                handleResponse(postJson(urls.assign, withMovePreferences({
                    student_id: selectedUnseated.dataset.studentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                })), null, () => dispatchStudentMoved({
                    source: 'touch-assign',
                    student_id: selectedUnseated.dataset.studentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
                return;
            }
            setSelectedSeat(seat);
        });
        seat.addEventListener('dblclick', (e) => {
            if (seat.dataset.cellType !== 'seat') return;
            e.preventDefault();
            showQuickSwapInput(seat);
        });
        seat.addEventListener('dragover', (e) => {
            if (seat.dataset.cellType !== 'seat') return;
            e.preventDefault();
            applyDragPreviewForSeat(seat);
        });
        seat.addEventListener('drop', (e) => {
            if (seat.dataset.cellType !== 'seat') return;
            e.preventDefault();
            setSelectedSeat(seat);

            if (dragState.active && dragState.mode === 'multi') {
                const plan = buildMultiDropPlan(seat);
                clearDragFeedback();
                if (!plan.ok) {
                    notify(plan.reason || '批量拖拽失败');
                    return;
                }
                if (plan.deltaRow === 0 && plan.deltaCol === 0) {
                    return;
                }
                if (!urls.moveBatch) {
                    notify('当前版本不支持多选拖拽');
                    return;
                }
                handleResponse(postJson(urls.moveBatch, withMovePreferences({ moves: plan.moves })), () => {
                    clearMultiSelection();
                }, () => {
                    dispatchStudentMoved({
                        source: 'html5-drop-batch',
                        row: seat.dataset.row,
                        col: seat.dataset.col,
                        moves: plan.moves
                    });
                });
                return;
            }

            const studentId = (dragState.active && dragState.sourceStudentId) || e.dataTransfer.getData('text/plain');
            const sourceSeat = getSeatByKey(dragState.anchorKey);
            clearDragFeedback();
            if (!studentId) return;
            if (sourceSeat && sourceSeat.dataset.seatKey === seat.dataset.seatKey) return;
            handleResponse(postJson(urls.move, withMovePreferences({
                student_id: studentId,
                row: seat.dataset.row,
                col: seat.dataset.col
            })), null, () => dispatchStudentMoved({
                source: 'html5-drop',
                student_id: studentId,
                row: seat.dataset.row,
                col: seat.dataset.col
            }));
        });
    });

    if (unseatedList) {
        unseatedList.addEventListener('click', async (e) => {
            if (consumeSuppressedTouchClick(e)) return;
            const deleteBtn = e.target.closest('.delete-student');
            if (deleteBtn) {
                e.stopPropagation();
                const url = deleteBtn.dataset.deleteUrl;
                if (!url) return;
                const ok = await showConfirmModal('确定要删除该学生吗？', { title: '删除学生' });
                if (!ok) return;
                handleResponse(postJson(url, {}));
                return;
            }
            const item = e.target.closest('.unseated-item');
            if (item) {
                setSelectedUnseated(item);
            }
        });
    }

    document.addEventListener('dragstart', (e) => {
        const seatContent = e.target.closest('.seat-content');
        const unseatedItem = e.target.closest('.unseated-item');
        if (seatContent) {
            const sourceSeat = seatContent.closest('.seat');
            if (!sourceSeat) return;
            const sourceKey = seatKey(sourceSeat);
            const selectedMovableSeats = collectMovableSelectedSeats();
            const canMultiDrag = selectedMovableSeats.length > 1 && selectedSeats.has(sourceKey);

            dragState.active = true;
            dragState.anchorKey = sourceKey;
            dragState.sourceStudentId = seatContent.dataset.studentId;

            if (canMultiDrag) {
                dragState.mode = 'multi';
                dragState.sourceKeys = selectedMovableSeats.map((seat) => seatKey(seat));
                setDragGhost(e, `移动 ${dragState.sourceKeys.length} 人`, sourceSeat);
            } else {
                dragState.mode = 'single';
                dragState.sourceKeys = [sourceKey];
                setDragGhost(e, '移动', sourceSeat);
            }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', seatContent.dataset.studentId);
            applyDragPreviewForSeat(sourceSeat);
        } else if (unseatedItem) {
            dragState.active = true;
            dragState.mode = 'single';
            dragState.anchorKey = null;
            dragState.sourceKeys = [];
            dragState.sourceStudentId = unseatedItem.dataset.studentId;
            setDragGhost(e, '安排入座', unseatedItem);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', unseatedItem.dataset.studentId);
        }
    });

    document.addEventListener('dragend', () => {
        resetDragState();
        clearDragFeedback();
    });

    const getTouchDragSource = (event) => {
        if (!isTouchUi()) return null;
        if (event.pointerType === 'mouse') return null;
        if (event.button !== undefined && event.button !== 0) return null;
        if (!event.target || !event.target.closest) return null;
        if (event.target.closest('button, a, input, textarea, select')) return null;
        if (groupMode) return null;

        const seatContent = event.target.closest('.seat-content');
        if (seatContent) {
            const sourceSeat = seatContent.closest('.seat');
            const studentId = seatContent.dataset.studentId;
            if (!sourceSeat || !studentId) return null;
            return {
                sourceType: 'seat',
                sourceEl: sourceSeat,
                sourceSeat,
                studentId,
            };
        }

        const unseatedItem = event.target.closest('.unseated-item');
        if (unseatedItem) {
            const studentId = unseatedItem.dataset.studentId;
            if (!studentId) return null;
            return {
                sourceType: 'unseated',
                sourceEl: unseatedItem,
                sourceSeat: null,
                studentId,
            };
        }

        return null;
    };

    document.addEventListener('pointerdown', (event) => {
        const source = getTouchDragSource(event);
        if (!source) return;
        touchDragCandidate = {
            ...source,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
        };
        if (event.target.setPointerCapture) {
            try {
                event.target.setPointerCapture(event.pointerId);
            } catch (_) { }
        }
    });

    document.addEventListener('pointermove', (event) => {
        if (touchDragSession) {
            if (touchDragSession.pointerId !== event.pointerId) return;
            event.preventDefault();
            updateTouchDrag(event);
            return;
        }

        if (!touchDragCandidate || touchDragCandidate.pointerId !== event.pointerId) return;
        const dx = event.clientX - touchDragCandidate.startX;
        const dy = event.clientY - touchDragCandidate.startY;
        if (Math.hypot(dx, dy) < 12) return;

        event.preventDefault();
        if (beginTouchDrag(event)) {
            updateTouchDrag(event);
        } else {
            touchDragCandidate = null;
        }
    }, { passive: false });

    document.addEventListener('pointerup', (event) => {
        if (touchDragSession && touchDragSession.pointerId === event.pointerId) {
            event.preventDefault();
            const dropSeat = getSeatFromPoint(event.clientX, event.clientY);
            completeTouchDrop(dropSeat);
            resetDragState();
            cleanupTouchDragSession();
            return;
        }
        if (touchDragCandidate && touchDragCandidate.pointerId === event.pointerId) {
            touchDragCandidate = null;
        }
    }, { passive: false });

    document.addEventListener('pointercancel', (event) => {
        if (touchDragSession && touchDragSession.pointerId === event.pointerId) {
            cancelTouchDrag();
        }
        if (touchDragCandidate && touchDragCandidate.pointerId === event.pointerId) {
            touchDragCandidate = null;
        }
    });

    if (groupAssignToggle) {
        groupAssignToggle.addEventListener('click', () => {
            setGroupMode(!groupMode);
        });
    }

    if (groupApplyBtn) {
        groupApplyBtn.addEventListener('click', () => {
            if (!selectedSeats.size) {
                notify('请先选择座位');
                return;
            }
            const groupId = groupSelect ? groupSelect.value : '';
            const seatsPayload = Array.from(selectedSeats).map(key => {
                const [row, col] = key.split('-');
                return { row, col };
            });
            handleResponse(postJson(urls.groupAssignBatch, {
                group_id: groupId || null,
                seats: seatsPayload
            }), () => {
                clearMultiSelection();
            });
        });
    }

    if (quickArrangeForm) {
        quickArrangeForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const formData = new FormData(quickArrangeForm);
            const submitBtn = autoArrangeBtn || quickArrangeForm.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.textContent : '';

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '排座中...';
            }

            postForm(quickArrangeForm.action, formData)
                .then((data) => {
                    return refreshState().finally(() => {
                        showInlineToast(data?.message || '排座完成');
                    });
                })
                .catch((err) => {
                    showInlineToast(err?.message || '排座失败');
                })
                .finally(() => {
                    if (!submitBtn) return;
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                });
        });
    }

    if (groupClearSelectBtn) {
        groupClearSelectBtn.addEventListener('click', () => {
            clearMultiSelection();
        });
    }

    if (groupAutoBtn) {
        groupAutoBtn.addEventListener('click', () => {
            if (groupAutoReferenceSelect && !groupAutoReferenceSelect.value && groupSelect?.value) {
                groupAutoReferenceSelect.value = groupSelect.value;
            }
        });
    }

    if (groupAutoConfirmBtn) {
        groupAutoConfirmBtn.addEventListener('click', () => {
            const referenceGroupId = groupAutoReferenceSelect ? groupAutoReferenceSelect.value : '';
            if (!referenceGroupId) {
                notify('请先选择参考小组');
                return;
            }
            if (!urls.groupAuto) {
                notify('当前版本不支持自动编组');
                return;
            }
            const strategyInput = document.querySelector('input[name="group_auto_remainder_strategy"]:checked');
            const remainderStrategy = strategyInput ? strategyInput.value : 'new_group';
            const autoDetectGroupStyle = groupAutoDetectStyleCheckbox ? groupAutoDetectStyleCheckbox.checked : true;
            const originalText = groupAutoConfirmBtn.textContent;
            groupAutoConfirmBtn.textContent = '编组中...';
            groupAutoConfirmBtn.disabled = true;
            postJson(urls.groupAuto, {
                reference_group_id: referenceGroupId,
                remainder_strategy: remainderStrategy,
                auto_detect_group_style: autoDetectGroupStyle
            })
                .then((data) => {
                    if (!data || data.status !== 'success') {
                        throw new Error(data?.message || '自动编组失败');
                    }
                    const createdGroups = Array.isArray(data.created_groups) ? data.created_groups : [];
                    createdGroups.forEach((g) => {
                        if (!g || !g.id) return;
                        if (groupList && !groupList.querySelector(`.group-item[data-group-id="${g.id}"]`)) {
                            groupList.appendChild(buildGroupItem(g.id, g.name));
                        }
                        upsertGroupOption(g.id, g.name);
                    });
                    ensureGroupEmptyHint();
                    showInlineToast(data.message || '自动编组完成');
                    const modal = document.getElementById('group-auto-config-modal');
                    if (modal) modal.style.display = 'none';
                    refreshState();
                })
                .catch((err) => {
                    notify(err.message || '自动编组失败');
                })
                .finally(() => {
                    groupAutoConfirmBtn.textContent = originalText;
                    groupAutoConfirmBtn.disabled = false;
                });
        });
    }

    if (groupMergeBtn) {
        groupMergeBtn.addEventListener('click', async () => {
            const sourceGroupId = groupMergeFromSelect ? groupMergeFromSelect.value : '';
            const targetGroupId = groupMergeToSelect ? groupMergeToSelect.value : '';
            if (!sourceGroupId || !targetGroupId) {
                notify('请选择来源组和目标组');
                return;
            }
            if (sourceGroupId === targetGroupId) {
                notify('来源组和目标组不能相同');
                return;
            }
            if (!urls.groupMerge) {
                notify('当前版本不支持合并组');
                return;
            }
            const sourceName = groupMergeFromSelect?.selectedOptions?.[0]?.textContent?.trim() || '来源组';
            const targetName = groupMergeToSelect?.selectedOptions?.[0]?.textContent?.trim() || '目标组';
            const ok = await showConfirmModal(`确定将【${sourceName}】并入【${targetName}】吗？来源组将被删除。`, { title: '合并小组' });
            if (!ok) return;

            const originalText = groupMergeBtn.textContent;
            groupMergeBtn.textContent = '合并中...';
            groupMergeBtn.disabled = true;

            postJson(urls.groupMerge, {
                target_group_id: targetGroupId,
                source_group_ids: [sourceGroupId]
            })
                .then((data) => {
                    if (!data || data.status !== 'success') {
                        throw new Error(data?.message || '合并组失败');
                    }
                    const deletedGroups = Array.isArray(data.deleted_groups) ? data.deleted_groups : [];
                    deletedGroups.forEach((group) => {
                        if (group?.id) {
                            const row = groupList?.querySelector(`.group-item[data-group-id="${group.id}"]`);
                            if (row) row.remove();
                            removeGroupOption(group.id);
                        }
                    });
                    ensureGroupEmptyHint();
                    showInlineToast(data.message || '合并组完成');
                    refreshState();
                })
                .catch((err) => {
                    notify(err.message || '合并组失败');
                })
                .finally(() => {
                    groupMergeBtn.textContent = originalText;
                    groupMergeBtn.disabled = false;
                });
        });
    }

    if (groupRotateBtn) {
        groupRotateBtn.addEventListener('click', async () => {
            if (!urls.groupRotate) {
                notify('当前版本不支持小组轮换');
                return;
            }
            const ok = await showConfirmModal('确定执行小组平移轮换吗？将按当前小组顺序整体交换位置。', { title: '小组轮换' });
            if (!ok) return;
            const originalText = groupRotateBtn.textContent;
            groupRotateBtn.textContent = '轮换中...';
            groupRotateBtn.disabled = true;
            postJson(urls.groupRotate, {})
                .then((data) => {
                    if (!data || data.status !== 'success') {
                        throw new Error(data?.message || '小组轮换失败');
                    }
                    showInlineToast(data.message || '已完成小组轮换');
                    refreshState();
                })
                .catch((err) => {
                    notify(err.message || '小组轮换失败');
                })
                .finally(() => {
                    groupRotateBtn.textContent = originalText;
                    groupRotateBtn.disabled = false;
                });
        });
    }

    const showLayoutTransformToast = (title, data) => {
        const container = createToastContainer();
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        const isTemplate = data.shift_mode === 'template';
        const isColumn = data.shift_mode === 'column';
        const isFallback = data.shift_mode === 'normal' && data.fallback_reason;
        let badge = '';
        if (isTemplate) {
            badge = `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#e8f5e9;color:#2e7d32;margin-left:6px;">智能模板</span>`;
        } else if (isColumn) {
            badge = `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(var(--primary-color-rgb, 10, 89, 247), 0.1);color:var(--primary-color, #0a59f7);margin-left:6px;">纵列轮换</span>`;
        } else if (isFallback) {
            badge = `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fff3e0;color:#e65100;margin-left:6px;">普通模式</span>`;
        }
        let extra = '';
        if (isTemplate && data.template_signature) {
            extra = `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary);">模板结构: ${data.template_signature}</div>`;
        } else if (isColumn) {
            const columnCount = parseInt(data.seat_column_count, 10) || 0;
            const signature = data.template_signature ? ` · 结构 ${data.template_signature}` : '';
            extra = `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary);">座位纵列: ${columnCount}${signature}</div>`;
        } else if (isFallback && data.fallback_reason) {
            extra = `<div style="margin-top:4px;font-size:11px;color:#e65100;">${data.fallback_reason}</div>`;
        }
        toast.innerHTML = `
            <div class="toast-header">
                <span>${title || '布局操作'}${badge}</span>
                <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">刚刚</span>
            </div>
            <div class="toast-body">${data.message || '布局轮换成功'}${extra}</div>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            });
        }, 3000);
    };

    const handleShiftLayout = (direction) => {
        if (!urls.shiftLayout) return;
        const steps = Math.max(1, parseInt(shiftLayoutSteps?.value, 10) || 1);
        const useLargeGroups = getShiftUseLargeGroups();
        const shiftButtonMap = {
            left: shiftLayoutLeftBtn,
            right: shiftLayoutRightBtn,
            front: shiftLayoutFrontBtn,
            back: shiftLayoutBackBtn,
        };
        const btn = shiftButtonMap[direction];
        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = '执行中...';
        btn.disabled = true;

        postJson(urls.shiftLayout, { direction, steps, use_large_groups: useLargeGroups })
            .then(data => {
                if (data && data.status === 'success') {
                    showLayoutTransformToast('布局移动', data);
                    refreshState();
                } else {
                    throw new Error(data?.message || '布局轮换失败');
                }
            })
            .catch(err => {
                console.error('Shift layout error:', err);
                notify(err.message || '请求出错，请重试');
            })
            .finally(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            });
    };

    const handleMirrorLayout = () => {
        if (!urls.mirrorLayout || !mirrorLayoutLeftRightBtn) return;

        const originalText = mirrorLayoutLeftRightBtn.textContent;
        mirrorLayoutLeftRightBtn.textContent = '执行中...';
        mirrorLayoutLeftRightBtn.disabled = true;

        postJson(urls.mirrorLayout, { axis: 'lr' })
            .then((data) => {
                if (data && data.status === 'success') {
                    showLayoutTransformToast('布局镜像', data);
                    refreshState();
                } else {
                    throw new Error(data?.message || '左右镜像失败');
                }
            })
            .catch((err) => {
                console.error('Mirror layout error:', err);
                notify(err.message || '请求出错，请重试');
            })
            .finally(() => {
                mirrorLayoutLeftRightBtn.textContent = originalText;
                mirrorLayoutLeftRightBtn.disabled = false;
            });
    };

    if (shiftLayoutLeftBtn) {
        shiftLayoutLeftBtn.addEventListener('click', () => handleShiftLayout('left'));
    }

    if (shiftLayoutRightBtn) {
        shiftLayoutRightBtn.addEventListener('click', () => handleShiftLayout('right'));
    }

    if (shiftLayoutFrontBtn) {
        shiftLayoutFrontBtn.addEventListener('click', () => handleShiftLayout('front'));
    }

    if (shiftLayoutBackBtn) {
        shiftLayoutBackBtn.addEventListener('click', () => handleShiftLayout('back'));
    }

    if (mirrorLayoutLeftRightBtn) {
        mirrorLayoutLeftRightBtn.addEventListener('click', handleMirrorLayout);
    }

    if (renameClassroomBtn) {
        renameClassroomBtn.addEventListener('click', async () => {
            if (!urls.renameClassroom) {
                notify('当前版本不支持修改班级名称');
                return;
            }
            const currentName = root.dataset.classroomName || '';
            const newName = await showPromptModal('请输入新的班级名称：', { title: '重命名班级', defaultValue: currentName });
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) {
                notify('班级名称不能为空');
                return;
            }

            const originalText = renameClassroomBtn.textContent;
            renameClassroomBtn.textContent = '保存中...';
            renameClassroomBtn.disabled = true;

            postJson(urls.renameClassroom, { name: trimmed })
                .then((data) => {
                    if (!data || data.status !== 'success') {
                        throw new Error(data?.message || '修改班级名称失败');
                    }
                    showInlineToast(`班级名称已更新为：${data.name || trimmed}`);
                    window.location.reload();
                })
                .catch((err) => {
                    notify(err.message || '修改班级名称失败');
                })
                .finally(() => {
                    renameClassroomBtn.textContent = originalText;
                    renameClassroomBtn.disabled = false;
                });
        });
    }

    const deleteClassroomBtn = document.getElementById('btn-delete-classroom');
    const deleteClassroomForm = document.getElementById('delete-classroom-form');
    if (deleteClassroomBtn && deleteClassroomForm) {
        deleteClassroomBtn.addEventListener('click', async () => {
            const ok = await showConfirmModal('确定要删除这个班级吗？此操作不可撤销。', { title: '删除班级' });
            if (ok) deleteClassroomForm.submit();
        });
    }

    if (unseatedSearch) {
        unseatedSearch.addEventListener('input', () => {
            applyUnseatedFilter();
        });
    }

    if (createGroupForm) {
        createGroupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = createGroupForm.querySelector('input[name="name"]');
            if (!nameInput || !nameInput.value.trim()) {
                notify('请输入小组名称');
                return;
            }
            const formData = new FormData();
            formData.append('name', nameInput.value.trim());
            postForm(createGroupForm.action, formData)
                .then((data) => {
                    if (!data?.group) {
                        showInlineToast('小组已创建');
                        return;
                    }
                    if (groupList) {
                        groupList.appendChild(buildGroupItem(data.group.id, data.group.name));
                        ensureGroupEmptyHint();
                    }
                    upsertGroupOption(data.group.id, data.group.name);
                    showInlineToast(`已创建小组：${data.group.name}`);
                    nameInput.value = '';
                })
                .catch((err) => notify(err.message || '创建小组失败'));
        });
    }

    if (groupList) {
        groupList.addEventListener('click', async (e) => {
            const renameBtn = e.target.closest('[data-action="rename-group"]');
            if (renameBtn) {
                const item = renameBtn.closest('.group-item');
                const currentName = item ? item.dataset.groupName : '';
                const newName = await showPromptModal('请输入新的小组名称：', { title: '重命名小组', defaultValue: currentName || '' });
                if (newName === null) return;
                const trimmed = newName.trim();
                if (!trimmed) {
                    notify('小组名称不能为空');
                    return;
                }
                const formData = new FormData();
                formData.append('name', trimmed);
                postForm(renameBtn.dataset.url, formData)
                    .then((data) => {
                        const targetName = data?.group?.name || trimmed;
                        if (item) {
                            item.dataset.groupName = targetName;
                            const nameEl = item.querySelector('span');
                            if (nameEl) nameEl.textContent = targetName;
                            const gid = item.dataset.groupId;
                            if (gid) upsertGroupOption(gid, targetName);
                        }
                        showInlineToast('小组已重命名');
                        refreshState();
                    })
                    .catch((err) => notify(err.message || '重命名失败'));
                return;
            }

            const deleteBtn = e.target.closest('[data-action="delete-group"]');
            if (deleteBtn) {
                const ok = await showConfirmModal('确定要删除这个小组吗？', { title: '删除小组' });
                if (!ok) return;
                postForm(deleteBtn.dataset.url)
                    .then((data) => {
                        const row = deleteBtn.closest('.group-item');
                        const gid = row?.dataset?.groupId || data?.deleted_group_id;
                        if (row) row.remove();
                        if (gid) removeGroupOption(gid);
                        ensureGroupEmptyHint();
                        showInlineToast('小组已删除');
                        refreshState();
                    })
                    .catch((err) => notify(err.message || '删除失败'));
            }
        });
    }

    if (undoBtn) {
        undoBtn.addEventListener('click', () => handleHistoryResponse(postJson(urls.undo, {})));
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => handleHistoryResponse(postJson(urls.redo, {})));
    }

    const openSideTab = (tab) => {
        if (!tab) return;
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        if (tabBtn) tabBtn.click();
    };

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (!tab) return;
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.querySelector(`[data-tab-panel="${tab}"]`);
            if (panel) panel.classList.add('active');
            localStorage.setItem('classroom_active_tab', tab);
        });
    });

    const savedTab = localStorage.getItem('classroom_active_tab');
    if (savedTab) {
        openSideTab(savedTab);
    }

    document.querySelectorAll('[data-open-side-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            openSideTab(btn.dataset.openSideTab);
        });
    });

    const openModal = (modalId) => {
        if (!modalId) return;
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.classList.add('modal-visible');
            });
        });
    };

    const closeModal = (modalId) => {
        if (!modalId) return;
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('modal-visible');
        const onEnd = (e) => {
            if (e.target !== modal.querySelector('.modal-content')) return;
            modal.style.display = 'none';
            modal.removeEventListener('transitionend', onEnd);
        };
        modal.addEventListener('transitionend', onEnd);
    };

    document.querySelectorAll('[data-open-modal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            openModal(btn.dataset.openModal);
        });
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            closeModal(btn.dataset.closeModal);
        });
    });

    initFileMenus();
    initSeatsImport();
    initBsceImport();

    if (urls.state) {
        fetch(`${urls.state}?t=${Date.now()}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data.tags)) renderTagLibrary(data.tags);
                if (Array.isArray(data.tag_rules)) renderTagRules(data.tag_rules);
            })
            .catch(() => {});
    }
    if (new URLSearchParams(window.location.search).get('open') === 'bsce-import') {
        const bsceModal = document.getElementById('bsce-import-modal');
        if (bsceModal) openModal('bsce-import-modal');
        history.replaceState(null, '', window.location.pathname);
    }
    bindSystemSaveLinks();
    initPluginHub();
    initShiftUseLargeGroupsPreference();

    const shiftOptionsForm = document.getElementById('shiftOptionsForm');
    if (shiftOptionsForm && urls.shiftLayout) {
        shiftOptionsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(shiftOptionsForm);
            const submitBtn = document.getElementById('shiftOptionsSubmitBtn');
            const origText = submitBtn.textContent;
            submitBtn.textContent = '执行中...';
            submitBtn.disabled = true;
            fetch(urls.shiftLayout, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                body: JSON.stringify({
                    direction: fd.get('shift_direction'),
                    steps: parseInt(fd.get('shift_steps'), 10) || 1,
                    use_large_groups: fd.has('use_large_groups'),
                }),
            })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'success') {
                    closeModal('shift-options-modal');
                    refreshState();
                    showLayoutTransformToast('布局移动', data);
                } else {
                    showInlineToast(data.message || '操作失败');
                }
            })
            .catch(() => showInlineToast('请求出错，请重试'))
            .finally(() => {
                submitBtn.textContent = origText;
                submitBtn.disabled = false;
            });
        });
    }

    if (seatStage) {
        seatStage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (!(groupMode || e.shiftKey || e.ctrlKey || e.metaKey)) return;
            if (e.target.closest('.seat')) return;
            selecting = true;
            selectStart = { x: e.clientX, y: e.clientY };
            if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
                clearMultiSelection();
            }
            selectionBox.style.display = 'block';
            selectionBox.style.left = `${selectStart.x}px`;
            selectionBox.style.top = `${selectStart.y}px`;
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!selecting) return;
        const x1 = Math.min(selectStart.x, e.clientX);
        const y1 = Math.min(selectStart.y, e.clientY);
        const x2 = Math.max(selectStart.x, e.clientX);
        const y2 = Math.max(selectStart.y, e.clientY);
        selectionBox.style.left = `${x1}px`;
        selectionBox.style.top = `${y1}px`;
        selectionBox.style.width = `${x2 - x1}px`;
        selectionBox.style.height = `${y2 - y1}px`;
    });

    document.addEventListener('mouseup', (e) => {
        if (!selecting) return;
        selecting = false;
        selectionBox.style.display = 'none';
        const x1 = Math.min(selectStart.x, e.clientX);
        const y1 = Math.min(selectStart.y, e.clientY);
        const x2 = Math.max(selectStart.x, e.clientX);
        const y2 = Math.max(selectStart.y, e.clientY);
        seatElements.forEach(seat => {
            if (seat.dataset.cellType !== 'seat') return;
            const rect = seat.getBoundingClientRect();
            const intersect = rect.left <= x2 && rect.right >= x1 && rect.top <= y2 && rect.bottom >= y1;
            if (intersect) {
                addToMultiSelection(seat);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (isEditableTarget()) return;
        const key = (e.key || '').toLowerCase();
        if (key === 'escape') {
            e.preventDefault();
            clearMultiSelection();
            return;
        }
        if (e.ctrlKey && key === 'z') {
            e.preventDefault();
            handleHistoryResponse(postJson(urls.undo, {}));
            return;
        }
        if (e.ctrlKey && key === 'y') {
            e.preventDefault();
            handleHistoryResponse(postJson(urls.redo, {}));
            return;
        }
        if (e.ctrlKey && key === 'c') {
            e.preventDefault();
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && seat.dataset.studentId) {
                clipboardStudentId = seat.dataset.studentId;
            }
            return;
        }
        if (e.ctrlKey && key === 'x') {
            e.preventDefault();
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && seat.dataset.studentId) {
                clipboardStudentId = seat.dataset.studentId;
                handleResponse(postJson(urls.clear, {
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
            }
            return;
        }
        if (e.ctrlKey && key === 'v') {
            e.preventDefault();
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && clipboardStudentId) {
                handleResponse(postJson(urls.assign, withMovePreferences({
                    student_id: clipboardStudentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                })));
            }
            return;
        }
        if (key === 'delete') {
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && seat.dataset.studentId) {
                e.preventDefault();
                handleResponse(postJson(urls.clear, {
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
            }
            return;
        }
        if (e.ctrlKey && key === 'd') {
            e.preventDefault();
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && seat.dataset.studentId) {
                handleResponse(postJson(urls.clear, {
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
            }
            return;
        }
        if (e.ctrlKey && key === 'u') {
            e.preventDefault();
            const seat = getSeatForAction();
            if (seat && seat.dataset.cellType === 'seat' && selectedUnseated) {
                handleResponse(postJson(urls.assign, withMovePreferences({
                    student_id: selectedUnseated.dataset.studentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                })));
            }
        }
    });

    setDragEnabled(true);


    const contextMenu = document.getElementById('seat-context-menu');
    if (contextMenu && contextMenu.parentNode !== document.body) {
        document.body.appendChild(contextMenu);
    }
    const ctxSetLeader = document.getElementById('ctx-set-leader');
    const ctxToggleFixedSeat = document.getElementById('ctx-toggle-fixed-seat');
    const ctxToggleFixedSeatLabel = document.getElementById('ctx-toggle-fixed-seat-label');
    const ctxClearSeat = document.getElementById('ctx-clear-seat');
    const ctxCopyStudent = document.getElementById('ctx-copy-student');
    const ctxCutStudent = document.getElementById('ctx-cut-student');
    const ctxMoveToUnseated = document.getElementById('ctx-move-to-unseated');
    const ctxPasteStudent = document.getElementById('ctx-paste-student');
    const ctxStudentName = document.getElementById('ctx-student-name');
    const ctxCellTypeLabel = document.getElementById('ctx-cell-type-label');
    const ctxCellCoord = document.getElementById('ctx-cell-coord');
    const ctxSections = contextMenu ? contextMenu.querySelectorAll('.context-menu-section') : [];
    let ctxTargetSeat = null;
    let ctxTargetStudentId = null;
    let contextMenuJustOpenedAt = 0;
    let blockedContextMenuTipAt = 0;

    const describeSeatForContextMenu = (seat) => {
        if (!seat) {
            return {
                exists: false,
            };
        }
        return {
            exists: true,
            row: seat.dataset.row || '',
            col: seat.dataset.col || '',
            cellType: seat.dataset.cellType || '',
            studentId: seat.dataset.studentId || '',
            fixedSeat: seat.dataset.fixedSeat || '0',
            hasGroupTag: !!seat.querySelector('.seat-group-tag'),
            isLeader: seat.classList.contains('is-leader'),
            className: seat.className || '',
        };
    };

    const isSecondaryMouseButton = (event) => {
        if (!event) return false;
        if (event.button === 2 || event.which === 3) return true;
        const isMacLike = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
        return Boolean(isMacLike && event.ctrlKey && event.button === 0);
    };

    const shouldSuppressNativeSeatContextMenu = (target) => {
        if (!target || !target.closest) return false;
        if (contextMenu && contextMenu.contains(target)) return true;
        return Boolean(target.closest('.seat-stage'));
    };

    const canOpenSeatContextMenu = (seat) => {
        if (!seat) return false;
        if (seat.closest && seat.closest('.seat-stage') !== null) return true;
        if (seat.dataset && seat.dataset.isUnseatedMock) return true;
        return false;
    };

    const showBlockedContextMenuReason = (seat) => {
    };

    const hideContextMenu = () => {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        contextMenu.style.visibility = 'visible';
        ctxTargetStudentId = null;
        ctxTargetSeat = null;
    };

    const showContextMenu = (e, seat) => {
        if (!contextMenu || !seat) return;

        const cellType = seat.dataset.cellType || '';
        const studentId = seat.dataset.studentId || '';
        const hasStudent = cellType === 'seat' && !!studentId;
        const isEmpty = cellType === 'seat' && !studentId;
        const isNonSeat = cellType !== 'seat';
        const isFixedSeat = seat.dataset.fixedSeat === '1';
        const hasGroupTag = !!seat.querySelector('.seat-group-tag');
        const isLeader = seat.classList.contains('is-leader');

        ctxTargetSeat = seat;

        ctxSections.forEach(s => s.classList.remove('visible'));

        const showSection = (name) => {
            const sec = contextMenu.querySelector(`[data-ctx-section="${name}"]`);
            if (sec) sec.classList.add('visible');
        };

        showSection('common');
        const row = seat.dataset.row || '?';
        const col = seat.dataset.col || '?';
        if (ctxCellCoord) ctxCellCoord.textContent = `${row} 行 ${col} 列`;

        if (hasStudent) {
            showSection('occupied');
            const nameEl = seat.querySelector('.seat-name');
            if (ctxStudentName) ctxStudentName.textContent = nameEl ? nameEl.textContent : '学生';
            if (ctxSetLeader) {
                ctxSetLeader.textContent = isLeader ? '取消任命' : '任命为组长';
                ctxSetLeader.style.display = hasGroupTag ? '' : 'none';
            }
            if (ctxToggleFixedSeat) {
                const canToggleFixedSeat = !seat.dataset.isUnseatedMock && !!seat.dataset.row && !!seat.dataset.col;
                ctxToggleFixedSeat.style.display = canToggleFixedSeat ? '' : 'none';
                if (ctxToggleFixedSeatLabel) {
                    ctxToggleFixedSeatLabel.textContent = isFixedSeat ? '取消固定座位' : '固定此座位';
                }
            }
            const ctxEditInfo = document.getElementById('ctx-edit-student-info');
            if (ctxEditInfo) {
                ctxEditInfo.style.display = seat.dataset.isUnseatedMock ? '' : 'none';
            }
        } else if (isEmpty) {
            showSection('empty');
            if (ctxPasteStudent) {
                ctxPasteStudent.disabled = !clipboardStudentId;
            }
        } else if (isNonSeat) {
            showSection('non-seat');
            const typeNames = { aisle: '走廊', podium: '讲台', empty: '空位' };
            if (ctxCellTypeLabel) ctxCellTypeLabel.textContent = typeNames[cellType] || cellType;
        }

        contextMenu.style.display = 'block';
        contextMenu.style.visibility = 'hidden';
        contextMenu.style.left = '0px';
        contextMenu.style.top = '0px';

        const gap = 8;
        const rect = contextMenu.getBoundingClientRect();
        let left = e.clientX + gap;
        let top = e.clientY + gap;

        if (left + rect.width > window.innerWidth - gap) {
            left = Math.max(gap, e.clientX - rect.width - gap);
        }
        if (top + rect.height > window.innerHeight - gap) {
            top = Math.max(gap, e.clientY - rect.height - gap);
        }

        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        contextMenu.style.visibility = 'visible';
    };

    const openSeatContextMenu = (event, seat) => {
        if (!contextMenu || !canOpenSeatContextMenu(seat)) {
            showBlockedContextMenuReason(seat);
            return false;
        }
        event.preventDefault();
        ctxTargetStudentId = seat.dataset.studentId || null;
        contextMenuJustOpenedAt = Date.now();
        showContextMenu(event, seat);
        return true;
    };

    const openSeatContextMenuFromTarget = (event, target) => {
        if (!target || !target.closest) return false;
        let seat = target.closest('.seat');
        if (!seat) {
            const unseated = target.closest('.unseated-item');
            if (unseated) {
                seat = document.createElement('div');
                seat.dataset.cellType = 'seat';
                seat.dataset.studentId = unseated.dataset.studentId;
                seat.dataset.isUnseatedMock = 'true';
                seat.dataset.studentSid = unseated.dataset.studentSid || '';
                seat.dataset.studentGender = unseated.dataset.studentGender || '';
                seat.dataset.studentScore = unseated.dataset.studentScore || '0';
                seat.dataset.updateUrl = unseated.dataset.updateUrl || '';
                const nameEl = unseated.querySelector('.unseated-name');
                const badge = unseated.querySelector('.guardian-badge');
                seat.innerHTML = `
                    <div class="seat-name">${nameEl ? nameEl.childNodes[0].textContent.trim() : '学生'}</div>
                    ${badge ? badge.outerHTML : ''}
                `;
            }
        }
        if (!seat) return false;
        return openSeatContextMenu(event, seat);
    };

    let touchContextTimer = null;
    let touchContextStart = null;

    const clearTouchContextTimer = () => {
        if (touchContextTimer) {
            window.clearTimeout(touchContextTimer);
            touchContextTimer = null;
        }
        touchContextStart = null;
    };

    const scheduleTouchContextMenu = (event) => {
        if (!isTouchUi()) return;
        if (event.pointerType === 'mouse') return;
        if (!event.target || !event.target.closest) return;
        if (contextMenu && contextMenu.contains(event.target)) return;
        if (event.target.closest('button, a, input, textarea, select')) return;

        const target = event.target.closest('.seat, .unseated-item');
        if (!target) return;

        clearTouchContextTimer();
        touchContextStart = {
            x: event.clientX,
            y: event.clientY,
            target,
        };
        touchContextTimer = window.setTimeout(() => {
            const current = touchContextStart;
            clearTouchContextTimer();
            if (!current || !current.target || !current.target.isConnected) return;
            const opened = openSeatContextMenuFromTarget({
                clientX: current.x,
                clientY: current.y,
                preventDefault() { },
                stopPropagation() { },
            }, current.target);
            if (opened) {
                touchDragCandidate = null;
                markNextTouchClickSuppressed();
                if (navigator.vibrate) {
                    navigator.vibrate(8);
                }
            }
        }, 540);
    };

    document.addEventListener('pointerdown', scheduleTouchContextMenu);

    document.addEventListener('pointermove', (event) => {
        if (!touchContextStart) return;
        const dx = Math.abs(event.clientX - touchContextStart.x);
        const dy = Math.abs(event.clientY - touchContextStart.y);
        if (dx > 10 || dy > 10) {
            clearTouchContextTimer();
        }
    });

    ['pointerup', 'pointercancel'].forEach((eventName) => {
        document.addEventListener(eventName, clearTouchContextTimer);
    });

    if (seatStage) {
        seatStage.addEventListener('scroll', clearTouchContextTimer, { passive: true });
    }

    document.addEventListener('fuckseats:windows-contextmenu', (event) => {
        const detail = event.detail || {};
        const x = Number(detail.x);
        const y = Number(detail.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const target = document.elementFromPoint(x, y);
        let seat = target && target.closest ? target.closest('.seat') : null;
        if (!seat && target && target.closest) seat = target.closest('.unseated-item');
        detail.handled = openSeatContextMenuFromTarget({
            clientX: x,
            clientY: y,
            preventDefault() { },
            stopPropagation() { },
        }, target);
        if (!detail.handled) {
            hideContextMenu();
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (!contextMenu || contextMenu.style.display !== 'block') return;
        if (contextMenu.contains(event.target)) return;
        if (isSecondaryMouseButton(event) && Date.now() - contextMenuJustOpenedAt < 180) {
            return;
        }
        hideContextMenu();
    });

    document.addEventListener('contextmenu', (event) => {
        if (contextMenu && contextMenu.contains(event.target)) {
            event.preventDefault();
            return;
        }
        if (shouldSuppressNativeSeatContextMenu(event.target)) {
            event.preventDefault();
        }
        openSeatContextMenuFromTarget(event, event.target);
    }, true);

    if (contextMenu && ctxSetLeader) {
        ctxSetLeader.addEventListener('click', () => {
            if (!ctxTargetStudentId) return;
            handleResponse(postJson(urls.setLeader, {
                student_id: ctxTargetStudentId
            }));
            hideContextMenu();
        });
    }

    if (ctxToggleFixedSeat) {
        ctxToggleFixedSeat.addEventListener('click', () => {
            if (!ctxTargetSeat || !ctxTargetSeat.dataset.row || !ctxTargetSeat.dataset.col) return;
            const nextEnabled = ctxTargetSeat.dataset.fixedSeat === '1' ? '0' : '1';
            handleResponse(postJson(urls.toggleFixedSeat, {
                row: ctxTargetSeat.dataset.row,
                col: ctxTargetSeat.dataset.col,
                enabled: nextEnabled,
            }));
            hideContextMenu();
        });
    }

    if (ctxClearSeat) {
        ctxClearSeat.addEventListener('click', () => {
            if (!ctxTargetSeat) return;
            handleResponse(postJson(urls.clear, {
                row: ctxTargetSeat.dataset.row,
                col: ctxTargetSeat.dataset.col,
            }));
            hideContextMenu();
        });
    }

    if (ctxCopyStudent) {
        ctxCopyStudent.addEventListener('click', () => {
            if (!ctxTargetStudentId) return;
            clipboardStudentId = ctxTargetStudentId;
            showInlineToast('已复制学生');
            hideContextMenu();
        });
    }

    if (ctxCutStudent) {
        ctxCutStudent.addEventListener('click', () => {
            if (!ctxTargetStudentId || !ctxTargetSeat) return;
            clipboardStudentId = ctxTargetStudentId;
            handleResponse(postJson(urls.clear, {
                row: ctxTargetSeat.dataset.row,
                col: ctxTargetSeat.dataset.col,
            }));
            showInlineToast('已剪切学生');
            hideContextMenu();
        });
    }

    if (ctxMoveToUnseated) {
        ctxMoveToUnseated.addEventListener('click', () => {
            if (!ctxTargetSeat) return;
            handleResponse(postJson(urls.clear, {
                row: ctxTargetSeat.dataset.row,
                col: ctxTargetSeat.dataset.col,
            }));
            hideContextMenu();
        });
    }

    if (ctxPasteStudent) {
        ctxPasteStudent.addEventListener('click', () => {
            if (!clipboardStudentId || !ctxTargetSeat) return;
            handleResponse(postJson(urls.assign, withMovePreferences({
                student_id: clipboardStudentId,
                row: ctxTargetSeat.dataset.row,
                col: ctxTargetSeat.dataset.col,
            })));
            hideContextMenu();
        });
    }

    const ctxEditStudentInfo = document.getElementById('ctx-edit-student-info');
    if (ctxEditStudentInfo) {
        ctxEditStudentInfo.addEventListener('click', async () => {
            if (!ctxTargetSeat || !ctxTargetSeat.dataset.isUnseatedMock) return;
            const seat = ctxTargetSeat;
            hideContextMenu();
            const nameEl = seat.querySelector('.seat-name');
            const existingTagIds = (seat.dataset.studentTagIds || '').split(',').filter(Boolean).map(Number);
            const data = await openStudentForm({
                title: '编辑学生信息',
                name: nameEl ? nameEl.textContent.trim() : '',
                student_id: seat.dataset.studentSid || '',
                gender: seat.dataset.studentGender || '',
                score: seat.dataset.studentScore || '',
                tag_ids: existingTagIds,
            });
            if (!data) return;
            const updateUrl = seat.dataset.updateUrl;
            if (!updateUrl) return;
            handleResponse(postJson(updateUrl, data));
        });
    }

    (function initSpotlight() {
        const overlay = document.getElementById('spotlight-overlay');
        const input = document.getElementById('spotlightInput');
        const suggestionsEl = document.getElementById('spotlightSuggestions');
        const resultEl = document.getElementById('spotlightResult');
        if (!overlay || !input) return;

        const commandUrl = root.dataset.commandUrl;
        if (!commandUrl) return;

        let manifest = [];
        let activeIndex = -1;
        let filteredCommands = [];
        let isOpen = false;

        fetch(commandUrl, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(data => {
                if (data.manifest && data.manifest.commands) manifest = data.manifest.commands;
            })
            .catch(() => {});

        let lastShiftTime = 0;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift' && !e.repeat) {
                const now = Date.now();
                if (now - lastShiftTime < 400) {
                    e.preventDefault();
                    toggleSpotlight();
                    lastShiftTime = 0;
                } else {
                    lastShiftTime = now;
                }
            }
            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                closeSpotlight();
            }
        });

        function toggleSpotlight() {
            isOpen ? closeSpotlight() : openSpotlight();
        }

        function openSpotlight() {
            isOpen = true;
            overlay.style.display = 'flex';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    overlay.classList.add('active');
                });
            });
            input.value = '';
            resultEl.innerHTML = '';
            activeIndex = -1;
            updateSuggestions();
            requestAnimationFrame(() => input.focus());
        }

        function closeSpotlight() {
            isOpen = false;
            overlay.classList.remove('active');
            const onEnd = (e) => {
                if (e.target !== overlay) return;
                overlay.style.display = 'none';
                overlay.removeEventListener('transitionend', onEnd);
            };
            overlay.addEventListener('transitionend', onEnd);
            input.blur();
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSpotlight();
        });

        input.addEventListener('input', () => {
            resultEl.innerHTML = '';
            updateSuggestions();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSelection(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(-1);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                tabComplete();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeCommand();
            }
        });

        function updateSuggestions() {
            const raw = input.value.trim();
            const query = raw.startsWith('/') ? raw.slice(1) : raw;
            const lower = query.toLowerCase();

            if (!query) {
                filteredCommands = manifest.slice();
            } else {
                filteredCommands = manifest.filter(cmd => {
                    if (cmd.name.includes(lower)) return true;
                    if (cmd.summary && cmd.summary.includes(lower)) return true;
                    if (cmd.aliases && cmd.aliases.some(a => a.includes(lower))) return true;
                    return false;
                });
            }

            activeIndex = filteredCommands.length > 0 ? 0 : -1;
            renderSuggestions();
        }

        function renderSuggestions() {
            if (filteredCommands.length === 0) {
                suggestionsEl.innerHTML = '';
                return;
            }
            suggestionsEl.innerHTML = filteredCommands.map((cmd, i) => {
                const aliases = (cmd.aliases || []).filter(a => a !== cmd.name).join(', ');
                return `<div class="spotlight-suggestion-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
                    <div>
                        <div class="spotlight-suggestion-name">/${cmd.name}</div>
                        <div class="spotlight-suggestion-summary">${cmd.summary || ''}</div>
                    </div>
                    ${aliases ? `<span class="spotlight-suggestion-aliases">${aliases}</span>` : ''}
                </div>`;
            }).join('');

            suggestionsEl.querySelectorAll('.spotlight-suggestion-item').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.index);
                    const cmd = filteredCommands[idx];
                    if (cmd) {
                        input.value = '/' + cmd.name + ' ';
                        input.focus();
                        updateSuggestions();
                    }
                });
            });
        }

        function moveSelection(dir) {
            if (filteredCommands.length === 0) return;
            activeIndex = (activeIndex + dir + filteredCommands.length) % filteredCommands.length;
            renderSuggestions();
            const activeEl = suggestionsEl.querySelector('.spotlight-suggestion-item.active');
            if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
        }

        function tabComplete() {
            if (activeIndex >= 0 && activeIndex < filteredCommands.length) {
                const cmd = filteredCommands[activeIndex];
                input.value = '/' + cmd.name + ' ';
                updateSuggestions();
            }
        }

        function executeCommand() {
            let text = input.value.trim();
            if (!text) {
                if (activeIndex >= 0 && filteredCommands[activeIndex]) {
                    text = '/' + filteredCommands[activeIndex].name;
                } else {
                    return;
                }
            }
            if (!text.startsWith('/')) text = '/' + text;

            suggestionsEl.innerHTML = '';
            resultEl.innerHTML = '<div class="spotlight-result-loading">执行中...</div>';

            fetch(commandUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrf,
                },
                body: JSON.stringify({ command: text }),
            })
            .then(r => r.json())
            .then(data => {
                const reply = (data.reply || '').trim();
                const cr = data.command_result || {};
                const needsRefresh = cr.needs_refresh;

                if (data.status === 'error') {
                    resultEl.innerHTML = `<div class="spotlight-result-content spotlight-result-error">${data.message || '命令执行失败'}</div>`;
                } else if (reply) {
                    resultEl.innerHTML = `<div class="spotlight-result-content">${escapeHtml(reply)}</div>`;
                } else {
                    resultEl.innerHTML = `<div class="spotlight-result-content">命令已执行</div>`;
                }

                if (needsRefresh) {
                    setTimeout(() => {
                        closeSpotlight();
                        if (typeof refreshState === 'function') {
                            refreshState();
                        } else {
                            location.reload();
                        }
                    }, 800);
                }
            })
            .catch(() => {
                resultEl.innerHTML = '<div class="spotlight-result-content spotlight-result-error">网络错误，请重试</div>';
            });
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    })();
});
