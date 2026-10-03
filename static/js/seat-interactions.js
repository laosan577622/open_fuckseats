/* Shared seat interactions; persistence is supplied by the caller. */
window.SeatInteractions = (() => {
    function bindDrop(seat, drop, preview = () => {}) {
        seat.addEventListener('dragover', event => {
            if (seat.dataset.cellType !== 'seat') return;
            event.preventDefault(); preview(event);
        });
        seat.addEventListener('drop', event => {
            if (seat.dataset.cellType !== 'seat') return;
            event.preventDefault(); drop(event);
        });
    }
    function movePayload(seat, studentId) {
        if (!studentId || seat.dataset.cellType !== 'seat' || String(studentId) === seat.dataset.studentId) return null;
        return { student_id: studentId, row: Number(seat.dataset.row), col: Number(seat.dataset.col) };
    }
    function cellPayload(seat, tool) {
        if (!seat || !['seat', 'aisle', 'podium', 'empty'].includes(tool)) return null;
        return { row: Number(seat.dataset.row), col: Number(seat.dataset.col), cell_type: tool };
    }
    function quickSwap(seat, { search, swap, choose, notify = () => {} }) {
        seat.querySelector('.quick-swap-input')?.remove();
        const input = document.createElement('input');
        input.className = 'quick-swap-input';
        input.placeholder = '输入姓名、首字母或学号';
        input.setAttribute('aria-label', input.placeholder);
        input.autocomplete = 'off'; seat.append(input); input.focus();
        let busy = false;
        input.addEventListener('blur', () => setTimeout(() => input.remove(), 200));
        input.addEventListener('keydown', async event => {
            if (event.key === 'Escape') { input.remove(); seat.focus(); return; }
            if (event.key !== 'Enter' || event.isComposing || busy) return;
            event.preventDefault(); event.stopPropagation();
            const query = input.value.trim(); if (!query) return;
            busy = true;
            try {
                const matches = await search(query);
                const exact = matches.find(item => String(item.student_id || '').trim().toLowerCase() === query.toLowerCase());
                if (!matches.length) {
                    input.setAttribute('aria-invalid', 'true'); notify('没有找到这位学生，请检查姓名、首字母或学号。');
                } else if (exact || matches.length === 1) {
                    await swap(seat, (exact || matches[0]).id); input.remove();
                } else { input.remove(); choose(seat, matches); }
            } catch (error) { notify(error.message || '换位失败，请重试'); }
            finally { busy = false; }
        });
        return input;
    }
    return { bindDrop, movePayload, cellPayload, quickSwap };
})();
