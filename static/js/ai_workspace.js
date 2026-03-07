document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('future-mode-root');
    if (!root) return;

    const chatUrl = root.dataset.chatUrl;
    const chatStreamUrl = root.dataset.chatStreamUrl || '';
    const csrf = root.dataset.csrf;
    const classroomId = String(root.dataset.classroomId || '').trim();

    const appScreen = document.getElementById('appScreen');
    const glowContainer = document.getElementById('glowContainer');
    const chatForm = document.getElementById('future-chat-form');
    const userInput = document.getElementById('userInput');
    const chatContainer = document.getElementById('chatContainer');
    const sendBtn = document.getElementById('sendBtn');

    const configBtn = document.getElementById('configBtn');
    const configModal = document.getElementById('configModal');
    const configCloseBtn = document.getElementById('configCloseBtn');
    const configForm = document.getElementById('future-config-form');
    const apiKeyInput = document.getElementById('future-api-key');
    const baseUrlInput = document.getElementById('future-base-url');
    const modelIdInput = document.getElementById('future-model-id');
    const thinkingModeSelect = document.getElementById('future-thinking-mode');
    const configResetBtn = document.getElementById('future-config-reset');

    const conversationSelect = document.getElementById('conversationSelect');
    const newConversationBtn = document.getElementById('newConversationBtn');
    const deleteConversationBtn = document.getElementById('deleteConversationBtn');

    const promptChips = document.querySelectorAll('.future-prompt-chip');

    const configStorageKey = 'future_mode_openai_config';
    const defaultGreeting = '你好，我是当前班级的 Window Inteligence ｜ 闻道智能。\n你可以直接提需求，我会在需要时向你申请工具授权。';

    let isSiriActive = false;
    let pulseTimeout;
    let siriDismissTimeout;
    let hasStartedTyping = false;
    let pendingNode = null;
    let activeConversationId = null;

    let approvalState = {
        token: '',
        calls: [],
        decisions: {},
    };
    const READ_PERMISSION_TOOLS = new Set([
        'get_classroom_overview',
        'get_student_info',
        'get_group_scores',
        'get_student_list',
        'send_card_info',
    ]);
    const readPermissionStorageKey = classroomId
        ? `future_mode_read_permission_class_${classroomId}`
        : 'future_mode_read_permission_class_default';
    let hasClassReadPermission = false;
    try {
        hasClassReadPermission = localStorage.getItem(readPermissionStorageKey) === '1';
    } catch (_) {
        hasClassReadPermission = false;
    }

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const loadClientConfig = () => {
        try { return JSON.parse(localStorage.getItem(configStorageKey) || '{}'); } catch (_) { return {}; }
    };

    const readClientConfig = () => ({
        thinking_mode: (() => {
            const mode = String(thinkingModeSelect?.value || '').trim().toLowerCase();
            return (mode === 'enabled' || mode === 'disabled') ? mode : '';
        })(),
        api_key: String(apiKeyInput?.value || '').trim(),
        base_url: String(baseUrlInput?.value || '').trim(),
        model: String(modelIdInput?.value || '').trim(),
    });

    const writeClientConfig = (config = {}) => {
        if (apiKeyInput) apiKeyInput.value = config.api_key || '';
        if (baseUrlInput) baseUrlInput.value = config.base_url || '';
        if (modelIdInput) modelIdInput.value = config.model || '';
        if (thinkingModeSelect) {
            const mode = String(config.thinking_mode || '').trim().toLowerCase();
            thinkingModeSelect.value = (mode === 'enabled' || mode === 'disabled') ? mode : '';
        }
    };

    const saveClientConfigToLocal = (config = {}) => {
        const mode = String(config.thinking_mode || '').trim().toLowerCase();
        localStorage.setItem(configStorageKey, JSON.stringify({
            api_key: String(config.api_key || '').trim(),
            base_url: String(config.base_url || '').trim(),
            model: String(config.model || '').trim(),
            thinking_mode: (mode === 'enabled' || mode === 'disabled') ? mode : '',
        }));
    };

    const isClientConfigEmpty = (config = {}) => {
        const mode = String(config.thinking_mode || '').trim().toLowerCase();
        const normalized = {
            api_key: String(config.api_key || '').trim(),
            base_url: String(config.base_url || '').trim(),
            model: String(config.model || '').trim(),
            thinking_mode: (mode === 'enabled' || mode === 'disabled') ? mode : '',
        };
        return !(normalized.api_key || normalized.base_url || normalized.model || normalized.thinking_mode);
    };

    writeClientConfig(loadClientConfig());

    const scrollToBottom = () => {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    };

    const wakeSiri = () => {
        clearTimeout(siriDismissTimeout);
        siriDismissTimeout = null;
        if (isSiriActive) return;
        isSiriActive = true;
        glowContainer.classList.add('active');
    };

    const dismissSiri = () => {
        isSiriActive = false;
        appScreen.classList.remove('squeezed');
        glowContainer.classList.remove('active');
        glowContainer.classList.remove('animating');
    };

    const addMessage = (text, sender, isStatus = false) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender} ${isStatus ? 'status' : ''}`;
        msgDiv.textContent = String(text || '');
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    };

    const removePendingMessage = () => {
        if (pendingNode && pendingNode.parentNode) {
            pendingNode.parentNode.removeChild(pendingNode);
        }
        pendingNode = null;
    };

    const isReadPermissionCall = (call) => READ_PERMISSION_TOOLS.has(String(call?.name || '').trim());

    const grantClassReadPermission = () => {
        if (hasClassReadPermission) return;
        hasClassReadPermission = true;
        try {
            localStorage.setItem(readPermissionStorageKey, '1');
        } catch (_) {
            // ignore storage failures
        }
    };

    const startThinkingAnimation = () => {
        wakeSiri();
        appScreen.classList.add('squeezed');
        glowContainer.classList.add('animating');
        document.documentElement.style.setProperty('--pulse-brightness', '1.2');
    };

    const renderSeatCard = (card) => {
        const rows = Array.isArray(card.rows) && card.rows.length ? card.rows : [];
        const cols = Array.isArray(card.cols) && card.cols.length ? card.cols : [];
        const cells = Array.isArray(card.cells) ? card.cells : [];
        const keyed = new Map();
        cells.forEach(cell => keyed.set(`${cell.row}-${cell.col}`, cell));

        const availableRows = rows.length ? rows : [...new Set(cells.map(item => Number(item.row)).filter(Boolean))].sort((a, b) => a - b);
        const availableCols = cols.length ? cols : [...new Set(cells.map(item => Number(item.col)).filter(Boolean))].sort((a, b) => a - b);
        const columnsCount = Math.max(1, availableCols.length || 1);

        let gridHtml = '';
        availableRows.forEach(r => {
            availableCols.forEach(c => {
                const cell = keyed.get(`${r}-${c}`) || {};
                const student = String(cell.student_name || '').trim();
                const groupName = String(cell.group_name || '').trim();
                const cellType = String(cell.cell_type || '');
                const secondary = student ? `${groupName ? `组:${groupName}` : ''}` : (cellType || '空');
                gridHtml += `
                    <div class="ai-card-seat-cell">
                        <div>${escapeHtml(`${r}-${c}`)}</div>
                        <div style="margin-top:4px;font-weight:600;">${escapeHtml(student || '空位')}</div>
                        <div class="meta">${escapeHtml(secondary || '')}</div>
                    </div>
                `;
            });
        });

        return `
            <div class="ai-card collapsible-card">
                <div class="ai-card-header" onclick="this.parentElement.classList.toggle('expanded')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div class="ai-card-title" style="margin-bottom:2px;">${escapeHtml(card.title || '座位图')}</div>
                        <div class="ai-card-sub" style="margin-bottom:0;">点击展开查看 ${escapeHtml((card.classroom && card.classroom.name) || '')} 的排布详情</div>
                    </div>
                    <div class="expand-icon" style="color:#64748b; transition:transform 0.3s; display:flex;">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                </div>
                <div class="ai-card-body collapsible-body">
                    <div class="collapsible-body-inner">
                        <div class="ai-card-seat-grid" style="grid-template-columns:repeat(${columnsCount}, minmax(74px, 1fr));">
                            ${gridHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderStudentDetailCard = (card) => {
        const student = card.student || {};
        const seat = student.seat ? `${student.seat.row}-${student.seat.col}` : '未入座';
        const groupName = student.group && student.group.name ? student.group.name : '未分组';
        return `
            <div class="ai-card">
                <div class="ai-card-title">${escapeHtml(card.title || '学生详情')}</div>
                <div class="ai-card-kv">
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">姓名</div><div class="ai-card-kv-value">${escapeHtml(student.name || '-')}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">学号</div><div class="ai-card-kv-value">${escapeHtml(student.student_id || '-')}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">性别</div><div class="ai-card-kv-value">${escapeHtml(student.gender || '-')}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">成绩</div><div class="ai-card-kv-value">${escapeHtml(String(student.score_display || student.score || '-'))}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">座位</div><div class="ai-card-kv-value">${escapeHtml(seat)}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">小组</div><div class="ai-card-kv-value">${escapeHtml(groupName)}</div></div>
                </div>
            </div>
        `;
    };

    const renderClassReportCard = (card) => {
        const report = card.report || {};
        const metrics = report.metrics || {};
        const groups = Array.isArray(report.group_ranking) ? report.group_ranking : [];
        const students = Array.isArray(report.top_students) ? report.top_students : [];
        const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];

        return `
            <div class="ai-card">
                <div class="ai-card-title">${escapeHtml(card.title || '班级报告')}</div>
                <div class="ai-card-kv">
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">学生总数</div><div class="ai-card-kv-value">${escapeHtml(String(metrics.student_count ?? '-'))}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">已入座</div><div class="ai-card-kv-value">${escapeHtml(String(metrics.seated_count ?? '-'))}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">未入座</div><div class="ai-card-kv-value">${escapeHtml(String(metrics.unseated_count ?? '-'))}</div></div>
                    <div class="ai-card-kv-item"><div class="ai-card-kv-label">小组数</div><div class="ai-card-kv-value">${escapeHtml(String(metrics.group_count ?? '-'))}</div></div>
                </div>
                ${groups.length ? `<div class="ai-card-sub" style="margin-top:10px;">小组排行</div><div class="ai-card-list">${groups.map(item => `<div class="ai-card-list-item">${escapeHtml(item.group_name || '')} · 平均分 ${escapeHtml(String(item.average_score ?? '-'))}</div>`).join('')}</div>` : ''}
                ${students.length ? `<div class="ai-card-sub" style="margin-top:10px;">高分学生</div><div class="ai-card-list">${students.map(item => `<div class="ai-card-list-item">${escapeHtml(item.name || '')} · ${escapeHtml(String(item.score_display || item.score || '-'))}</div>`).join('')}</div>` : ''}
                ${suggestions.length ? `<div class="ai-card-sub" style="margin-top:10px;">建议</div><div class="ai-card-list">${suggestions.map(item => `<div class="ai-card-list-item">${escapeHtml(item.message || '')}</div>`).join('')}</div>` : ''}
            </div>
        `;
    };

    const renderCardHtml = (card = {}) => {
        const cardType = String(card.type || '').trim();
        if (cardType === 'partial_seat_map' || cardType === 'full_seat_map') {
            return renderSeatCard(card);
        }
        if (cardType === 'student_detail') {
            return renderStudentDetailCard(card);
        }
        if (cardType === 'class_report') {
            return renderClassReportCard(card);
        }
        return `
            <div class="ai-card">
                <div class="ai-card-title">${escapeHtml(card.title || '卡片')}</div>
                <pre style="white-space:pre-wrap;font-size:12px;color:#334155;">${escapeHtml(JSON.stringify(card, null, 2))}</pre>
            </div>
        `;
    };

    const addCardMessage = (card) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai card-message';
        msgDiv.innerHTML = renderCardHtml(card);
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    };

    const renderCards = (cards) => {
        (cards || []).forEach(card => {
            if (card && typeof card === 'object') {
                addCardMessage(card);
            }
        });
    };

    const typeAssistantMessage = async (text) => {
        startThinkingAnimation();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';
        chatContainer.appendChild(msgDiv);
        scrollToBottom();

        return new Promise((resolve) => {
            let i = 0;
            const content = String(text || '');
            const typeWriter = setInterval(() => {
                if (i < content.length) {
                    msgDiv.innerHTML = escapeHtml(content.substring(0, i + 1)) + '<span class="cursor"></span>';
                    i += 1;
                    scrollToBottom();
                } else {
                    clearInterval(typeWriter);
                    msgDiv.textContent = content;
                    document.documentElement.style.setProperty('--pulse-brightness', '1');
                    glowContainer.classList.remove('animating');
                    clearTimeout(siriDismissTimeout);
                    siriDismissTimeout = setTimeout(dismissSiri, 1200);
                    resolve(msgDiv);
                }
            }, 22);
        });
    };

    const startAssistantStreamingMessage = () => {
        startThinkingAnimation();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';
        msgDiv.textContent = '';
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    };

    const finishAssistantStreaming = () => {
        document.documentElement.style.setProperty('--pulse-brightness', '1');
        glowContainer.classList.remove('animating');
        clearTimeout(siriDismissTimeout);
        siriDismissTimeout = setTimeout(dismissSiri, 700);
    };

    const postJson = async (payload) => {
        const normalized = { ...payload };
        if (normalized.action !== 'conversation_init' && activeConversationId && !Object.prototype.hasOwnProperty.call(normalized, 'conversation_id')) {
            normalized.conversation_id = activeConversationId;
        }
        const response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
            },
            body: JSON.stringify(normalized),
        });
        const data = await response.json();
        if (!response.ok || data.status === 'error') {
            throw new Error(data.message || `请求失败：${response.status}`);
        }
        return data;
    };

    const parseSseBlock = (block) => {
        const lines = String(block || '').split('\n');
        let eventName = 'message';
        const dataLines = [];
        lines.forEach(line => {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
                return;
            }
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
        });
        if (!dataLines.length) return null;
        let payload = {};
        try {
            payload = JSON.parse(dataLines.join('\n'));
        } catch (_) {
            payload = {};
        }
        return { eventName, payload };
    };

    const renderConversationOptions = (conversations = []) => {
        if (!conversationSelect) return;
        const list = Array.isArray(conversations) ? conversations : [];
        conversationSelect.innerHTML = '';
        list.forEach(item => {
            const opt = document.createElement('option');
            opt.value = String(item.id);
            opt.textContent = item.title || `对话 ${item.id}`;
            conversationSelect.appendChild(opt);
        });
        if (activeConversationId !== null) {
            conversationSelect.value = String(activeConversationId);
        }
    };

    const renderHistoryMessages = (messages = []) => {
        chatContainer.innerHTML = '';
        if (!Array.isArray(messages) || !messages.length) {
            addMessage(defaultGreeting, 'ai');
            return;
        }
        messages.forEach(item => {
            const role = String(item.role || 'assistant');
            const content = String(item.content || '');
            const cards = Array.isArray(item.cards) ? item.cards : [];
            if (role === 'user') {
                if (content) addMessage(content, 'user');
            } else {
                if (content) addMessage(content, 'ai');
            }
            renderCards(cards);
        });
    };

    const applyConversationMeta = (result) => {
        if (!result || typeof result !== 'object') return;
        if (result.conversation_id !== undefined && result.conversation_id !== null) {
            activeConversationId = result.conversation_id;
        }
        if (Array.isArray(result.conversations)) {
            renderConversationOptions(result.conversations);
        }
    };

    const syncConfigFromServer = async () => {
        try {
            const result = await postJson({ action: 'config_get' });
            const serverConfig = result.client_config || {};
            if (isClientConfigEmpty(serverConfig)) return;
            writeClientConfig(serverConfig);
            saveClientConfigToLocal(serverConfig);
            addMessage('已加载数据库中的连接设置。', 'ai', true);
        } catch (_) {
            // ignore
        }
    };

    const renderApprovalCards = async () => {
        if (!approvalState.calls.length) return;
        const callById = new Map((approvalState.calls || []).map(call => [call.call_id, call]));
        const autoApprovedReadCalls = [];
        if (hasClassReadPermission) {
            approvalState.calls.forEach(call => {
                if (!call?.call_id || !isReadPermissionCall(call)) return;
                approvalState.decisions[call.call_id] = true;
                autoApprovedReadCalls.push(call);
            });
        }
        const autoApprovedReadIds = new Set(autoApprovedReadCalls.map(call => call.call_id));
        const interactiveCalls = approvalState.calls.filter(call => !autoApprovedReadIds.has(call.call_id));

        if (!interactiveCalls.length) {
            await handleApprovalSubmit();
            return;
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message approval-wrapper';

        const callsHtml = interactiveCalls.map(call => `
            <div class="approval-card">
                <div class="approval-card-text">${escapeHtml(call.summary || call.label || call.name)}，允许吗？</div>
                <div class="approval-card-actions">
                    <button type="button" class="btn-capsule app-deny-btn" data-call-id="${escapeHtml(call.call_id)}">拒绝</button>
                    <button type="button" class="btn-capsule app-allow-btn" data-call-id="${escapeHtml(call.call_id)}">允许</button>
                </div>
                <div class="app-status" style="font-size:14px; margin-top:12px; text-align:center; display:none;"></div>
            </div>
        `).join('');

        msgDiv.innerHTML = `
            ${callsHtml}
            <button class="btn-capsule app-submit-btn" style="display:none;">确认并继续执行</button>
        `;

        chatContainer.appendChild(msgDiv);
        scrollToBottom();

        const checkAllChosen = () => approvalState.calls.every(c => Object.prototype.hasOwnProperty.call(approvalState.decisions, c.call_id));
        const submitBtn = msgDiv.querySelector('.app-submit-btn');

        msgDiv.querySelectorAll('.app-allow-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const callId = btn.dataset.callId;
                approvalState.decisions[callId] = true;
                const selectedCall = callById.get(callId);
                if (selectedCall && isReadPermissionCall(selectedCall)) {
                    grantClassReadPermission();
                }
                const statusDiv = btn.parentElement.nextElementSibling;
                statusDiv.innerText = '已允许';
                statusDiv.style.color = '#137333';
                statusDiv.style.display = 'block';
                btn.parentElement.style.display = 'none';
                if (checkAllChosen()) submitBtn.click();
            });
        });

        msgDiv.querySelectorAll('.app-deny-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const callId = btn.dataset.callId;
                approvalState.decisions[callId] = false;
                const statusDiv = btn.parentElement.nextElementSibling;
                statusDiv.innerText = '已拒绝';
                statusDiv.style.color = '#C5221F';
                statusDiv.style.display = 'block';
                btn.parentElement.style.display = 'none';
                if (checkAllChosen()) submitBtn.click();
            });
        });

        submitBtn.addEventListener('click', async () => {
            msgDiv.querySelectorAll('button').forEach(b => {
                b.disabled = true;
                b.style.opacity = 0.5;
            });
            await handleApprovalSubmit();
        });
    };

    const processResult = async (result) => {
        applyConversationMeta(result);
        if (Array.isArray(result.messages)) {
            renderHistoryMessages(result.messages);
            return;
        }

        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (cards.length) renderCards(cards);

        if (result.status === 'needs_approval') {
            approvalState = {
                token: result.approval_token || '',
                calls: result.pending_calls || [],
                decisions: {},
            };
            await renderApprovalCards();
            return;
        }

        approvalState = { token: '', calls: [], decisions: {} };
        if (result.reply) {
            await typeAssistantMessage(result.reply);
        }
    };

    const handleApprovalSubmit = async () => {
        if (!approvalState.token || !approvalState.calls.length) return;
        const decisions = approvalState.calls.map(call => ({
            call_id: call.call_id,
            approved: Boolean(approvalState.decisions[call.call_id]),
        }));

        startThinkingAnimation();
        removePendingMessage();
        pendingNode = addMessage('正在根据你的授权继续思考…', 'ai', true);
        try {
            const result = await postJson({
                action: 'tool_approval',
                approval_token: approvalState.token,
                decisions,
                conversation_id: activeConversationId,
                client_config: readClientConfig(),
            });
            removePendingMessage();
            await processResult(result);
        } catch (error) {
            removePendingMessage();
            await typeAssistantMessage(error.message || '工具授权处理失败，稍后重试。');
        }
    };

    const handleSend = async (text) => {
        const cleaned = String(text || '').trim();
        if (!cleaned) return;

        addMessage(cleaned, 'user');
        userInput.value = '';
        hasStartedTyping = false;
        startThinkingAnimation();

        pendingNode = addMessage('正在思考…', 'ai', true);
        try {
            if (!chatStreamUrl) {
                throw new Error('未配置流式接口地址');
            }
            const response = await fetch(chatStreamUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrf,
                },
                body: JSON.stringify({
                    action: 'message',
                    message: cleaned,
                    conversation_id: activeConversationId,
                    client_config: readClientConfig(),
                }),
            });
            if (!response.ok || !response.body) {
                const fallbackResult = await postJson({
                    action: 'message',
                    message: cleaned,
                    conversation_id: activeConversationId,
                    client_config: readClientConfig(),
                });
                removePendingMessage();
                finishAssistantStreaming();
                await processResult(fallbackResult);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let donePayload = null;
            let streamedNode = null;
            let hasDelta = false;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop() || '';

                for (const block of blocks) {
                    const parsed = parseSseBlock(block);
                    if (!parsed) continue;
                    const { eventName, payload } = parsed;

                    if (eventName === 'delta') {
                        const textDelta = String(payload.text || '');
                        if (!textDelta) continue;
                        if (!streamedNode) {
                            removePendingMessage();
                            streamedNode = startAssistantStreamingMessage();
                        }
                        hasDelta = true;
                        streamedNode.textContent += textDelta;
                        scrollToBottom();
                        continue;
                    }

                    if (eventName === 'error') {
                        throw new Error(payload.message || '流式输出失败');
                    }

                    if (eventName === 'done') {
                        donePayload = payload || {};
                    }
                }
            }

            removePendingMessage();
            finishAssistantStreaming();

            if (donePayload) {
                applyConversationMeta(donePayload);
                const cards = Array.isArray(donePayload.cards) ? donePayload.cards : [];
                if (cards.length) renderCards(cards);

                if (donePayload.status === 'needs_approval') {
                    if (streamedNode && !String(streamedNode.textContent || '').trim()) {
                        streamedNode.remove();
                    }
                    approvalState = {
                        token: donePayload.approval_token || '',
                        calls: donePayload.pending_calls || [],
                        decisions: {},
                    };
                    await renderApprovalCards();
                    return;
                }

                approvalState = { token: '', calls: [], decisions: {} };
                const doneReply = String(donePayload.reply || '').trim();
                if (!hasDelta && doneReply) {
                    await typeAssistantMessage(doneReply);
                    return;
                }
                if (streamedNode && !String(streamedNode.textContent || '').trim() && doneReply) {
                    streamedNode.textContent = doneReply;
                    scrollToBottom();
                }
                return;
            }

            if (streamedNode && !String(streamedNode.textContent || '').trim()) {
                streamedNode.remove();
            }
        } catch (error) {
            removePendingMessage();
            await typeAssistantMessage(error.message || '发送失败，请稍后重试。');
        }
    };

    const initConversation = async () => {
        const result = await postJson({ action: 'conversation_init' });
        await processResult(result);
    };

    userInput.addEventListener('focus', wakeSiri);
    userInput.addEventListener('input', () => {
        document.documentElement.style.setProperty('--pulse-scale', '1.04');
        document.documentElement.style.setProperty('--pulse-brightness', '1.3');

        clearTimeout(pulseTimeout);
        pulseTimeout = setTimeout(() => {
            document.documentElement.style.setProperty('--pulse-scale', '1');
            document.documentElement.style.setProperty('--pulse-brightness', '1');
        }, 150);

        if (!hasStartedTyping && userInput.value.length > 0) {
            hasStartedTyping = true;
        }

        if (userInput.value.length === 0) {
            hasStartedTyping = false;
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSend(userInput.value);
    });

    promptChips.forEach(chip => {
        chip.addEventListener('click', () => {
            handleSend(chip.dataset.prompt);
        });
    });

    if (conversationSelect) {
        conversationSelect.addEventListener('change', async () => {
            const picked = String(conversationSelect.value || '').trim();
            if (!picked) return;
            try {
                const result = await postJson({
                    action: 'conversation_switch',
                    conversation_id: picked,
                });
                await processResult(result);
            } catch (error) {
                addMessage(error.message || '切换对话失败。', 'ai', true);
            }
        });
    }

    if (newConversationBtn) {
        newConversationBtn.addEventListener('click', async () => {
            try {
                const result = await postJson({ action: 'conversation_create' });
                await processResult(result);
                addMessage('已创建新对话。', 'ai', true);
            } catch (error) {
                addMessage(error.message || '创建对话失败。', 'ai', true);
            }
        });
    }

    if (deleteConversationBtn) {
        deleteConversationBtn.addEventListener('click', async () => {
            if (!activeConversationId) return;
            try {
                const result = await postJson({
                    action: 'conversation_delete',
                    conversation_id: activeConversationId,
                });
                await processResult(result);
                addMessage('当前对话已删除。', 'ai', true);
            } catch (error) {
                addMessage(error.message || '删除对话失败。', 'ai', true);
            }
        });
    }

    const toggleModal = (show) => {
        if (show) {
            configModal.style.display = 'flex';
            setTimeout(() => configModal.opacity = '1', 10);
            configModal.classList.add('show');
        } else {
            configModal.classList.remove('show');
            setTimeout(() => configModal.style.display = 'none', 300);
        }
    };

    configBtn.addEventListener('click', () => toggleModal(true));
    configCloseBtn.addEventListener('click', () => toggleModal(false));

    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submittingConfig = readClientConfig();
        try {
            const result = await postJson({
                action: 'config_save',
                client_config: submittingConfig,
            });
            const savedConfig = result.client_config || submittingConfig;
            saveClientConfigToLocal(savedConfig);
            writeClientConfig(savedConfig);
            toggleModal(false);
            addMessage('连接设置已保存到数据库，并在当前浏览器生效。', 'ai', true);
        } catch (error) {
            addMessage(error.message || '配置保存失败，请稍后重试。', 'ai', true);
        }
    });

    configResetBtn.addEventListener('click', async () => {
        try {
            await postJson({
                action: 'config_save',
                client_config: { api_key: '', base_url: '', model: '', thinking_mode: '' },
            });
            localStorage.removeItem(configStorageKey);
            writeClientConfig({});
            toggleModal(false);
            addMessage('配置已从数据库与浏览器清空，将使用后端默认配置。', 'ai', true);
        } catch (error) {
            addMessage(error.message || '配置清空失败，请稍后重试。', 'ai', true);
        }
    });

    Promise.resolve()
        .then(() => syncConfigFromServer())
        .then(() => initConversation())
        .catch(error => {
            addMessage(error.message || '初始化失败，请刷新后重试。', 'ai', true);
        });
});
