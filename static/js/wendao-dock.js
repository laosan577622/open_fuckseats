(() => {
    'use strict';
    // 闻道智能左侧栏：顶栏按钮开合侧栏；建议、对话、输入框都在侧栏里。
    // 对话本身由 ai_workspace.js 驱动，这里只负责侧栏状态，并通过 window.WendaoDock 与它衔接。
    const root = document.getElementById('future-mode-root');
    if (!root?.dataset.inlineDock) return;
    const side = document.getElementById('wd-side');
    const launch = document.getElementById('wd-launch');
    const orb = document.getElementById('wd-orb');
    const gear = document.getElementById('wd-model-trigger');
    const modelPanel = document.getElementById('wd-model-panel');
    const modelSelect = document.getElementById('wendao-model');
    const modelName = document.getElementById('wd-model-name');
    const composer = document.getElementById('future-chat-form');
    const input = document.getElementById('userInput');
    const scroller = document.getElementById('wd-side-scroll');
    const messages = document.getElementById('chatContainer');
    const block = document.getElementById('wd-suggestions');
    const list = document.getElementById('wd-suggestion-list');
    const status = document.getElementById('wd-suggestion-status');
    const sideOrb = document.getElementById('wd-side-orb');
    const notice = launch.querySelector('.wd-notice');
    const draftKey = `wendao-draft:${root.dataset.classroomId}`;
    const ignoredKey = `wendao-suggestions:${root.dataset.classroomId}`;
    const openKey = 'wendao-side-open';
    let isOpen = false, initialized = false, initPromise, running = false, awaitingApproval = false, suggestionBusy = false;
    let items = [], rawItems = [], actions = {}, ignored = new Set();
    const seen = new Set();

    try { input.value = sessionStorage.getItem(draftKey) || ''; ignored = new Set(JSON.parse(sessionStorage.getItem(ignoredKey) || '[]')); } catch (_) {}
    function saveDraft() { try { sessionStorage.setItem(draftKey, input.value); } catch (_) {} }
    function saveIgnored() { try { sessionStorage.setItem(ignoredKey, JSON.stringify([...ignored])); } catch (_) {} }
    function key(item) { return JSON.stringify([item.type || '', item.message || '', item.action_url || '']); }
    function allowed(item) {
        try { return localStorage.getItem(item.type === 'export_suggestion' ? 'seats_show_group_completion_suggestion' : 'seats_show_layout_suggestions') !== '0'; } catch (_) { return true; }
    }
    function ensureChat() {
        if (initialized) return initPromise;
        if (!window.WendaoChat) return Promise.resolve();
        initialized = true;
        initPromise = window.WendaoChat?.initialize();
        return initPromise;
    }

    // 输入框随内容长高，最多 6 行（AIComposer 规范）
    function autosize() {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    }
    input.addEventListener('input', () => { saveDraft(); autosize(); });
    input.addEventListener('focus', ensureChat);

    function setState(state) {
        composer.dataset.state = state;
        if (state === 'idle') sideOrb.removeAttribute('data-state'); else sideOrb.dataset.state = state;
        launch.classList.toggle('wd-running', state !== 'idle');
    }

    function setOpen(next, {focus = true, remember = true} = {}) {
        if (isOpen === next) return;
        isOpen = next;
        side.classList.toggle('is-open', next);
        document.body.classList.toggle('wd-side-open', next);
        side.toggleAttribute('inert', !next);
        side.setAttribute('aria-hidden', String(!next));
        launch.setAttribute('aria-expanded', String(next));
        if (remember) { try { localStorage.setItem(openKey, next ? '1' : '0'); } catch (_) {} }
        if (next) {
            notice.hidden = true;
            delete launch.dataset.replyPending;
            ensureChat();
            autosize();
            scroller.scrollTop = scroller.scrollHeight;
            if (focus && !running) input.focus({preventScroll: true});
        } else {
            toggleModel(false);
            if (side.contains(document.activeElement)) launch.focus({preventScroll: true});
        }
        updateOrb();
    }

    function toggleModel(force) {
        const next = force ?? modelPanel.hidden;
        modelPanel.hidden = !next;
        gear.setAttribute('aria-expanded', String(next));
        if (next) modelSelect.focus({preventScroll: true});
    }
    function syncModelName() {
        const option = modelSelect.selectedOptions[0];
        modelName.textContent = option?.value ? option.textContent : '选择模型';
    }
    new MutationObserver(syncModelName).observe(modelSelect, {childList: true});
    modelSelect.addEventListener('change', () => { syncModelName(); toggleModel(false); input.focus({preventScroll: true}); });

    // 顶栏的建议按钮只是计数徽标：有建议时出现，点击打开侧栏并定位到建议
    function updateOrb() {
        const visible = !isOpen && (items.length > 0 || suggestionBusy);
        orb.hidden = !visible;
        const count = orb.querySelector('.wd-count');
        count.textContent = items.length > 1 ? String(items.length) : '';
        count.hidden = items.length < 2;
        orb.setAttribute('aria-label', `排座建议，${items.length} 条`);
        block.hidden = !items.length && !status.textContent;
    }

    function renderSuggestions() {
        const signature = JSON.stringify(items.map(key));
        if (list.dataset.signature === signature) { updateOrb(); return; }
        list.dataset.signature = signature;
        list.replaceChildren();
        items.forEach(item => {
            const card = document.createElement('article'); card.className = 'wd-suggestion';
            const heading = document.createElement('div'); heading.className = 'wd-suggestion-heading';
            heading.textContent = item.type === 'export_suggestion' ? '分组完成提示' : '优化建议';
            const text = document.createElement('p'); text.textContent = item.message;
            const row = document.createElement('div'); row.className = 'wd-suggestion-actions';
            if (item.action_label && ['group_balance', 'export_suggestion'].includes(item.type)) {
                const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'wd-chip wd-chip--primary'; apply.textContent = item.action_label;
                apply.addEventListener('click', () => executeSuggestion(item)); row.append(apply);
            }
            const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'wd-chip'; dismiss.textContent = item.ignore_label || '忽略';
            dismiss.addEventListener('click', async () => {
                dismiss.disabled = true;
                try {
                    if (item.ignore_url && item.ignore_url !== '#') await actions.dismiss(item);
                    ignored.add(key(item)); saveIgnored();
                    status.textContent = '';
                    await collapse(card);
                    setSuggestions(rawItems, actions);
                } catch (error) { status.textContent = error.message; dismiss.disabled = false; }
            });
            row.append(dismiss);
            card.append(heading, text, row);
            list.append(card);
        });
        updateOrb();
    }
    function collapse(card) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
        const height = card.getBoundingClientRect().height;
        card.style.overflow = 'hidden';
        const motion = card.animate([{opacity: 1, height: `${height}px`}, {opacity: 0, height: '0px', marginBottom: '-8px'}], {duration: 240, easing: 'cubic-bezier(.2,0,0,1)', fill: 'forwards'});
        return Promise.race([motion.finished.catch(() => {}), new Promise(done => setTimeout(done, 400))]);
    }
    function setSuggestions(incoming, handlers) {
        rawItems = incoming || []; actions = handlers || actions;
        const normalized = rawItems.map(item => typeof item === 'string' ? {message: item} : item).filter(item => item && allowed(item));
        items = [...new Map(normalized.filter(item => !ignored.has(key(item))).map(item => [key(item), item])).values()];
        const fresh = items.some(item => !seen.has(key(item)));
        normalized.forEach(item => seen.add(key(item)));
        renderSuggestions();
        if (fresh && !isOpen) { orb.classList.remove('wd-born'); void orb.offsetWidth; orb.classList.add('wd-born'); }
    }
    async function executeSuggestion(item) {
        if (suggestionBusy || running || awaitingApproval) { status.textContent = '请先完成或拒绝闻道当前操作，再执行建议。'; updateOrb(); return; }
        suggestionBusy = true;
        list.querySelectorAll('button').forEach(button => { button.disabled = true; });
        setState('thinking');
        try {
            const result = await actions.execute(item);
            if (result?.status !== 'cancelled') { ignored.add(key(item)); saveIgnored(); }
            status.textContent = result?.status === 'cancelled' ? '已取消保存，建议仍然保留。' : '';
        } catch (error) { status.textContent = error.message || '操作失败，请检查当前座位后重试。'; }
        finally {
            suggestionBusy = false; setState('idle');
            delete list.dataset.signature;
            setSuggestions(rawItems, actions);
        }
    }

    launch.addEventListener('click', () => setOpen(!isOpen));
    orb.addEventListener('click', () => { setOpen(true, {focus: false}); block.scrollIntoView({block: 'start', behavior: 'smooth'}); list.querySelector('button')?.focus({preventScroll: true}); });
    gear.addEventListener('click', () => toggleModel());
    side.querySelector('[data-wd-close]').addEventListener('click', () => setOpen(false));
    document.getElementById('btn-open-future-mode')?.addEventListener('click', event => { event.preventDefault(); setOpen(true); });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing || !isOpen) return;
        if (!modelPanel.hidden) { event.preventDefault(); toggleModel(false); gear.focus({preventScroll: true}); }
        else if (side.contains(document.activeElement)) { event.preventDefault(); setOpen(false); }
    });
    document.addEventListener('pointerdown', event => {
        if (!modelPanel.hidden && !modelPanel.contains(event.target) && !gear.contains(event.target)) toggleModel(false);
    });
    window.addEventListener('storage', event => { if (event.key?.startsWith('seats_show_')) setSuggestions(rawItems, actions); });

    let leavingForWorkspace = false;
    document.getElementById('wd-full-workspace').addEventListener('click', () => {
        window.WendaoChat?.transferPending();
        leavingForWorkspace = true;
    });
    window.addEventListener('beforeunload', event => { if (!leavingForWorkspace && (running || awaitingApproval || suggestionBusy)) { event.preventDefault(); event.returnValue = ''; } });

    window.WendaoDock = {
        open(kind) { setOpen(true, {focus: kind !== 'suggestions'}); },
        setSuggestions, saveDraft,
        async run() {
            running = true; awaitingApproval = false;
            setState('thinking');
            autosize();
        },
        async finish(needsApproval) {
            awaitingApproval = !!needsApproval;
            running = false; setState('idle');
            if (needsApproval) document.getElementById('wendao-status').textContent = '需要你的授权才能继续。';
            saveDraft(); autosize();
            if (!isOpen) { notice.hidden = false; launch.dataset.replyPending = needsApproval ? 'approval' : 'complete'; }
            else scroller.scrollTop = scroller.scrollHeight;
            window.refreshState?.();
        },
        async beforeSend(text) {
            await ensureChat();
            if (suggestionBusy) return false;
            // 快捷命令有直接执行路径，在进入该路径前明确确认，避免绕过工具授权。
            if (/^[\/／]/.test(text)) return window.confirm(`执行此班级命令？\n${text}\n命令可能直接修改当前班级数据。`);
            return true;
        },
        conversation(id) {
            document.getElementById('wd-full-workspace').search = `conversation=${encodeURIComponent(id)}`;
        }
    };

    // 对话区内容变化时贴底滚动（用户往上翻时不打扰）
    let pinned = true;
    scroller.addEventListener('scroll', () => { pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48; }, {passive: true});
    new MutationObserver(() => { if (pinned) scroller.scrollTop = scroller.scrollHeight; }).observe(messages, {childList: true, subtree: true, characterData: true});

    updateOrb();
    // 上次离开时侧栏开着就保持打开；窄窗口里侧栏会盖住座位，不自动展开
    let remembered = false;
    try { remembered = localStorage.getItem(openKey) === '1'; } catch (_) {}
    // 对话引擎在本脚本之后加载，等页面脚本都执行完再恢复
    if (remembered && matchMedia('(min-width: 1101px)').matches) window.addEventListener('DOMContentLoaded', () => {
        side.classList.add('wd-no-motion');
        document.body.classList.add('wd-no-motion');
        setOpen(true, {focus: false, remember: false});
        requestAnimationFrame(() => requestAnimationFrame(() => { side.classList.remove('wd-no-motion'); document.body.classList.remove('wd-no-motion'); }));
    });
})();
