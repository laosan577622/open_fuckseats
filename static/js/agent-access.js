/* Agent 授权窗口：外部 Agent 通过 /open_api/access/authorize 申请访问时，在应用界面里由用户确认。
   待确认的申请随 /api/realtime/ 的轮询结果下发；这里只负责展示和提交用户的决定。 */
(function () {
    'use strict';

    var MODAL_ID = 'agent-access-modal';
    var queue = [];
    var current = null;
    var submitting = false;
    var dismissed = Object.create(null);

    var SCOPE_COPY = {
        full: {
            summary: '申请读取并修改不想排座位的数据',
            items: [
                '读取所有班级、座位排列、名单、学号、成绩、自定义信息、小组、约束、标签、快照和历史记录',
                '新建、修改或删除班级和学生，调整座位，执行自动排座与自定义排序',
            ],
            allow: '允许读取和修改',
        },
        read: {
            summary: '申请读取不想排座位的数据',
            items: [
                '读取所有班级、座位排列、名单、学号、成绩、自定义信息、小组、约束、标签、快照和历史记录',
                '不能修改或删除任何数据',
            ],
            allow: '允许读取',
        },
    };

    function csrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) return meta.content;
        var match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function ensureDom() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'modal agent-access-modal';
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'agentAccessTitle');
        modal.setAttribute('aria-describedby', 'agentAccessSummary');
        modal.style.display = 'none';
        modal.innerHTML =
            '<div class="modal-content modal-medium agent-access-content">' +
                '<div class="agent-access-head">' +
                    '<span class="agent-access-icon" aria-hidden="true">' +
                        '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
                            '<path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.2 10"/>' +
                        '</svg>' +
                    '</span>' +
                    '<div>' +
                        '<h3 id="agentAccessTitle" class="modal-title">Agent 申请访问</h3>' +
                        '<p class="agent-access-queue" id="agentAccessQueue" hidden></p>' +
                    '</div>' +
                '</div>' +
                '<p class="agent-access-client"><strong id="agentAccessClient"></strong><span id="agentAccessSummary"></span></p>' +
                '<p class="agent-access-reason" id="agentAccessReason" hidden></p>' +
                '<ul class="agent-access-scope" id="agentAccessScope"></ul>' +
                '<fieldset class="agent-access-duration" id="agentAccessDuration">' +
                    '<legend>授权期限</legend>' +
                    '<label><input type="radio" name="agentAccessDuration" value="session" checked> 仅本次运行</label>' +
                    '<label><input type="radio" name="agentAccessDuration" value="30d"> 30 天</label>' +
                    '<label><input type="radio" name="agentAccessDuration" value="forever"> 永久</label>' +
                '</fieldset>' +
                '<p class="agent-access-note" id="agentAccessNote"></p>' +
                '<p class="agent-access-error" id="agentAccessError" role="alert" hidden></p>' +
                '<div class="modal-actions agent-access-actions">' +
                    '<button type="button" class="btn btn-secondary" id="agentAccessDeny" data-modal-cancel>拒绝</button>' +
                    '<button type="button" class="btn btn-secondary" id="agentAccessReadOnly">仅允许读取</button>' +
                    '<button type="button" class="btn btn-primary" id="agentAccessAllow"></button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.querySelectorAll('input[name="agentAccessDuration"]').forEach(function (input) {
            input.addEventListener('change', syncDurationNote);
        });
        document.getElementById('agentAccessDeny').addEventListener('click', function () { decide('deny'); });
        document.getElementById('agentAccessReadOnly').addEventListener('click', function () { decide('read'); });
        document.getElementById('agentAccessAllow').addEventListener('click', function () {
            if (current) decide(current.scope === 'full' ? 'full' : 'read');
        });
        return modal;
    }

    var DURATION_COPY = {
        session: { note: '授权只在本次应用运行期间有效，关闭应用后自动失效。', toast: '本次运行期间有效' },
        '30d': { note: '授权 30 天内有效，应用重启后这个程序仍可继续访问；可在「设置 → 数据与隐私」随时撤销。', toast: '30 天内有效' },
        forever: { note: '授权长期有效，应用重启后这个程序仍可继续访问，直到你在「设置 → 数据与隐私」撤销。', toast: '长期有效，可在设置中撤销' },
    };

    function selectedDuration() {
        var checked = document.querySelector('input[name="agentAccessDuration"]:checked');
        return checked && DURATION_COPY[checked.value] ? checked.value : 'session';
    }

    function syncDurationNote() {
        var note = document.getElementById('agentAccessNote');
        if (note) note.textContent = DURATION_COPY[selectedDuration()].note + '写入操作会直接生效，不会再逐项确认；请只允许你正在使用的程序。';
    }

    function setBusy(busy) {
        submitting = busy;
        ['agentAccessDeny', 'agentAccessReadOnly', 'agentAccessAllow'].forEach(function (id) {
            var button = document.getElementById(id);
            if (button) button.disabled = busy;
        });
    }

    function render() {
        var modal = ensureDom();
        var copy = SCOPE_COPY[current.scope] || SCOPE_COPY.read;
        document.getElementById('agentAccessClient').textContent = '「' + current.client_name + '」';
        document.getElementById('agentAccessSummary').textContent = copy.summary;
        var reason = document.getElementById('agentAccessReason');
        reason.hidden = !current.reason;
        reason.textContent = current.reason ? '申请说明：' + current.reason : '';
        var list = document.getElementById('agentAccessScope');
        list.replaceChildren();
        copy.items.forEach(function (text) {
            var item = document.createElement('li');
            item.textContent = text;
            list.appendChild(item);
        });
        document.getElementById('agentAccessAllow').textContent = copy.allow;
        document.getElementById('agentAccessReadOnly').hidden = current.scope !== 'full';
        var waiting = queue.length - 1;
        var queueLabel = document.getElementById('agentAccessQueue');
        queueLabel.hidden = waiting < 1;
        queueLabel.textContent = waiting > 0 ? '另有 ' + waiting + ' 个申请等待处理' : '';
        document.getElementById('agentAccessError').hidden = true;
        // 每个申请都从“仅本次运行”开始，长期授权必须由用户主动选择。
        modal.querySelector('input[name="agentAccessDuration"][value="session"]').checked = true;
        syncDurationNote();
        setBusy(false);
        if (modal.style.display === 'none' || !modal.classList.contains('modal-visible')) {
            window.openModal(MODAL_ID);
            // 默认聚焦“拒绝”，误按回车不会放行。
            requestAnimationFrame(function () {
                var deny = document.getElementById('agentAccessDeny');
                if (deny && deny.isConnected) deny.focus({ preventScroll: true });
            });
        }
    }

    function show() {
        if (submitting) return;
        var next = queue[0] || null;
        if (!next) {
            if (current) window.closeModal(MODAL_ID);
            current = null;
            return;
        }
        if (current && current.id === next.id) {
            // 同一个申请，只刷新排队数量。
            var waiting = queue.length - 1;
            var label = document.getElementById('agentAccessQueue');
            if (label) {
                label.hidden = waiting < 1;
                label.textContent = waiting > 0 ? '另有 ' + waiting + ' 个申请等待处理' : '';
            }
            return;
        }
        current = next;
        render();
    }

    function sync(requests) {
        if (!Array.isArray(requests) || typeof window.openModal !== 'function') return;
        queue = requests.filter(function (item) {
            return item && typeof item.id === 'string' && !dismissed[item.id];
        });
        show();
    }

    function decide(decision) {
        if (!current || submitting) return;
        var target = current;
        setBusy(true);
        fetch('/api/agent-access/' + encodeURIComponent(target.id) + '/decide/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken(),
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ decision: decision, duration: selectedDuration() }),
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                return { ok: response.ok, status: response.status, data: data };
            });
        }).then(function (result) {
            // 404 表示申请已在别的窗口处理或已超时，同样从队列里移除。
            if (!result.ok && result.status !== 404) {
                throw new Error(result.data.message || '提交失败，请重试');
            }
            dismissed[target.id] = true;
            submitting = false;
            if (result.ok) window.dispatchEvent(new CustomEvent('fuckseats:agent-access-changed'));
            if (result.ok && typeof window.showToast === 'function') {
                window.showToast(result.data.authorization === 'granted'
                    ? '已允许「' + target.client_name + '」' + (result.data.scope === 'full' ? '读取和修改' : '读取') + '，' + (DURATION_COPY[result.data.duration] || DURATION_COPY.session).toast
                    : '已拒绝「' + target.client_name + '」的访问申请');
            }
            sync(Array.isArray(result.data.requests) ? result.data.requests : queue.slice(1));
        }).catch(function (error) {
            setBusy(false);
            var message = document.getElementById('agentAccessError');
            message.textContent = error.message || '提交失败，请重试';
            message.hidden = false;
        });
    }

    window.addEventListener('fuckseats:realtime', function (event) {
        sync(event.detail && event.detail.agent_access);
    });
    window.AgentAccess = { sync: sync };
})();
