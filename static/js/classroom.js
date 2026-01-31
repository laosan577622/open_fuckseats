document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('classroom-root');
    if (!root) return;

    const urls = {
        move: root.dataset.moveUrl,
        clear: root.dataset.clearUrl,
        assign: root.dataset.assignUrl,
        groupAssign: root.dataset.groupAssignUrl,
        groupAssignBatch: root.dataset.groupAssignBatchUrl,
        state: root.dataset.stateUrl,
        undo: root.dataset.undoUrl,
        redo: root.dataset.redoUrl,
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

    const seatElements = Array.from(document.querySelectorAll('.seat'));
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const groupSelect = document.getElementById('groupSelect');
    const groupAssignToggle = document.getElementById('groupAssignToggle');
    const groupApplyBtn = document.getElementById('groupApplyBtn');
    const groupClearSelectBtn = document.getElementById('groupClearSelectBtn');
    const seatStage = document.querySelector('.seat-stage');
    const unseatedList = document.querySelector('.unseated-list');
    const unseatedCount = document.getElementById('unseatedCount');
    const suggestionList = document.getElementById('suggestionList');
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

    const handleResponse = (promise) => {
        promise.then(data => {
            if (data && data.status && data.status !== 'success') {
                alert(data.message || '操作失败');
                return;
            }
            refreshState();
        }).catch(() => alert('操作失败'));
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
            if (cls.startsWith('cell-') || cls === 'occupied') {
                seat.classList.remove(cls);
            }
        });

        seat.classList.add(`cell-${data.cell_type}`);
        if (data.student) {
            seat.classList.add('occupied');
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
                                    <button class="toast-btn primary toast-action-btn" data-url="${item.action_url}" data-msg-type="${item.type || ''}">${item.action_label}</button>
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
                                window.location.href = url;
                                btn.closest('.toast-notification').remove();
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
        });
        seat.addEventListener('drop', (e) => {
            if (seat.dataset.cellType !== 'seat') return;
            e.preventDefault();
            const studentId = e.dataTransfer.getData('text/plain');
            if (!studentId) return;
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
            e.dataTransfer.setData('text/plain', seatContent.dataset.studentId);
        } else if (unseatedItem) {
            e.dataTransfer.setData('text/plain', unseatedItem.dataset.studentId);
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
            }));
        });
    }

    if (groupClearSelectBtn) {
        groupClearSelectBtn.addEventListener('click', () => {
            clearMultiSelection();
        });
    }

    if (undoBtn) {
        undoBtn.addEventListener('click', () => handleResponse(postJson(urls.undo, {})));
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => handleResponse(postJson(urls.redo, {})));
    }

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
        const savedBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
        if (savedBtn) {
            savedBtn.click();
        }
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

    if (document.fullscreenEnabled) {
        document.documentElement.requestFullscreen().catch(() => { });
    }
});
