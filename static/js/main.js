document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.app-header');
    const touchPointerQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;

    const syncTouchMode = () => {
        const hasTouch = Boolean(
            (touchPointerQuery && touchPointerQuery.matches) ||
            navigator.maxTouchPoints > 0 ||
            'ontouchstart' in window
        );
        document.documentElement.classList.toggle('has-touch-ui', hasTouch);
    };

    const syncHeaderHeight = () => {
        if (!header) return;
        const height = Math.max(0, Math.round(header.getBoundingClientRect().height));
        if (height > 0) {
            const current = parseInt(
                getComputedStyle(document.documentElement).getPropertyValue('--header-height'),
                10
            );
            if (Number.isNaN(current) || Math.abs(current - height) >= 1) {
                document.documentElement.style.setProperty('--header-height', `${height}px`);
            }
        }
    };

    // window.open 带 noopener 时按规范总是返回 null，不能据此判断是否被拦截；
    // 用临时 <a target="_blank"> 模拟原生点击，保证当前页面不会被导航走。
    const openInNewTab = (url) => {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    };

    const initExternalLinks = () => {
        document.addEventListener('click', async (event) => {
            const link = event.target.closest('a[data-open-external]');
            if (!link || event.defaultPrevented) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const url = String(link.href || '').trim();
            if (!url) return;
            event.preventDefault();

            try {
                if (window.CloudManager && typeof window.CloudManager.openExternalUrl === 'function') {
                    await window.CloudManager.openExternalUrl(url);
                    return;
                }
            } catch (_) {
            }

            openInNewTab(url);
        });
    };

    const openAboutWindow = async (url) => {
        const api = window.pywebview && window.pywebview.api;
        if (api && typeof api.open_about_window === 'function') {
            try {
                const result = await api.open_about_window();
                if (result && result.status !== 'unsupported' && result.status !== 'error') return true;
            } catch (_) {
            }
        }
        openInNewTab(url);
        return true;
    };

    const initAboutWindow = () => {
        document.addEventListener('click', (event) => {
            const link = event.target.closest('a[data-about-window]');
            if (!link || event.defaultPrevented) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const url = String(link.href || '').trim();
            if (!url) return;
            event.preventDefault();
            openAboutWindow(url);
        });
    };

    const menuTargetAvailable = (selector) => {
        const target = document.querySelector(selector);
        if (selector === '#native-menu-about') return !!target;
        return target && (!document.body.classList.contains('welcome-body') || (target.closest('#welcome-toolbar') && !target.closest('[hidden]') && document.body.classList.contains('welcome-has-toolbar')));
    };
    const syncNativeMenu = () => {
        const body = document.body;
        if (!body || body.dataset.appShell !== 'webview' || body.dataset.appPlatform !== 'macos') return;
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.sync_native_menu !== 'function') return;
        const selectorSet = new Set();
        Object.values(nativeMenuItems).forEach((items) => {
            items.forEach((item) => selectorSet.add(item[1]));
        });
        const available = Array.from(selectorSet).filter((selector) => menuTargetAvailable(selector));
        try {
            api.sync_native_menu({
                path: window.location.pathname,
                title: document.title,
                shell: body.dataset.appShell,
                available,
            });
        } catch (_) {
        }
    };

    const nativeMenuItems = {
        file: [
            ['导入学生', '#btn-import-students'],
            ['导入座位布局', '#btn-open-layout-import-modal'],
            ['导入 SDES', '#btn-import-sdes'],
            ['导入 .seats', '#btn-import-seats-file'],
            ['导出排座表', '#btn-export-excel'],
            ['导出 SVG', '#btn-export-svg'],
            ['导出 PPTX', '#btn-export-pptx'],
            ['导出小组登记表', '#btn-export-group-report'],
            ['导出 CSIS', '#btn-export-csis'],
            ['导出 .seats', '#btn-export-seats-file'],
        ],
        edit: [
            ['撤销', '#undoBtn'],
            ['重做', '#redoBtn'],
            ['添加学生', '#btn-add-student'],
            ['修改班级名称', '#btn-rename-classroom'],
            ['删除班级', '#btn-delete-classroom'],
        ],
        view: [
            ['布局编辑', '#btn-layout-editor'],
            ['全屏', '#btn-fullscreen'],
            ['学生面板', '[data-tab="students"]'],
            ['分组面板', '[data-tab="groups"]'],
            ['约束面板', '[data-tab="constraints"]'],
            ['外观设置', '[data-settings-nav="appearance"]'],
        ],
        arrange: [
            ['自动排座', '#btn-auto-arrange'],
            ['自定义策略设置', '#classroom-custom-sort-link'],
            ['约束管理', '[data-tab="constraints"]'],
            ['排座偏好', '[data-settings-nav="arrange"]'],
        ],
        transform: [
            ['左移布局', '#btn-shift-layout-left'],
            ['右移布局', '#btn-shift-layout-right'],
            ['前移布局', '#btn-shift-layout-front'],
            ['后移布局', '#btn-shift-layout-back'],
            ['左右镜像', '#btn-mirror-layout-lr'],
            ['移动选项', '[data-open-modal="shift-options-modal"]'],
        ],
        students: [
            ['学生列表', '[data-tab="students"]'],
            ['分组管理', '[data-tab="groups"]'],
            ['标签管理', '#btn-open-tag-manager'],
        ],
        extensions: [
            ['插件中心', '#btn-open-plugin-hub'],
            ['命令面板', '#btn-open-plugin-command'],
            ['扩展清单', 'a[href*="extensions"]'],
            ['打开闻道智能', '#btn-open-future-mode'],
            ['云服务', '[data-settings-nav="cloud"]'],
        ],
        window: [
            ['返回首页', '.global-back-button'],
            ['设置', 'a[href*="/settings/"]'],
        ],
        help: [
            ['关于', '#native-menu-about'],
        ],
    };

    const initMenuPlacement = () => {
        const roots = Array.from(document.querySelectorAll('.menu-dropdown[data-menu-root]'));
        if (!roots.length) return;
        let frame = 0;
        const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
        const positionMenus = () => {
            frame = 0;
            const viewport = window.visualViewport;
            const leftEdge = (viewport?.offsetLeft || 0) + 8;
            const topEdge = (viewport?.offsetTop || 0) + 8;
            const rightEdge = leftEdge + (viewport?.width || document.documentElement.clientWidth) - 16;
            const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;

            roots.forEach((root) => {
                if (!root.classList.contains('open')) return;
                // 按父子顺序定位，后续层级沿用父菜单的展开方向。
                root.querySelectorAll('.menu-panel').forEach((panel) => {
                    panel.style.removeProperty('left');
                    panel.style.removeProperty('top');
                    panel.parentElement.classList.remove('menu-opens-left');
                    const style = getComputedStyle(panel);
                    // 入场动画刚开始时 visibility 可能仍为 hidden，按交互状态提前定位。
                    if (style.pointerEvents === 'none' || !panel.offsetParent) return;

                    const anchor = panel.offsetParent;
                    const rect = anchor.getBoundingClientRect();
                    const originX = rect.left + anchor.clientLeft - anchor.scrollLeft;
                    const originY = rect.top + anchor.clientTop - anchor.scrollTop;
                    const width = panel.offsetWidth;
                    const height = panel.offsetHeight;
                    let left = parseFloat(style.left) || 0;
                    let top = parseFloat(style.top) || 0;
                    const sideways = panel.classList.contains('menu-panel-sub') && left >= anchor.clientWidth - 1;

                    if (sideways) {
                        const parentPanel = anchor.closest('.menu-panel');
                        const preferLeft = parentPanel?.parentElement.classList.contains('menu-opens-left');
                        const fitsLeft = originX - width >= leftEdge;
                        const fitsRight = originX + left + width <= rightEdge;
                        if (fitsLeft && (preferLeft || !fitsRight)) left = -width;
                    }

                    // 两侧都放不下时在窗口内平移；窄屏仍沿用原来的纵向展开。
                    left = clamp(left, leftEdge - originX, rightEdge - originX - width);
                    top = clamp(top, topEdge - originY, bottomEdge - originY - height);
                    panel.style.left = `${left}px`;
                    panel.style.top = `${top}px`;
                    panel.parentElement.classList.toggle('menu-opens-left', sideways && left < 0);
                });
            });
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(positionMenus);
        };
        roots.forEach((root) => {
            root.addEventListener('pointerover', schedule);
            root.addEventListener('focusin', schedule);
            // 菜单开关会停止冒泡，在捕获阶段登记，下一帧再读取展开后的尺寸。
            root.addEventListener('click', schedule, true);
            root.addEventListener('transitionend', (event) => {
                if (event.target.matches('.menu-panel') && event.propertyName === 'transform') schedule();
            });
        });
        window.addEventListener('resize', schedule);
        document.addEventListener('scroll', schedule, true);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', schedule);
            window.visualViewport.addEventListener('scroll', schedule);
        }
        if (header && 'ResizeObserver' in window) new ResizeObserver(schedule).observe(header);
    };

    const initNativeMenus = () => {
        const bar = document.querySelector('[data-native-menu-bar]');
        if (!bar) return;
        const popover = bar.querySelector('[data-native-menu-popover]');
        let activeTrigger = null;
        let activeItems = [];
        const close = () => {
            bar.querySelectorAll('.native-menu-trigger.is-open').forEach((item) => {
                item.classList.remove('is-open');
                item.setAttribute('aria-expanded', 'false');
            });
            if (popover) {
                popover.hidden = true;
                popover.innerHTML = '';
            }
            activeItems = [];
            activeTrigger = null;
        };
        const invoke = (selector) => {
            const target = document.querySelector(selector);
            if (!target) return false;
            target.click();
            return true;
        };
        const render = (key, trigger) => {
            if (!popover) return;
            popover.setAttribute('role', 'menu');
            const items = (nativeMenuItems[key] || []).filter(([, selector]) => menuTargetAvailable(selector));
            popover.innerHTML = '';
            if (!items.length) {
                close();
                return;
            }
            activeTrigger = trigger;
            items.forEach(([label, selector]) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'native-menu-item';
                item.setAttribute('role', 'menuitem');
                item.setAttribute('tabindex', '-1');
                item.textContent = label;
                item.addEventListener('click', () => {
                    invoke(selector);
                    close();
                });
                if (!document.querySelector(selector)) item.disabled = true;
                popover.appendChild(item);
            });
            activeItems = Array.from(popover.querySelectorAll('[role="menuitem"]:not(:disabled)'));
            const rect = trigger.getBoundingClientRect();
            popover.style.left = `${Math.max(8, rect.left)}px`;
            popover.style.top = `${rect.bottom + 4}px`;
            popover.hidden = false;
        };
        const open = (trigger, focusFirst = false) => {
            close();
            trigger.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            render(trigger.dataset.nativeMenu, trigger);
            if (focusFirst && activeItems[0]) activeItems[0].focus();
        };
        bar.querySelectorAll('[data-native-menu]').forEach((trigger) => {
            const triggerItems = nativeMenuItems[trigger.dataset.nativeMenu] || [];
            const hasAvailableAction = triggerItems.some(([, selector]) => menuTargetAvailable(selector));
            trigger.hidden = !hasAvailableAction;
            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                if (trigger.classList.contains('is-open')) close();
                else open(trigger);
            });
            trigger.addEventListener('keydown', (event) => {
                if (trigger.hidden) return;
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open(trigger, true);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    close();
                }
            });
        });
        popover?.addEventListener('keydown', (event) => {
            if (!activeItems.length) return;
            const current = activeItems.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                activeItems[(current + direction + activeItems.length) % activeItems.length].focus();
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                document.activeElement?.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                const trigger = activeTrigger;
                close();
                trigger?.focus();
            }
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('[data-native-menu-bar]')) close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !popover?.contains(event.target)) close();
        });
    };

    // 传统 POST 表单防重复提交：双击或连按 Enter 不会重复创建班级、重复导入。
    const initSubmitGuard = () => {
        const release = (form) => {
            delete form.dataset.submitting;
            form.removeAttribute('aria-busy');
            form.querySelectorAll('.is-submitting').forEach((button) => button.classList.remove('is-submitting'));
        };
        document.addEventListener('submit', (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || form.hasAttribute('data-allow-resubmit')) return;
            if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
            if (form.target && form.target !== '_self') return;
            if (form.dataset.submitting === 'true') {
                event.preventDefault();
                return;
            }
            const submitter = event.submitter;
            // 等所有监听器跑完再判断：由脚本接管（preventDefault 后走 fetch）的表单不加锁。
            // 也不能在 submit 事件里禁用按钮，否则它的 name/value 会从表单数据中丢失。
            window.setTimeout(() => {
                if (event.defaultPrevented) return;
                form.dataset.submitting = 'true';
                form.setAttribute('aria-busy', 'true');
                if (submitter && form.contains(submitter)) submitter.classList.add('is-submitting');
                // 下载文件等不会离开当前页的提交，稍后自动解锁。
                window.setTimeout(() => release(form), 8000);
            }, 0);
        });
        // 从往返缓存恢复的页面要解锁，否则返回后按钮一直处于提交中。
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) document.querySelectorAll('form[data-submitting]').forEach(release);
        });
    };

    window.addEventListener('fuckseats:menus-changed', () => {
        document.querySelectorAll('[data-native-menu]').forEach(trigger => {
            trigger.hidden = !(nativeMenuItems[trigger.dataset.nativeMenu] || []).some(([, selector]) => menuTargetAvailable(selector));
        });
        const popover = document.querySelector('[data-native-menu-popover]');
        if (popover) popover.hidden = true;
        syncNativeMenu();
    });
    initMenuPlacement();
    initNativeMenus();
    initExternalLinks();
    initAboutWindow();
    initSubmitGuard();
    syncTouchMode();
    syncHeaderHeight();
    syncNativeMenu();
    window.addEventListener('pywebviewready', syncNativeMenu);
    window.setTimeout(syncNativeMenu, 250);
    // macOS 切换 Space 或从其他应用返回时，WebView 可能保持页面内容但系统菜单已被重置。
    // 重新获得焦点/可见性时主动同步，配合桌面壳保存的最近菜单恢复完整顶栏。
    window.addEventListener('focus', syncNativeMenu);
    window.addEventListener('pageshow', syncNativeMenu);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncNativeMenu();
    });
    // 工具栏换行、字体加载等都会改变顶栏高度，不只是窗口缩放；合并到下一帧统一测量。
    let headerFrame = 0;
    const scheduleHeaderHeight = () => {
        if (headerFrame) return;
        headerFrame = window.requestAnimationFrame(() => {
            headerFrame = 0;
            syncHeaderHeight();
        });
    };
    if (header && 'ResizeObserver' in window) {
        new ResizeObserver(scheduleHeaderHeight).observe(header);
    } else {
        window.addEventListener('resize', scheduleHeaderHeight);
    }
    window.addEventListener('load', syncHeaderHeight);
    if (touchPointerQuery) {
        if (typeof touchPointerQuery.addEventListener === 'function') {
            touchPointerQuery.addEventListener('change', syncTouchMode);
        } else if (typeof touchPointerQuery.addListener === 'function') {
            touchPointerQuery.addListener(syncTouchMode);
        }
    }
});
