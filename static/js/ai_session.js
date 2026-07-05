(function () {
    'use strict';

    var POLL_FALLBACK_MS = 2500;

    var overlay = document.getElementById('ai-session-overlay');
    if (!overlay) return;

    var messageEl = overlay.querySelector('.ai-session-message');
    var progressEl = overlay.querySelector('.ai-session-progress');
    var progressBar = overlay.querySelector('.ai-session-progress-bar');
    var cancelBtn = overlay.querySelector('#ai-session-cancel');

    var lastSeq = null;
    var hiding = false;
    var pollTimer = null;
    var es = null;
    var esHealthy = false;

    var classroomRoot = document.getElementById('classroom-root');
    var currentClassroomId = classroomRoot ? String(classroomRoot.dataset.classroomId || '') : '';
    var seenClassroomSeq = {};
    var homeRoot = document.querySelector('.classrooms-grid');
    var isHomePage = !!homeRoot && !currentClassroomId;
    var seenDataSeq = null;
    var pageRefreshPending = false;
    var pageRefreshScheduled = false;
    var sessionActive = false;
    var refreshInFlight = false;
    var refreshPending = false;

    function refreshCurrentClassroom() {
        if (!currentClassroomId) return;
        if (typeof window.refreshState !== 'function') return;
        if (refreshInFlight) { refreshPending = true; return; }
        refreshInFlight = true;
        try {
            var p = window.refreshState();
            if (p && typeof p.then === 'function') {
                p.then(function () {
                    refreshInFlight = false;
                    if (refreshPending) { refreshPending = false; refreshCurrentClassroom(); }
                }).catch(function () { refreshInFlight = false; });
            } else {
                refreshInFlight = false;
            }
        } catch (e) {
            refreshInFlight = false;
        }
    }

    function applyRealtime(rt) {
        if (!rt) return;
        if (isHomePage && typeof rt.data_seq === 'number') {
            if (seenDataSeq === null) {
                seenDataSeq = rt.data_seq;
            } else if (rt.data_seq !== seenDataSeq) {
                seenDataSeq = rt.data_seq;
                requestPageRefresh();
            }
        }
        if (!rt.classroom_seq || !currentClassroomId) return;
        var seq = rt.classroom_seq[currentClassroomId];
        if (typeof seq === 'number') {
            if (typeof seenClassroomSeq[currentClassroomId] !== 'number') {
                seenClassroomSeq[currentClassroomId] = seq;
            } else if (seq !== seenClassroomSeq[currentClassroomId]) {
                seenClassroomSeq[currentClassroomId] = seq;
                refreshCurrentClassroom();
            }
        }
    }

    function requestPageRefresh() {
        if (!isHomePage) return;
        if (sessionActive) {
            pageRefreshPending = true;
            return;
        }
        refreshCurrentPage();
    }

    function refreshCurrentPage() {
        if (pageRefreshScheduled) return;
        pageRefreshScheduled = true;
        window.setTimeout(function () {
            window.location.reload();
        }, 120);
    }

    function flushPendingPageRefresh() {
        if (!pageRefreshPending) return;
        pageRefreshPending = false;
        refreshCurrentPage();
    }

    function rememberSessionState(active) {
        var wasActive = sessionActive;
        sessionActive = active;
        if (wasActive && !sessionActive) {
            flushPendingPageRefresh();
        }
    }

    function applySession(session) {
        if (!session) return;
        var active = !!session.active;
        var changed = session.seq !== lastSeq;
        lastSeq = session.seq;
        rememberSessionState(active);

        if (active) {
            if (messageEl && session.message) messageEl.textContent = session.message;
            else if (messageEl) messageEl.textContent = 'AI 正在操作中，请稍候';

            var pct = session.progress;
            if (typeof pct === 'number' && isFinite(pct)) {
                var clamped = Math.max(0, Math.min(100, pct));
                if (progressBar) progressBar.style.width = clamped + '%';
                if (progressEl) progressEl.classList.add('ai-session-progress-visible');
            } else {
                if (progressBar) progressBar.style.width = '0%';
                if (progressEl) progressEl.classList.remove('ai-session-progress-visible');
            }
            show();
        } else if (changed) {
            hide();
        }
    }

    function show() {
        if (hiding) {
            hiding = false;
            overlay.classList.remove('ai-session-hiding');
        }
        overlay.classList.add('ai-session-visible');
        overlay.style.display = '';
        overlay.setAttribute('aria-hidden', 'false');
    }

    function hide() {
        if (!overlay.classList.contains('ai-session-visible')) return;
        overlay.setAttribute('aria-hidden', 'true');
        hiding = true;
        overlay.classList.add('ai-session-hiding');
        window.setTimeout(function () {
            if (!hiding) return;
            hiding = false;
            overlay.classList.remove('ai-session-visible');
            overlay.classList.remove('ai-session-hiding');
            overlay.style.display = 'none';
        }, 300);
    }

    function stopPolling() {
        if (pollTimer) { window.clearTimeout(pollTimer); pollTimer = null; }
    }

    function schedulePoll(delay) {
        stopPolling();
        pollTimer = window.setTimeout(poll, delay);
    }

    function poll() {
        fetch('/api/ai-session/', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data) {
                    applySession(data.session);
                    applyRealtime(data.realtime);
                }
                if (!esHealthy) schedulePoll(POLL_FALLBACK_MS);
            })
            .catch(function () {
                if (!esHealthy) schedulePoll(POLL_FALLBACK_MS);
            });
    }

    function startSSE() {
        try {
            es = new EventSource('/api/ai-session/stream/');
        } catch (e) {
            schedulePoll(POLL_FALLBACK_MS);
            return;
        }
        es.addEventListener('session', function (ev) {
            try {
                var data = JSON.parse(ev.data);
                if (data) {
                    applySession(data.session);
                    applyRealtime(data.realtime);
                }
            } catch (e) {}
        });
        es.onopen = function () {
            esHealthy = true;
            stopPolling();
        };
        es.onerror = function () {
            esHealthy = false;
            if (!pollTimer) schedulePoll(POLL_FALLBACK_MS);
        };
    }

    function cancelSession() {
        fetch('/api/ai-session/end/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
              applySession(data && data.session);
              poll();
          }).catch(function () { hide(); });
    }

    if (cancelBtn) cancelBtn.addEventListener('click', cancelSession);

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            poll();
            if (!esHealthy && (!es || es.readyState === 2)) startSSE();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            startSSE();
            poll();
        });
    } else {
        startSSE();
        poll();
    }

    window.FuckSeatsAISession = {
        poll: poll,
        cancel: cancelSession,
        applySession: applySession
    };
})();
