document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('future-mode-root');
    if (!root) return;
    const dock = root.dataset.inlineDock ? window.WendaoDock : null;
    const namePrivacy = window.AINamePrivacy;

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

    const conversationSelect = document.getElementById('conversationSelect');
    const newConversationBtn = document.getElementById('newConversationBtn');
    const deleteConversationBtn = document.getElementById('deleteConversationBtn');

    const promptChips = document.querySelectorAll('.future-prompt-chip');

    const defaultGreeting = `你好，我是 ${root.dataset.classroomName || '当前班级'} 的闻道智能。\n你可以直接提需求，我会在需要时向你申请工具授权。`;

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
    const pendingTransferKey = `wendao-workspace-pending:${classroomId}`;
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const scrollToBottom = () => {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    };

    const wakeSiri = () => {
        if (dock) return;
        clearTimeout(siriDismissTimeout);
        siriDismissTimeout = null;
        if (isSiriActive) return;
        isSiriActive = true;
        glowContainer.classList.add('active');
    };

    const dismissSiri = () => {
        if (dock) return;
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

    const fireMessageRipple = () => {
        const ripple = document.createElement('div');
        ripple.className = 'message-ripple';
        appScreen.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    };

    const startThinkingAnimation = (withRipple = false) => {
        if (dock) return;
        wakeSiri();
        if (withRipple) {
            fireMessageRipple();
        }
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
        if (dock) return addMessage(text, 'ai');
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
        if (dock) return;
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
        const data = namePrivacy.decode(await response.json());
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
        return { eventName, payload: namePrivacy.decode(payload) };
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
            dock?.conversation(activeConversationId);
        }
        if (Array.isArray(result.conversations)) {
            renderConversationOptions(result.conversations);
        }
    };

    const renderApprovalCards = async () => {
        if (!approvalState.calls.length) return;
        const interactiveCalls = approvalState.calls;

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
        setBusy(true);
        await dock?.run();
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
            });
            removePendingMessage();
            await processResult(result);
        } catch (error) {
            removePendingMessage();
            approvalState = {token:'',calls:[],decisions:{}};
            await typeAssistantMessage((error.message || '工具授权处理失败。') + ' 请检查教室现状，避免重复执行。');
        } finally { setBusy(false); refreshConnection(); await dock?.finish(!!approvalState.token); }
    };

    const handleSend = async (text) => {
        const cleaned = String(text || '').trim();
        if (!cleaned || busy || approvalState.token || !connectionState.model) return;
        if (dock && !(await dock.beforeSend(cleaned))) return;
        if (busy) return;
        setBusy(true);

        addMessage(cleaned, 'user');
        userInput.value = '';
        dock?.saveDraft();
        await dock?.run();
        hasStartedTyping = false;
        startThinkingAnimation(true);

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
                    }),
            });
            if (!response.ok || !response.body) {
                const failure = await response.json().catch(() => ({}));
                throw new Error(failure.message || '连接失败，请检查额度或稍后重试。');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let donePayload = null;
            let streamedNode = null;
            let hasDelta = false;
            let streamedText = '';

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
                        streamedText += textDelta;
                        streamedNode.textContent = namePrivacy.restoreStream(streamedText);
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
                if (streamedNode) {
                    streamedNode.textContent = doneReply || namePrivacy.restore(streamedText);
                    scrollToBottom();
                }
                return;
            }

            throw new Error('输出连接已中断，请检查对话结果后再操作。');
        } catch (error) {
            removePendingMessage();
            if (dock && !userInput.value) { userInput.value = cleaned; dock.saveDraft(); }
            await typeAssistantMessage(error.message || '发送失败，请稍后重试。');
        } finally { setBusy(false); refreshConnection(); await dock?.finish(!!approvalState.token); }
    };

    const initConversation = async () => {
        const requested = new URLSearchParams(location.search).get('conversation');
        const result = await postJson(requested ? { action: 'conversation_switch', conversation_id: requested } : { action: 'conversation_init' });
        await processResult(result);
    };

    userInput.addEventListener('focus', wakeSiri);
    userInput.addEventListener('input', () => {
        setBusy(busy);
        if (dock) return;
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
    if (dock) userInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault(); handleSend(userInput.value);
        }
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
            if (busy || approvalState.token) return;
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
            if (busy || approvalState.token) return;
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
            if (busy || approvalState.token) return;
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


    let busy = false;
    let connectionState = {};
    let refreshing = false;
    const modelSelect = document.getElementById('wendao-model');
    const statusLabel = document.getElementById('wendao-status');
    function setBusy(value) {
        busy = value;
        sendBtn.disabled = busy || !!approvalState.token || !connectionState.model || !userInput.value.trim();
        for (const control of [conversationSelect,newConversationBtn,deleteConversationBtn,modelSelect].filter(Boolean)) {
            control.disabled = busy || !!approvalState.token;
        }
        modelSelect.disabled ||= !connectionState.connected;
    }
    async function connectionApi(path, body) {
        const response = await fetch('/api/wendao/'+path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {'Content-Type':'application/json','X-CSRFToken':csrf},
            ...(body === undefined ? {} : {body:JSON.stringify(body)})
        });
        const data=await response.json();
        if (!response.ok) throw new Error(data.message || '连接失败');
        return data;
    }
    async function refreshConnection() {
        if (dock && !chatInitialized) return;
        if (refreshing || busy || approvalState.token) return;
        refreshing = true;
        try {
            connectionState = await connectionApi('status/');
            if (!connectionState.connected || connectionState.reauthorize) {
                connectionState.model='';
                modelSelect.replaceChildren(new Option('请先在设置中连接闻道智能',''));
                statusLabel.textContent=connectionState.error || '尚未连接，请打开连接设置完成授权。';
                if (dock) document.getElementById('wd-model-status').textContent = statusLabel.textContent;
                return;
            }
            const catalog=await connectionApi('models/');
            modelSelect.replaceChildren();
            catalog.models.forEach(id=>modelSelect.add(new Option(id,id)));
            if (!catalog.models.includes(connectionState.model)) {
                connectionState.model='';
                if (catalog.models.length) connectionState.model=(await connectionApi('model/',{model:catalog.models[0]})).model;
            }
            modelSelect.value=connectionState.model;
            const usage=connectionState.usage;
            const balance=usage?.balance;
            const quotas=[['period','周期'],['sliding_window','窗口']].flatMap(([key,label])=>{
                const item=usage?.[key];
                return item && item.remaining_nanousd == null ? [label+'剩余 '+(100-Math.round(Math.max(0,Math.min(100,Number(item.usage_percent || 0)))))+'%'] : [];
            });
            const detail=quotas.length ? ' · '+quotas.join(' · ') : balance?.amount_nanousd != null ? ' · 余额 '+(Number(balance.amount_nanousd)/1e9).toLocaleString('zh-CN',{maximumFractionDigits:6})+' USD' : '';
            statusLabel.textContent=connectionState.error || (!catalog.models.length ? '当前账户没有可用模型。' : '已连接闻道智能'+detail);
            if (dock) document.getElementById('wd-model-status').textContent = statusLabel.textContent;
        } catch(error) { connectionState.model=''; statusLabel.textContent=error.message; if (dock) document.getElementById('wd-model-status').textContent = error.message; }
        finally { refreshing=false; setBusy(busy); }
    }
    modelSelect.addEventListener('change', async ()=>{
        setBusy(true);
        try { connectionState.model=(await connectionApi('model/',{model:modelSelect.value})).model; }
        catch(error) { modelSelect.value=connectionState.model || ''; statusLabel.textContent=error.message; }
        finally { setBusy(false); }
    });
    window.addEventListener('focus',()=>refreshConnection());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshConnection();});
    let chatInitialized = false;
    async function initialize() {
        if (chatInitialized) return;
        chatInitialized = true; setBusy(true);
        try { await initConversation(); }
        catch (error) { addMessage(error.message, 'ai', true); }
        finally { setBusy(false); await refreshConnection(); }
        if (!dock) {
            try {
                const transfer = JSON.parse(sessionStorage.getItem(pendingTransferKey) || 'null');
                sessionStorage.removeItem(pendingTransferKey);
                if (transfer?.token && Array.isArray(transfer.calls) && Date.now() - transfer.time < 30000) {
                    approvalState = {token: transfer.token, calls: transfer.calls, decisions: transfer.decisions || {}};
                    await renderApprovalCards(); setBusy(false);
                }
            } catch (_) { sessionStorage.removeItem(pendingTransferKey); }
        }
    }
    if (dock) window.WendaoChat = { initialize, transferPending() {
        if (!approvalState.token) return;
        try { sessionStorage.setItem(pendingTransferKey, JSON.stringify({...approvalState, time:Date.now()})); } catch (_) {}
    } };
    else initialize();
});
