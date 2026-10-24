function toggleFullScreen() {
    const doc = document;
    const root = document.documentElement;
    const isFullscreen = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
    if (!isFullscreen) {
        const enter = root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen || root.msRequestFullscreen;
        if (enter) {
            enter.call(root).catch(() => { });
        }
        return;
    }
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    if (exit) {
        exit.call(doc).catch(() => { });
    }
}

let currentScale = 1.0;
const gridContainer = document.getElementById('seat-grid-container');
const zoomLevelDisplay = document.getElementById('zoom-level');

function updateZoom() {
    if (!gridContainer) return;
    gridContainer.style.zoom = currentScale;

    if (zoomLevelDisplay) {
        zoomLevelDisplay.textContent = `${Math.round(currentScale * 100)}%`;
    }
}

function zoomIn() {
    currentScale = Math.min(currentScale + 0.1, 2.0);
    updateZoom();
}

function zoomOut() {
    currentScale = Math.max(currentScale - 0.1, 0.5);
    updateZoom();
}

const stage = document.querySelector('.seat-stage');
if (stage) {
    stage.addEventListener('wheel', function (e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0) zoomIn();
            else zoomOut();
        }
    });
}

(function () {

    var snapshotList = document.querySelector('.snapshot-list');
    if (snapshotList) snapshotList.addEventListener('click', function (e) {
        var syncLoadForm = e.target.closest('form[data-sync-snapshot-load]');
        if (syncLoadForm) {
            e.preventDefault();
            window.showConfirmModal('恢复会覆盖当前名单、布局、约束和历史记录；当前版本会先保存为本地快照。确定继续？', { title: '恢复同步前快照' })
                .then(function (confirmed) { if (confirmed) HTMLFormElement.prototype.submit.call(syncLoadForm); });
            return;
        }
        var loadLink = e.target.closest('[data-snapshot-load]');
        if (loadLink) {
            e.preventDefault();
            window.showConfirmModal('加载快照会用该快照覆盖当前全部排座，确定继续？', { title: '加载快照' })
                .then(function (confirmed) { if (confirmed) window.location.href = loadLink.href; });
            return;
        }
        var deleteForm = e.target.closest('form[data-snapshot-delete]');
        if (deleteForm) {
            e.preventDefault();
            window.showConfirmModal('删除后无法恢复，确定删除该快照？', { title: '删除快照' })
                .then(function (confirmed) {
                    if (!confirmed) return;
                    // programmatic submit() 不触发 submit 事件，改为派发让 ajaxifyForm 接管。
                    deleteForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                });
        }
    });
})();
