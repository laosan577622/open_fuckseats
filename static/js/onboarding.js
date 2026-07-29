(function () {
    if (window.startOnboarding) return;

    var SEEN_URL = '/onboarding/seen';
    var SEEN_KEY = 'fuckseats_onboarding_seen';
    var STEP_KEY = 'onboarding_detail_step';
    var LAYOUT_STEP_KEY = 'onboarding_layout_step';
    var LAYOUT_DONE_KEY = 'onboarding_layout_done';
    var DATA_SHARING_AFTER_ONBOARDING_KEY = 'fuckseats_show_data_sharing_after_onboarding';

    function driverLib() {
        return (window.driver && window.driver.js) ? window.driver.js : null;
    }

    function getCsrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) return meta.content;
        var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function hasSeenLocally() {
        try {
            var value = localStorage.getItem(SEEN_KEY);
            return value === '1' || value === 'true' || value === 'seen';
        } catch (e) {
            return false;
        }
    }

    function rememberSeenLocally() {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    }

    function isCompletionStage(stage) {
        return stage === 'detail_done' || stage === 'tour_done';
    }

    function queueDataSharingPromptAfterOnboarding(stage) {
        if (!isCompletionStage(stage)) return;
        try { sessionStorage.setItem(DATA_SHARING_AFTER_ONBOARDING_KEY, '1'); } catch (e) {}
    }

    function markSeenOnServer(stage) {
        rememberSeenLocally();
        queueDataSharingPromptAfterOnboarding(stage);
        if (isCompletionStage(stage)) {
            window.ONBOARDING_SHOULD_SHOW = false;
            window.FUCKSEATS_ONBOARDING_ACTIVE = false;
        }
        try {
            fetch(SEEN_URL, {
                method: 'POST',
                credentials: 'same-origin',
                keepalive: true,
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({
                    completed_steps: stage || '',
                    current_classroom_id: currentOnboardingClassroomPk() || ''
                })
            }).then(function (res) {
                return res && res.ok ? res.json() : null;
            }).then(function (data) {
                if (isCompletionStage(stage)) {
                    var homeUrl = (data && data.redirect_url) ? data.redirect_url : '';
                    if (!homeUrl) {
                        var logo = document.querySelector('a.logo[href]');
                        homeUrl = logo ? logo.getAttribute('href') : '/';
                    }
                    window.setTimeout(function () {
                        window.location.href = homeUrl;
                    }, 420);
                    return;
                }
            }).catch(function () {});
        } catch (e) {}
    }

    function readStep(key, len) {
        try {
            var saved = parseInt(sessionStorage.getItem(key), 10);
            if (!isNaN(saved) && saved > 0 && saved < len) return saved;
        } catch (e) {}
        return 0;
    }

    function saveStep(key, idx) {
        try { if (typeof idx === 'number') sessionStorage.setItem(key, String(idx)); } catch (e) {}
    }

    function isIndexPage() {
        return !!document.querySelector('.classrooms-grid');
    }

    function isLayoutEditorPage() {
        return !!document.getElementById('layout-root');
    }

    function currentClassroomPk() {
        var root = document.getElementById('classroom-root');
        return root ? (root.dataset.classroomId || null) : null;
    }

    function currentLayoutClassroomPk() {
        var root = document.getElementById('layout-root');
        return root ? (root.dataset.classroomId || null) : null;
    }

    function currentOnboardingClassroomPk() {
        return currentClassroomPk() || currentLayoutClassroomPk() || null;
    }

    function firstRowMiddleLayoutSeat() {
        var seats = Array.prototype.slice.call(document.querySelectorAll('#seat-grid-container .seat[data-row="1"]'));
        if (!seats.length) return document.querySelector('#seat-grid-container .seat');
        seats.sort(function (a, b) {
            return parseInt(a.dataset.col || '0', 10) - parseInt(b.dataset.col || '0', 10);
        });
        return seats[Math.floor((seats.length - 1) / 2)] || seats[0];
    }

    function isLayoutGridContextEvent(event) {
        if (!event) return false;
        if (event.type === 'fuckseats:layout-contextmenu') return true;
        var target = event.target;
        return !!(target && target.closest && target.closest('#seat-grid-container'));
    }

    function switchRibbon(tabKey) {
        var tab = document.querySelector('.ribbon-tab[data-ribbon-tab="' + tabKey + '"]');
        if (tab) tab.click();
    }

    function clickTab(tabKey) {
        var tab = document.querySelector('.tab-btn[data-tab="' + tabKey + '"]');
        if (tab) tab.click();
    }

    function resolveElement(target) {
        if (!target) return null;
        if (typeof target === 'function') return target();
        if (typeof target === 'string') return document.querySelector(target);
        return target;
    }

    function runTour(opts) {
        var lib = driverLib();
        if (!lib) return;
        var steps = opts.steps;
        var stepKey = opts.stepKey;
        var startStep = opts.startStep != null ? opts.startStep : readStep(stepKey, steps.length);
        var onComplete = opts.onComplete || function () {};
        var exitByClose = false;
        var boundListeners = [];

        function resolvedSteps() {
            return steps.map(function (step) {
                if (!step || typeof step.element !== 'function') return step;
                var resolved = {};
                Object.keys(step).forEach(function (key) { resolved[key] = step[key]; });
                resolved.element = resolveElement(step.element);
                return resolved;
            });
        }

        function unbindAdvanceListeners() {
            boundListeners.forEach(function (item) {
                try { item.target.removeEventListener(item.type, item.handler, true); } catch (e) {}
            });
            boundListeners = [];
        }

        function bindAdvanceListeners(step, element) {
            var advanceOn = step.advanceOn;
            if (advanceOn == null && !step.manual) advanceOn = 'click';
            if (advanceOn === false || step.manual) return;
            var events = Array.isArray(advanceOn) ? advanceOn : [advanceOn];
            var target = step.advanceScope === 'document' ? document : (element || document);
            events.forEach(function (eventName) {
                var handler = function (event) {
                    if (typeof step.shouldAdvance === 'function' && !step.shouldAdvance(event)) return;
                    unbindAdvanceListeners();
                    try {
                        var i = d.getActiveIndex();
                        saveStep(stepKey, i + 1);
                    } catch (err) {}
                    window.setTimeout(function () {
                        try { d.moveNext(); } catch (err) {}
                    }, step.advanceDelay || 0);
                };
                try {
                    target.addEventListener(eventName, handler, true);
                    boundListeners.push({ target: target, type: eventName, handler: handler });
                } catch (e) {}
            });
        }

        function advanceCurrentStepSoon(step, delay) {
            var expectedIndex = -1;
            try { expectedIndex = d.getActiveIndex(); } catch (err) {}
            window.setTimeout(function () {
                if (typeof step.autoAdvanceWhen === 'function' && !step.autoAdvanceWhen()) return;
                try {
                    var i = d.getActiveIndex();
                    if (expectedIndex !== -1 && i !== expectedIndex) return;
                    saveStep(stepKey, i + 1);
                    d.moveNext();
                } catch (err) {}
            }, delay == null ? 160 : delay);
        }

        var d = lib.driver({
            showProgress: true,
            animate: true,
            allowClose: false,
            disableActiveInteraction: false,
            doneBtnText: opts.doneBtnText || '完成引导',
            nextBtnText: '下一步',
            prevBtnText: '上一步',
            steps: resolvedSteps(),
            onHighlighted: function (element) {
                try { saveStep(stepKey, d.getActiveIndex()); } catch (e) {}
                unbindAdvanceListeners();
                var step = steps[d.getActiveIndex()] || {};
                if (typeof step.onHighlightStarted === 'function') {
                    try { step.onHighlightStarted(element); } catch (e) {}
                }
                bindAdvanceListeners(step, element);
                if (typeof step.autoAdvanceWhen === 'function' && step.autoAdvanceWhen()) {
                    advanceCurrentStepSoon(step, step.autoAdvanceDelay);
                }
            },
            onDeselected: function () { unbindAdvanceListeners(); },
            onCloseClick: function () {
                exitByClose = true;
                d.destroy();
            },
            onDestroyStarted: function () {
                unbindAdvanceListeners();
                window.FUCKSEATS_ONBOARDING_ACTIVE = false;
                if (exitByClose) {
                    exitByClose = false;
                    d.destroy();
                    return;
                }
                d.destroy();
                try { sessionStorage.removeItem(stepKey); } catch (e) {}
                onComplete();
            }
        });

        window.FUCKSEATS_ONBOARDING_ACTIVE = true;
        d.drive(startStep);
        return d;
    }

    function startIndexTour(force) {
        var lib = driverLib();
        if (!lib) return;
        if (!force && window.ONBOARDING_SHOULD_SHOW !== true) return;
        var sampleCard = document.querySelector('.classroom-card-link[data-sample="1"]');
        if (!sampleCard) return;

        var d = lib.driver({
            animate: true,
            showProgress: false,
            allowClose: false,
            disableActiveInteraction: false,
            steps: [
                {
                    element: sampleCard,
                    popover: {
                        title: '欢迎来到 不想排座位',
                        description: '我们帮你建好了一个「示例班级」，里面已经放好示例名单。点进去，跟着提示走一遍就能上手。',
                        doneBtnText: '稍后再说'
                    }
                }
            ],
            onDestroyStarted: function () {
                d.destroy();
                markSeenOnServer('index_skip');
            }
        });
        d.drive();
    }

    var DETAIL_STEPS = [
        {
            element: '.header-content',
            manual: true,
            popover: {
                title: '欢迎来到 不想排座位',
                description: '示例名单和两个示例小组都帮你准备好了。跟着提示点点按钮、拖拖座位，很快就能上手。复杂的地方慢慢试，试好再点「下一步」；有些步骤你一点按钮就会自动往下走。'
            }
        },
        {
            element: '.seat-stage',
            manual: true,
            popover: {
                title: '排座区域',
                description: '这里就是教室的座位。现在示例学生还没入座，下面先把他们排进去。'
            }
        },
        {
            element: '#btn-auto-arrange',
            popover: {
                title: '一键自动排座',
                description: '点「执行排座」，学生就会自动排进座位里。排好后会接着往下走。'
            },
            onHighlightStarted: function () { switchRibbon('home'); }
        },
        {
            element: '#btn-layout-editor',
            popover: {
                title: '先看看教室布局',
                description: '点「布局编辑」，进去调整教室的样子，比如加走廊、加讲台。改完再回来继续。'
            },
            onHighlightStarted: function () { switchRibbon('view'); }
        },
        {
            element: '.seat-stage',
            manual: true,
            popover: {
                title: '讲台左右护法',
                description: '刚才在布局里设置了讲台，讲台左右两边最近的座位会自动成为左护法和右护法的位置。谁坐在这两个座位上，谁就是护法。'
            }
        },
        {
            element: '.seat-stage',
            advanceOn: 'fuckseats:student-moved',
            advanceScope: 'document',
            popover: {
                title: '拖拽换座',
                description: '拖动一个已经入座的学生到别的座位，可以搬过去，也可以和那个座位的学生互换。换好后会接着往下走。'
            }
        },
        {
            element: '.seat-stage',
            advanceOn: 'fuckseats:student-moved',
            advanceScope: 'document',
            popover: {
                title: '双击输入学号快速换座',
                description: '双击任意座位，在输入框中填写另一名学生的完整学号，或输入姓名和姓名首字母，即可直接换座。请实际完成一次快速换座。'
            }
        },
        {
            element: '.seat-stage',
            advanceOn: 'contextmenu',
            popover: {
                title: '座位右键菜单',
                description: '在任意座位上右键，里面有好几个操作，比如清空、复制、固定座位、任命组长。打开菜单后接着往下走。'
            }
        },
        {
            element: '#seat-context-menu',
            manual: true,
            popover: {
                title: '右键可以继续操作',
                description: '可以随便点一两个试试。比如复制一个学生，再右键空座位粘贴。试好点「下一步」。'
            }
        },
        {
            element: '#main-tab-header',
            manual: true,
            popover: {
                title: '侧边功能面板',
                description: '这里有几个标签页，下面去「小组」看看怎么分组。'
            }
        },
        {
            element: '.tab-btn[data-tab="groups"]',
            popover: {
                title: '进入小组工具',
                description: '点「小组」标签页。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '#groupAssignToggle',
            popover: {
                title: '开启分组模式',
                description: '点「分组模式」。开启后在座位区点或框选多个座位，选中的座位可以一起分到同一个小组。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '.seat-stage',
            manual: true,
            popover: {
                title: '选几个座位',
                description: '在座位区点几个座位，也可以按住鼠标框选一片。选好点「下一步」。'
            }
        },
        {
            element: '#groupSelect',
            advanceOn: 'change',
            popover: {
                title: '选择目标小组',
                description: '选一个小组，比如「第一组」。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '#groupApplyBtn',
            popover: {
                title: '应用到选中',
                description: '点「应用到选中」，刚才选的座位就归到这个小组了，座位上会显示小组标签。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '.seat-stage',
            advanceOn: 'contextmenu',
            popover: {
                title: '在小组里试右键',
                description: '右键一个带小组标签的座位，可以任命或取消组长。打开菜单后接着往下走。'
            }
        },
        {
            element: '#seat-context-menu',
            manual: true,
            popover: {
                title: '任命组长',
                description: '菜单里如果有「任命为组长」，可以点一下试试，那个学生就成了这个组的组长。试好点「下一步」。'
            }
        },
        {
            element: '#groupToolsToggle',
            popover: {
                title: '小组详情',
                description: '点开「小组详情」，这里能加小组、改名字、删小组。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '#groupList',
            manual: true,
            popover: {
                title: '小组可修改',
                description: '可以试试改小组名字，或者加一个新小组。改好点「下一步」。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '#groupAutoBtn',
            popover: {
                title: '自动编组',
                description: '点「自动编组」，可以按一个已有小组的样子，自动把别的座位也编成小组。'
            },
            onHighlightStarted: function () { clickTab('groups'); }
        },
        {
            element: '#groupAutoReferenceSelect',
            advanceOn: 'change',
            popover: {
                title: '选择参考小组',
                description: '选一个刚才用过的小组作为参考。不想试的话直接点下一步就行。'
            }
        },
        {
            element: '#groupAutoConfirmBtn',
            popover: {
                title: '开始编组',
                description: '点「开始编组」，就按参考小组的样子生成其它小组。'
            }
        },
        {
            element: '#btn-shift-layout-left',
            manual: true,
            popover: {
                title: '整体移动',
                description: '在「变换」面板里可以把整个座位一起左移、右移、前移、后移，或者镜像翻转。'
            },
            onHighlightStarted: function () { switchRibbon('transform'); }
        },
        {
            element: '#shortcut-actions',
            manual: true,
            popover: {
                title: '撤销与重做',
                description: '哪一步做错了，用这里的撤销和重做就能退回去或再做一遍。'
            }
        },
        {
            element: '.tab-btn[data-tab="files"]',
            popover: {
                title: '导入与导出',
                description: '点「文件」标签页，这里能导入 Excel 名单，也能导出 Excel、图片、PPT，还能存布局快照。'
            },
            onHighlightStarted: function () { clickTab('files'); }
        },
        {
            element: '#cloud-header-area',
            popover: {
                title: '登录云服务',
                description: '最后，点右上角「登录」老三账号，就能在多设备间同步班级、备份座位表。引导走完后，示例班级会自动删掉，不会留在你的列表里。'
            },
            onHighlightStarted: function () { switchRibbon('home'); clickTab('students'); }
        }
    ];

    function startDetailTour(force) {
        var pk = currentClassroomPk();
        var isSample = pk != null && String(window.ONBOARDING_SAMPLE_PK) === String(pk);
        var shouldShow = force === true || (window.ONBOARDING_SHOULD_SHOW === true && isSample);
        if (!shouldShow) return;
        runTour({
            steps: DETAIL_STEPS,
            stepKey: STEP_KEY,
            doneBtnText: '完成引导',
            onComplete: function () {
                markSeenOnServer('detail_done');
                try { sessionStorage.removeItem(LAYOUT_DONE_KEY); } catch (e) {}
            }
        });
    }

    var LAYOUT_STEPS = [
        {
            element: '.seat-stage',
            manual: true,
            popover: {
                title: '布局编辑器',
                description: '这里可以改动教室的形状。跟着提示做几个常见操作就行。'
            }
        },
        {
            element: '#seat-grid-container .seat',
            manual: true,
            popover: {
                title: '先选座位',
                description: '点一个或几个座位，也可以按住鼠标在空白处框选一片。选好点「下一步」。'
            }
        },
        {
            element: '.tool-btn[data-tool="aisle"]',
            popover: {
                title: '把座位改成走廊',
                description: '点「走廊」，刚才选中的座位就变成走廊了。'
            }
        },
        {
            element: '#seat-grid-container .seat',
            advanceOn: ['contextmenu', 'fuckseats:layout-contextmenu'],
            advanceScope: 'document',
            shouldAdvance: isLayoutGridContextEvent,
            popover: {
                title: '右键菜单',
                description: '在任意格子上右键，可以快速设成座位、走廊、讲台、空位，也能插入或删除整行整列。'
            }
        },
        {
            element: '#contextMenu button[data-rc-action="insert_col"]',
            popover: {
                title: '添加一列',
                description: '点「在左侧插入列」，教室就多了一列。想多加几列，可以再右键重复加。'
            }
        },
        {
            element: '#seat-grid-container',
            manual: true,
            popover: {
                title: '框选几列做走廊',
                description: '用鼠标框选其中一列或几列座位，准备改成走廊。选好点「下一步」。'
            }
        },
        {
            element: '.tool-btn[data-tool="aisle"]',
            popover: {
                title: '应用走廊',
                description: '再点一次「走廊」，刚才框选的列就都变成走廊了。'
            }
        },
        {
            element: firstRowMiddleLayoutSeat,
            advanceOn: ['contextmenu', 'fuckseats:layout-contextmenu'],
            advanceScope: 'document',
            shouldAdvance: isLayoutGridContextEvent,
            popover: {
                title: '在最前面加一行',
                description: '右键第一行中间附近的格子，准备在它上面加一行。'
            }
        },
        {
            element: '#contextMenu button[data-rc-action="insert_row"]',
            popover: {
                title: '插入新的第一行',
                description: '点「在上方插入行」，加出来的就是新的第一行。'
            }
        },
        {
            element: firstRowMiddleLayoutSeat,
            manual: true,
            popover: {
                title: '选中新第一行中间',
                description: '现在高亮的就是新第一行的中间位置。点一下选中它。'
            }
        },
        {
            element: '.tool-btn[data-tool="podium"]',
            popover: {
                title: '设置讲台',
                description: '点「讲台」，把刚才选中的格子改成讲台。'
            }
        },
        {
            element: '#togglePreviewBtn',
            popover: {
                title: '打开预览',
                description: '点「打开预览」，能半透明地看到学生入座的样子，方便边改边看。'
            }
        },
        {
            element: '.header-action-row a.btn[href*="/classroom/"]',
            popover: {
                title: '返回排座',
                description: '点「返回排座」，接着回去体验换座和其它功能。'
            }
        }
    ];

    function startLayoutTour(force) {
        var pk = currentLayoutClassroomPk();
        var isSample = pk != null && String(window.ONBOARDING_SAMPLE_PK) === String(pk);
        var layoutDone = false;
        try { layoutDone = sessionStorage.getItem(LAYOUT_DONE_KEY) === '1'; } catch (e) {}
        var shouldShow = force === true || (window.ONBOARDING_SHOULD_SHOW === true && isSample && !layoutDone);
        if (!shouldShow) return;
        runTour({
            steps: LAYOUT_STEPS,
            stepKey: LAYOUT_STEP_KEY,
            doneBtnText: '完成布局引导',
            onComplete: function () {
                try { sessionStorage.setItem(LAYOUT_DONE_KEY, '1'); } catch (e) {}
            }
        });
    }

    function startOnboarding(force) {
        if (force !== true && hasSeenLocally()) return;
        if (isIndexPage()) { startIndexTour(force); return; }
        if (isLayoutEditorPage()) { startLayoutTour(force); return; }
        if (currentClassroomPk()) { startDetailTour(force); return; }
    }

    function maybeAutoStart() {
        if (window.ONBOARDING_SHOULD_SHOW !== true) return;
        if (hasSeenLocally()) return;
        if (!driverLib()) return;
        startOnboarding(false);
    }

    window.startOnboarding = startOnboarding;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeAutoStart);
    } else {
        maybeAutoStart();
    }
})();
