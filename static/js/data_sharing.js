window.DataSharing = (function () {
    'use strict';

    var _config = null;
    var _enabled = false;
    var _sessionId = '';
    var _eventQueue = [];
    var _logQueue = [];
    var _flushTimer = null;
    var _initialized = false;
    var _flushInterval = 30000;
    var _maxQueueSize = 200;
    var _pageLoadTime = Date.now();

    function generateSessionId() {
        var arr = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(arr);
        } else {
            for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(arr, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    function getInstallId() {
        var key = 'fuckseats_data_sharing_install_id';
        var id = localStorage.getItem(key);
        if (id) return id;
        id = generateSessionId();
        localStorage.setItem(key, id);
        return id;
    }

    function getPlatform() {
        var ua = navigator.userAgent || '';
        if (/Windows/.test(ua)) return 'win32';
        if (/Macintosh|Mac OS/.test(ua)) return 'darwin';
        if (/Linux/.test(ua)) return 'linux';
        if (/Android/.test(ua)) return 'android';
        if (/iPhone|iPad/.test(ua)) return 'ios';
        return 'unknown';
    }

    function getAppVersion() {
        var el = document.querySelector('[data-app-version]');
        return el ? el.dataset.appVersion : '0.0.0';
    }

    function clientPayload() {
        return {
            install_id: getInstallId(),
            session_id: _sessionId,
            app_version: getAppVersion(),
            platform: getPlatform(),
            source: 'frontend'
        };
    }

    function isEnabled() {
        return _enabled && _config && _config.enabled;
    }

    function fetchConfig() {
        return fetch('/cloud/config')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var ds = data.data_sharing || {};
                _config = ds;
                _enabled = !!ds.enabled;
                return ds;
            })
            .catch(function () {
                _enabled = false;
                return null;
            });
    }

    function init() {
        if (_initialized) return;
        _initialized = true;
        _sessionId = generateSessionId();
        fetchConfig().then(function () {
            if (isEnabled()) {
                startFlushTimer();
                trackPageView();
                hookNavigation();
            }
        });
    }

    function startFlushTimer() {
        if (_flushTimer) return;
        _flushTimer = setInterval(flush, _flushInterval);
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') flush();
        });
    }

    function trackEvent(feature, action, opts) {
        if (!isEnabled()) return;
        opts = opts || {};
        _eventQueue.push({
            feature: String(feature || 'unknown').slice(0, 80),
            action: String(action || 'use').slice(0, 80),
            success: opts.success !== false,
            duration_ms: Math.max(0, parseInt(opts.duration_ms) || 0),
            count: Math.max(1, parseInt(opts.count) || 1),
            occurred_at: Date.now() / 1000,
            metadata: sanitizeMetadata(opts.metadata)
        });
        if (_eventQueue.length >= _maxQueueSize) flush();
    }

    function trackLog(level, source, code, opts) {
        if (!isEnabled()) return;
        opts = opts || {};
        _logQueue.push({
            level: String(level || 'INFO').toUpperCase().slice(0, 16),
            source: String(source || 'frontend').slice(0, 80),
            code: String(code || '').slice(0, 80),
            message: sanitizeMessage(opts.message || ''),
            occurred_at: Date.now() / 1000,
            context: sanitizeMetadata(opts.context)
        });
        if (_logQueue.length >= _maxQueueSize) flush();
    }

    function sanitizeMessage(msg) {
        msg = String(msg || '').slice(0, 240);
        msg = msg.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]');
        msg = msg.replace(/\b\d{7,}\b/g, '[number]');
        msg = msg.replace(/(token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session)\s*[:=]\s*[^\s,;]+/gi, '$1=[filtered]');
        return msg;
    }

    var SENSITIVE_KEYS = /^(name|student|email|phone|mobile|tel|token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|uid|user|avatar|address|classroom|content|message|prompt|response|snapshot|data|file|path)$/i;

    function sanitizeMetadata(meta) {
        if (!meta || typeof meta !== 'object') return {};
        var result = {};
        var count = 0;
        for (var key in meta) {
            if (!meta.hasOwnProperty(key)) continue;
            if (SENSITIVE_KEYS.test(key)) continue;
            if (count >= 24) break;
            var val = meta[key];
            if (typeof val === 'string') {
                result[key] = sanitizeMessage(val).slice(0, 160);
            } else if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
                result[key] = val;
            }
            count++;
        }
        return result;
    }

    function featureFromPath(path) {
        path = String(path || window.location.pathname);
        if (path === '/' || path === '') return 'classroom';
        if (/\/cloud\//.test(path)) return 'cloud';
        if (/\/plugins\/|\/extensions\//.test(path)) return 'plugin';
        if (/\/ai\//.test(path)) return 'ai';
        if (/\/layout\/|\/arrange|\/seat/.test(path)) return 'seat_layout';
        if (/\/student|\/tag/.test(path)) return 'student';
        if (/\/group\//.test(path)) return 'group';
        if (/\/constraint\//.test(path)) return 'constraint';
        if (/\/import/.test(path)) return 'import';
        if (/\/export/.test(path)) return 'export';
        if (/\/settings/.test(path)) return 'settings';
        if (/\/classroom\//.test(path)) return 'classroom';
        return 'other';
    }

    function trackPageView() {
        trackEvent(featureFromPath(), 'page_view', {
            metadata: { referrer_feature: document.referrer ? featureFromPath(new URL(document.referrer, window.location.origin).pathname) : '' }
        });
    }

    function hookNavigation() {
        var originalPushState = history.pushState;
        var originalReplaceState = history.replaceState;
        history.pushState = function () {
            originalPushState.apply(this, arguments);
            trackPageView();
        };
        history.replaceState = function () {
            originalReplaceState.apply(this, arguments);
        };
        window.addEventListener('popstate', trackPageView);
    }

    function flush() {
        if (!isEnabled()) return;
        var events = _eventQueue.splice(0, _maxQueueSize);
        var logs = _logQueue.splice(0, _maxQueueSize);

        if (events.length > 0) {
            sendBeacon('/api/improve/events', { client: clientPayload(), events: events });
        }
        if (logs.length > 0) {
            sendBeacon('/api/improve/logs', { client: clientPayload(), logs: logs });
        }
    }

    function sendBeacon(url, payload) {
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
            var blob = new Blob([body], { type: 'application/json' });
            var sent = navigator.sendBeacon(url, blob);
            if (sent) return;
        }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
            keepalive: true
        }).catch(function () {});
    }

    function trackFetchTiming(url, method, startTime, success) {
        if (!isEnabled()) return;
        var duration = Date.now() - startTime;
        var path = url;
        try {
            var u = new URL(url, window.location.origin);
            path = u.pathname;
        } catch (e) {}
        trackEvent(featureFromPath(path), 'api_call', {
            success: success,
            duration_ms: duration,
            metadata: { method: method || 'GET', path: path.slice(0, 80) }
        });
    }

    function trackError(source, code, message, context) {
        trackLog('ERROR', source, code, { message: message, context: context });
    }

    function hookGlobalErrors() {
        window.addEventListener('error', function (e) {
            if (!isEnabled()) return;
            trackLog('ERROR', 'window', 'uncaught_error', {
                message: (e.message || '').slice(0, 200),
                context: { filename: (e.filename || '').split('/').pop(), lineno: e.lineno }
            });
        });
        window.addEventListener('unhandledrejection', function (e) {
            if (!isEnabled()) return;
            var reason = e.reason || {};
            trackLog('ERROR', 'promise', 'unhandled_rejection', {
                message: String(reason.message || reason || '').slice(0, 200)
            });
        });
    }

    function setEnabled(enabled) {
        return fetch('/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_sharing_enabled: !!enabled })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var ds = data.data_sharing || {};
                _config = ds;
                _enabled = !!ds.enabled;
                if (_enabled && !_flushTimer) startFlushTimer();
                return ds;
            });
    }

    function setLogRetentionDays(days) {
        return fetch('/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_sharing_local_log_retention_days: days })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var ds = data.data_sharing || {};
                _config = ds;
                return ds;
            });
    }

    var setLocalLogRetentionDays = setLogRetentionDays;

    function getConfig() {
        return _config;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            init();
            hookGlobalErrors();
        });
    } else {
        init();
        hookGlobalErrors();
    }

    return {
        trackEvent: trackEvent,
        trackLog: trackLog,
        trackError: trackError,
        trackFetchTiming: trackFetchTiming,
        flush: flush,
        setEnabled: setEnabled,
        setLogRetentionDays: setLogRetentionDays,
        setLocalLogRetentionDays: setLocalLogRetentionDays,
        getConfig: getConfig,
        isEnabled: isEnabled,
        featureFromPath: featureFromPath
    };
})();
