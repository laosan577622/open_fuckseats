(() => {
    const body = document.body;
    if (body.dataset.appShell !== 'webview') return;
    const titlebar = document.querySelector('.header-titlebar');
    const api = () => window.pywebview && window.pywebview.api;
    const interactive = 'a, button, input, select, textarea, [contenteditable], [role="button"]';
    const applyState = (state) => {
        body.dataset.windowMaximized = String(Boolean(state.maximized));
        const button = document.querySelector('[data-window-action="maximize"]');
        button.title = state.maximized ? '还原窗口' : '最大化';
        button.setAttribute('aria-label', button.title);
    };
    const reportError = () => {
        if (typeof window.showToast === 'function') window.showToast('窗口操作失败，请重试', 'error');
    };
    const syncState = () => {
        if (api()) api().get_window_state().then(applyState).catch(reportError);
    };
    window.addEventListener('pywebviewready', syncState);
    window.addEventListener('desktopwindowstate', (event) => applyState(event.detail));
    syncState();
    const action = (name) => {
        if (api()) api().window_action(name).catch(reportError);
    };
    document.querySelectorAll('[data-window-action]').forEach((button) => {
        button.addEventListener('click', () => action(button.dataset.windowAction));
    });
    titlebar.addEventListener('dblclick', (event) => {
        if (!event.target.closest(interactive)) action('maximize');
    });

    // 捕获指针，异步桥接期间只发送最新位置，避免拖动消息积压。
    let gesture = null;
    const flush = async (current) => {
        if (current.busy || !current.ready) return;
        current.busy = true;
        try {
            while (current.pending) {
                const point = current.pending;
                current.pending = null;
                await api().update_window_gesture(point.x - current.x, point.y - current.y);
            }
        } catch (_) { reportError(); }
        finally {
            current.busy = false;
            if (current.ended && gesture === current) gesture = null;
        }
    };
    const start = async (event, edge) => {
        if (event.button !== 0 || !api() || gesture || body.dataset.windowMaximized === 'true') return;
        event.preventDefault();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const current = { x: event.screenX, y: event.screenY, id: event.pointerId, ready: false, busy: false, pending: null, ended: false };
        gesture = current;
        try {
            current.ready = await api().begin_window_gesture(edge);
            if (!current.ready) { gesture = null; return; }
            await flush(current);
        } catch (_) { gesture = null; reportError(); }
    };
    titlebar.addEventListener('pointerdown', (event) => {
        if (!event.target.closest(interactive)) start(event, 'move');
    });
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((edge) => {
        const handle = document.createElement('div');
        handle.className = 'desktop-resize-edge';
        handle.dataset.edge = edge;
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', (event) => start(event, edge));
        body.appendChild(handle);
    });
    window.addEventListener('pointermove', (event) => {
        if (!gesture || gesture.ended || event.pointerId !== gesture.id) return;
        gesture.pending = { x: event.screenX, y: event.screenY };
        flush(gesture);
    });
    const finish = (event) => {
        if (!gesture || event.pointerId !== gesture.id) return;
        if (event.type === 'pointerup') gesture.pending = { x: event.screenX, y: event.screenY };
        gesture.ended = true;
        flush(gesture);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('lostpointercapture', finish);
})();
