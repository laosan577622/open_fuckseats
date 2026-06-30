document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('layout-root');
    if (!root) return;

    const cellUrl = root.dataset.cellUrl;
    const csrf = root.dataset.csrf;
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu && contextMenu.parentNode !== document.body) {
        document.body.appendChild(contextMenu);
    }
    let activeTool = 'seat';
    let contextSeat = null;
    let contextRowCol = null;  // {row, col} for empty-space right-click
    let contextMenuJustOpenedAt = 0;
    let suppressNextTouchClick = false;

    const selectedSeats = new Set();
    let selecting = false;
    let selectStart = null;
    const touchPointerQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
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
    const notify = (message) => {
        if (!message) return;
        if (typeof window.showToast === 'function') {
            window.showToast(message);
            return;
        }
        console.warn(message);
    };

    const seatStage = document.querySelector('.seat-stage');
    const gridContainer = document.getElementById('seat-grid-container');
    const zoomLevelDisplay = document.getElementById('zoom-level');
    const zoomInBtn = document.getElementById('layoutZoomInBtn');
    const zoomOutBtn = document.getElementById('layoutZoomOutBtn');
    const previewToggles = Array.from(document.querySelectorAll('[data-layout-preview-toggle]'));
    const PREVIEW_CLASS = 'layout-preview-visible';
    const ZOOM_STORAGE_KEY = 'fuckseats_layout_editor_zoom';
    const PREVIEW_STORAGE_KEY = 'fuckseats_layout_editor_preview';
    const clampZoom = (value) => Math.min(Math.max(value, 0.5), 2);
    const readStorage = (key) => {
        try {
            return window.localStorage ? window.localStorage.getItem(key) : null;
        } catch (error) {
            return null;
        }
    };
    const writeStorage = (key, value) => {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(key, value);
            }
        } catch (error) {
            // Ignore storage failures in private browsing or restricted environments.
        }
    };
    let currentScale = clampZoom(parseFloat(readStorage(ZOOM_STORAGE_KEY) || '1') || 1);
    let previewVisible = readStorage(PREVIEW_STORAGE_KEY) === '1';

    const updateZoom = () => {
        if (!gridContainer) return;
        gridContainer.style.zoom = currentScale;
        if (zoomLevelDisplay) {
            zoomLevelDisplay.textContent = `${Math.round(currentScale * 100)}%`;
        }
        writeStorage(ZOOM_STORAGE_KEY, String(currentScale));
    };

    const zoomIn = () => {
        currentScale = clampZoom(Number((currentScale + 0.1).toFixed(2)));
        updateZoom();
    };

    const zoomOut = () => {
        currentScale = clampZoom(Number((currentScale - 0.1).toFixed(2)));
        updateZoom();
    };

    const setPreviewVisible = (visible) => {
        previewVisible = Boolean(visible);
        root.classList.toggle(PREVIEW_CLASS, previewVisible);
        previewToggles.forEach((button) => {
            button.textContent = previewVisible ? '关闭预览' : '打开预览';
            button.setAttribute('aria-pressed', previewVisible ? 'true' : 'false');
            button.classList.toggle('active', previewVisible);
        });
        writeStorage(PREVIEW_STORAGE_KEY, previewVisible ? '1' : '0');
    };

    updateZoom();
    setPreviewVisible(previewVisible);

    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    previewToggles.forEach((button) => {
        button.addEventListener('click', () => {
            setPreviewVisible(!previewVisible);
        });
    });

    if (seatStage) {
        seatStage.addEventListener('wheel', (event) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            if (event.deltaY < 0) {
                zoomIn();
            } else {
                zoomOut();
            }
        }, { passive: false });
    }

    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.display = 'none';
    document.body.appendChild(selectionBox);

    // Crosshair overlays for row/col targeting
    const crosshairRow = document.createElement('div');
    crosshairRow.className = 'rc-crosshair-row';
    crosshairRow.style.display = 'none';
    const crosshairCol = document.createElement('div');
    crosshairCol.className = 'rc-crosshair-col';
    crosshairCol.style.display = 'none';
    const seatGrid = document.querySelector('.seat-grid');
    if (seatGrid) {
        seatGrid.style.position = 'relative';
        seatGrid.appendChild(crosshairRow);
        seatGrid.appendChild(crosshairCol);
    }

    const hideCrosshair = () => {
        crosshairRow.style.display = 'none';
        crosshairCol.style.display = 'none';
    };

    const showCrosshair = (targetRow, targetCol) => {
        if (!seatGrid) return;
        const rows = seatGrid.querySelectorAll('.seat-row');
        const gridRect = seatGrid.getBoundingClientRect();

        // Find the row element
        if (targetRow >= 1 && targetRow <= rows.length) {
            const rowEl = rows[targetRow - 1];
            const rowRect = rowEl.getBoundingClientRect();
            crosshairRow.style.display = 'block';
            crosshairRow.style.top = `${rowRect.top - gridRect.top}px`;
            crosshairRow.style.height = `${rowRect.height}px`;
        } else {
            crosshairRow.style.display = 'none';
        }

        // Find a seat in the target column to get its horizontal position
        const colSeat = seatGrid.querySelector(`.seat[data-col="${targetCol}"]`);
        if (colSeat) {
            const colRect = colSeat.getBoundingClientRect();
            crosshairCol.style.display = 'block';
            crosshairCol.style.left = `${colRect.left - gridRect.left}px`;
            crosshairCol.style.width = `${colRect.width}px`;
        } else {
            crosshairCol.style.display = 'none';
        }
    };

    // Find nearest row/col from a click position within the grid
    const findNearestRowCol = (clientX, clientY) => {
        if (!seatGrid) return null;
        const rows = seatGrid.querySelectorAll('.seat-row');
        if (!rows.length) return null;

        let nearestRow = 1;
        let minRowDist = Infinity;
        rows.forEach((rowEl, i) => {
            const rect = rowEl.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const dist = Math.abs(clientY - centerY);
            if (dist < minRowDist) {
                minRowDist = dist;
                nearestRow = i + 1;
            }
        });

        let nearestCol = 1;
        let minColDist = Infinity;
        const allSeats = seatGrid.querySelectorAll('.seat');
        const seenCols = new Set();
        allSeats.forEach(seat => {
            const col = parseInt(seat.dataset.col, 10);
            if (seenCols.has(col)) return;
            seenCols.add(col);
            const rect = seat.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const dist = Math.abs(clientX - centerX);
            if (dist < minColDist) {
                minColDist = dist;
                nearestCol = col;
            }
        });

        return { row: nearestRow, col: nearestCol };
    };

    const postJson = (payload) => {
        return fetch(cellUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
            },
            body: JSON.stringify(payload)
        }).then(res => res.json());
    };

    const isSecondaryMouseButton = (event) => {
        if (!event) return false;
        if (event.button === 2 || event.which === 3) return true;
        const isMacLike = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
        return Boolean(isMacLike && event.ctrlKey && event.button === 0);
    };

    const seatKey = (seat) => `${seat.dataset.row}-${seat.dataset.col}`;

    const clearSelection = () => {
        selectedSeats.forEach(key => {
            const seat = document.querySelector(`.seat[data-seat-key="${key}"]`);
            if (seat) seat.classList.remove('multi-selected');
        });
        selectedSeats.clear();
    };

    const addToSelection = (seat) => {
        const key = seatKey(seat);
        if (!selectedSeats.has(key)) {
            selectedSeats.add(key);
            seat.classList.add('multi-selected');
        }
    };

    const toggleSelection = (seat) => {
        const key = seatKey(seat);
        if (selectedSeats.has(key)) {
            selectedSeats.delete(key);
            seat.classList.remove('multi-selected');
        } else {
            addToSelection(seat);
        }
    };

    const applyToolToSeats = (tool, seats) => {
        if (!tool || !seats.length) return;
        Promise.all(seats.map(seat => postJson({
            row: seat.dataset.row,
            col: seat.dataset.col,
            cell_type: tool
        }))).then(() => {
            window.location.reload();
        }).catch(() => notify('操作失败'));
    };

    const applyTool = (seat, tool) => {
        if (!seat || !tool) return;
        postJson({
            row: seat.dataset.row,
            col: seat.dataset.col,
            cell_type: tool
        }).then(data => {
            if (data && data.status && data.status !== 'success') {
                notify(data.message || '操作失败');
                return;
            }
            window.location.reload();
        }).catch(() => notify('操作失败'));
    };

    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTool = btn.dataset.tool;
            document.querySelectorAll('.tool-btn').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            if (selectedSeats.size) {
                const seats = Array.from(selectedSeats).map(key => document.querySelector(`.seat[data-seat-key="${key}"]`)).filter(Boolean);
                applyToolToSeats(activeTool, seats);
            }
        });
    });

    const applySelectedBtn = document.getElementById('applySelected');
    const clearSelectedBtn = document.getElementById('clearSelected');

    if (applySelectedBtn) {
        applySelectedBtn.addEventListener('click', () => {
            const seats = Array.from(selectedSeats).map(key => document.querySelector(`.seat[data-seat-key="${key}"]`)).filter(Boolean);
            if (!seats.length) {
                notify('请先选择座位');
                return;
            }
            applyToolToSeats(activeTool, seats);
        });
    }

    if (clearSelectedBtn) {
        clearSelectedBtn.addEventListener('click', clearSelection);
    }

    const setContextMenuMode = (mode) => {
        // mode: 'seat' (right-click on seat) or 'empty' (right-click on empty space)
        if (!contextMenu) return;
        contextMenu.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.style.display = mode === 'seat' ? '' : 'none';
        });
        const divider = contextMenu.querySelector('.context-menu-divider');
        if (divider) divider.style.display = mode === 'seat' ? '' : 'none';
    };

    const openSeatContextMenu = (event, seat) => {
        if (!contextMenu || !seat) return false;
        event.preventDefault();
        event.stopPropagation();
        contextSeat = seat;
        contextRowCol = null;
        contextMenuJustOpenedAt = Date.now();
        setContextMenuMode('seat');
        showCrosshair(parseInt(seat.dataset.row, 10), parseInt(seat.dataset.col, 10));

        contextMenu.style.left = '0px';
        contextMenu.style.top = '0px';
        contextMenu.style.display = 'flex';

        const gap = 8;
        const menuWidth = contextMenu.offsetWidth || 140;
        const menuHeight = contextMenu.offsetHeight || 160;
        const left = Math.min(event.clientX + gap, window.innerWidth - menuWidth - gap);
        const top = Math.min(event.clientY + gap, window.innerHeight - menuHeight - gap);

        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        document.dispatchEvent(new CustomEvent('fuckseats:layout-contextmenu', {
            detail: {
                mode: 'seat',
                row: parseInt(seat.dataset.row, 10),
                col: parseInt(seat.dataset.col, 10)
            }
        }));
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
        detail.handled = openSeatContextMenuFromTarget({
            clientX: x,
            clientY: y,
            preventDefault() { },
            stopPropagation() { },
        }, target);
    });

    document.querySelectorAll('.seat').forEach(seat => {
        seat.dataset.seatKey = seatKey(seat);
        seat.addEventListener('click', (e) => {
            if (consumeSuppressedTouchClick(e)) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                toggleSelection(seat);
            } else {
                clearSelection();
                addToSelection(seat);
            }
        });
    });

    if (contextMenu) {
        contextMenu.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (contextSeat) {
                    applyTool(contextSeat, btn.dataset.tool);
                }
                contextMenu.style.display = 'none';
                hideCrosshair();
            });
        });

        const rcOpUrl = root.dataset.rowColOpUrl;
        contextMenu.querySelectorAll('button[data-rc-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!rcOpUrl) return;
                const action = btn.dataset.rcAction;
                let row, col;
                if (contextSeat) {
                    row = parseInt(contextSeat.dataset.row, 10);
                    col = parseInt(contextSeat.dataset.col, 10);
                } else if (contextRowCol) {
                    row = contextRowCol.row;
                    col = contextRowCol.col;
                } else {
                    return;
                }
                const index = action.includes('row') ? row : col;
                contextMenu.style.display = 'none';
                hideCrosshair();
                fetch(rcOpUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrf,
                    },
                    body: JSON.stringify({ action, index })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        window.location.reload();
                    } else {
                        notify(data.message || '操作失败');
                    }
                })
                .catch(() => notify('请求出错，请重试'));
            });
        });
    }

    document.addEventListener('pointerdown', (event) => {
        if (!contextMenu || contextMenu.style.display === 'none') return;
        if (contextMenu.contains(event.target)) return;
        if (isSecondaryMouseButton(event) && Date.now() - contextMenuJustOpenedAt < 180) return;
        contextMenu.style.display = 'none';
        hideCrosshair();
    });

    const openEmptyContextMenu = (event) => {
        if (!contextMenu) return false;
        event.preventDefault();
        event.stopPropagation();
        contextSeat = null;
        const rc = findNearestRowCol(event.clientX, event.clientY);
        if (!rc) return false;
        contextRowCol = rc;
        contextMenuJustOpenedAt = Date.now();
        setContextMenuMode('empty');
        showCrosshair(rc.row, rc.col);

        contextMenu.style.left = '0px';
        contextMenu.style.top = '0px';
        contextMenu.style.display = 'flex';

        const gap = 8;
        const menuWidth = contextMenu.offsetWidth || 140;
        const menuHeight = contextMenu.offsetHeight || 160;
        const left = Math.min(event.clientX + gap, window.innerWidth - menuWidth - gap);
        const top = Math.min(event.clientY + gap, window.innerHeight - menuHeight - gap);
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        document.dispatchEvent(new CustomEvent('fuckseats:layout-contextmenu', {
            detail: {
                mode: 'empty',
                row: rc.row,
                col: rc.col
            }
        }));
        return true;
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

        const seatTarget = event.target.closest('.seat');
        const stageTarget = event.target.closest('.seat-stage') || event.target.closest('.seat-grid');
        if (!seatTarget && !stageTarget) return;

        clearTouchContextTimer();
        touchContextStart = {
            x: event.clientX,
            y: event.clientY,
            target: seatTarget || stageTarget,
            mode: seatTarget ? 'seat' : 'empty',
        };
        touchContextTimer = window.setTimeout(() => {
            const current = touchContextStart;
            clearTouchContextTimer();
            if (!current || !current.target || !current.target.isConnected) return;
            const eventLike = {
                clientX: current.x,
                clientY: current.y,
                preventDefault() { },
                stopPropagation() { },
            };
            const opened = current.mode === 'seat'
                ? openSeatContextMenuFromTarget(eventLike, current.target)
                : openEmptyContextMenu(eventLike);
            if (opened) {
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

    document.addEventListener('contextmenu', (event) => {
        if (!event.target || !event.target.closest) return;
        if (contextMenu && contextMenu.contains(event.target)) {
            event.preventDefault();
            return;
        }
        // Try seat first
        if (openSeatContextMenuFromTarget(event, event.target)) return;
        // Then try empty space in seat-stage
        if (event.target.closest('.seat-stage') || event.target.closest('.seat-grid')) {
            openEmptyContextMenu(event);
        }
    }, true);

    if (seatStage) {
        seatStage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.seat')) return;
            selecting = true;
            selectStart = { x: e.clientX, y: e.clientY };
            if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
                clearSelection();
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
        document.querySelectorAll('.seat').forEach(seat => {
            const rect = seat.getBoundingClientRect();
            const intersect = rect.left <= x2 && rect.right >= x1 && rect.top <= y2 && rect.bottom >= y1;
            if (intersect) {
                addToSelection(seat);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && contextMenu) {
            contextMenu.style.display = 'none';
            hideCrosshair();
        }
    });

    if (document.fullscreenEnabled) {
        document.documentElement.requestFullscreen().catch(() => { });
    }

    const shiftUrl = root.dataset.shiftUrl;
    const shiftLeftBtn = document.getElementById('shiftLeftBtn');
    const shiftRightBtn = document.getElementById('shiftRightBtn');
    const shiftStepsInput = document.getElementById('shiftStepsInput');

    const shiftLayout = (direction) => {
        if (!shiftUrl) return;
        const steps = parseInt(shiftStepsInput.value, 10);
        if (isNaN(steps) || steps <= 0) {
            notify('移动列数必须大于 0');
            return;
        }

        fetch(shiftUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
            },
            body: JSON.stringify({ direction: direction, steps: steps })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                notify('移动成功');
                setTimeout(() => window.location.reload(), 220);
            } else {
                notify(data.message || '移动失败');
            }
        })
        .catch(err => {
            notify('请求出错，请重试');
            console.error(err);
        });
    };

    if (shiftLeftBtn) shiftLeftBtn.addEventListener('click', () => shiftLayout('left'));
    if (shiftRightBtn) shiftRightBtn.addEventListener('click', () => shiftLayout('right'));
});
