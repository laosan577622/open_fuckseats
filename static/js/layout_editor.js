document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('layout-root');
    if (!root) return;

    const cellUrl = root.dataset.cellUrl;
    const csrf = root.dataset.csrf;
    const contextMenu = document.getElementById('contextMenu');
    let activeTool = 'seat';
    let contextSeat = null;

    const selectedSeats = new Set();
    let selecting = false;
    let selectStart = null;

    const seatStage = document.querySelector('.seat-stage');
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.display = 'none';
    document.body.appendChild(selectionBox);

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
        }).catch(() => alert('操作失败'));
    };

    const applyTool = (seat, tool) => {
        if (!seat || !tool) return;
        postJson({
            row: seat.dataset.row,
            col: seat.dataset.col,
            cell_type: tool
        }).then(data => {
            if (data && data.status && data.status !== 'success') {
                alert(data.message || '操作失败');
                return;
            }
            window.location.reload();
        }).catch(() => alert('操作失败'));
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
                alert('请先选择座位');
                return;
            }
            applyToolToSeats(activeTool, seats);
        });
    }

    if (clearSelectedBtn) {
        clearSelectedBtn.addEventListener('click', clearSelection);
    }

    document.querySelectorAll('.seat').forEach(seat => {
        seat.dataset.seatKey = seatKey(seat);
        seat.addEventListener('click', (e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                toggleSelection(seat);
            } else {
                clearSelection();
                addToSelection(seat);
            }
        });
        seat.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            contextSeat = seat;
            if (!contextMenu) return;
            contextMenu.style.display = 'flex';
            const menuWidth = 140;
            const menuHeight = 160;
            const left = Math.min(e.pageX, window.innerWidth - menuWidth - 20);
            const top = Math.min(e.pageY, window.innerHeight - menuHeight - 20);
            contextMenu.style.left = `${left}px`;
            contextMenu.style.top = `${top}px`;
        });
    });

    if (contextMenu) {
        contextMenu.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (contextSeat) {
                    applyTool(contextSeat, btn.dataset.tool);
                }
                contextMenu.style.display = 'none';
            });
        });
    }

    document.addEventListener('click', () => {
        if (contextMenu) contextMenu.style.display = 'none';
    });

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
        }
    });

    if (document.fullscreenEnabled) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
});
