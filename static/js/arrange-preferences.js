document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('arrange-preferences-form');
    const modal = document.getElementById('arrange-preferences-modal');
    const trigger = document.getElementById('btn-arrange-preferences');
    if (!form || !modal || !trigger) return;

    const defaults = { gender: 'none', score: 'none', avoid_previous: false };
    const gender = document.getElementById('arrangePreferenceGender');
    const score = document.getElementById('arrangePreferenceScore');
    const avoidPrevious = document.getElementById('arrangePreferenceAvoidPrevious');
    const indicator = document.getElementById('arrange-preferences-indicator');
    const error = document.getElementById('arrangePreferencesError');
    const save = document.getElementById('arrangePreferencesSave');
    const menu = document.getElementById('arrange-method-menu');
    const menuTrigger = document.querySelector('.arrange-method-trigger');
    let saved = { ...defaults };
    let saving = false;
    let opened = false;
    try {
        saved = { ...defaults, ...JSON.parse(document.getElementById('arrange-preferences-data').textContent) };
    } catch (_) { /* 旧数据缺失时使用默认值。 */ }

    function fill(value) {
        gender.value = value.gender;
        score.value = value.score;
        avoidPrevious.checked = value.avoid_previous;
        error.hidden = true;
    }

    function updateIndicator() {
        const active = saved.gender !== 'none' || saved.score !== 'none' || saved.avoid_previous;
        indicator.hidden = !active;
        trigger.setAttribute('aria-label', active ? '偏好选项，已设置' : '偏好选项');
    }

    function close() {
        if (saving) return;
        opened = false;
        window.closeModal(modal.id);
        menuTrigger?.focus();
    }

    trigger.addEventListener('click', () => {
        menu.hidden = true;
        menuTrigger?.setAttribute('aria-expanded', 'false');
        fill(saved);
        opened = true;
        window.openModal(modal.id);
        gender.focus();
    });
    document.getElementById('arrangePreferencesCancel').addEventListener('click', close);
    document.getElementById('arrangePreferencesReset').addEventListener('click', () => fill(defaults));
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    document.addEventListener('keydown', (event) => {
        if (!opened) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
        } else if (event.key === 'Tab') {
            const controls = Array.from(form.querySelectorAll('select, input, button'))
                .filter((control) => control.type !== 'hidden' && !control.disabled);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first) {
                event.preventDefault();
            } else if (event.shiftKey && (document.activeElement === first || !form.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !form.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        }
    }, true);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saving) return;
        const preferences = { gender: gender.value, score: score.value, avoid_previous: avoidPrevious.checked };
        saving = true;
        error.hidden = true;
        form.querySelectorAll('button, select, input[type="checkbox"]').forEach((control) => { control.disabled = true; });
        save.textContent = '保存中...';
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': form.elements.csrfmiddlewaretoken.value,
                },
                body: JSON.stringify(preferences),
            });
            const data = await response.json();
            if (!response.ok || data.status !== 'success') throw new Error(data.message || '保存失败，请重试');
            saved = data.preferences;
            updateIndicator();
            saving = false;
            close();
            window.showToast?.('偏好已保存，下次自动排座时生效');
        } catch (failure) {
            error.textContent = failure.message || '保存失败，请重试';
            error.hidden = false;
        } finally {
            saving = false;
            form.querySelectorAll('button, select, input[type="checkbox"]').forEach((control) => { control.disabled = false; });
            save.textContent = '保存偏好';
        }
    });
    updateIndicator();
});
