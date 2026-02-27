document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.app-header');
    const titlebarBadge = document.querySelector('.titlebar-badge');

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
        const hosts = document.querySelectorAll('.header-ribbon[data-ribbon-host]');
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

    initRibbonTabs();
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);
    window.addEventListener('load', syncHeaderHeight);
});
