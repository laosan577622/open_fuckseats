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
        renameClassroom: root.dataset.renameClassroomUrl,
        state: root.dataset.stateUrl,
        undo: root.dataset.undoUrl,
        redo: root.dataset.redoUrl,
        setLeader: root.dataset.setLeaderUrl,
    };
    const csrf = root.dataset.csrf;

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

    const shiftLayoutLeftBtn = document.getElementById('btn-shift-layout-left');
    const shiftLayoutRightBtn = document.getElementById('btn-shift-layout-right');
    const shiftLayoutSteps = document.getElementById('shiftLayoutSteps');
    const createGroupForm = document.getElementById('createGroupForm');
    const groupList = document.getElementById('groupList');
    const unseatedSearch = document.getElementById('unseatedSearch');
    const groupBaseUrl = createGroupForm ? createGroupForm.action.replace(/group\/create\/?$/, 'group/') : '';
    const seatStage = document.querySelector('.seat-stage');
    const unseatedList = document.querySelector('.unseated-list');
    const unseatedCount = document.getElementById('unseatedCount');
    const suggestionList = document.getElementById('suggestionList');
    const enabledActionSuggestionTypes = new Set(['export_suggestion', 'group_balance']);
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.display = 'none';
    document.body.appendChild(selectionBox);
    const seatsImportForm = document.getElementById('seats-import-form');
    const seatsImportInput = document.getElementById('seats-import-input');
    const seatsImportTriggers = Array.from(document.querySelectorAll('[data-seats-import-trigger="1"]'));
    const fileMenuRoots = Array.from(document.querySelectorAll('.menu-dropdown[data-menu-root]'));

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
        seatsImportTriggers.forEach((trigger) => {
            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                closeAllFileMenus();
                seatsImportInput.value = '';
                seatsImportInput.click();
            });
        });
        seatsImportInput.addEventListener('change', () => {
            if (!seatsImportInput.files || !seatsImportInput.files.length) return;
            seatsImportForm.submit();
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
        setTimeout(() => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            });
        }, 2200);
    };
    const notify = (message) => {
        showInlineToast(message);
    };

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
            // ignore storage errors
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
        const confirmed = window.confirm(`插件“${title}”请求修改当前工作页面，是否授权？`);
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
                    // ignore cleanup failures
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
            btn.style.background = payload.variant === 'secondary' ? 'rgba(10, 89, 247, 0.12)' : '#0a59f7';
            btn.style.color = payload.variant === 'secondary' ? '#0a59f7' : '#fff';
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
            chip.style.border = '1px solid rgba(10, 89, 247, 0.22)';
            chip.style.borderRadius = '999px';
            chip.style.padding = '2px 10px';
            chip.style.fontSize = '11px';
            chip.style.color = '#0a59f7';
            chip.style.background = 'rgba(10, 89, 247, 0.08)';
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
                    // keep auto-run silent
                }
            }
        }
    };

    const executePluginCommand = async (cmd, options = {}) => {
        if (!cmd) return;

        if (cmd.kind === 'uiOpen') {
            window.open(buildUiPageUrl(cmd.extensionId, cmd.uiName), '_blank', 'noopener,noreferrer');
            if (!options.silent) showInlineToast(`已打开 ${cmd.extensionId}.${cmd.uiName}`);
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
                window.open(buildUiPageUrl(targetId, uiName), '_blank', 'noopener,noreferrer');
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
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
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

    const handleResponse = (promise, onSuccess = null) => {
        promise.then(data => {
            if (data && data.status && data.status !== 'success') {
                notify(data.message || '操作失败');
                return;
            }
            if (onSuccess) onSuccess(data);
            refreshState();
        }).catch((err) => notify(err?.message || '操作失败'));
    };

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
            handleResponse(postJson(urls.assign, {
                student_id: targetStudentId,
                row,
                col
            }));
            return;
        }

        handleResponse(postJson(urls.move, {
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
            // Center the drag image to the pointer
            e.dataTransfer.setDragImage(ghost, sourceEl.offsetWidth / 2, sourceEl.offsetHeight / 2);
        } else {
            ghost.classList.add('drag-ghost-text');
            ghost.textContent = label;
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 20, 20);
        }

        setTimeout(() => ghost.remove(), 0);
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
            if (cls.startsWith('cell-') || cls === 'occupied' || cls === 'is-leader') {
                seat.classList.remove(cls);
            }
        });

        seat.classList.add(`cell-${data.cell_type}`);
        if (data.student) {
            seat.classList.add('occupied');
            if (data.student.is_leader) {
                seat.classList.add('is-leader');
            }
        }
        if (hadSelected) seat.classList.add('selected');
        if (hadMulti) seat.classList.add('multi-selected');

        seat.dataset.cellType = data.cell_type;
        seat.dataset.studentId = data.student ? data.student.id : '';

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

    const refreshState = () => {
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
                            return `
                                <div class="unseated-item" draggable="true" data-student-id="${student.id}">
                                    <div>
                                        <div class="unseated-name">${student.name}</div>
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

                if (data.suggestions) {
                    const toastContainer = document.getElementById('toast-container') || createToastContainer();
                    toastContainer.innerHTML = ''; // 清空容器（简单同步逻辑，可优化）

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
                            // 渲染为弹窗
                            const toast = document.createElement('div');
                            toast.className = 'toast-notification';
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
                            // 渲染为列表项
                            listItems.push(`<div class="suggestion-item">${item}</div>`);
                        }
                    });

                    // 绑定弹窗事件
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
                                    btn.closest('.toast-notification')?.remove();
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
                                btn.closest('.toast-notification').remove();
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
                            btn.closest('.toast-notification').remove();
                        });
                    });

                    if (suggestionList) {
                        if (listItems.length) {
                            suggestionList.innerHTML = listItems.join('');
                        } else {
                            suggestionList.innerHTML = '<div class="empty-hint">当前布局没有明显问题</div>';
                        }
                    }
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
            if (seat.dataset.cellType !== 'seat') return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                addToMultiSelection(seat);
                return;
            }
            if (groupMode) {
                toggleMultiSelection(seat);
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
                handleResponse(postJson(urls.moveBatch, { moves: plan.moves }), () => {
                    clearMultiSelection();
                });
                return;
            }

            const studentId = (dragState.active && dragState.sourceStudentId) || e.dataTransfer.getData('text/plain');
            const sourceSeat = getSeatByKey(dragState.anchorKey);
            clearDragFeedback();
            if (!studentId) return;
            if (sourceSeat && sourceSeat.dataset.seatKey === seat.dataset.seatKey) return;
            handleResponse(postJson(urls.move, {
                student_id: studentId,
                row: seat.dataset.row,
                col: seat.dataset.col
            }));
        });
    });

    if (unseatedList) {
        unseatedList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-student');
            if (deleteBtn) {
                e.stopPropagation();
                const url = deleteBtn.dataset.deleteUrl;
                if (!url) return;
                if (!confirm('确定要删除该学生吗？')) return;
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
        dragState.active = false;
        dragState.mode = null;
        dragState.anchorKey = null;
        dragState.sourceKeys = [];
        dragState.sourceStudentId = null;
        clearDragFeedback();
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
        groupMergeBtn.addEventListener('click', () => {
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
            if (!confirm(`确定将【${sourceName}】并入【${targetName}】吗？来源组将被删除。`)) {
                return;
            }

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
        groupRotateBtn.addEventListener('click', () => {
            if (!urls.groupRotate) {
                notify('当前版本不支持小组轮换');
                return;
            }
            if (!confirm('确定执行小组平移轮换吗？将按当前小组顺序整体交换位置。')) {
                return;
            }
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

    const handleShiftLayout = (direction) => {
        if (!urls.shiftLayout) return;
        const steps = 1;

        const btn = direction === 'left' ? shiftLayoutLeftBtn : shiftLayoutRightBtn;
        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = '执行中...';
        btn.disabled = true;

        postJson(urls.shiftLayout, { direction, steps })
            .then(data => {
                if (data && data.status === 'success') {
                    showInlineToast(data.message || '布局轮换成功');
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

    if (shiftLayoutLeftBtn) {
        shiftLayoutLeftBtn.addEventListener('click', () => handleShiftLayout('left'));
    }

    if (shiftLayoutRightBtn) {
        shiftLayoutRightBtn.addEventListener('click', () => handleShiftLayout('right'));
    }

    if (renameClassroomBtn) {
        renameClassroomBtn.addEventListener('click', () => {
            if (!urls.renameClassroom) {
                notify('当前版本不支持修改班级名称');
                return;
            }
            const currentName = root.dataset.classroomName || '';
            const newName = prompt('请输入新的班级名称：', currentName);
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
        groupList.addEventListener('click', (e) => {
            const renameBtn = e.target.closest('[data-action="rename-group"]');
            if (renameBtn) {
                const item = renameBtn.closest('.group-item');
                const currentName = item ? item.dataset.groupName : '';
                const newName = prompt('请输入新的小组名称：', currentName || '');
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
                if (!confirm('确定要删除这个小组吗？')) return;
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
        undoBtn.addEventListener('click', () => handleResponse(postJson(urls.undo, {})));
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => handleResponse(postJson(urls.redo, {})));
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
            // 保存当前激活的标签页到 localStorage
            localStorage.setItem('classroom_active_tab', tab);
        });
    });

    // 从 localStorage 恢复激活的标签页
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
        modal.style.display = 'block';
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
        const onEnd = () => {
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

    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });

    initFileMenus();
    initSeatsImport();
    bindSystemSaveLinks();
    initPluginHub();

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
        const key = e.key.toLowerCase();
        if (key === 'escape') {
            e.preventDefault();
            clearMultiSelection();
            return;
        }
        if (e.ctrlKey && key === 'z') {
            e.preventDefault();
            handleResponse(postJson(urls.undo, {}));
            return;
        }
        if (e.ctrlKey && key === 'y') {
            e.preventDefault();
            handleResponse(postJson(urls.redo, {}));
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
                handleResponse(postJson(urls.assign, {
                    student_id: clipboardStudentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
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
                handleResponse(postJson(urls.assign, {
                    student_id: selectedUnseated.dataset.studentId,
                    row: seat.dataset.row,
                    col: seat.dataset.col
                }));
            }
        }
    });

    setDragEnabled(true);

    // 导入流程已迁移到独立配置页面脚本

    // Context Menu Logic
    const contextMenu = document.getElementById('seat-context-menu');
    if (contextMenu && contextMenu.parentNode !== document.body) {
        document.body.appendChild(contextMenu);
    }
    const ctxSetLeader = document.getElementById('ctx-set-leader');
    let ctxTargetStudentId = null;
    let contextMenuJustOpenedAt = 0;
    let blockedContextMenuTipAt = 0;

    const contextDebug = (source, payload = {}) => {
        const data = payload && typeof payload === 'object' ? payload : { value: payload };
        console.log('[classroom-context-menu]', source, data);
        try {
            const api = window.pywebview?.api;
            if (api && typeof api.log_context_menu_debug === 'function') {
                api.log_context_menu_debug(`classroom:${source}`, data);
            }
        } catch (_) {
            // ignore bridge logging failures
        }
    };

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
        if (!seat || seat.dataset.cellType !== 'seat' || !seat.dataset.studentId) return false;
        return seat.querySelector('.seat-group-tag') !== null;
    };

    const showBlockedContextMenuReason = (seat) => {
        const now = Date.now();
        if (now - blockedContextMenuTipAt < 800) return;
        blockedContextMenuTipAt = now;

        if (!seat || !seat.dataset || !seat.dataset.studentId) return;
        if (!seat.querySelector('.seat-group-tag')) {
            showInlineToast('该学生尚未加入任何小组，先分组后才能设为组长');
        }
    };

    const hideContextMenu = () => {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        contextMenu.style.visibility = 'visible';
        ctxTargetStudentId = null;
    };

    const showContextMenu = (e, seat) => {
        if (!contextMenu || !ctxSetLeader || !seat) return;

        const isLeader = seat.classList.contains('is-leader');
        ctxSetLeader.textContent = isLeader ? '取消任命' : '任命为组长';

        contextMenu.style.display = 'block';
        contextMenu.style.visibility = 'hidden';

        // 重置位置，防止前一次点击的位置影响元素的正常测量大小
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
        const seatInfo = describeSeatForContextMenu(seat);
        if (!contextMenu || !ctxSetLeader || !canOpenSeatContextMenu(seat)) {
            showBlockedContextMenuReason(seat);
            contextDebug('open-blocked', {
                seat: seatInfo,
                hasMenu: !!contextMenu,
                hasAction: !!ctxSetLeader,
            });
            return false;
        }
        event.preventDefault();
        event.stopPropagation();
        ctxTargetStudentId = seat.dataset.studentId;
        contextMenuJustOpenedAt = Date.now();
        showContextMenu(event, seat);
        contextDebug('open-success', {
            seat: seatInfo,
            point: { x: event.clientX, y: event.clientY },
        });
        return true;
    };

    const openSeatContextMenuFromTarget = (event, target) => {
        if (!target || !target.closest) return false;
        const seat = target.closest('.seat');
        if (!seat) return false;
        return openSeatContextMenu(event, seat);
    };

    document.addEventListener('fuckseats:windows-contextmenu', (event) => {
        const detail = event.detail || {};
        const x = Number(detail.x);
        const y = Number(detail.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const target = document.elementFromPoint(x, y);
        const seat = target && target.closest ? target.closest('.seat') : null;
        contextDebug('windows-event', {
            point: { x, y },
            targetClass: target && target.className ? String(target.className) : '',
            seat: describeSeatForContextMenu(seat),
        });
        detail.handled = openSeatContextMenuFromTarget({
            clientX: x,
            clientY: y,
            preventDefault() { },
            stopPropagation() { },
        }, target);
        if (!detail.handled) {
            hideContextMenu();
        }
        contextDebug('windows-event-result', {
            point: { x, y },
            handled: !!detail.handled,
        });
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
            contextDebug('native-menu-self', {
                targetClass: event.target && event.target.className ? String(event.target.className) : '',
            });
            return;
        }
        const seat = event.target && event.target.closest ? event.target.closest('.seat') : null;
        const handled = openSeatContextMenuFromTarget(event, event.target);
        contextDebug('document-contextmenu', {
            handled,
            defaultPrevented: !!event.defaultPrevented,
            targetClass: event.target && event.target.className ? String(event.target.className) : '',
            seat: describeSeatForContextMenu(seat),
        });
    }, true);

    if (contextMenu && ctxSetLeader) {
        ctxSetLeader.addEventListener('click', () => {
            if (!ctxTargetStudentId) return;
            contextDebug('action-click', {
                studentId: ctxTargetStudentId,
            });
            handleResponse(postJson(urls.setLeader, {
                student_id: ctxTargetStudentId
            }));
            hideContextMenu();
        });
    }
});
