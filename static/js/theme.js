(function () {
    const THEME_KEY = 'seats_theme';

    const THEMES = {
        'starriver-blue': {
            id: 'starriver-blue',
            name: '星河蓝',
            description: '漫天的星光，终将汇成璀璨的星河',
            color: '#0a59f7',
            colorRgb: '10, 89, 247',
        },
        'surging-orange': {
            id: 'surging-orange',
            name: '澎湃橙',
            description: '人座合一，我心澎湃',
            color: '#FF6900',
            colorRgb: '255, 105, 0',
        },
    };

    const DEFAULT_THEME = 'starriver-blue';

    function getThemeId() {
        let saved = '';
        try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (e) {}
        return (saved && THEMES[saved]) ? saved : DEFAULT_THEME;
    }

    function getTheme() {
        return THEMES[getThemeId()];
    }

    function applyTheme(themeId) {
        const theme = THEMES[themeId] || THEMES[DEFAULT_THEME];
        const root = document.documentElement;
        root.style.setProperty('--primary-color', theme.color);
        root.style.setProperty('--primary-color-rgb', theme.colorRgb);
        root.setAttribute('data-theme', theme.id);

        document.querySelectorAll('[data-theme-color]').forEach(function (el) {
            var attr = el.getAttribute('data-theme-color');
            if (attr === 'fill') {
                el.setAttribute('fill', theme.color);
            } else if (attr === 'stroke') {
                el.setAttribute('stroke', theme.color);
            } else if (attr === 'fill-opacity') {
                el.setAttribute('fill', theme.color);
            }
        });

        try { localStorage.setItem(THEME_KEY, theme.id); } catch (e) {}
    }

    function playThemeRipple(originX, originY, color) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var overlay = document.createElement('div');
        overlay.className = 'theme-ripple-overlay';
        var circle = document.createElement('div');
        circle.className = 'theme-ripple-circle';
        circle.style.left = originX + 'px';
        circle.style.top = originY + 'px';
        circle.style.background = color;
        overlay.appendChild(circle);
        document.body.appendChild(overlay);
        circle.addEventListener('animationend', function () { overlay.remove(); });
        // 安全兜底：2 秒后强制清除，防止 animationend 未触发残留遮罩。
        window.setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 2000);
    }

    function setTheme(themeId, originX, originY) {
        var theme = THEMES[themeId] || THEMES[DEFAULT_THEME];
        if (typeof originX === 'number' && typeof originY === 'number') {
            playThemeRipple(originX, originY, theme.color);
            // 涟漪展开 300ms 后再切换主题色，让用户看到旧→新的覆盖过程。
            window.setTimeout(function () { applyTheme(themeId); }, 300);
        } else {
            applyTheme(themeId);
        }
        window.dispatchEvent(new CustomEvent('themechange', { detail: getTheme() }));
    }

    var currentId = getThemeId();
    document.documentElement.style.setProperty('--primary-color', THEMES[currentId].color);
    document.documentElement.style.setProperty('--primary-color-rgb', THEMES[currentId].colorRgb);
    document.documentElement.setAttribute('data-theme', currentId);

    window.ThemeManager = {
        THEMES: THEMES,
        DEFAULT_THEME: DEFAULT_THEME,
        getThemeId: getThemeId,
        getTheme: getTheme,
        setTheme: setTheme,
        applyTheme: applyTheme,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyTheme(currentId); });
    } else {
        applyTheme(currentId);
    }
})();
