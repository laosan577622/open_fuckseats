document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('classroom-root');
    const grid = document.getElementById('seat-grid-container');
    const data = document.getElementById('classroom-door-data');
    if (!root || !grid || !data) return;

    const rows = [...grid.querySelectorAll(':scope > .seat-row')];
    if (!rows.length) return;
    let doors = JSON.parse(data.textContent);
    let busy = false;
    const status = document.getElementById('classroom-door-status');

    const doorIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 20V4l13-2v20L5 20Z"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
    const plusIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const corners = [
        {corner: 'front_left', side: 'left', row: rows[0], label: '左前角'},
        {corner: 'front_right', side: 'right', row: rows[0], label: '右前角'},
        {corner: 'back_left', side: 'left', row: rows[rows.length - 1], label: '左后角'},
        {corner: 'back_right', side: 'right', row: rows[rows.length - 1], label: '右后角'},
    ];
    const button = (className, label, icon) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = className;
        item.setAttribute('aria-label', label);
        item.title = label;
        item.innerHTML = icon;
        return item;
    };
    const save = async next => {
        if (busy) return;
        busy = true;
        status.textContent = '正在保存';
        grid.querySelectorAll('.classroom-door-position button').forEach(item => { item.disabled = true; });
        try {
            const response = await fetch(root.dataset.doorUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': root.dataset.csrf},
                body: JSON.stringify({previous: doors, doors: next}),
            });
            const result = await response.json();
            if (!response.ok) {
                if (response.status === 409 && typeof window.refreshState === 'function') await window.refreshState();
                throw new Error(result.error || '门设置保存失败');
            }
            doors = result.doors;
            status.textContent = '已保存';
            if (typeof window.refreshState === 'function') window.refreshState();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            busy = false;
            render();
        }
    };
    const render = () => {
        grid.querySelectorAll('.classroom-door-position').forEach(item => item.remove());
        for (const {corner, side, row, label} of corners) {
            const here = doors.filter(door => door.corner === corner);
                const position = document.createElement('div');
                position.className = 'classroom-door-position';
                position.dataset.side = side;
                position.style.top = `${row.offsetTop + row.offsetHeight / 2}px`;
                if (here.length) {
                    const last = here[here.length - 1];
                    const remove = button('classroom-door-existing', `删除${label}的${last.name}`, doorIcon);
                    if (here.length > 1) {
                        const count = document.createElement('span');
                        count.className = 'classroom-door-count';
                        count.textContent = String(here.length);
                        remove.append(count);
                    }
                    remove.addEventListener('click', event => {
                        event.stopPropagation();
                        save(doors.filter(door => door.id !== last.id));
                    });
                    position.append(remove);
                }
                const add = button(here.length ? 'classroom-door-add' : 'classroom-door-empty',
                    `在${label}${here.length ? '再' : ''}添加门`, here.length ? plusIcon : doorIcon);
                add.addEventListener('click', event => {
                    event.stopPropagation();
                    save([...doors, {id: crypto.randomUUID(), name: `门 ${doors.length + 1}`,
                        corner, offset: 0}]);
                });
                position.append(add);
                grid.append(position);
        }
    };
    root.addEventListener('classroom-state-updated', event => {
        if (!Array.isArray(event.detail?.doors)) return;
        doors = event.detail.doors;
        if (!busy) render();
    });
    render();
});
