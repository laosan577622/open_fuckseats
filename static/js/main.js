document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.app-header');
    const titlebarBadge = document.querySelector('.titlebar-badge');
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

    const initRibbonTabs = () => {
        const hosts = document.querySelectorAll('[data-ribbon-host]');
        hosts.forEach((host, idx) => {
            const tabs = Array.from(host.querySelectorAll('.ribbon-tab[data-ribbon-tab]'));
            const panels = Array.from(host.querySelectorAll('.ribbon-panel[data-ribbon-panel]'));
            if (!tabs.length) return;

            const hasPanels = panels.length > 0;
            const storageKey = `ribbon_tab:${window.location.pathname}:${idx}`;

            const activate = (tabKey, persist = true) => {
                let targetKey = tabKey;
                if (hasPanels && !host.querySelector(`.ribbon-panel[data-ribbon-panel="${targetKey}"]`)) {
                    targetKey = panels[0]?.dataset.ribbonPanel || '';
                }
                tabs.forEach((tab) => {
                    tab.classList.toggle('active', tab.dataset.ribbonTab === targetKey);
                });
                if (hasPanels) {
                    panels.forEach((panel) => {
                        panel.classList.toggle('active', panel.dataset.ribbonPanel === targetKey);
                    });
                }
                if (persist && targetKey) {
                    localStorage.setItem(storageKey, targetKey);
                }
                const activeTab = tabs.find((tab) => tab.classList.contains('active'));
                if (titlebarBadge && activeTab) {
                    titlebarBadge.textContent = activeTab.textContent.trim();
                }
                requestAnimationFrame(syncHeaderHeight);
            };

            tabs.forEach((tab) => {
                tab.addEventListener('click', () => {
                    if (tab.disabled) return;
                    const tabKey = tab.dataset.ribbonTab;
                    if (!tabKey) return;
                    activate(tabKey, true);
                });
            });

            const saved = localStorage.getItem(storageKey);
            const first = tabs.find((tab) => !tab.disabled)?.dataset.ribbonTab || tabs[0]?.dataset.ribbonTab;
            activate(saved || first, false);
        });
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

    initRibbonTabs();
    initExternalLinks();
    syncTouchMode();
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);
    window.addEventListener('load', syncHeaderHeight);
    if (touchPointerQuery) {
        if (typeof touchPointerQuery.addEventListener === 'function') {
            touchPointerQuery.addEventListener('change', syncTouchMode);
        } else if (typeof touchPointerQuery.addListener === 'function') {
            touchPointerQuery.addListener(syncTouchMode);
        }
    }
});
