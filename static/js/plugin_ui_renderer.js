(function () {
    const root = document.getElementById('plugin-ui-root');
    if (!root) {
        return;
    }

    const refreshBtn = document.getElementById('plugin-ui-refresh-btn');
    const feedback = document.getElementById('plugin-ui-feedback');
    const pluginId = root.dataset.pluginId || '';
    const uiName = root.dataset.uiName || '';
    const endpoint = root.dataset.uiEndpoint || '';

    if (!pluginId || !uiName || !endpoint) {
        root.innerHTML = '<div class="plugin-ui-error">缺少插件 UI 上下文，无法渲染。</div>';
        return;
    }

    function getCsrfToken() {
        const cookie = document.cookie || '';
        const rows = cookie.split(';');
        for (let i = 0; i < rows.length; i += 1) {
            const item = rows[i].trim();
            if (item.startsWith('csrftoken=')) {
                return decodeURIComponent(item.substring('csrftoken='.length));
            }
        }
        return '';
    }

    function showFeedback(message, isError) {
        if (!feedback) {
            return;
        }
        feedback.hidden = false;
        feedback.textContent = message || '';
        if (isError) {
            feedback.classList.add('error');
        } else {
            feedback.classList.remove('error');
        }
    }

    function hideFeedback() {
        if (!feedback) {
            return;
        }
        feedback.hidden = true;
        feedback.textContent = '';
        feedback.classList.remove('error');
    }

    function getClassroomIdFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const classroomId = params.get('classroom_id');
        if (!classroomId) {
            return null;
        }
        return classroomId;
    }

    function parseJsonSafely(text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    function toPrettyJson(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return String(value);
        }
    }

    function buildUiUrl() {
        const search = window.location.search || '';
        return search ? `${endpoint}${search}` : endpoint;
    }

    async function loadUi() {
        hideFeedback();
        root.innerHTML = '<div class="plugin-ui-loading">正在生成界面...</div>';

        let response;
        try {
            response = await fetch(buildUiUrl(), {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
        } catch (error) {
            root.innerHTML = `<div class="plugin-ui-error">请求失败：${error}</div>`;
            return;
        }

        const text = await response.text();
        const payload = parseJsonSafely(text);
        if (!response.ok || !payload || payload.status !== 'success') {
            const message = payload && payload.message ? payload.message : text || '未知错误';
            root.innerHTML = `<div class="plugin-ui-error">生成失败：${message}</div>`;
            return;
        }

        renderUi(payload.ui);
    }

    function createCard(title) {
        const card = document.createElement('article');
        card.className = 'plugin-ui-card';

        if (title) {
            const header = document.createElement('h3');
            header.textContent = title;
            card.appendChild(header);
        }
        return card;
    }

    function renderMetric(block) {
        const card = createCard('');
        const label = document.createElement('div');
        label.className = 'plugin-ui-metric-label';
        label.textContent = block.label || '指标';

        const value = document.createElement('div');
        value.className = 'plugin-ui-metric-value';
        value.textContent = block.value == null ? '-' : String(block.value);

        card.appendChild(label);
        card.appendChild(value);

        if (block.hint) {
            const hint = document.createElement('div');
            hint.className = 'plugin-ui-subtitle';
            hint.textContent = String(block.hint);
            card.appendChild(hint);
        }
        return card;
    }

    function renderText(block) {
        const card = createCard(block.title || '说明');
        const text = document.createElement('div');
        text.textContent = block.text || '';
        card.appendChild(text);
        return card;
    }

    function renderList(block) {
        const card = createCard(block.title || '列表');
        const list = document.createElement('ul');
        list.className = 'plugin-ui-list';

        const items = Array.isArray(block.items) ? block.items : [];
        items.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item == null ? '' : String(item);
            list.appendChild(li);
        });

        card.appendChild(list);
        return card;
    }

    function renderTable(block) {
        const card = createCard(block.title || '表格');
        const columns = Array.isArray(block.columns) ? block.columns : [];
        const rows = Array.isArray(block.rows) ? block.rows : [];

        const wrap = document.createElement('div');
        wrap.className = 'plugin-ui-table-wrap';

        const table = document.createElement('table');
        table.className = 'plugin-ui-table';

        if (columns.length) {
            const thead = document.createElement('thead');
            const tr = document.createElement('tr');
            columns.forEach((col) => {
                const th = document.createElement('th');
                th.textContent = String((col && (col.label || col.key)) || '');
                tr.appendChild(th);
            });
            thead.appendChild(tr);
            table.appendChild(thead);
        }

        const tbody = document.createElement('tbody');
        if (rows.length) {
            rows.forEach((row) => {
                const tr = document.createElement('tr');
                if (columns.length) {
                    columns.forEach((col) => {
                        const td = document.createElement('td');
                        const key = col && col.key ? col.key : '';
                        const value = key && row && typeof row === 'object' ? row[key] : '';
                        td.textContent = value == null ? '' : String(value);
                        tr.appendChild(td);
                    });
                } else {
                    const td = document.createElement('td');
                    td.textContent = row == null ? '' : String(row);
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.textContent = String(block.empty_text || '暂无数据');
            if (columns.length) {
                td.colSpan = columns.length;
            }
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        wrap.appendChild(table);
        card.appendChild(wrap);
        return card;
    }

    async function invokeAction(item, buttonRef) {
        const classroomId = getClassroomIdFromQuery();
        const method = String(item.method || 'POST').toUpperCase();
        const endpointUrl = item.call || (item.action ? `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(item.action)}/` : '');

        if (!endpointUrl) {
            showFeedback('动作缺少 call 或 action', true);
            return;
        }

        const payload = Object.assign({}, item.payload || {});
        if (classroomId && payload.classroom_id == null) {
            payload.classroom_id = classroomId;
        }

        const btn = buttonRef;
        if (btn) {
            btn.disabled = true;
        }

        try {
            let response;
            if (method === 'GET') {
                const params = new URLSearchParams();
                Object.keys(payload).forEach((key) => {
                    if (payload[key] != null) {
                        params.set(key, String(payload[key]));
                    }
                });
                const url = params.toString() ? `${endpointUrl}?${params.toString()}` : endpointUrl;
                response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });
            } else {
                response = await fetch(endpointUrl, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify(payload),
                });
            }

            const text = await response.text();
            const result = parseJsonSafely(text);
            if (!response.ok || !result || result.status !== 'success') {
                const errorMessage = result && result.message ? result.message : text;
                showFeedback(`执行失败：${errorMessage || '未知错误'}`, true);
                return;
            }

            showFeedback(item.success_message || '执行成功', false);
            if (item.refresh_ui !== false) {
                await loadUi();
            }
        } catch (error) {
            showFeedback(`执行失败：${error}`, true);
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    }

    function renderActions(block) {
        const card = createCard(block.title || '动作');
        const wrap = document.createElement('div');
        wrap.className = 'plugin-ui-actions';

        const items = Array.isArray(block.items) ? block.items : [];
        items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'plugin-ui-action-btn';
            if (item.variant === 'secondary') {
                button.classList.add('secondary');
            }
            button.textContent = item.label || item.action || '执行动作';
            button.addEventListener('click', function () {
                invokeAction(item, button);
            });
            wrap.appendChild(button);
        });

        card.appendChild(wrap);
        return card;
    }

    function renderJson(block) {
        const card = createCard(block.title || '数据');
        const pre = document.createElement('pre');
        pre.className = 'plugin-ui-json';
        pre.textContent = toPrettyJson(block.value == null ? block : block.value);
        card.appendChild(pre);
        return card;
    }

    function renderBlock(block) {
        const safeBlock = block && typeof block === 'object' ? block : { type: 'json', value: block };
        const blockType = String(safeBlock.type || 'json').toLowerCase();
        if (blockType === 'metric') {
            return renderMetric(safeBlock);
        }
        if (blockType === 'text') {
            return renderText(safeBlock);
        }
        if (blockType === 'list') {
            return renderList(safeBlock);
        }
        if (blockType === 'actions') {
            return renderActions(safeBlock);
        }
        if (blockType === 'table') {
            return renderTable(safeBlock);
        }
        return renderJson(safeBlock);
    }

    function renderUi(uiPayload) {
        if (uiPayload == null) {
            root.innerHTML = '<div class="plugin-ui-empty">插件未返回 UI 数据</div>';
            return;
        }

        const shell = document.createElement('section');
        shell.className = 'plugin-ui-shell';

        if (uiPayload && typeof uiPayload === 'object' && !Array.isArray(uiPayload) && uiPayload.type === 'page') {
            if (uiPayload.theme && uiPayload.theme.primary) {
                document.documentElement.style.setProperty('--primary-color', String(uiPayload.theme.primary));
            }

            const title = document.createElement('h2');
            title.className = 'plugin-ui-title';
            title.textContent = uiPayload.title || `${pluginId}/${uiName}`;
            shell.appendChild(title);

            if (uiPayload.subtitle) {
                const subtitle = document.createElement('div');
                subtitle.className = 'plugin-ui-subtitle';
                subtitle.textContent = String(uiPayload.subtitle);
                shell.appendChild(subtitle);
            }

            const blocksWrap = document.createElement('div');
            blocksWrap.className = 'plugin-ui-blocks';
            const blocks = Array.isArray(uiPayload.blocks) ? uiPayload.blocks : [];
            blocks.forEach((block) => {
                blocksWrap.appendChild(renderBlock(block));
            });
            shell.appendChild(blocksWrap);
        } else if (Array.isArray(uiPayload)) {
            const blocksWrap = document.createElement('div');
            blocksWrap.className = 'plugin-ui-blocks';
            uiPayload.forEach((block) => {
                blocksWrap.appendChild(renderBlock(block));
            });
            shell.appendChild(blocksWrap);
        } else {
            const blocksWrap = document.createElement('div');
            blocksWrap.className = 'plugin-ui-blocks';
            blocksWrap.appendChild(renderJson({ title: 'UI 数据', value: uiPayload }));
            shell.appendChild(blocksWrap);
        }

        root.innerHTML = '';
        root.appendChild(shell);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            loadUi();
        });
    }

    loadUi();
})();
