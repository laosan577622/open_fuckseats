(function () {
    'use strict';

    if (window.showConfirmModal && window.showPromptModal) return;

    var MODAL_ID = 'generic-dialog-modal';
    var _resolver = null;

    // 全局 modal 开关，供全站页面复用（classroom.js 等直接引用 window.openModal/closeModal）。
    if (typeof window.openModal !== 'function') {
        window.openModal = function (modalId) {
            if (!modalId) return;
            var modal = document.getElementById(modalId);
            if (!modal) return;
            // 关闭动画尚未结束就再次打开时，撤销遗留的隐藏回调，否则新打开的弹窗会被立刻隐藏。
            cancelPendingClose(modal);
            if (!modal.classList.contains('modal-visible')) {
                var active = document.activeElement;
                modal._returnFocus = active && active !== document.body && !modal.contains(active) ? active : null;
            }
            modal.style.display = 'flex';
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (modal.style.display === 'none') return;
                    modal.classList.add('modal-visible');
                });
            });
        };
    }
    if (typeof window.closeModal !== 'function') {
        window.closeModal = function (modalId) {
            if (!modalId) return;
            var modal = document.getElementById(modalId);
            if (!modal) return;
            cancelPendingClose(modal);
            modal.classList.remove('modal-visible');
            var content = modal.querySelector('.modal-content');
            var finish = function () {
                cancelPendingClose(modal);
                if (modal.classList.contains('modal-visible')) return;
                modal.style.display = 'none';
            };
            var onEnd = function (e) {
                if (e.target === content) finish();
            };
            modal._closeOnEnd = onEnd;
            modal.addEventListener('transitionend', onEnd);
            // 兜底：无过渡动画时也能关闭。
            modal._closeTimer = setTimeout(finish, 350);
            restoreFocus(modal);
        };
    }

    function cancelPendingClose(modal) {
        if (modal._closeOnEnd) modal.removeEventListener('transitionend', modal._closeOnEnd);
        if (modal._closeTimer) clearTimeout(modal._closeTimer);
        modal._closeOnEnd = null;
        modal._closeTimer = null;
    }

    function restoreFocus(modal) {
        var target = modal._returnFocus;
        modal._returnFocus = null;
        var active = document.activeElement;
        // 只有焦点仍停留在弹窗内（或已丢失）时才归还，避免抢走用户已经移到别处的焦点。
        if (!target || !target.isConnected || (active && active !== document.body && !modal.contains(active))) return;
        try { target.focus({ preventScroll: true }); } catch (_) {}
    }

    function isModalShown(modal) {
        return modal.classList.contains('modal-visible') && modal.style.display !== 'none';
    }

    function topVisibleModal() {
        var modals = document.querySelectorAll('.modal.modal-visible');
        for (var i = modals.length - 1; i >= 0; i--) {
            if (isModalShown(modals[i])) return modals[i];
        }
        return null;
    }

    // Esc 关闭最上层弹窗：点击它自己的取消/关闭按钮，让各弹窗原有的清理与 resolve 逻辑照常执行。
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
        var modal = topVisibleModal();
        if (!modal) return;
        var dismiss = modal.id === MODAL_ID
            ? document.getElementById('genericDialogCancel')
            : modal.querySelector('[data-close-modal], [data-modal-cancel], .modal-close-btn, button[id$="Cancel"]');
        if (!dismiss || dismiss.disabled) return;
        event.preventDefault();
        dismiss.click();
    });

    function ensureDom() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            bindBackdropCancel(modal);
            return modal;
        }
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'genericDialogTitle');
        modal.style.display = 'none';
        modal.innerHTML =
            '<div class="modal-content modal-compact">' +
                '<h3 id="genericDialogTitle" class="modal-title"></h3>' +
                '<p id="genericDialogMessage" class="modal-desc modal-message"></p>' +
                '<input type="text" id="genericDialogInput" class="modal-field modal-dialog-input" aria-labelledby="genericDialogMessage" style="display:none">' +
                '<div class="modal-actions">' +
                    '<button type="button" class="btn btn-secondary" id="genericDialogCancel">取消</button>' +
                    '<button type="button" class="btn btn-primary" id="genericDialogOk">确定</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        bindBackdropCancel(modal);
        return modal;
    }

    function bindBackdropCancel(modal) {
        if (modal.dataset.backdropBound) return;
        modal.dataset.backdropBound = '1';
        // 只认按下与松开都落在遮罩上的点击，避免在输入框里拖选文字时误关。
        var pressedOnBackdrop = false;
        modal.addEventListener('pointerdown', function (event) {
            pressedOnBackdrop = event.target === modal;
        });
        modal.addEventListener('click', function (event) {
            if (event.target !== modal || !pressedOnBackdrop) return;
            var cancel = document.getElementById('genericDialogCancel');
            if (cancel) cancel.click();
        });
    }

    function focusLater(element) {
        requestAnimationFrame(function () {
            if (element && element.isConnected) element.focus({ preventScroll: true });
        });
    }

    function freshButtons() {
        var ok = document.getElementById('genericDialogOk');
        var cancel = document.getElementById('genericDialogCancel');
        var input = document.getElementById('genericDialogInput');
        // 克隆重建以清除上一次的监听。
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        input.replaceWith(input.cloneNode(true));
        return {
            ok: document.getElementById('genericDialogOk'),
            cancel: document.getElementById('genericDialogCancel'),
            input: document.getElementById('genericDialogInput')
        };
    }

    function closeDialog() {
        window.closeModal(MODAL_ID);
        _resolver = null;
    }

    function showConfirmModal(message, options) {
        options = options || {};
        var title = options.title || '确认操作';
        var okText = options.okText || '确定';
        var cancelText = options.cancelText || '取消';
        var danger = options.danger === true;
        return new Promise(function (resolve) {
            ensureDom();
            document.getElementById('genericDialogTitle').textContent = title;
            document.getElementById('genericDialogMessage').textContent = message;
            var refs = freshButtons();
            refs.input.style.display = 'none';
            refs.ok.textContent = okText;
            refs.cancel.textContent = cancelText;
            refs.ok.classList.toggle('btn-danger', danger);
            _resolver = resolve;
            refs.ok.addEventListener('click', function () { closeDialog(); resolve(true); });
            refs.cancel.addEventListener('click', function () { closeDialog(); resolve(false); });
            window.openModal(MODAL_ID);
            // 危险操作默认聚焦“取消”，防止误按 Enter 直接删除。
            focusLater(danger ? refs.cancel : refs.ok);
        });
    }

    function showPromptModal(message, options) {
        options = options || {};
        var title = options.title || '请输入';
        var defaultValue = options.defaultValue || '';
        var okText = options.okText || '确定';
        var cancelText = options.cancelText || '取消';
        return new Promise(function (resolve) {
            ensureDom();
            document.getElementById('genericDialogTitle').textContent = title;
            document.getElementById('genericDialogMessage').textContent = message;
            var refs = freshButtons();
            refs.input.style.display = '';
            refs.input.value = defaultValue;
            refs.ok.textContent = okText;
            refs.cancel.textContent = cancelText;
            _resolver = resolve;
            var submit = function () { closeDialog(); resolve(refs.input.value); };
            refs.ok.addEventListener('click', submit);
            refs.input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
            });
            refs.cancel.addEventListener('click', function () { closeDialog(); resolve(null); });
            window.openModal(MODAL_ID);
            requestAnimationFrame(function () { refs.input.focus(); refs.input.select(); });
        });
    }

    // 云同步冲突等“二选一”场景：主按钮=本地，危险次按钮=云端，取消=中止。
    // resolve('local' | 'cloud' | 'cancel')
    function showChoiceModal(message, options) {
        options = options || {};
        var title = options.title || '请选择';
        var primaryText = options.primaryText || '保留本地版本';
        var altText = options.altText || '使用云端版本';
        var cancelText = options.cancelText || '取消';
        return new Promise(function (resolve) {
            ensureDom();
            document.getElementById('genericDialogTitle').textContent = title;
            document.getElementById('genericDialogMessage').textContent = message;
            var refs = freshButtons();
            refs.input.style.display = 'none';

            refs.ok.textContent = primaryText;
            refs.ok.classList.remove('btn-danger');

            // 复用 cancel 按钮位，额外插入一个“云端”按钮。
            refs.cancel.textContent = cancelText;
            var alt = document.createElement('button');
            alt.type = 'button';
            alt.className = 'btn btn-danger';
            alt.textContent = altText;
            refs.cancel.parentNode.insertBefore(alt, refs.cancel);

            var done = function (choice) {
                if (alt.parentNode) alt.parentNode.removeChild(alt);
                closeDialog();
                resolve(choice);
            };
            refs.ok.addEventListener('click', function () { done('local'); });
            alt.addEventListener('click', function () { done('cloud'); });
            refs.cancel.addEventListener('click', function () { done('cancel'); });
            window.openModal(MODAL_ID);
            focusLater(refs.ok);
        });
    }

    window.showConfirmModal = showConfirmModal;
    window.showPromptModal = showPromptModal;
    window.showChoiceModal = showChoiceModal;
})();
