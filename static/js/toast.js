(function () {
    'use strict';

    var MAX_VISIBLE = 4;
    var MAX_TOASTS = 8;
    var DEFAULT_DURATION = 3000;
    var SWIPE_THRESHOLD = 60;
    var stackOffset = 0;

    var _frontToast = null;
    var _frontTimerId = null;
    var _frontSince = 0;

    function getContainer() {
        return document.getElementById('toast-container');
    }

    function getActiveToasts() {
        var container = getContainer();
        if (!container) return [];
        return Array.from(container.querySelectorAll('.toast-notification:not(.toast-exit)'));
    }

    function getCountBadge() {
        var container = getContainer();
        if (!container) return null;
        var badge = container.querySelector('.toast-stack-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'toast-stack-badge';
            container.appendChild(badge);
        }
        return badge;
    }

    function getVisuals(reverseIdx, total) {
        if (reverseIdx >= MAX_VISIBLE) {
            return { y: -8, z: -80, rx: 12, scale: 0.82, opacity: 0, blur: 3, zIdx: 0 };
        }
        var t = reverseIdx / Math.max(total - 1, 1);
        return {
            y: reverseIdx * -10,
            z: reverseIdx * -40,
            rx: reverseIdx * 4,
            scale: 1 - reverseIdx * 0.05,
            opacity: 1 - reverseIdx * 0.2,
            blur: reverseIdx * 0.8,
            zIdx: total - reverseIdx
        };
    }

    function applyVisuals(toast, v, transition) {
        if (transition) {
            toast.style.transition = 'transform 0.45s var(--spring-default, cubic-bezier(0.4,0,0.2,1)), ' +
                'opacity 0.4s ease, filter 0.4s ease, box-shadow 0.4s ease';
        }
        toast.style.transform = 'translateY(' + v.y + 'px) translateZ(' + v.z + 'px) rotateX(' + v.rx + 'deg) scale(' + v.scale + ')';
        toast.style.opacity = String(Math.max(0, v.opacity));
        toast.style.filter = v.blur > 0.01 ? 'blur(' + v.blur + 'px)' : '';
        toast.style.zIndex = String(v.zIdx);
        toast.style.pointerEvents = v.zIdx > 0 && v.opacity > 0.5 ? 'auto' : 'none';
        var shadow = v.zIdx > 0
            ? '0 ' + (8 + v.zIdx * 2) + 'px ' + (24 + v.zIdx * 4) + 'px rgba(0,0,0,' + (0.08 + v.zIdx * 0.02) + ')'
            : '0 4px 12px rgba(0,0,0,0.06)';
        toast.style.boxShadow = shadow;
    }

    function updateStack() {
        var toasts = getActiveToasts();
        var total = toasts.length;

        var badge = getCountBadge();
        if (badge) {
            if (total > 1) {
                badge.textContent = total + ' 条通知';
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        if (total === 0) { syncFrontTimer(); return; }

        var safeOffset = ((stackOffset % total) + total) % total;

        for (var i = 0; i < total; i++) {
            var reverseIdx = total - 1 - ((i + safeOffset) % total);
            applyVisuals(toasts[i], getVisuals(reverseIdx, total), true);
        }
        syncFrontTimer();
    }

    function dismissToast(toast) {
        if (toast.classList.contains('toast-exit')) return;
        if (toast === _frontToast) clearFrontTimer();
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            stackOffset = 0;
            updateStack();
        });
    }

    function enforceLimit() {
        var toasts = getActiveToasts();
        while (toasts.length > MAX_TOASTS) {
            dismissToast(toasts.shift());
        }
    }

    function syncFrontTimer() {
        var toasts = getActiveToasts();
        var total = toasts.length;
        if (total === 0) { clearFrontTimer(); return; }
        var safeOffset = ((stackOffset % total) + total) % total;
        var front = null;
        for (var i = 0; i < total; i++) {
            if (total - 1 - ((i + safeOffset) % total) === 0) { front = toasts[i]; break; }
        }
        if (front === _frontToast) return;
        if (_frontToast && _frontTimerId !== null) {
            _frontToast._frontElapsed = (_frontToast._frontElapsed || 0) + (Date.now() - _frontSince);
            clearTimeout(_frontTimerId);
            _frontTimerId = null;
        }
        _frontToast = front;
        if (!front || !front._toastDuration || front._toastDuration <= 0) return;
        var remaining = front._toastDuration - (front._frontElapsed || 0);
        if (remaining <= 0) { dismissToast(front); return; }
        _frontSince = Date.now();
        _frontTimerId = setTimeout(function () { _frontTimerId = null; dismissToast(front); }, remaining);
    }

    function clearFrontTimer() {
        if (_frontTimerId !== null) { clearTimeout(_frontTimerId); _frontTimerId = null; }
        _frontToast = null;
    }

    function initSwipeToDismiss(toast) {
        var startX = 0, currentX = 0, isDragging = false;

        function onStart(e) {
            isDragging = true;
            startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
            currentX = startX;
            toast.style.transition = 'none';
        }
        function onMove(e) {
            if (!isDragging) return;
            currentX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
            var dx = currentX - startX;
            if (dx < 0) dx = 0;
            var pct = dx / 200;
            toast.style.transform = 'translateX(' + dx + 'px) rotateY(' + (pct * 20) + 'deg) scale(' + (1 - pct * 0.08) + ')';
            toast.style.opacity = String(Math.max(0, 1 - pct));
        }
        function onEnd() {
            if (!isDragging) return;
            isDragging = false;
            toast.style.transition = '';
            if (currentX - startX > SWIPE_THRESHOLD) {
                dismissToast(toast);
            } else {
                toast.style.transform = '';
                toast.style.opacity = '';
                updateStack();
            }
        }

        toast.addEventListener('mousedown', onStart);
        toast.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
    }

    var wheelAccumY = 0;
    var wheelStopTimer = null;
    var isWheelScrolling = false;
    var WHEEL_STOP_DELAY = 200;

    function previewShift(toasts, dir) {
        var total = toasts.length;
        if (total <= 1) return;
        var curOff = ((stackOffset % total) + total) % total;
        var nxtOff = (((stackOffset + dir) % total) + total) % total;

        for (var i = 0; i < total; i++) {
            var curRev = total - 1 - ((i + curOff) % total);
            var nxtRev = total - 1 - ((i + nxtOff) % total);
            var cur = getVisuals(curRev, total);
            var nxt = getVisuals(nxtRev, total);
            var goingFront = nxtRev < curRev;
            var t = 0.4;
            var v = {
                y: cur.y + (nxt.y - cur.y) * t,
                z: cur.z + (nxt.z - cur.z) * t + (goingFront ? 20 : -20) * t,
                rx: cur.rx + (nxt.rx - cur.rx) * t + (goingFront ? -12 : 8) * t,
                scale: cur.scale + (nxt.scale - cur.scale) * t,
                opacity: cur.opacity + (nxt.opacity - cur.opacity) * t,
                blur: cur.blur + (nxt.blur - cur.blur) * t,
                zIdx: goingFront ? Math.max(cur.zIdx, nxt.zIdx) : Math.min(cur.zIdx, nxt.zIdx)
            };
            toasts[i].style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease, filter 0.3s ease, box-shadow 0.3s ease';
            applyVisuals(toasts[i], v, false);
        }
    }

    function commitWheelSwitch(dir) {
        var toasts = getActiveToasts();
        if (toasts.length <= 1) return;
        stackOffset += dir;
        var total = toasts.length;
        var safeOffset = ((stackOffset % total) + total) % total;

        for (var i = 0; i < total; i++) {
            var reverseIdx = total - 1 - ((i + safeOffset) % total);
            var v = getVisuals(reverseIdx, total);
            var goingFront = reverseIdx === 0;
            toasts[i].style.transition = 'none';
            var midRx = goingFront ? -15 : 10;
            var midZ = goingFront ? 30 : v.z - 30;
            toasts[i].style.transform = 'translateY(' + v.y + 'px) translateZ(' + midZ + 'px) rotateX(' + midRx + 'deg) scale(' + (v.scale * 0.95) + ')';
            toasts[i].style.opacity = String(v.opacity * 0.8);
        }

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                for (var i = 0; i < toasts.length; i++) {
                    var reverseIdx = total - 1 - ((i + safeOffset) % total);
                    toasts[i].style.transition = 'transform 0.4s var(--spring-default, cubic-bezier(0.4,0,0.2,1)), ' +
                        'opacity 0.35s ease, filter 0.35s ease, box-shadow 0.35s ease';
                    applyVisuals(toasts[i], getVisuals(reverseIdx, total), false);
                }
                syncFrontTimer();
            });
        });
    }

    function initWheelCycle() {
        var container = getContainer();
        if (!container) return;
        container.addEventListener('wheel', function (e) {
            var toasts = getActiveToasts();
            if (toasts.length <= 1) return;
            e.preventDefault();
            wheelAccumY += e.deltaY;
            if (!isWheelScrolling) isWheelScrolling = true;
            previewShift(toasts, wheelAccumY > 0 ? 1 : -1);
            clearTimeout(wheelStopTimer);
            wheelStopTimer = setTimeout(function () {
                commitWheelSwitch(wheelAccumY > 0 ? 1 : -1);
                wheelAccumY = 0;
                isWheelScrolling = false;
            }, WHEEL_STOP_DELAY);
        }, { passive: false });
    }

    window.showToast = function (message, options) {
        var container = getContainer();
        if (!container) return;
        var opts = Object.assign({ duration: DEFAULT_DURATION, title: '提示' }, options);

        var toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML =
            '<div class="toast-header">' +
                '<span>' + opts.title + '</span>' +
                '<span class="toast-time">刚刚</span>' +
            '</div>' +
            '<div class="toast-body">' + message + '</div>';

        initSwipeToDismiss(toast);
        toast._toastDuration = opts.duration;
        toast._frontElapsed = 0;

        container.appendChild(toast);
        stackOffset = 0;
        enforceLimit();
        updateStack();
    };

    window.updateToastStack = updateStack;
    window.dismissToastElement = dismissToast;

    initWheelCycle();
})();
