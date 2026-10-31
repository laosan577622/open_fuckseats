(function () {
    'use strict';

    const root = document.documentElement;
    const storeKey = 'fuckseats_no_fuck_mode';
    const nativeGet = Storage.prototype.getItem;
    const nativeSet = Storage.prototype.setItem;
    function readLocal() {
        try { return nativeGet.call(window.localStorage, storeKey); } catch (_) { return null; }
    }
    function cachePreference(value) {
        try { nativeSet.call(window.localStorage, storeKey, value); } catch (_) {}
        if (window.BACKEND_STORE) window.BACKEND_STORE[storeKey] = value;
    }
    let enabled = root.hasAttribute('data-no-fuck-mode') ? root.dataset.noFuckMode !== 'false' : readLocal() !== 'false';
    root.dataset.noFuckMode = String(enabled);
    const originals = new WeakMap();
    const defaultDisplay = { english_name: 'BuxiangSeats', product_name: '不想排座位', product_website: 'https://paizuowei.577622.xyz', about: {} };
    let displayConfig = { ...defaultDisplay };
    const displayAttributes = ['title', 'alt', 'aria-label', 'aria-description', 'placeholder'];
    const excluded = 'script, style, textarea, [data-brand-about], [contenteditable]:not([contenteditable="false"])';

    function format(value) {
        const text = String(value == null ? '' : value);
        // Addresses are configuration, rather than product naming.
        if (/^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i.test(text.trim())) return text;
        return enabled ? text.replace(/fuckseats/gi, () => displayConfig.english_name).replace(/不想排座位/g, () => displayConfig.product_name) : text;
    }

    function renderValue(node, key, current, write) {
        const values = originals.get(node) || {};
        const previous = values[key];
        const original = previous && current === previous.rendered ? previous.original : current;
        const rendered = format(original);
        if (!previous && original === rendered) return;
        values[key] = { original, rendered };
        originals.set(node, values);
        if (current !== rendered) write(rendered);
    }

    function renderNode(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (element && element.closest(excluded)) return;
        if (node.nodeType === 3) {
            // An option without a value submits its text. Preserve that value before renaming it.
            if (element && element.tagName === 'OPTION' && !element.hasAttribute('value') && format(node.data) !== node.data) {
                element.setAttribute('value', element.value);
            }
            renderValue(node, 'text', node.data, function (text) { node.data = text; });
            return;
        }
        if (node.nodeType === 1) {
            displayAttributes.forEach(function (name) {
                if (node.hasAttribute(name)) {
                    renderValue(node, name, node.getAttribute(name), function (text) { node.setAttribute(name, text); });
                }
            });
            if (node.tagName === 'INPUT' && /^(button|submit|reset)$/.test(node.type)) {
                renderValue(node, 'value', node.value, function (text) { node.value = text; });
            }
        }
        node.childNodes.forEach(renderNode);
    }

    // Run in the head, before the page is parsed, so initial and later content use the same naming.
    const observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
            if (record.type === 'childList') record.addedNodes.forEach(renderNode);
            else renderNode(record.target);
        });
    });
    observer.observe(root, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: displayAttributes.concat('value'),
    });
    renderNode(root);

    function applyState(data) {
        if (!data || typeof data.no_fuck_mode !== 'boolean' || enabled === data.no_fuck_mode) return;
        enabled = data.no_fuck_mode;
        root.dataset.noFuckMode = String(enabled);
        renderNode(root);
        document.dispatchEvent(new CustomEvent('app-branding-changed', { detail: { no_fuck_mode: enabled } }));
    }

    function refresh() {
        const value = readLocal();
        if (value !== null) applyState({ no_fuck_mode: value !== 'false' });
        return Promise.resolve();
    }

    function syncStore() {
        if (window.BACKEND_STORE && Object.prototype.hasOwnProperty.call(window.BACKEND_STORE, storeKey)) {
            const value = window.BACKEND_STORE[storeKey] === 'false' ? 'false' : 'true';
            cachePreference(value);
            applyState({ no_fuck_mode: value !== 'false' });
        }
    }

    let channel = null;
    try {
        channel = new BroadcastChannel('fuckseats-branding');
        channel.onmessage = function (event) {
            if (!event.data || typeof event.data.no_fuck_mode !== 'boolean') return;
            cachePreference(String(event.data.no_fuck_mode));
            applyState(event.data);
        };
    } catch (_) {}

    async function save(noFuckMode) {
        if (typeof noFuckMode !== 'boolean') throw new TypeError('无效的模式设置');
        const csrf = document.querySelector('meta[name="csrf-token"]');
        const value = String(noFuckMode);
        const response = await fetch('/api/store/set/', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.content : '' },
            body: JSON.stringify({ key: storeKey, value }),
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success' || data.persisted === false) throw new Error(data.message || '模式保存失败，请重试');
        cachePreference(value);
        applyState({ no_fuck_mode: noFuckMode });
        if (channel) channel.postMessage({ no_fuck_mode: noFuckMode });
    }

    // Native browser dialogs do not create DOM nodes.
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
        const original = window[name];
        if (typeof original !== 'function') return;
        window[name] = function (message, ...args) { return original.call(window, format(message), ...args); };
    });

    function configure(payload) {
        const incoming = payload && payload.no_fuck_mode || {};
        displayConfig = { ...defaultDisplay, ...incoming, about: incoming.about || {} };
        renderNode(root);
        document.dispatchEvent(new CustomEvent('app-branding-config-changed'));
    }
    window.AppBranding = { format, applyState, refresh, syncStore, save, configure,
        getDisplayConfig: function () { return { ...displayConfig, about: { ...displayConfig.about } }; },
        isEnabled: function () { return enabled; } };
    window.addEventListener('storage', function (event) {
        if (event.key !== storeKey) return;
        if (window.BACKEND_STORE) window.BACKEND_STORE[storeKey] = event.newValue;
        applyState({ no_fuck_mode: event.newValue !== 'false' });
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', function (event) { if (event.persisted) refresh(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
