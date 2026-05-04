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
        const saved = localStorage.getItem(THEME_KEY);
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

        localStorage.setItem(THEME_KEY, theme.id);
    }

    function setTheme(themeId) {
        applyTheme(themeId);
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
