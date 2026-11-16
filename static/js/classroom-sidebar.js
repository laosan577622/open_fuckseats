/* 班级详情侧栏：拖拽分隔条调整宽度，按钮 / 菜单 / 快捷键收起与展开。
   只在宽屏并排布局（≥1101px）生效；宽度由 CSS 变量 --classroom-side-pref 驱动，
   实际宽度的上下限在 classroom-workspace.css 里用 clamp() 约束，窗口缩放时无需脚本参与。
   本文件在侧栏标记之前同步加载，先把上次的宽度和收起状态写到 <html>，避免进入页面时跳动。 */
(function () {
    'use strict';

    var WIDTH_KEY = 'fuckseats_classroom_side_width';
    var COLLAPSED_KEY = 'fuckseats_classroom_side_collapsed';
    var DEFAULT_WIDTH = 430;
    var MIN_WIDTH = 300;
    var MAX_WIDTH = 720;
    var STAGE_RESERVE = 520;
    var COLLAPSE_AT = 180;
    var KEY_STEP = 16;
    var MOTION_MS = 240;
    var WIDE_QUERY = '(min-width: 1101px)';
    var root = document.documentElement;

    function read(key) {
        try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }
    function write(key, value) {
        try { window.localStorage.setItem(key, value); } catch (_) { /* 存不下时只影响下次打开 */ }
    }
    function maxWidth() {
        return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - STAGE_RESERVE));
    }
    function clampWidth(value) {
        if (!isFinite(value)) return DEFAULT_WIDTH;
        return Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value)));
    }

    var preferred = clampWidth(parseFloat(read(WIDTH_KEY)));
    var collapsed = read(COLLAPSED_KEY) === '1';

    function apply() {
        root.style.setProperty('--classroom-side-pref', preferred + 'px');
        root.classList.toggle('classroom-side-collapsed', collapsed);
    }
    apply();

    function init() {
        var panel = document.querySelector('.classroom-layout > .side-panel');
        var resizer = document.getElementById('classroom-side-resizer');
        var toggle = document.getElementById('btn-toggle-side-panel');
        if (!panel || !resizer || !toggle) return;
        var wide = window.matchMedia ? window.matchMedia(WIDE_QUERY) : { matches: true };
        var relayoutFrame = 0;

        // 座位密度、工具栏收起等都监听 resize；侧栏变宽变窄后通知它们重新计算。
        function relayout() {
            if (relayoutFrame) return;
            relayoutFrame = requestAnimationFrame(function () {
                relayoutFrame = 0;
                window.dispatchEvent(new Event('resize'));
            });
        }
        // 收起 / 展开动画：逐帧把当前宽度写到 --classroom-side-live，结束后交还给 CSS。
        var motion = null;
        function finishMotion() {
            if (!motion) return;
            cancelAnimationFrame(motion.frame);
            clearTimeout(motion.fallback);
            motion = null;
            root.style.removeProperty('--classroom-side-live');
            root.classList.remove('is-side-animating');
            window.dispatchEvent(new Event('resize'));
        }
        function animateWidth(from, to) {
            finishMotion();
            var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce || !wide.matches || Math.abs(from - to) < 1) {
                relayout();
                return;
            }
            var start = performance.now();
            root.classList.add('is-side-animating');
            root.style.setProperty('--classroom-side-live', from + 'px');
            motion = {
                frame: 0,
                // 页面在后台时不会有动画帧，到点直接落到终态。
                fallback: setTimeout(finishMotion, MOTION_MS + 200),
            };
            (function step(now) {
                if (!motion) return;
                var progress = Math.min(1, Math.max(0, ((now || performance.now()) - start) / MOTION_MS));
                var eased = 1 - Math.pow(1 - progress, 3);
                root.style.setProperty('--classroom-side-live', (from + (to - from) * eased).toFixed(1) + 'px');
                window.dispatchEvent(new Event('resize'));
                if (progress >= 1) finishMotion();
                else motion.frame = requestAnimationFrame(step);
            })(start);
        }
        function renderedWidth() {
            return wide.matches ? panel.getBoundingClientRect().width : 0;
        }

        function syncControls() {
            var width = Math.min(preferred, maxWidth());
            resizer.setAttribute('aria-valuemin', String(MIN_WIDTH));
            resizer.setAttribute('aria-valuemax', String(maxWidth()));
            resizer.setAttribute('aria-valuenow', String(collapsed ? 0 : width));
            resizer.setAttribute('aria-valuetext', collapsed ? '侧栏已收起' : '侧栏宽度 ' + width + ' 像素');
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
            toggle.title = collapsed ? '展开侧栏' : '收起侧栏';
            // 收起后侧栏不可见，里面的控件不能再接收焦点。
            if (collapsed && wide.matches) panel.setAttribute('inert', '');
            else panel.removeAttribute('inert');
        }

        function setWidth(value, persist) {
            finishMotion();
            preferred = Math.min(clampWidth(value), maxWidth());
            apply();
            syncControls();
            if (persist) write(WIDTH_KEY, String(preferred));
        }

        function setCollapsed(value, options) {
            value = !!value;
            if (value === collapsed) return;
            if (value && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
            var from = options && typeof options.from === 'number' ? options.from : renderedWidth();
            finishMotion();
            collapsed = value;
            apply();
            syncControls();
            write(COLLAPSED_KEY, collapsed ? '1' : '0');
            if (options && options.instant) relayout();
            else animateWidth(from, collapsed ? 0 : Math.min(preferred, maxWidth()));
        }

        toggle.addEventListener('click', function () { setCollapsed(!collapsed); });

        // ---- 拖拽 ----
        var drag = null;
        function endDrag(commit) {
            if (!drag) return;
            var state = drag;
            drag = null;
            root.classList.remove('is-side-resizing');
            resizer.classList.remove('is-dragging');
            try { resizer.releasePointerCapture(state.pointerId); } catch (_) { /* 已释放 */ }
            if (!commit) {
                preferred = state.startWidth;
                collapsed = state.startCollapsed;
                apply();
            } else if (state.willCollapse) {
                // 收起时保留拖拽前的宽度，再次展开回到原来的大小。
                preferred = state.startWidth;
                collapsed = false;
                root.classList.remove('classroom-side-collapsed');
                setCollapsed(true, { instant: true });
            } else {
                write(WIDTH_KEY, String(preferred));
                if (state.startCollapsed) write(COLLAPSED_KEY, '0');
            }
            syncControls();
            relayout();
        }

        resizer.addEventListener('pointerdown', function (event) {
            if (event.button !== 0 || !wide.matches) return;
            event.preventDefault();
            finishMotion();
            drag = {
                pointerId: event.pointerId,
                startWidth: preferred,
                startCollapsed: collapsed,
                willCollapse: false,
            };
            resizer.setPointerCapture(event.pointerId);
            resizer.classList.add('is-dragging');
            root.classList.add('is-side-resizing');
        });
        resizer.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            var raw = window.innerWidth - event.clientX;
            drag.willCollapse = raw < COLLAPSE_AT;
            collapsed = drag.willCollapse;
            if (!drag.willCollapse) preferred = Math.min(clampWidth(raw), maxWidth());
            apply();
            relayout();
        });
        resizer.addEventListener('pointerup', function (event) {
            if (drag && event.pointerId === drag.pointerId) endDrag(true);
        });
        resizer.addEventListener('pointercancel', function () { endDrag(false); });
        resizer.addEventListener('lostpointercapture', function () { endDrag(true); });
        resizer.addEventListener('dblclick', function () {
            setWidth(DEFAULT_WIDTH, true);
            relayout();
        });

        // ---- 键盘 ----
        resizer.addEventListener('keydown', function (event) {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            var next = null;
            // 分隔条在侧栏左边：向左是加宽，向右是变窄。
            if (event.key === 'ArrowLeft') next = Math.min(preferred, maxWidth()) + KEY_STEP;
            else if (event.key === 'ArrowRight') next = Math.min(preferred, maxWidth()) - KEY_STEP;
            else if (event.key === 'Home') next = MAX_WIDTH;
            else if (event.key === 'End') next = MIN_WIDTH;
            else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setCollapsed(!collapsed);
                return;
            } else if (event.key === 'Escape' && drag) {
                event.preventDefault();
                endDrag(false);
                return;
            }
            if (next === null) return;
            event.preventDefault();
            if (collapsed) setCollapsed(false, { instant: true });
            setWidth(next, true);
            relayout();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key !== '\\' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            if (!wide.matches) return;
            event.preventDefault();
            setCollapsed(!collapsed);
        });

        // 菜单里的“学生面板”“小组面板”等入口会直接点击页签：侧栏收起时先展开。
        panel.addEventListener('click', function (event) {
            if (collapsed && event.target.closest('.tab-btn')) setCollapsed(false);
        });

        var onViewportChange = function () { syncControls(); };
        if (wide.addEventListener) wide.addEventListener('change', onViewportChange);
        window.addEventListener('resize', onViewportChange, { passive: true });
        syncControls();
        window.ClassroomSidebar = {
            collapse: function () { setCollapsed(true); },
            expand: function () { setCollapsed(false); },
            toggle: function () { setCollapsed(!collapsed); },
            isCollapsed: function () { return collapsed; },
            setWidth: function (value) { setWidth(value, true); relayout(); },
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
