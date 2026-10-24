(() => {
    const root = document.getElementById('sdes-import-root');
    if (!root) return;
    const form = document.getElementById('sdes-upload-form');
    const fileInput = document.getElementById('sdes-file');
    const upload = document.getElementById('sdes-upload');
    const nativePick = document.getElementById('sdes-native-pick');
    const classSelect = document.getElementById('sdes-class');
    const chartSelect = document.getElementById('sdes-chart');
    const apply = document.getElementById('sdes-apply');
    const status = document.getElementById('sdes-status');
    const csrf = form.querySelector('[name="csrfmiddlewaretoken"]').value;
    let staged = null;
    let busy = false;
    let revision = 0;
    const setBusy = (value) => {
        busy = value;
        upload.disabled = nativePick.disabled = classSelect.disabled = chartSelect.disabled = value;
        apply.disabled = value || !staged?.preview_hash;
    };
    const post = async (data) => {
        const response = await fetch(root.dataset.url, {
            method: 'POST', headers: { 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' }, body: data,
        });
        const payload = await response.json();
        if (!response.ok || payload.status === 'error') throw new Error(payload.message || '导入失败');
        return payload;
    };
    const chartOptions = (index) => {
        chartSelect.replaceChildren();
        const selected = staged.classes.find((item) => item.index === Number(index));
        for (const chart of selected?.charts || []) {
            const option = new Option(chart.name, chart.index);
            chartSelect.add(option);
        }
    };
    const render = (payload, replaceCatalog = false) => {
        staged = payload;
        document.getElementById('sdes-selection').hidden = false;
        if (replaceCatalog) {
            classSelect.replaceChildren();
            for (const item of payload.classes) {
                const option = new Option(item.name + (item.charts.length ? '' : '（无座位表）'), item.index);
                option.disabled = !item.charts.length;
                classSelect.add(option);
            }
        }
        classSelect.value = payload.class_index;
        chartOptions(payload.class_index);
        chartSelect.value = payload.chart_index;
        document.getElementById('sdes-summary').textContent = `${payload.rows} 行 × ${payload.cols} 列 · 学生 ${payload.students} 人 · 已安排 ${payload.assigned} 人 · ${payload.groups} 个小组 · ${payload.tags} 个标签`;
        const warnings = document.getElementById('sdes-warnings');
        warnings.replaceChildren();
        for (const message of payload.warnings) {
            const item = document.createElement('li');
            item.textContent = message;
            warnings.append(item);
        }
        warnings.hidden = !payload.warnings.length;
        const guards = document.getElementById('sdes-guards');
        guards.textContent = [payload.left_guardian && `左护法：${payload.left_guardian}`, payload.right_guardian && `右护法：${payload.right_guardian}`].filter(Boolean).join(' · ');
        guards.hidden = !guards.textContent;
        const table = document.createElement('table');
        table.className = 'preview-table seat-layout-preview-table';
        const body = table.createTBody();
        payload.preview.forEach((row, index) => {
            const tr = body.insertRow();
            const th = document.createElement('th');
            th.textContent = `第 ${index + 1} 排`;
            tr.append(th);
            for (const cell of row) {
                const td = tr.insertCell();
                td.className = `seat-layout-cell type-${cell.cell_type}`;
                td.textContent = cell.label;
            }
        });
        document.getElementById('sdes-preview').replaceChildren(table);
        status.textContent = `已识别 ${payload.filename}`;
        document.getElementById('sdes-filename').textContent = payload.filename;
    };
    const selectionData = (action) => {
        const data = new FormData();
        data.set('action', action);
        data.set('token', staged.token);
        data.set('class_index', classSelect.value);
        data.set('chart_index', chartSelect.value);
        data.set('preview_hash', staged.preview_hash);
        return data;
    };
    const invalidate = () => {
        staged = null;
        document.getElementById('sdes-selection').hidden = true;
        document.getElementById('sdes-preview').replaceChildren();
        document.getElementById('sdes-summary').textContent = '等待识别文件。';
        document.getElementById('sdes-warnings').hidden = true;
        document.getElementById('sdes-guards').hidden = true;
        document.getElementById('sdes-filename').textContent = '尚未选择文件';
    };
    const updatePreview = async () => {
        const current = ++revision;
        setBusy(true);
        try {
            const payload = await post(selectionData('preview'));
            if (current === revision) render(payload);
        } catch (error) {
            status.textContent = error.message || '预览失败';
            staged.preview_hash = '';
        } finally {
            if (current === revision) setBusy(false);
            if (!staged?.preview_hash) apply.disabled = true;
        }
    };
    classSelect.addEventListener('change', () => { chartOptions(classSelect.value); updatePreview(); });
    chartSelect.addEventListener('change', updatePreview);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!fileInput.files.length) { status.textContent = '请先选择 SDES 文件'; return; }
        invalidate();
        setBusy(true);
        try { render(await post(new FormData(form)), true); }
        catch (error) { status.textContent = error.message || '文件识别失败'; }
        finally { setBusy(false); }
    });
    fileInput.addEventListener('change', () => {
        document.getElementById('sdes-file-name').textContent = fileInput.files[0]?.name || '未选择文件';
        if (fileInput.hidden && fileInput.files.length) form.requestSubmit();
    });
    nativePick.addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await window.FuckSeatsDesktop.uploadLocalFile(root.dataset.url, {
                csrf, fieldName: 'sdes_file', acceptExtensions: ['.sdes', '.json'], fallbackFilename: 'import.sdes.json',
            });
            if (!result) { setBusy(false); fileInput.click(); }
            else if (result.status !== 'cancelled') render(result.response || result, true);
        } catch (error) { invalidate(); status.textContent = error.message || '文件识别失败'; }
        finally { setBusy(false); }
    });
    const enableNativePicker = () => {
        const native = document.body.dataset.appShell === 'webview' && !!window.pywebview?.api?.upload_local_file;
        nativePick.hidden = !native;
        fileInput.hidden = upload.hidden = native;
        document.getElementById('sdes-file-control').hidden = native;
        document.getElementById('sdes-filename').hidden = !native;
    };
    window.addEventListener('pywebviewready', enableNativePicker);
    window.addEventListener('DOMContentLoaded', enableNativePicker);
    apply.addEventListener('click', async () => {
        if (busy || !staged?.preview_hash) return;
        setBusy(true);
        try {
            const payload = await post(selectionData('apply'));
            window.location.href = payload.next_url;
        } catch (error) { status.textContent = error.message || '导入失败'; setBusy(false); }
    });
    try {
        const initial = JSON.parse(document.getElementById('sdes-initial').textContent);
        if (initial) { render(initial, true); setBusy(false); }
    } catch (error) { status.textContent = '预览已失效，请重新识别文件'; }
})();
