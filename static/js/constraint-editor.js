(() => {
    const form = document.getElementById('constraintEditorForm');
    if (!form) return;

    const students = JSON.parse(document.getElementById('constraint-editor-students').textContent || '[]');
    const types = JSON.parse(document.getElementById('constraint-editor-types').textContent || '[]');
    const typeMap = new Map(types.map(item => [item.value, item]));
    const typeSelect = document.getElementById('constraintTypeSelect');
    const error = document.getElementById('constraintEditorError');
    const submit = document.getElementById('constraintEditorSubmit');
    const pickers = [...form.querySelectorAll('.constraint-student-picker')];

    const selectedName = picker => {
        const id = picker.querySelector('input[type="hidden"]').value;
        return students.find(student => String(student.id) === id)?.name || '尚未选择';
    };

    const updateSummary = () => {
        const type = typeMap.get(typeSelect.value) || {};
        document.getElementById('constraintRuleTitle').textContent = type.label || '';
        document.getElementById('constraintRuleDescription').textContent = type.description || '';
        document.getElementById('constraintRuleStudent').textContent = selectedName(pickers[0]);
        document.getElementById('constraintRuleTarget').textContent = selectedName(pickers[1]);
        document.getElementById('constraintRuleTargetWrap').hidden = !type.needs_target;
    };

    const setFieldVisible = (name, visible) => {
        const field = form.querySelector(`[data-field="${name}"]`);
        if (!field) return;
        field.hidden = !visible;
        field.querySelectorAll('input').forEach(input => {
            input.disabled = !visible;
            if (input.type === 'number') input.required = visible;
        });
    };

    const syncFields = () => {
        const type = typeMap.get(typeSelect.value) || {};
        setFieldVisible('target_student_id', !!type.needs_target);
        setFieldVisible('row', !!type.needs_row);
        setFieldVisible('col', !!type.needs_col);
        setFieldVisible('distance', !!type.needs_distance);
        updateSummary();
    };

    const closePicker = picker => {
        picker.querySelector('.constraint-student-results').hidden = true;
        picker.querySelector('input[type="search"]').setAttribute('aria-expanded', 'false');
    };

    pickers.forEach(picker => {
        const search = picker.querySelector('input[type="search"]');
        const idInput = picker.querySelector('input[type="hidden"]');
        const results = picker.querySelector('.constraint-student-results');
        const initial = students.find(student => String(student.id) === picker.dataset.selectedId);
        if (initial) search.value = initial.student_id ? `${initial.name} · ${initial.student_id}` : initial.name;
        let matches = [];
        let active = -1;

        const choose = student => {
            idInput.value = String(student.id);
            search.value = student.student_id ? `${student.name} · ${student.student_id}` : student.name;
            closePicker(picker);
            updateSummary();
        };

        const render = () => {
            const keyword = search.value.trim().toLocaleLowerCase();
            const otherId = picker.dataset.picker === 'target' ? pickers[0].querySelector('input[type="hidden"]').value : '';
            matches = students.filter(student => String(student.id) !== otherId && (`${student.name} ${student.student_id || ''}`).toLocaleLowerCase().includes(keyword)).slice(0, 10);
            active = -1;
            results.replaceChildren();
            if (!matches.length) {
                const hint = document.createElement('p');
                hint.textContent = students.length ? '没有找到学生' : '班级暂无学生';
                results.append(hint);
            } else {
                matches.forEach((student, index) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.setAttribute('role', 'option');
                    button.textContent = student.name;
                    if (student.student_id) {
                        const number = document.createElement('small');
                        number.textContent = student.student_id;
                        button.append(number);
                    }
                    button.addEventListener('pointerdown', event => event.preventDefault());
                    button.addEventListener('click', () => choose(matches[index]));
                    results.append(button);
                });
            }
            results.hidden = false;
            search.setAttribute('aria-expanded', 'true');
        };

        search.addEventListener('focus', render);
        search.addEventListener('input', () => { idInput.value = ''; render(); updateSummary(); });
        search.addEventListener('keydown', event => {
            if (event.key === 'Escape') { closePicker(picker); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (results.hidden) render();
                if (!matches.length) return;
                active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
                results.querySelectorAll('button').forEach((button, index) => button.classList.toggle('is-active', index === active));
            }
            if (event.key === 'Enter' && !results.hidden && matches.length) {
                event.preventDefault();
                choose(matches[active < 0 ? 0 : active]);
            }
        });
        search.addEventListener('blur', () => window.setTimeout(() => closePicker(picker), 120));
    });

    document.addEventListener('pointerdown', event => {
        pickers.forEach(picker => { if (!picker.contains(event.target)) closePicker(picker); });
    });
    typeSelect.addEventListener('change', syncFields);
    syncFields();

    form.addEventListener('submit', async event => {
        event.preventDefault();
        error.hidden = true;
        if (!form.reportValidity()) return;
        const type = typeMap.get(typeSelect.value) || {};
        if (!pickers[0].querySelector('input[type="hidden"]').value || (type.needs_target && !pickers[1].querySelector('input[type="hidden"]').value)) {
            error.textContent = '请从搜索结果中选择学生';
            error.hidden = false;
            return;
        }
        submit.disabled = true;
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': form.querySelector('[name="csrfmiddlewaretoken"]').value },
                body: new FormData(form),
            });
            const result = await response.json();
            if (!response.ok || result.status !== 'success') throw new Error(result.message || '保存失败');
            window.location.assign(form.dataset.returnUrl);
        } catch (cause) {
            error.textContent = cause.message || '保存失败';
            error.hidden = false;
            submit.disabled = false;
        }
    });
})();
