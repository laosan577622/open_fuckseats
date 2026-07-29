(function () {
    'use strict';

    var POLL_MS = 2500;
    var classroomRoot = document.getElementById('classroom-root');
    var currentClassroomId = classroomRoot ? String(classroomRoot.dataset.classroomId || '') : '';
    var isDataPage = !!document.querySelector(
        '.classroom-groups-workspace, .classroom-group-detail-page'
    ) && !currentClassroomId;
    var seenClassroomSeq = {};
    var seenDataSeq = null;
    var refreshInFlight = false;
    var refreshPending = false;

    function refreshCurrentClassroom() {
        if (!currentClassroomId || typeof window.refreshState !== 'function') return;
        if (refreshInFlight) {
            refreshPending = true;
            return;
        }
        refreshInFlight = true;
        try {
            var result = window.refreshState();
            Promise.resolve(result).finally(function () {
                refreshInFlight = false;
                if (refreshPending) {
                    refreshPending = false;
                    refreshCurrentClassroom();
                }
            });
        } catch (error) {
            refreshInFlight = false;
        }
    }

    function applyRealtime(rt) {
        if (!rt) return;
        if (isDataPage && typeof rt.data_seq === 'number') {
            if (seenDataSeq === null) {
                seenDataSeq = rt.data_seq;
            } else if (rt.data_seq !== seenDataSeq) {
                window.location.reload();
                return;
            }
        }
        if (!currentClassroomId || !rt.classroom_seq) return;
        var seq = rt.classroom_seq[currentClassroomId];
        if (typeof seq !== 'number') return;
        if (typeof seenClassroomSeq[currentClassroomId] !== 'number') {
            seenClassroomSeq[currentClassroomId] = seq;
        } else if (seenClassroomSeq[currentClassroomId] !== seq) {
            seenClassroomSeq[currentClassroomId] = seq;
            refreshCurrentClassroom();
        }
    }

    function poll() {
        fetch('/api/realtime/', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) { if (data) applyRealtime(data.realtime); })
            .catch(function () {})
            .finally(function () { window.setTimeout(poll, POLL_MS); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', poll);
    } else {
        poll();
    }
})();
