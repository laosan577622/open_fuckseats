(() => {
    'use strict';
    const names = new Map();
    const protocolFields = new Set(['call_id', 'tool_call_id', 'approval_token', 'response_id']);
    const restoreText = (text) => String(text ?? '').replace(/STU_[0-9a-f]{32}/g, alias => names.get(alias) ?? alias);
    const restore = (value) => {
        if (typeof value === 'string') return restoreText(value);
        if (Array.isArray(value)) return value.map(restore);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [restoreText(key), protocolFields.has(key) ? item : restore(item)]));
        }
        return value;
    };
    const decode = (payload) => {
        Object.entries(payload?.student_name_aliases || {}).forEach(([alias, name]) => {
            if (/^STU_[0-9a-f]{32}$/.test(alias) && typeof name === 'string') names.set(alias, name);
        });
        const {student_name_aliases, ...data} = payload || {};
        return restore(data);
    };
    window.AINamePrivacy = {
        decode,
        restore,
        // Hide only a trailing fragment until a complete alias arrives.
        restoreStream: (text) => restoreText(String(text ?? '').replace(/(?:STU_[0-9a-f]{0,31}|STU_|STU|ST|S)$/, '')),
    };
})();
