(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const read = id => JSON.parse($(id).textContent);
    const el = (tag, text, attrs = {}) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
    };
    const error = message => { $('exam-error').hidden = false; $('exam-error').textContent = message; };
    async function post(url, body, button) {
        $('exam-error').hidden = true;
        if (button) button.disabled = true;
        try {
            const response = await fetch(url, {method: 'POST', headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content,
            }, body: JSON.stringify(body)});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '操作失败，请重试');
            return data;
        } catch (err) { error(err.message); return null; }
        finally { if (button) button.disabled = false; }
    }

    if ($('exam-setup')) {
        const form = $('exam-setup'), source = read('exam-source');
        const room = source.classroom || {}, seats = source.seats.filter(s =>
            (s.cell_type || 'seat') === 'seat' &&
            ('student_pk' in s ? s.student_pk != null : Boolean(s.student_name)));
        const total = seats.length;
        const lengths = [...seats.reduce((map, s) => map.set(s.col, (map.get(s.col) || 0) + 1), new Map()).values()]
            .sort((a, b) => b - a);
        const rowOffset = Math.max(0, ...source.seats.filter(s => s.cell_type === 'podium').map(s => s.row));
        const field = name => form.elements[name];
        const size = () => ({rows: Number(field('rows').value), cols: Number(field('cols').value)});
        const valid = ({rows, cols}) => Number.isInteger(rows) && Number.isInteger(cols) &&
            rows >= 1 && cols >= 1 && rows <= 128 && cols <= 128 && rows * cols <= 1600;
        // Same bound as the planner: every desk outside the kept column heads is carried once.
        const carried = (rows, cols) => Math.max(total, rows * cols) -
            lengths.slice(0, cols).reduce((sum, length) => sum + Math.min(rows, length), 0);
        const fits = (rows, cols) => 2 * cols - 1 <= room.cols && rows + rowOffset <= room.rows;
        function suggestions(count) {
            const options = [];
            for (let cols = 1; cols <= Math.min(128, count); cols++) {
                const rows = Math.ceil(count / cols);
                if (rows > 128 || rows * cols > 1600) continue;
                options.push({rows, cols, carry: carried(rows, cols), slack: rows * cols - count, fits: fits(rows, cols)});
            }
            return options.sort((a, b) => (b.fits - a.fits) || (a.carry - b.carry) || (a.slack - b.slack) ||
                (Math.abs(a.cols - lengths.length) - Math.abs(b.cols - lengths.length))).slice(0, 3);
        }
        function setSize(rows, cols) { field('rows').value = rows; field('cols').value = cols; update(); }
        function renderSuggestions() {
            const count = Number(field('examinees').value), box = $('exam-suggestions');
            box.replaceChildren();
            if (!Number.isInteger(count) || count < 1 || count > 1600) return;
            suggestions(count).forEach((option, index) => {
                const chip = el('button', undefined, {type: 'button', class: 'exam-chip'});
                chip.append(el('strong', `${option.cols} 组 × ${option.rows} 排`),
                    el('small', `${option.rows * option.cols} 座 · 单独搬运 ${option.carry} 张${option.fits ? '' : ' · 超出现有教室'}${index === 0 ? ' · 推荐' : ''}`));
                chip.addEventListener('click', () => setSize(option.rows, option.cols));
                box.append(chip);
            });
        }
        function miniMap(container, rows, cols, cells, podiums = []) {
            container.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
            const byCell = new Map(cells.map(cell => [`${cell.row},${cell.col}`, cell]));
            podiums.forEach(p => byCell.set(`${p.row},${p.col}`, {kind: 'podium', name: '讲台'}));
            const fragment = document.createDocumentFragment();
            for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) {
                const cell = byCell.get(`${r},${c}`);
                const span = el('span', cell ? [...(cell.name || '')].slice(-2).join('') : '', {class: cell ? `is-${cell.kind}` : 'is-gap'});
                if (cell && cell.kind !== 'podium') span.title = `${cell.name || '空桌'} · 第${c}列第${r}排`;
                fragment.append(span);
            }
            container.replaceChildren(fragment);
        }
        const podiums = source.seats.filter(s => s.cell_type === 'podium');
        const sourceCells = seats.map(s => ({row: s.row, col: s.col, kind: 'keep', name: s.student_name || ''}));
        const tile = (value, label, note) => {
            const node = el('div', undefined, {class: 'exam-metric'});
            node.append(el('strong', String(value)), el('span', label));
            if (note) node.append(el('small', note));
            return node;
        };
        let timer = null, controller = null;
        async function estimate() {
            const current = size();
            if (controller) controller.abort();
            controller = new AbortController();
            const signal = controller.signal;
            $('exam-estimate-status').textContent = '正在试算搬运方案…';
            try {
                const response = await fetch(form.dataset.estimate, {method: 'POST', signal, headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content,
                }, body: JSON.stringify({...current, snapshot_id: field('snapshot_id')?.value || null})});
                const data = await response.json();
                if (signal.aborted) return;
                if (!response.ok) throw new Error(data.error || '试算失败');
                const m = data.metrics, still = data.target.filter(cell => cell.kind === 'keep').length;
                $('exam-metrics').replaceChildren(
                    tile(m.carried, '张需单独搬运', m.carried <= m.minimum_carried ? '已是该行列下的最少' : `理论最少 ${m.minimum_carried}`),
                    tile(still, '张不用单独搬'), tile(m.exported, '张搬出'), tile(m.imported, '张搬入'),
                    tile(m.duration, '预计节拍', '示意单位，非秒数'));
                $('exam-estimate-status').textContent = '';
                miniMap($('exam-source-map'), room.rows, room.cols, data.source, podiums);
                const targetCols = 2 * data.cols - 1;
                miniMap($('exam-layout-preview'), data.rows, targetCols,
                    data.target.map(cell => ({...cell, col: 2 * cell.col - 1})));
                $('exam-estimate-steps').replaceChildren(...data.instructions.map(text => el('li', text)));
                $('exam-generate').disabled = false;
            } catch (err) {
                if (err.name === 'AbortError') return;
                $('exam-metrics').replaceChildren();
                $('exam-estimate-steps').replaceChildren();
                $('exam-estimate-status').textContent = err.message;
                $('exam-generate').disabled = true;
            }
        }
        function update() {
            const current = size(), count = current.rows * current.cols;
            clearTimeout(timer);
            if (!valid(current)) {
                $('exam-count').textContent = '行列须为 1～128，总数最多 1600 张。';
                $('exam-generate').disabled = true;
                return;
            }
            const examinees = Number(field('examinees').value);
            const lack = examinees > count ? `，比考生少 ${examinees - count} 座` : examinees ? `，空余 ${count - examinees} 座` : '';
            $('exam-count').textContent = `${current.cols} 组 × ${current.rows} 排 = ${count} 座${lack}。参与排列 ${total} 张桌子，空桌按走廊处理。`;
            miniMap($('exam-layout-preview'), current.rows, 2 * current.cols - 1,
                Array.from({length: count}, (_, i) => ({row: i % current.rows + 1, col: 2 * Math.floor(i / current.rows) + 1, kind: 'pending'})));
            timer = setTimeout(estimate, 300);
        }
        form.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
            const input = field(button.dataset.step);
            input.value = Math.max(1, Math.min(128, (Number(input.value) || 0) + Number(button.dataset.delta)));
            update();
        }));
        field('examinees').addEventListener('input', () => {
            renderSuggestions();
            const first = $('exam-suggestions').firstElementChild;
            if (first) first.click();
        });
        field('rows').addEventListener('input', update);
        field('cols').addEventListener('input', update);
        field('snapshot_id')?.addEventListener('change', update);
        miniMap($('exam-source-map'), room.rows, room.cols, sourceCells, podiums);
        setSize(lengths[0] || 8, Math.max(1, Math.min(lengths.length || 6, Math.floor((room.cols + 1) / 2))));
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const data = await post(form.dataset.url, {...size(), snapshot_id: field('snapshot_id')?.value || null}, event.submitter);
            if (data) location.assign(data.url);
        });
    }

    if (!$('exam-plan')) return;
    const plan = read('exam-plan'), studio = $('exam-stage'), stage = studio.dataset.stage;
    const svg = $('exam-board'), namespace = 'http://www.w3.org/2000/svg';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = value => Math.max(0, Math.min(1, value));
    const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
    const makeSVG = (tag, attrs = {}, text) => {
        const node = document.createElementNS(namespace, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const unit = plan.kind === 'restore' ? '列' : '组';
    const titleFor = desk => desk.source ? `${plan.kind === 'restore' && !desk.position ? '搬回原' : '原'}第${desk.source_col || desk.source.col}列第${desk.source.row}排 · ${desk.source.student_name || '空桌'}` : '搬入的桌子';
    const destinationFor = desk => desk.target ? `第${desk.target.display_col || desk.target.col}${unit}第${desk.target.row}排` : '搬出教室';
    const tasksByDesk = new Map(), nodes = new Map(), routes = new Map();
    const alignmentByDesk = new Map((plan.alignment || []).map(item => [item.desk_id, item]));
    // 考后恢复先整列靠拢回原列，再开始逐张搬运。
    const closingByDesk = new Map((plan.pre_alignment || []).map(item => [item.desk_id, item]));
    const closingEnd = closingByDesk.size ? 2 : 0;
    const duration = plan.metrics.duration;
    let numbers = plan.numbering, selected = null, time = stage === 'movement' ? 0 : duration;
    let playing = false, lastFrame = null, currentStatus = '';
    plan.tasks.forEach(task => {
        if (!tasksByDesk.has(task.desk_id)) tasksByDesk.set(task.desk_id, []);
        tasksByDesk.get(task.desk_id).push(task);
    });
    const kindOf = desk => desk.action === 'export' ? 'export' : desk.action === 'import' ? 'import'
        : tasksByDesk.has(desk.id) ? 'carry' : 'keep';

    // 棋盘：教室地面、讲台与门在底层，路线在中层，桌子在最上层。
    svg.setAttribute('viewBox', `-1.2 -1 ${plan.width + 2.4} ${plan.height + 2}`);
    svg.append(makeSVG('rect', {x: 0, y: 0, width: plan.width, height: plan.height, rx: .45, class: 'exam-room'}));
    svg.append(makeSVG('text', {x: plan.width / 2, y: .62, class: 'exam-front'}, '教室前方'));
    const columnLabels = makeSVG('g', {class: 'exam-column-labels'}); svg.append(columnLabels);
    let labelPhase = null;
    plan.obstacles.forEach(([x, y]) => svg.append(makeSVG('rect', {x: x - .46, y: y - .46, width: .92, height: .92, rx: .14, class: 'exam-podium'})));
    plan.doors.forEach(door => {
        let y = 2 + 2 * door.offset;
        if (door.corner.startsWith('back')) y = plan.height - y;
        const x = door.corner.endsWith('left') ? 0 : plan.width;
        svg.append(makeSVG('rect', {x: x - .11, y: y - .55, width: .22, height: 1.1, rx: .11, class: 'exam-door'}));
        svg.append(makeSVG('text', {x: x === 0 ? -.25 : x + .25, y: y + .1, 'text-anchor': x === 0 ? 'end' : 'start', class: 'exam-door-label'}, door.name));
    });
    const routeLayer = makeSVG('g', {class: 'exam-routes'}); svg.append(routeLayer);
    const deskLayer = makeSVG('g', {class: 'exam-desks'}); svg.append(deskLayer);
    plan.tasks.forEach(task => {
        const node = makeSVG('polyline', {class: `exam-route is-${task.action}`, visibility: 'hidden'});
        routes.set(task.index, node); routeLayer.append(node);
    });
    const order = [...plan.desks].sort((a, b) => ((a.position || a.target.position)[0] - (b.position || b.target.position)[0]) || ((a.position || a.target.position)[1] - (b.position || b.target.position)[1]));
    order.forEach((desk, index) => {
        const group = makeSVG('g', {class: `exam-desk is-${kindOf(desk)}`, tabindex: 0, role: 'button', 'aria-label': `${titleFor(desk)}，去向${destinationFor(desk)}`});
        const body = makeSVG('g', {class: 'exam-desk-body'});
        body.style.setProperty('--i', String(Math.min(index, 80)));
        body.append(makeSVG('rect', {x: -.42, y: -.38, width: .84, height: .84, rx: .16, class: 'exam-desk-shadow'}));
        body.append(makeSVG('rect', {x: -.42, y: -.42, width: .84, height: .84, rx: .16, class: 'exam-desk-face'}));
        body.append(makeSVG('text', {class: 'exam-desk-name'}));
        body.append(makeSVG('text', {class: 'exam-desk-number', y: -.07}));
        group.append(body);
        group.append(makeSVG('title', {}, `${titleFor(desk)} → ${destinationFor(desk)}`));
        group.addEventListener('click', () => selectDesk(desk));
        group.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectDesk(desk); } });
        deskLayer.append(group); nodes.set(desk.id, {group, body, name: body.querySelector('.exam-desk-name'), number: body.querySelector('.exam-desk-number')});
    });
    if (!reduced.matches) { svg.classList.add('is-entering'); setTimeout(() => svg.classList.remove('is-entering'), 1400); }

    const numberMap = () => new Map(numbers.map(n => [`${n.row},${n.col}`, n.number]));
    const lerp = (from, to, t) => from.map((value, index) => value + (to[index] - value) * t);
    function locate(desk) {
        // 返回某一时刻桌子的位置、透明度与“抬起”程度；抬起只在搬运途中出现，首尾平滑过渡。
        let position = desk.position, opacity = desk.position ? 1 : 0, lift = 0, task = null, progress = 0;
        const closing = closingByDesk.get(desk.id);
        if (closing && time < closingEnd) position = lerp(closing.from, closing.to, ease(time / closingEnd));
        for (const item of tasksByDesk.get(desk.id) || []) {
            if (time < item.start) break;
            if (time >= item.end) { position = item.path.at(-1); opacity = item.action === 'export' ? 0 : 1; continue; }
            task = item;
            progress = Math.min(item.path.length - 1, Math.max(0, time - item.start));
            const index = Math.floor(progress), fraction = progress - index;
            position = lerp(item.path[index], item.path[Math.min(index + 1, item.path.length - 1)], fraction);
            lift = Math.min(clamp((time - item.start) / .5), clamp((item.end - time) / .5));
            opacity = item.action === 'export' ? clamp((item.end - time) / 1.6) : item.action === 'import' ? clamp((time - item.start) / 1.6) : 1;
        }
        const alignment = alignmentByDesk.get(desk.id);
        if (alignment && time >= plan.alignment_start) position = lerp(alignment.from, alignment.to, ease((time - plan.alignment_start) / 2));
        return {position, opacity, lift, task, progress};
    }
    function draw() {
        const map = numberMap(), final = time >= duration;
        let active = 0;
        const phase = final ? 'target' : time < closingEnd ? 'closing' : 'source';
        if (phase !== labelPhase) {
            columnLabels.replaceChildren(); const columns = new Map();
            plan.desks.forEach(desk => {
                if (phase === 'target' && desk.target) columns.set(desk.target.position[0], `第${desk.target.display_col || desk.target.col}${unit}`);
                else if (phase !== 'target' && desk.position) columns.set(phase === 'closing' && closingByDesk.has(desk.id) ? closingByDesk.get(desk.id).from[0] : desk.position[0], `原第${desk.source_col || desk.source?.col}列`);
            });
            columns.forEach((label, x) => columnLabels.append(makeSVG('text', {x, y: 1.18, class: 'exam-column-label'}, label)));
            labelPhase = phase;
        }
        plan.desks.forEach(desk => {
            const state = locate(desk), node = nodes.get(desk.id);
            const visible = state.opacity > .01 && state.position;
            node.group.setAttribute('visibility', visible ? 'visible' : 'hidden');
            node.group.setAttribute('tabindex', visible ? '0' : '-1');
            if (state.position) node.group.setAttribute('transform', `translate(${state.position[0]} ${state.position[1]}) scale(${1 + .12 * state.lift})`);
            node.group.style.opacity = String(state.opacity * (selected && selected !== desk.id ? .28 : 1));
            node.group.classList.toggle('is-active', state.lift > .35);
            node.group.classList.toggle('is-selected', selected === desk.id);
            node.group.classList.toggle('is-start', stage === 'numbering' && desk.target && desk.target.row - 1 === start[0] && desk.target.col - 1 === start[1]);
            const value = desk.target ? map.get(`${desk.target.row},${desk.target.col}`) : null;
            const showNumber = final && value;
            node.group.classList.toggle('has-number', Boolean(showNumber));
            node.number.textContent = showNumber ? String(value).padStart(2, '0') : '';
            node.name.textContent = (desk.source?.student_name || (desk.source ? '空桌' : '新桌')).slice(0, 4);
            node.name.setAttribute('y', showNumber ? '.22' : '.02');
            if (state.task) active++;
        });
        plan.tasks.forEach(task => {
            const route = routes.get(task.index);
            const running = time >= task.start && time < task.end;
            const focus = selected ? task.desk_id === selected && time < task.end : running;
            if (stage !== 'movement' || !focus) { route.setAttribute('visibility', 'hidden'); return; }
            // 只画还没走完的那段路线，桌子走到哪，线就收到哪。
            const progress = Math.max(0, time - task.start), index = Math.floor(progress);
            const head = running ? lerp(task.path[Math.min(index, task.path.length - 1)], task.path[Math.min(index + 1, task.path.length - 1)], progress - index) : task.path[0];
            route.setAttribute('points', [head, ...task.path.slice(running ? index + 1 : 1)].map(p => p.join(',')).join(' '));
            route.setAttribute('visibility', 'visible');
        });
        if ($('exam-progress')) {
            $('exam-progress').value = time;
            $('exam-progress').style.setProperty('--fill', `${duration ? 100 * time / duration : 100}%`);
            $('exam-time').textContent = `${Math.floor(time)} / ${duration}`;
        }
        const status = final ? '最终布局' : time >= plan.alignment_start && alignmentByDesk.size ? '整列平移，拉开组间距'
            : time < closingEnd ? '整列靠拢，回到原列' : active ? `正在搬运 ${active} 张` : time ? '等待下一批' : '准备开始';
        if ($('exam-playing-status') && status !== currentStatus) { $('exam-playing-status').textContent = status; currentStatus = status; }
    }
    function selectDesk(desk) {
        selected = selected === desk.id ? null : desk.id;
        if (stage === 'numbering' && desk.target) {
            selected = null;
            start = [desk.target.row - 1, desk.target.col - 1];
            if ([0, plan.rows - 1].includes(start[0]) && [0, plan.cols - 1].includes(start[1])) {
                numberForm.elements.reverse_rows.checked = start[0] !== 0;
                numberForm.elements.reverse_cols.checked = start[1] !== 0;
            }
            previewNumbers();
            return;
        }
        document.querySelectorAll('#exam-tasks tr').forEach(row => row.classList.toggle('is-selected', row.dataset.desk === selected));
        if ($('exam-clear-selection')) $('exam-clear-selection').hidden = !selected;
        if (selected) document.querySelector(`#exam-tasks tr[data-desk="${selected}"]`)?.scrollIntoView({block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth'});
        draw();
    }
    function table() {
        const map = numberMap(), fragment = document.createDocumentFragment();
        plan.desks.forEach(desk => {
            const row = el('tr'); row.dataset.desk = desk.id; row.dataset.kind = kindOf(desk);
            const tasks = tasksByDesk.get(desk.id) || [];
            const sequence = tasks.map(task => {
                const action = {export: '搬出', import: '搬入', stage: '临时停放', move: '移至目标'}[task.action];
                const door = plan.doors.find(d => d.id === task.door_id);
                return `任务${task.index + 1} ${action}${door ? `（${door.name}）` : ''}，${task.start === 0 ? '可开始' : `第${task.start}节拍出发`}${task.after.length ? `，任务${task.after.map(i => i + 1).join('、')}完成后` : ''}`;
            }).join('；') || (alignmentByDesk.has(desk.id) ? '随原列整体平移' : closingByDesk.has(desk.id) ? '随本组整体靠拢回原列' : '原位保留');
            const value = desk.target && map.get(`${desk.target.row},${desk.target.col}`);
            [titleFor(desk), destinationFor(desk), value ? String(value).padStart(2, '0') : '—', sequence].forEach(text => row.append(el('td', text)));
            row.addEventListener('click', () => selectDesk(desk)); fragment.append(row);
        });
        $('exam-tasks').replaceChildren(fragment);
        if ($('exam-labels')) {
            $('exam-labels').replaceChildren(...[...numbers].sort((a, b) => a.number - b.number).map(n => {
                const label = el('div', undefined, {class: 'exam-label'});
                label.append(el('strong', String(n.number).padStart(2, '0')), el('small', `第${n.col}组 第${n.row}排`));
                return label;
            }));
        }
    }
    $('exam-clear-selection').addEventListener('click', () => { selected = null; $('exam-clear-selection').hidden = true; document.querySelectorAll('#exam-tasks tr.is-selected').forEach(row => row.classList.remove('is-selected')); draw(); });
    $('exam-search').addEventListener('input', event => {
        const query = event.target.value.trim().toLowerCase();
        document.querySelectorAll('#exam-tasks tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
    });
    function setPlaying(value) {
        playing = value;
        const button = $('exam-play');
        if (!button) return;
        button.classList.toggle('is-playing', value);
        button.setAttribute('aria-label', value ? '暂停' : '播放');
        button.title = value ? '暂停（空格）' : '播放（空格）';
    }
    function seek(value) { setPlaying(false); time = Math.max(0, Math.min(duration, value)); draw(); }
    function frame(now) {
        if (!playing) return;
        if (lastFrame !== null) time = Math.min(duration, time + Math.min((now - lastFrame) / 1000, .1) * 5 * Number($('exam-speed').value));
        lastFrame = now; draw();
        if (time >= duration) setPlaying(false); else requestAnimationFrame(frame);
    }
    if (stage === 'movement') {
        $('exam-play').addEventListener('click', () => {
            if (playing) { setPlaying(false); return; }
            if (reduced.matches) { seek(duration); return; }
            if (time >= duration) time = 0;
            setPlaying(true); lastFrame = null; requestAnimationFrame(frame);
        });
        $('exam-finish').addEventListener('click', () => seek(duration));
        $('exam-progress').addEventListener('input', event => seek(Number(event.target.value)));
        const stops = [...new Set([0, ...(closingEnd ? [closingEnd] : []), ...plan.tasks.flatMap(t => [t.start, t.end]), duration])].sort((a, b) => a - b);
        $('exam-previous').addEventListener('click', () => seek([...stops].reverse().find(t => t < time - .01) ?? 0));
        $('exam-next').addEventListener('click', () => seek(stops.find(t => t > time + .01) ?? duration));
        document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
        document.addEventListener('keydown', event => {
            if (event.target.closest('input,select,textarea,button,summary,[role=button]') || event.metaKey || event.ctrlKey || event.altKey) return;
            const action = {' ': 'exam-play', ArrowLeft: 'exam-previous', ArrowRight: 'exam-next', End: 'exam-finish'}[event.key];
            if (!action) return;
            event.preventDefault(); $(action).click();
        });
    }
    const numberForm = $('exam-numbering'); let start = plan.numbering_options?.start || [0, 0];
    function previewNumbers() {
        const options = Object.fromEntries(new FormData(numberForm));
        const rr = Array.from({length: plan.rows}, (_, i) => i), cc = Array.from({length: plan.cols}, (_, i) => i);
        if (options.reverse_rows) rr.reverse(); if (options.reverse_cols) cc.reverse();
        const column = options.mode === 'column' || (options.mode === 'snake' && options.snake_axis === 'column');
        let sequence = [];
        (column ? cc : rr).forEach((outer, i) => {
            let inner = column ? rr : cc; if (options.mode === 'snake' && i % 2) inner = [...inner].reverse();
            inner.forEach(value => sequence.push(column ? [value, outer] : [outer, value]));
        });
        const pivot = sequence.findIndex(([r, c]) => r === start[0] && c === start[1]);
        sequence = [...sequence.slice(pivot), ...sequence.slice(0, pivot)];
        numbers = sequence.map(([r, c], i) => ({row: r + 1, col: c + 1, number: i + 1}));
        $('exam-start-label').textContent = `01 号：第${start[1] + 1}组第${start[0] + 1}排。${pivot > 0 ? '从这张桌子开始，排到最后一张后接回第一张。' : '点击任意桌子可设为 01 号。'}`;
        $('exam-snake-label').hidden = options.mode !== 'snake';
        table(); draw();
        // 桌号按新顺序依次弹出，看得出编号是怎么走的。
        if (!reduced.matches) {
            svg.classList.remove('is-renumbering'); void svg.getBoundingClientRect(); svg.classList.add('is-renumbering');
            plan.desks.forEach(desk => {
                const value = desk.target && numberMap().get(`${desk.target.row},${desk.target.col}`);
                if (value) nodes.get(desk.id).body.style.setProperty('--n', String(Math.min(value, 60)));
            });
        }
    }
    if (numberForm) {
        Object.entries(plan.numbering_options || {}).forEach(([key, value]) => {
            const field = numberForm.elements[key]; if (!field) return;
            if (field.type === 'checkbox') field.checked = value; else field.value = value;
        });
        numberForm.addEventListener('input', event => {
            // 起点在四角时，方向改变后 01 号跟着移到新方向的起始角，而不是把序列从中间截断。
            const corner = [0, plan.rows - 1].includes(start[0]) && [0, plan.cols - 1].includes(start[1]);
            if (corner && ['reverse_rows', 'reverse_cols'].includes(event.target.name)) {
                start = [numberForm.elements.reverse_rows.checked ? plan.rows - 1 : 0, numberForm.elements.reverse_cols.checked ? plan.cols - 1 : 0];
            }
            previewNumbers();
        });
        numberForm.addEventListener('submit', async event => {
            event.preventDefault();
            const options = Object.fromEntries(new FormData(numberForm));
            const data = await post(numberForm.dataset.url, {mode: options.mode, snake_axis: options.snake_axis,
                reverse_rows: Boolean(options.reverse_rows), reverse_cols: Boolean(options.reverse_cols), start, revision: plan.revision}, event.submitter);
            if (data) location.assign(data.url);
        });
    }
    for (const id of ['exam-apply', 'exam-restore']) {
        $(id)?.addEventListener('click', async event => {
            const data = await post(event.currentTarget.dataset.url, {revision: plan.revision}, event.currentTarget);
            if (data) location.assign(data.url);
        });
    }
    if (stage === 'print') {
        const printKind = () => {
            const kind = document.querySelector('input[name="exam-print-kind"]:checked').value;
            document.body.dataset.examPrint = kind;
            $('exam-map').hidden = kind !== 'map'; $('exam-list').hidden = kind !== 'list'; $('exam-labels').hidden = kind !== 'labels';
            $('exam-list').open = true;
        };
        document.querySelectorAll('input[name="exam-print-kind"]').forEach(input => input.addEventListener('change', printKind)); printKind();
        $('exam-print').addEventListener('click', () => window.print());
    }
    // 工作区占满窗口剩余高度，棋盘一屏看全。
    function fit() {
        if (matchMedia('(max-width: 900px)').matches) { studio.style.height = ''; return; }
        studio.style.height = `${Math.max(460, innerHeight - studio.getBoundingClientRect().top - scrollY - 20)}px`;
    }
    fit(); addEventListener('resize', fit);
    if (numberForm) previewNumbers(); else { table(); draw(); }
})();
