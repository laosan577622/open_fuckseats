/* 补充练习：小组、排座规则、快照、侧栏、Agent 授权、考场模式与 Drop。
   全部使用内置的虚构数据，不访问任何班级接口；由 welcome-lessons.js 统一渲染外壳和完成状态。
   每个练习：title 标题，prompt(lesson) 当前步骤的提示，render(ctx) 画出练习区并绑定操作。 */
window.WelcomeLessonExtras = (() => {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const seat = (name, row, col, {tag = '', info = '', cls = ''} = {}) => `
        <div class="seat ${name ? 'occupied' : ''} ${cls}" role="button" tabindex="0" data-row="${row}" data-col="${col}" data-cell-type="seat"
            aria-label="第${row}排第${col}列 ${name || '空座'}${tag ? '，' + tag : ''}${info ? '，' + info : ''}">
            <div class="${name ? 'seat-content' : 'seat-placeholder'}">${name
                ? `<span class="seat-name">${name}</span>${info ? `<span class="seat-info">${info}</span>` : ''}`
                : `${row}-${col}`}</div>
            ${tag ? `<div class="seat-group-tag">${tag}</div>` : ''}
        </div>`;
    const aisle = () => '<div class="seat cell-aisle" aria-hidden="true"><div class="seat-placeholder">走廊</div></div>';
    const grid = rows => `<div class="seat-grid">${rows.map(cells => `<div class="seat-row">${cells.join('')}</div>`).join('')}</div>`;
    const caption = text => `<p class="welcome-caption">${text}</p>`;
    const controls = html => `<div class="welcome-lesson-controls">${html}</div>`;
    const on = (stage, action, handler) => stage.querySelector(`[data-lesson-action="${action}"]`)?.addEventListener('click', handler);

    const lessons = {
        leader: {
            title: '任命一位组长',
            prompt: () => '右键李华的座位，选择“任命为组长”。使用键盘时可点击下方的菜单按钮。',
            render({stage, lesson, complete, button}) {
                stage.innerHTML = grid([[
                    seat('张明', 1, 1, {tag: '第一组'}),
                    seat('李华', 1, 2, {tag: '第一组', cls: lesson.done ? 'is-leader' : ''}),
                    seat('陈晨', 1, 3, {tag: '第一组'}),
                ]]) + (lesson.done
                    ? caption('李华 · 第一组组长。导出小组登记表时会标出组长。')
                    : button('打开李华的座位菜单', 'menu'))
                    + '<div class="welcome-lesson-menu" role="menu" hidden><button type="button" class="menu-item-button" role="menuitem" data-lesson-action="leader">任命为组长</button></div>';
                const target = stage.querySelectorAll('.seat')[1];
                const open = event => {
                    event?.preventDefault();
                    if (lesson.done) return;
                    const menu = stage.querySelector('[role=menu]');
                    menu.hidden = false;
                    menu.querySelector('button').focus();
                };
                target.oncontextmenu = open;
                on(stage, 'menu', open);
                on(stage, 'leader', complete);
            },
        },
        autogroup: {
            title: '按参考小组自动编组',
            prompt: () => '第一组已经分好。选择“第一组”作为参考，再点击“自动编组”，其余座位会按同样的形状编成小组。',
            render({stage, lesson, complete, button, tell}) {
                const tags = lesson.done ? ['第一组', '第一组', '第二组', '第二组', '第三组', '第三组'] : ['第一组', '第一组', '', '', '', ''];
                stage.innerHTML = grid([['张明', '李华', '陈晨', '王悦', '林晓', '周宁'].map((name, index) => seat(name, 1, index + 1, {tag: tags[index]}))])
                    + controls(`<label>参考小组 <select aria-label="参考小组" ${lesson.done ? 'disabled' : ''}><option value="">请选择</option><option value="1" ${lesson.done ? 'selected' : ''}>第一组</option></select></label>${button(lesson.done ? '已编为三组' : '自动编组', 'auto', lesson.done)}`)
                    + (lesson.done ? caption('人数除不尽时，可以选择并入上一组、另编一组或不编组。') : '');
                on(stage, 'auto', () => {
                    if (stage.querySelector('select').value !== '1') { tell('先选择“第一组”作为参考小组。'); return; }
                    complete();
                });
            },
        },
        grouprotate: {
            title: '让小组轮换位置',
            prompt: () => '点击“小组轮换”，两个小组整体交换位置，组内的同桌关系保持不变。',
            render({stage, lesson, complete, button}) {
                const first = [seat('张明', 1, 1, {tag: '第一组'}), seat('李华', 1, 2, {tag: '第一组'})];
                const second = [seat('陈晨', 1, 4, {tag: '第二组'}), seat('王悦', 1, 5, {tag: '第二组'})];
                const order = lesson.done
                    ? [seat('陈晨', 1, 1, {tag: '第二组'}), seat('王悦', 1, 2, {tag: '第二组'}), aisle(), seat('张明', 1, 4, {tag: '第一组'}), seat('李华', 1, 5, {tag: '第一组'})]
                    : [...first, aisle(), ...second];
                stage.innerHTML = grid([order]) + controls(button(lesson.done ? '已轮换一次' : '小组轮换', 'rotate', lesson.done))
                    + (lesson.done ? caption('每周轮换一次，可以让各组轮流坐到前排或靠窗的位置。') : '');
                on(stage, 'rotate', complete);
            },
        },
        constraint: {
            title: '让两位同学分开坐',
            prompt: lesson => lesson.phase
                ? '约束已添加。点击“自动排座”，看看排座结果。'
                : '为张明和李华选择“不能相邻”，再点击“添加约束”。',
            render({stage, lesson, complete, rerender, button, tell}) {
                const names = lesson.done ? ['张明', '陈晨', '李华', '王悦'] : ['张明', '李华', '陈晨', '王悦'];
                let html = grid([names.map((name, index) => seat(name, 1, index + 1))]);
                if (lesson.done) html += caption('张明、李华已分开。约束无法满足时，排座会提示并回滚。');
                else if (lesson.phase) html += caption('约束：张明、李华 不能相邻') + controls(button('自动排座', 'arrange'));
                else html += controls(`<label>张明 与 李华 <select aria-label="约束规则"><option value="">选择规则</option><option value="together">必须相邻</option><option value="apart">不能相邻</option></select></label>${button('添加约束', 'add')}`);
                stage.innerHTML = html;
                on(stage, 'add', () => {
                    if (stage.querySelector('select').value !== 'apart') { tell('这次请选择“不能相邻”。'); return; }
                    lesson.phase = 1;
                    rerender();
                });
                on(stage, 'arrange', complete);
            },
        },
        tags: {
            title: '给学生打标签',
            prompt: () => '为张明选择“近视”标签并应用。标签可以用来设置“只能坐前排”这样的规则。',
            render({stage, lesson, complete, button, tell}) {
                stage.innerHTML = grid([[seat('张明', 1, 1, {info: lesson.done ? '近视' : ''}), seat('李华', 1, 2)]])
                    + controls(`<label>给张明添加 <select aria-label="标签" ${lesson.done ? 'disabled' : ''}><option value="">选择标签</option><option value="near" ${lesson.done ? 'selected' : ''}>近视</option><option value="cadre">班干部</option></select></label>${button(lesson.done ? '已添加标签' : '应用', 'tag', lesson.done)}`)
                    + (lesson.done ? caption('在侧栏“标签”页可以为“近视”设置只能坐区域、不能坐区域或同标签保持距离。') : '');
                on(stage, 'tag', () => {
                    if (stage.querySelector('select').value !== 'near') { tell('这次请选择“近视”。'); return; }
                    complete();
                });
            },
        },
        preference: {
            title: '换座时不坐回原位',
            prompt: () => '勾选“尽量不重复位置”，再勾选“尽量不在原行”或“尽量不在原列”，然后点击“按偏好重新排座”。',
            render({stage, lesson, complete, button, tell, persist}) {
                const options = lesson.data ||= {position: false, row: false, col: false};
                const before = [['张明', '李华'], ['陈晨', '王悦']];
                let layout = before;
                if (lesson.done) {
                    if (options.row) layout = [layout[1], layout[0]];
                    if (options.col) layout = layout.map(row => [row[1], row[0]]);
                }
                const moved = [options.row, options.col].map(flag => lesson.done && flag ? 4 : 0);
                stage.innerHTML = grid(layout.map((row, r) => row.map((name, c) => seat(name, r + 1, c + 1))))
                    + (lesson.done
                        ? caption(`对比上次快照：${moved[0]}/4 人离开原行，${moved[1]}/4 人离开原列。`)
                        : caption('上次保存的快照'))
                    + `<div class="welcome-lesson-prefs" role="group" aria-label="位置偏好">
                        <label><input type="checkbox" data-pref="position" ${options.position ? 'checked' : ''} ${lesson.done ? 'disabled' : ''}> 尽量不重复位置</label>
                        <div class="welcome-lesson-subprefs">
                            <label><input type="checkbox" data-pref="row" ${options.row ? 'checked' : ''} ${lesson.done || !options.position ? 'disabled' : ''}> 尽量不在原行</label>
                            <label><input type="checkbox" data-pref="col" ${options.col ? 'checked' : ''} ${lesson.done || !options.position ? 'disabled' : ''}> 尽量不在原列</label>
                        </div>
                    </div>`
                    + controls(button(lesson.done ? '已按偏好排座' : '按偏好重新排座', 'arrange', lesson.done));
                stage.querySelectorAll('[data-pref]').forEach(input => input.onchange = () => {
                    options[input.dataset.pref] = input.checked;
                    if (!options.position) options.row = options.col = false;
                    stage.querySelectorAll('[data-pref="row"], [data-pref="col"]').forEach(child => {
                        child.disabled = !options.position;
                        child.checked = options[child.dataset.pref];
                    });
                    persist();
                });
                on(stage, 'arrange', () => {
                    if (!options.position) { tell('先勾选“尽量不重复位置”。'); return; }
                    if (!options.row && !options.col) { tell('再勾选“尽量不在原行”或“尽量不在原列”，看看区别。'); return; }
                    complete();
                });
            },
        },
        champion: {
            title: '单科王同桌',
            prompt: () => '在排座算法中选择“单科王同桌”，再点击“自动排座”。每人取最高分的一科，同科的同学会排成同桌。',
            render({stage, lesson, complete, button, tell}) {
                const students = {张明: '语文 128', 李华: '数学 136', 陈晨: '语文 121', 王悦: '数学 130'};
                const order = lesson.done ? ['张明', '陈晨', '李华', '王悦'] : ['张明', '李华', '陈晨', '王悦'];
                const cells = order.map((name, index) => seat(name, 1, index < 2 ? index + 1 : index + 2, {info: students[name]}));
                stage.innerHTML = grid([[cells[0], cells[1], aisle(), cells[2], cells[3]]])
                    + controls(`<label>排座算法 <select aria-label="排座算法" ${lesson.done ? 'disabled' : ''}><option value="random">随机排座</option><option value="subject_champion" ${lesson.done ? 'selected' : ''}>单科王同桌</option></select></label>${button(lesson.done ? '已完成排座' : '自动排座', 'arrange', lesson.done)}`)
                    + (lesson.done ? caption('2/2 对同桌最高分科目相同。各科成绩在导入成绩表时作为自定义信息一并导入。') : '');
                on(stage, 'arrange', () => {
                    if (stage.querySelector('select').value !== 'subject_champion') { tell('请先选择“单科王同桌”。'); return; }
                    complete();
                });
            },
        },
        snapshot: {
            title: '保存一份座位快照',
            prompt: lesson => ['给当前座位起个名字，点击“保存快照”。', '快照已保存。点击“随机调整”，模拟之后的改动。', '点击“加载快照”，回到保存时的座位。'][lesson.phase || 0],
            render({stage, lesson, complete, rerender, button, tell}) {
                const data = lesson.data ||= {name: ''};
                const names = lesson.phase === 2 && !lesson.done ? ['陈晨', '张明', '李华'] : ['张明', '李华', '陈晨'];
                let html = grid([names.map((name, index) => seat(name, 1, index + 1))]);
                if (lesson.done) html += caption(`已恢复到“${escape(data.name)}”。自动排座的位置偏好也会参考已保存的快照。`);
                else if (lesson.phase === 2) html += controls(button(`加载快照“${escape(data.name)}”`, 'load'));
                else if (lesson.phase === 1) html += caption(`已保存：${escape(data.name)}`) + controls(button('随机调整', 'shuffle'));
                else html += controls(`<label>快照名称 <input type="text" aria-label="快照名称" maxlength="20" placeholder="例如：期中考试座位"></label>${button('保存快照', 'save')}`);
                stage.innerHTML = html;
                on(stage, 'save', () => {
                    const name = stage.querySelector('input').value.trim();
                    if (!name) { tell('先填写快照名称。'); return; }
                    data.name = name;
                    lesson.phase = 1;
                    rerender();
                });
                on(stage, 'shuffle', () => { lesson.phase = 2; rerender(); });
                on(stage, 'load', complete);
            },
        },
        sidebar: {
            title: '调整右侧工作面板',
            prompt: lesson => [
                '拖动滑块调整侧栏宽度。在班级页面里，直接拖动侧栏的左边缘，双击恢复默认宽度。',
                '点击“收起侧栏”，把空间全部留给座位。',
                '再点击“展开侧栏”。也可以用“视图”菜单或 Ctrl / Command + \\ 切换。',
            ][lesson.phase || 0],
            render({stage, lesson, complete, rerender, button, persist}) {
                const data = lesson.data ||= {width: 430};
                const collapsed = lesson.phase === 2 && !lesson.done;
                stage.innerHTML = `<div class="welcome-split-demo${collapsed ? ' is-collapsed' : ''}" style="--demo-side:${Math.round(data.width / 12)}%">
                        <div class="welcome-split-demo-stage">座位区</div>
                        <div class="welcome-split-demo-side" aria-hidden="${collapsed}">学生 · 小组 · 约束</div>
                    </div>`
                    + controls(`<label>侧栏宽度 <input type="range" min="300" max="720" step="10" value="${data.width}" aria-label="侧栏宽度" ${lesson.phase ? 'disabled' : ''}></label>`
                        + (lesson.phase ? button(lesson.done ? '侧栏已展开' : collapsed ? '展开侧栏' : '收起侧栏', 'toggle', lesson.done) : ''))
                    + (lesson.done ? caption('宽度和收起状态会记住，下次打开班级时保持不变。') : '');
                const range = stage.querySelector('input[type=range]');
                range.oninput = () => {
                    data.width = Number(range.value);
                    stage.querySelector('.welcome-split-demo').style.setProperty('--demo-side', `${Math.round(data.width / 12)}%`);
                };
                range.onchange = () => {
                    if (data.width === 430) { persist(); return; }
                    lesson.phase = 1;
                    rerender();
                };
                on(stage, 'toggle', () => {
                    if (lesson.phase === 1) { lesson.phase = 2; rerender(); } else complete();
                });
            },
        },
        agent: {
            title: '让 AI 助手连接应用',
            prompt: lesson => lesson.phase
                ? '这是 AI 助手申请访问时弹出的窗口。看清程序名称和范围，再选择一个处理方式。'
                : 'AI 助手不需要密钥也能发起申请，由你在应用里决定是否放行。点击按钮模拟一次申请。',
            render({stage, lesson, complete, rerender, button}) {
                const data = lesson.data ||= {choice: ''};
                const results = {
                    full: '已允许读取和修改。授权只在本次应用运行期间有效，关闭应用后自动失效。',
                    read: '已允许读取。这个程序不能修改或删除任何数据。',
                    deny: '已拒绝。这个程序拿不到任何数据，需要时可以重新申请。',
                };
                if (lesson.done) stage.innerHTML = '<div class="welcome-service">「示例助手」<small>' + results[data.choice || 'deny'] + '</small></div>';
                else if (lesson.phase) stage.innerHTML = `<div class="welcome-agent-demo" role="group" aria-label="授权申请示例">
                        <p class="agent-access-client"><strong>「示例助手」</strong>申请读取并修改不想排座位的数据</p>
                        <ul class="agent-access-scope"><li>读取班级、座位排列、名单和成绩等资料</li><li>调整座位、执行自动排座，修改或删除数据</li></ul>
                        <div class="welcome-lesson-controls">${button('拒绝', 'deny')}${button('仅允许读取', 'read')}${button('允许读取和修改', 'full')}</div>
                    </div>`;
                else stage.innerHTML = controls(button('模拟一次授权申请', 'request'));
                on(stage, 'request', () => { lesson.phase = 1; rerender(); });
                ['deny', 'read', 'full'].forEach(choice => on(stage, choice, () => { data.choice = choice; complete(); }));
            },
        },
        exam: {
            title: '了解考场模式',
            prompt: () => '考试前把日常座位变成单人单列的考场，考完再恢复。阅读三个步骤后点击“知道了”。',
            render({stage, lesson, complete, button}) {
                stage.innerHTML = '<div class="welcome-service">1　设置门的位置<small>在教室图上标出出入口，从工具栏进入“考场模式”</small></div>'
                    + '<div class="welcome-service">2　选择考场布局<small>输入考生人数，查看哪些桌子保留、搬出或补入，并播放搬运路线</small></div>'
                    + '<div class="welcome-service">3　编桌号并打印<small>按组、按排或 S 型编号；考试结束后生成搬回路线，恢复原座位</small></div>'
                    + controls(button(lesson.done ? '已了解' : '知道了', 'ok', lesson.done));
                on(stage, 'ok', complete);
            },
        },
        drop: {
            title: 'Drop 到教室大屏',
            prompt: () => '点击“Drop”，把当前座次图交给本机的不想班管教师端。练习不会真的发送。',
            render({stage, lesson, complete, button}) {
                stage.innerHTML = grid([[seat('张明', 1, 1, {tag: '第一组'}), seat('李华', 1, 2, {tag: '第一组'})]])
                    + controls(button(lesson.done ? '已打开教师端' : 'Drop', 'drop', lesson.done))
                    + caption(lesson.done
                        ? '教师端会弹出窗口，由你选择教室和显示内容。'
                        : 'Drop 只发送当前布局、学生资料和小组信息，不包含历史、快照和排座规则。');
                on(stage, 'drop', complete);
            },
        },
    };

    return {
        lessons,
        titles: Object.fromEntries(Object.entries(lessons).map(([kind, lesson]) => [kind, lesson.title])),
        // 只在云控开启对应功能后才出现的练习。
        gated: {drop: 'drop'},
    };
})();
