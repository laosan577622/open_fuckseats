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
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 2200);
    };

    const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const sanitizeFilename = (name, fallback = '导出文件') => {
        const normalized = String(name || '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/[. ]+$/g, '')
            .trim();
        return normalized || fallback;
    };

    const parseContentDispositionFilename = (contentDisposition) => {
        if (!contentDisposition) return '';
        const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (utf8Match && utf8Match[1]) {
            try {
                return decodeURIComponent(utf8Match[1]);
            } catch (_) {
                return utf8Match[1];
            }
        }
        const plainMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
        if (!plainMatch) return '';
        return (plainMatch[1] || plainMatch[2] || '').trim();
    };

    const inferFilenameFromUrl = (url, fallback = '导出文件') => {
        try {
            const parsed = new URL(url, window.location.origin);
            const lastPart = parsed.pathname.split('/').filter(Boolean).pop() || '';
            if (!lastPart) return fallback;
            if (lastPart.includes('.')) return lastPart;
            return fallback;
        } catch (_) {
            return fallback;
        }
    };

    const parseAcceptExtensions = (raw = '') => {
        return String(raw)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => (item.startsWith('.') ? item : `.${item}`));
    };

    const buildSavePickerTypes = (acceptMime, extensions, filename) => {
        const extList = [...(extensions || [])];
        if (!extList.length && filename.includes('.')) {
            const suffix = filename.slice(filename.lastIndexOf('.'));
            if (suffix && suffix.length <= 10) {
                extList.push(suffix);
            }
        }
        if (!extList.length) return [];
        const mime = acceptMime || 'application/octet-stream';
        return [{
            description: '导出文件',
            accept: {
                [mime]: extList
            }
        }];
    };

    const triggerBrowserDownload = (blob, filename) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            link.remove();
        }, 1000);
    };

    const openSaveFileHandle = async (filename, acceptMime, extensions) => {
        if (!window.isSecureContext || typeof window.showSaveFilePicker !== 'function') return null;
        const pickerOptions = {
            suggestedName: filename
        };
        const types = buildSavePickerTypes(acceptMime, extensions, filename);
        if (types.length) pickerOptions.types = types;
        return window.showSaveFilePicker(pickerOptions);
    };

    const saveExportFromUrl = async (url, options = {}) => {
        if (!url) throw new Error('导出地址无效');
        const fallbackFilename = sanitizeFilename(
            options.fallbackFilename || inferFilenameFromUrl(url),
            '导出文件'
        );
        const acceptMime = options.acceptMime || '';
        const acceptExtensions = options.acceptExtensions || [];

        let fileHandle = null;
        try {
            fileHandle = await openSaveFileHandle(fallbackFilename, acceptMime, acceptExtensions);
        } catch (error) {
            if (error?.name === 'AbortError') {
                return { status: 'cancelled', filename: fallbackFilename };
            }
        }

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            throw new Error(`导出失败（${response.status}）`);
        }

        const headerFilename = parseContentDispositionFilename(response.headers.get('Content-Disposition') || '');
        const finalFilename = sanitizeFilename(headerFilename || fallbackFilename, fallbackFilename);
        const blob = await response.blob();

        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { status: 'saved', filename: finalFilename };
        }

        triggerBrowserDownload(blob, finalFilename);
        return { status: 'downloaded', filename: finalFilename };
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
                    alert(error?.message || '导出失败');
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
                alert(data.message || '操作失败');
                return;
            }
            if (onSuccess) onSuccess(data);
            refreshState();
        }).catch((err) => alert(err?.message || '操作失败'));
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

    const setDragGhost = (e, label) => {
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = label;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        requestAnimationFrame(() => ghost.remove());
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
        if (!urls.state) return;
        const selectedSeatKey = selectedSeat ? seatKey(selectedSeat) : null;
        const selectedUnseatedId = selectedUnseated ? selectedUnseated.dataset.studentId : null;

        const stateUrl = `${urls.state}?t=${Date.now()}`;
        fetch(stateUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
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
                                    alert(error?.message || '导出失败');
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
            .catch(() => alert('刷新失败'));
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
                    alert(plan.reason || '批量拖拽失败');
                    return;
                }
                if (plan.deltaRow === 0 && plan.deltaCol === 0) {
                    return;
                }
                if (!urls.moveBatch) {
                    alert('当前版本不支持多选拖拽');
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
                setDragGhost(e, `移动 ${dragState.sourceKeys.length} 人`);
            } else {
                dragState.mode = 'single';
                dragState.sourceKeys = [sourceKey];
                setDragGhost(e, '移动');
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
            setDragGhost(e, '安排入座');
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
                alert('请先选择座位');
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
                alert('请先选择参考小组');
                return;
            }
            if (!urls.groupAuto) {
                alert('当前版本不支持自动编组');
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
                    alert(err.message || '自动编组失败');
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
                alert('请选择来源组和目标组');
                return;
            }
            if (sourceGroupId === targetGroupId) {
                alert('来源组和目标组不能相同');
                return;
            }
            if (!urls.groupMerge) {
                alert('当前版本不支持合并组');
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
                    alert(err.message || '合并组失败');
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
                alert('当前版本不支持小组轮换');
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
                    alert(err.message || '小组轮换失败');
                })
                .finally(() => {
                    groupRotateBtn.textContent = originalText;
                    groupRotateBtn.disabled = false;
                });
        });
    }

    if (renameClassroomBtn) {
        renameClassroomBtn.addEventListener('click', () => {
            if (!urls.renameClassroom) {
                alert('当前版本不支持修改班级名称');
                return;
            }
            const currentName = root.dataset.classroomName || '';
            const newName = prompt('请输入新的班级名称：', currentName);
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) {
                alert('班级名称不能为空');
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
                    alert(err.message || '修改班级名称失败');
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
                alert('请输入小组名称');
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
                .catch((err) => alert(err.message || '创建小组失败'));
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
                    alert('小组名称不能为空');
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
                    .catch((err) => alert(err.message || '重命名失败'));
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
                    .catch((err) => alert(err.message || '删除失败'));
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
    };

    const closeModal = (modalId) => {
        if (!modalId) return;
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = 'none';
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
                modal.style.display = 'none';
            }
        });
    });

    bindSystemSaveLinks();

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
    const ctxSetLeader = document.getElementById('ctx-set-leader');
    let ctxTargetStudentId = null;

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

    document.addEventListener('click', () => {
        hideContextMenu();
    });

    if (contextMenu && ctxSetLeader) {
        seatElements.forEach(seat => {
            seat.addEventListener('contextmenu', (e) => {
                if (seat.dataset.cellType !== 'seat' || !seat.dataset.studentId) return;

                // 检查是否有小组
                // 这里我们假设 seat 元素如果有 group tag 或者从 dataset 中能知道 group
                // 简单点：只有占座且在组里的才能设为组长
                // 需要 updateSeatElement 更新时把 group_id 也存一下，或者直接判断 DOM
                const hasGroup = seat.querySelector('.seat-group-tag') !== null;

                if (!hasGroup) return;

                e.preventDefault();
                e.stopPropagation();
                ctxTargetStudentId = seat.dataset.studentId;
                showContextMenu(e, seat);
            });
        });

        ctxSetLeader.addEventListener('click', () => {
            if (!ctxTargetStudentId) return;
            handleResponse(postJson(urls.setLeader, {
                student_id: ctxTargetStudentId
            }));
            hideContextMenu();
        });
    }
});
