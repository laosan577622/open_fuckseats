(function () {
    'use strict';

    var root = document.getElementById('plugin-ui-root');
    if (!root) return;

    var refreshBtn = document.getElementById('plugin-ui-refresh-btn');
    var feedback = document.getElementById('plugin-ui-feedback');
    var pluginId = root.dataset.pluginId || '';
    var uiName = root.dataset.uiName || '';
    var endpoint = root.dataset.uiEndpoint || '';

    if (!pluginId || !uiName || !endpoint) {
        root.innerHTML = '<div class="plugin-ui-error">缺少插件 UI 上下文，无法渲染。</div>';
        return;
    }

    var DEFAULT_SPANS = {
        metric:   3,
        text:     6,
        list:     6,
        actions:  12,
        table:    12,
        json:     12,
        progress: 6,
        divider:  12,
        section:  12,
        badge:    3
    };

    function resolveSpan(block) {
        if (block.span) return Math.min(12, Math.max(1, parseInt(block.span, 10) || 3));
        var t = String(block.type || 'json').toLowerCase();
        return DEFAULT_SPANS[t] || 6;
    }

    function getCsrfToken() {
        var rows = (document.cookie || '').split(';');
        for (var i = 0; i < rows.length; i++) {
            var item = rows[i].trim();
            if (item.indexOf('csrftoken=') === 0) {
                return decodeURIComponent(item.substring('csrftoken='.length));
            }
        }
        return '';
    }

    function showFeedback(message, isError) {
        if (!feedback) return;
        feedback.hidden = false;
        feedback.textContent = message || '';
        feedback.className = 'plugin-ui-feedback' + (isError ? ' error' : '');
    }

    function hideFeedback() {
        if (!feedback) return;
        feedback.hidden = true;
        feedback.textContent = '';
        feedback.classList.remove('error');
    }

    function getClassroomIdFromQuery() {
        return new URLSearchParams(window.location.search).get('classroom_id') || null;
    }

    function parseJson(text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    function prettyJson(value) {
        try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
    }

    function buildUiUrl() {
        var search = window.location.search || '';
        return search ? endpoint + search : endpoint;
    }

    function el(tag, cls, attrs) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (attrs) {
            for (var k in attrs) {
                if (attrs.hasOwnProperty(k)) node.setAttribute(k, attrs[k]);
            }
        }
        return node;
    }

    function renderSkeleton() {
        root.innerHTML = '';
        var wrap = el('div', 'plugin-ui-loading');
        wrap.textContent = '正在生成界面...';
        root.appendChild(wrap);
    }

    async function loadUi() {
        hideFeedback();
        renderSkeleton();

        var response;
        try {
            response = await fetch(buildUiUrl(), {
                method: 'GET',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
        } catch (error) {
            root.innerHTML = '<div class="plugin-ui-error">请求失败：' + error + '</div>';
            return;
        }

        var text = await response.text();
        var payload = parseJson(text);
        if (!response.ok || !payload || payload.status !== 'success') {
            var msg = (payload && payload.message) ? payload.message : (text || '未知错误');
            root.innerHTML = '<div class="plugin-ui-error">生成失败：' + msg + '</div>';
            return;
        }

        renderUi(payload.ui);
    }

    function createCard(title, spanCols) {
        var card = el('article', 'plugin-ui-card');
        if (spanCols && spanCols !== 3) {
            card.classList.add('span-' + spanCols);
        }
        if (title) {
            var h = el('h3');
            h.textContent = title;
            card.appendChild(h);
        }
        return card;
    }

    function renderMetric(block) {
        var card = createCard('', resolveSpan(block));
        var label = el('div', 'plugin-ui-metric-label');
        label.textContent = block.label || '指标';
        var value = el('div', 'plugin-ui-metric-value');
        value.textContent = block.value == null ? '-' : String(block.value);
        card.appendChild(label);
        card.appendChild(value);
        if (block.hint) {
            var hint = el('div', 'plugin-ui-metric-hint');
            hint.textContent = String(block.hint);
            card.appendChild(hint);
        }
        return card;
    }

    function renderText(block) {
        var card = createCard(block.title || '说明', resolveSpan(block));
        var body = el('div', 'plugin-ui-text-body');
        body.textContent = block.text || '';
        card.appendChild(body);
        return card;
    }

    function renderList(block) {
        var card = createCard(block.title || '列表', resolveSpan(block));
        var list = el('ul', 'plugin-ui-list');
        var items = Array.isArray(block.items) ? block.items : [];
        if (!items.length) items = [block.empty_text || '暂无数据'];
        items.forEach(function (item) {
            var li = el('li');
            li.textContent = item == null ? '' : String(item);
            list.appendChild(li);
        });
        card.appendChild(list);
        return card;
    }

    function renderTable(block) {
        var card = createCard(block.title || '表格', resolveSpan(block));
        var columns = Array.isArray(block.columns) ? block.columns : [];
        var rows = Array.isArray(block.rows) ? block.rows : [];

        var wrap = el('div', 'plugin-ui-table-wrap');
        var table = el('table', 'plugin-ui-table');

        if (columns.length) {
            var thead = el('thead');
            var tr = el('tr');
            columns.forEach(function (col) {
                var th = el('th');
                th.textContent = String((col && (col.label || col.key)) || '');
                tr.appendChild(th);
            });
            thead.appendChild(tr);
            table.appendChild(thead);
        }

        var tbody = el('tbody');
        if (rows.length) {
            rows.forEach(function (row) {
                var tr = el('tr');
                if (columns.length) {
                    columns.forEach(function (col) {
                        var td = el('td');
                        var key = col && col.key ? col.key : '';
                        var val = key && row && typeof row === 'object' ? row[key] : '';
                        td.textContent = val == null ? '' : String(val);
                        tr.appendChild(td);
                    });
                } else {
                    var td = el('td');
                    td.textContent = row == null ? '' : String(row);
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            });
        } else {
            var tr = el('tr');
            var td = el('td');
            td.textContent = block.empty_text || '暂无数据';
            if (columns.length) td.colSpan = columns.length;
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        wrap.appendChild(table);
        card.appendChild(wrap);
        return card;
    }

    async function invokeAction(item, buttonRef) {
        var classroomId = getClassroomIdFromQuery();
        var method = String(item.method || 'POST').toUpperCase();
        var endpointUrl = item.call || (item.action ? '/plugins/' + encodeURIComponent(pluginId) + '/' + encodeURIComponent(item.action) + '/' : '');

        if (!endpointUrl) {
            showFeedback('动作缺少 call 或 action', true);
            return;
        }

        var payload = Object.assign({}, item.payload || {});
        if (classroomId && payload.classroom_id == null) {
            payload.classroom_id = classroomId;
        }

        if (buttonRef) buttonRef.disabled = true;

        try {
            var response;
            if (method === 'GET') {
                var params = new URLSearchParams();
                Object.keys(payload).forEach(function (key) {
                    if (payload[key] != null) params.set(key, String(payload[key]));
                });
                var url = params.toString() ? endpointUrl + '?' + params.toString() : endpointUrl;
                response = await fetch(url, {
                    method: 'GET',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
            } else {
                response = await fetch(endpointUrl, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify(payload)
                });
            }

            var text = await response.text();
            var result = parseJson(text);
            if (!response.ok || !result || result.status !== 'success') {
                var errMsg = (result && result.message) ? result.message : text;
                showFeedback('执行失败：' + (errMsg || '未知错误'), true);
                return;
            }

            showFeedback(item.success_message || '执行成功', false);
            if (item.refresh_ui !== false) await loadUi();
        } catch (error) {
            showFeedback('执行失败：' + error, true);
        } finally {
            if (buttonRef) buttonRef.disabled = false;
        }
    }

    function renderActions(block) {
        var card = createCard(block.title || '动作', resolveSpan(block));
        var wrap = el('div', 'plugin-ui-actions');
        var items = Array.isArray(block.items) ? block.items : [];
        items.forEach(function (item) {
            var button = el('button', 'plugin-ui-action-btn');
            button.type = 'button';
            if (item.variant === 'secondary') button.classList.add('secondary');
            button.textContent = item.label || item.action || '执行动作';
            button.addEventListener('click', function () { invokeAction(item, button); });
            wrap.appendChild(button);
        });
        card.appendChild(wrap);
        return card;
    }

    function renderProgress(block) {
        var card = createCard(block.title || '进度', resolveSpan(block));
        var wrap = el('div', 'plugin-ui-progress-wrap');
        var bar = el('div', 'plugin-ui-progress-bar');
        var fill = el('div', 'plugin-ui-progress-fill');
        var pct = Math.max(0, Math.min(100, parseFloat(block.value) || 0));
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        var info = el('div', 'plugin-ui-progress-info');
        var labelEl = el('span');
        labelEl.textContent = block.label || '';
        var valEl = el('span');
        valEl.textContent = block.hint || (pct + '%');
        info.appendChild(labelEl);
        info.appendChild(valEl);
        wrap.appendChild(info);
        card.appendChild(wrap);
        return card;
    }

    function renderDivider() {
        return el('hr', 'plugin-ui-divider');
    }

    function renderSection(block) {
        var wrap = el('div', 'plugin-ui-section-header');
        var title = el('span', 'plugin-ui-section-title');
        title.textContent = block.title || '';
        wrap.appendChild(title);
        if (block.subtitle) {
            var sub = el('span', 'plugin-ui-section-subtitle');
            sub.textContent = block.subtitle;
            wrap.appendChild(sub);
        }
        return wrap;
    }

    function renderBadge(block) {
        var card = createCard('', resolveSpan(block));
        var badge = el('span', 'plugin-ui-badge');
        var variant = block.variant || 'primary';
        badge.classList.add('badge-' + variant);
        badge.textContent = block.text || block.label || '';
        card.appendChild(badge);
        return card;
    }

    function renderJson(block) {
        var card = createCard(block.title || '数据', resolveSpan(block));
        var pre = el('pre', 'plugin-ui-json');
        pre.textContent = prettyJson(block.value == null ? block : block.value);
        card.appendChild(pre);
        return card;
    }

    function renderBlock(block) {
        var safeBlock = (block && typeof block === 'object') ? block : { type: 'json', value: block };
        var t = String(safeBlock.type || 'json').toLowerCase();

        switch (t) {
            case 'metric':   return renderMetric(safeBlock);
            case 'text':     return renderText(safeBlock);
            case 'list':     return renderList(safeBlock);
            case 'actions':  return renderActions(safeBlock);
            case 'table':    return renderTable(safeBlock);
            case 'progress': return renderProgress(safeBlock);
            case 'divider':  return renderDivider();
            case 'section':  return renderSection(safeBlock);
            case 'badge':    return renderBadge(safeBlock);
            default:         return renderJson(safeBlock);
        }
    }

    function renderUi(uiPayload) {
        if (uiPayload == null) {
            root.innerHTML = '<div class="plugin-ui-empty">插件未返回 UI 数据</div>';
            return;
        }

        var shell = el('section', 'plugin-ui-shell');

        if (uiPayload && typeof uiPayload === 'object' && !Array.isArray(uiPayload) && uiPayload.type === 'page') {
            if (uiPayload.theme && uiPayload.theme.primary) {
                document.documentElement.style.setProperty('--primary-color', String(uiPayload.theme.primary));
                document.documentElement.style.setProperty('--pui-primary', String(uiPayload.theme.primary));
            }

            var title = el('h2', 'plugin-ui-title');
            title.textContent = uiPayload.title || (pluginId + '/' + uiName);
            shell.appendChild(title);

            if (uiPayload.subtitle) {
                var subtitle = el('div', 'plugin-ui-subtitle');
                subtitle.textContent = String(uiPayload.subtitle);
                shell.appendChild(subtitle);
            }

            var blocksWrap = el('div', 'plugin-ui-blocks');
            var blocks = Array.isArray(uiPayload.blocks) ? uiPayload.blocks : [];
            blocks.forEach(function (block) {
                blocksWrap.appendChild(renderBlock(block));
            });
            shell.appendChild(blocksWrap);
        } else if (Array.isArray(uiPayload)) {
            var blocksWrap2 = el('div', 'plugin-ui-blocks');
            uiPayload.forEach(function (block) {
                blocksWrap2.appendChild(renderBlock(block));
            });
            shell.appendChild(blocksWrap2);
        } else {
            var blocksWrap3 = el('div', 'plugin-ui-blocks');
            blocksWrap3.appendChild(renderJson({ title: 'UI 数据', value: uiPayload }));
            shell.appendChild(blocksWrap3);
        }

        root.innerHTML = '';
        root.appendChild(shell);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () { loadUi(); });
    }

    loadUi();
})();
