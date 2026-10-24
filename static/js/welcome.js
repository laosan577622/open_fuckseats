/* Each exercise owns a synthetic scene. No classroom API is used here. */
document.addEventListener('DOMContentLoaded', async () => {
    await window.OnboardingStore.ready;
    if (window.FUCKSEATS_ONBOARDING_REDIRECTING) return;
    const store = window.OnboardingStore;
    const boot = store.boot || {};
    const pages = ['welcome', 'drag', 'initials', 'history', 'layout', 'arrange', 'news-toolbar', 'news-cloud', 'news-ai', 'login', 'thirdparty', 'ready', 'practice'];
    pages.push(...Object.keys(WelcomeLessons.titles).map(kind=>`lesson-${kind}`));
    const exercises = ['drag', 'initials', 'history', 'layout', 'arrange'];
    const tutorialSteps = [...exercises, 'lesson-import', 'lesson-layoutimport'];
    const replay = new URLSearchParams(location.search).has('replay');
    let state = !replay && store.read();
    if (!state || state.finished || !pages.includes(state.page) || !Array.isArray(state.completed) || !Array.isArray(state.skipped) || !Array.isArray(state.trail)) state = { page: 'welcome', returning: !!boot.returning, completed: [], skipped: [], trail: [] };
    if (replay && new URLSearchParams(location.search).has('help')) state.page = 'practice';
    if (replay) history.replaceState({}, '', '/welcome/');
    const screen = document.getElementById('welcome-screen');
    const status = document.getElementById('welcome-status');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer, hintTimer, demoTimer, abortLogin, selected = null, activeTool = 'seat', demonstrating = false;
    let cloudUser = boot.cloudUser || null;
    let changingPage = false;
    let motionRects = new Map();
    const captureSeats = () => new Map([...screen.querySelectorAll('.seat[data-student-id]')].filter(node => node.dataset.studentId).map(node => [node.dataset.studentId, node.getBoundingClientRect()]));
    function animateSeats() {
        if (reduced) return;
        screen.querySelectorAll('.seat[data-student-id]').forEach((seat, index) => {
            const content = seat.querySelector('.seat-content');
            if (!content) return;
            const old = motionRects.get(seat.dataset.studentId), rect = seat.getBoundingClientRect();
            const from = old ? {transform:`translate(${old.left-rect.left}px,${old.top-rect.top}px)`,opacity:1} : {transform:'translateY(20px) scale(.94)',opacity:0};
            content.animate([from,{transform:'translate(0,0) scale(1)',opacity:1}], {duration:520,delay:old ? 0 : index*45,easing:'cubic-bezier(.2,.9,.25,1)'});
        });
    }
    const names = [{id:1,name:'张明',initials:'zm',student_id:'001'}, {id:2,name:'李华',initials:'lh',student_id:'002'}, {id:3,name:'陈晨',initials:'cc',student_id:'003'}, {id:4,name:'王悦',initials:'wy',student_id:'004'}, {id:5,name:'林晓',initials:'lx',student_id:'005'}, {id:6,name:'周宁',initials:'zn',student_id:'006'}];
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const save = () => store.write(state);
    const tell = message => { status.textContent = message || ''; };
    const button = (label, action, secondary = false) => `<button type="button" class="btn ${secondary ? 'btn-secondary' : 'btn-primary'}" data-action="${action}">${label}</button>`;
    const textButton = (label, action) => `<button type="button" class="welcome-text" data-action="${action}">${label}</button>`;
    const title = text => `<h1 id="welcome-heading" tabindex="-1">${text}</h1>`;
    const center = (heading, body, actions) => `<div class="welcome-center welcome-enter">${title(heading)}${body}<div class="welcome-actions">${actions}</div></div>`;
    const split = (heading, body, extra = '') => `<div class="welcome-split welcome-enter"><div class="welcome-stage" id="welcome-stage"></div><div class="welcome-copy"><p class="welcome-eyebrow">${exercises.includes(state.page) ? '动手试一试' : '认识 3.0'}</p>${title(heading)}<p id="welcome-instruction">${body}</p>${extra}</div></div>`;
    function seed(page) {
        const large = ['layout', 'arrange'].includes(page);
        state.scene = Array.from({length:large ? 12 : 2}, (_, i) => ({row: Math.floor(i / (large ? 4 : 2)) + 1, col:i % (large ? 4 : 2) + 1, type:'seat', student:large ? null : i + 1}));
        if (page === 'arrange') { state.scene[1].type = 'podium'; state.scene[6].type = 'aisle'; }
        state.phase = 0; state.undo = []; state.redo = [];
        if (page === 'history') { state.undo = [structuredClone(state.scene)]; [state.scene[0].student, state.scene[1].student] = [2, 1]; }
    }
    async function go(page, {back = false} = {}) {
        if (changingPage) return;
        changingPage = true;
        window.dispatchEvent(new Event('welcome-page-leave'));
        const update=()=>{
            clearTimeout(timer); clearTimeout(hintTimer); clearTimeout(demoTimer);
            document.getElementById('welcome-confetti').replaceChildren();
            document.querySelectorAll('.welcome-drag-ghost').forEach(node => node.remove());
            abortLogin?.abort(); abortLogin = null;
            if (!back) state.trail.push(state.page);
            state.page = page; state.success = false; selected = null; demonstrating = false;
            if (exercises.includes(page) || page === 'news-cloud') seed(page);
            save(); render();
        };
        {
            const shift = back ? -1 : 1;
            if (!reduced) await screen.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-shift*28}px)`}],{duration:180,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}).finished;
            update();screen.getAnimations().forEach(animation=>animation.cancel());
            if (!reduced) await screen.animate([{opacity:0,transform:`translateX(${shift*36}px)`},{opacity:1,transform:'translateX(0)'}],{duration:400,easing:'cubic-bezier(.16,1,.3,1)'}).finished;
        }
        changingPage = false;
    }
    async function finish(destination = '/') {
        if (changingPage) return;
        changingPage = true;
        abortLogin?.abort();
        await WelcomeFinale.play({onContinue:async button=>{
            state.finished = true; save(); await store.flush();
            window.FUCKSEATS_ONBOARDING_ACTIVE = false;
            try { sessionStorage.setItem('fuckseats_show_data_sharing_after_onboarding', '1'); } catch (_) {}
            await WelcomeTransitions.depart(button);
            location.href = destination;
        }});
    }
    function nextExercise() {
        if (state.practiceMode) { go('practice'); return; }
        go(tutorialSteps[tutorialSteps.indexOf(state.page) + 1] || 'news-toolbar');
    }
    function success(message) {
        if (state.success || demonstrating) return;
        state.success = true;
        if (!state.completed.includes(state.page)) state.completed.push(state.page);
        save();
        const stage = document.getElementById('welcome-stage');
        stage.innerHTML = `<div class="welcome-success" role="status"><svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true"><circle cx="36" cy="36" r="32" stroke="currentColor" stroke-width="2"/><path d="m21 36 10 10 20-22" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><p>${message}</p></div>`;
        tell(message);
        if (state.page === 'drag' && !reduced) {
            const confetti = document.getElementById('welcome-confetti');
            confetti.innerHTML = Array.from({length:45}, (_, i) => `<i style="left:${i*2.2}%;--drift:${(i%7-3)*25}px;animation-delay:${(i%5)*.03}s;background:${['#0a59f7','#a8c7ff','#82a0bb'][i%3]}"></i>`).join('');
        }
        timer = setTimeout(() => { document.getElementById('welcome-confetti').replaceChildren(); nextExercise(); }, 2000);
    }
    function toolbar() {
        const visible = ['history','layout','arrange','news-toolbar'].includes(state.page);
        document.body.classList.toggle('welcome-has-toolbar', visible);
        document.getElementById('welcome-toolbar').hidden = !visible;
        const editing = state.page === 'layout' && state.phase > 0;
        document.body.classList.toggle('classroom-detail-body', visible && !editing);
        document.body.classList.toggle('layout-editor-body', editing);
        document.getElementById('welcome-classroom-toolbar').hidden = editing;
        document.getElementById('welcome-layout-toolbar').hidden = !editing;
        document.getElementById('welcome-layout-done').hidden = !editing;
        document.getElementById('undoBtn').disabled = state.page === 'history' && state.phase !== 0;
        document.getElementById('redoBtn').disabled = state.page === 'history' && state.phase !== 1;
        window.dispatchEvent(new Event('fuckseats:menus-changed'));
        window.dispatchEvent(new Event('resize'));
    }
    function render() {
        motionRects = captureSeats();
        clearTimeout(hintTimer); tell(''); toolbar();
        screen.dataset.page = state.page;
        document.body.classList.toggle('welcome-import-active',['lesson-import','lesson-layoutimport'].includes(state.page));
        document.getElementById('welcome-back').hidden = !state.trail.length;
        document.getElementById('welcome-back').textContent = state.practiceMode && state.page !== 'practice' ? '返回练习目录' : '返回';
        document.getElementById('welcome-skip').textContent = tutorialSteps.includes(state.page) ? '跳过这一步' : '跳过引导';
        document.getElementById('welcome-skip').hidden = ['ready','login','thirdparty','practice'].includes(state.page) || state.page.startsWith('lesson-') && (state.practiceMode || !tutorialSteps.includes(state.page));
        document.getElementById('welcome-progress').textContent = tutorialSteps.includes(state.page) && !state.practiceMode ? `${tutorialSteps.indexOf(state.page)+1} / ${tutorialSteps.length}` : '';
        switch (state.page) {
        case 'welcome':
            screen.innerHTML = state.returning
                ? center('Hey，欢迎回来', '<p>你不在的日子里，我们升级了 <strong>3.0</strong> 新版本。<br>接下来，让我们看看有哪些新东西吧。</p>', button('继续','start'))
                : center('欢迎！', '', button('继续','start') + button('我是老用户','returning',true) + button('我使用过这个版本','used',true));
            break;
        case 'drag': screen.innerHTML = split('试试拖拽他俩，<br>交换位置', '按住一个名字，拖到另一个座位上。', textButton('看一次演示','demonstrate')); break;
        case 'initials': screen.innerHTML = split('换个位置，<br>也可以打几个字母', '双击张明的座位，输入李华的首字母 <strong>lh</strong>，然后按回车。', textButton('看一次演示','demonstrate')); break;
        case 'history': screen.innerHTML = split('刚才的操作，<br>可以退回一步', state.phase ? '现在点击顶栏的“重做”，恢复刚才的换位。' : '点击顶栏的“撤销”，让两位学生回到原位。'); break;
        case 'layout': {
            const prompts = ['点击“布局编辑”，调整示例座位表。', '在右侧“编辑工具”选择“走廊”，再点击蓝框格子。', '在右侧“编辑工具”选择“讲台”，再点击蓝框格子。', '布局已准备好，点击窗口左上方“返回排座”。'];
            screen.innerHTML = split('让座位，<br>适合你的教室', prompts[state.phase] || prompts[0], state.phase === 0 ? button('布局编辑', 'edit-layout') : ''); break;
        }
        case 'arrange': screen.innerHTML = split('剩下的座位，<br>交给自动排座', '点击顶栏蓝色按钮右侧的箭头，选择“随机排座”，再点击“自动排座”。'); break;
        case 'news-toolbar':
            screen.innerHTML = split('熟悉的操作，<br>新的位置', '排座、布局、导入导出，都可以从顶栏找到。', button('继续','news-next'));
            document.getElementById('welcome-stage').innerHTML = '<div class="welcome-service">视图<small>布局编辑、全屏与工作面板</small></div><div class="welcome-service">编辑<small>撤销、重做与学生管理</small></div><div class="welcome-service">文件<small>导入名单，导出排座表</small></div>'; break;
        case 'news-cloud':
            screen.innerHTML = split('后续备份，<br>按变化同步', '首次完整备份，之后优先同步改动。需要时仍可读取完整快照和旧版备份。', button('交换一次','cloud-demo',true) + '<div style="margin-top:16px">' + button('继续','news-next') + '</div>'); break;
        case 'news-ai':
            screen.innerHTML = split('需要帮忙时，<br>打开闻道智能', '在设置中连接账户，再从工作区开始对话。实际操作由你确认授权。', button('继续','news-next'));
            document.getElementById('welcome-stage').innerHTML = '<div class="welcome-service">1　连接闻道智能<small>设置 → 闻道智能</small></div><div class="welcome-service">2　选择班级，开始对话<small>打开闻道 AI 工作区</small></div><div class="welcome-service">3　确认操作授权<small>查看工具请求，再允许或拒绝</small></div>'; break;
        case 'login':
            screen.innerHTML = cloudUser
                ? center('已登录', `<p>${escape(cloudUser.nickname || '老三账户')}</p>`, button('继续','ready'))
                : center('登录，让班级跟着你', '<p>使用老三账户，在多台设备间同步班级数据。<br>登录后会同步已关联的班级。</p>', button('登录','login') + button('不登录继续','ready',true) + textButton('使用三方云服务继续','thirdparty'));
            break;
        case 'thirdparty':
            screen.innerHTML = center('连接三方云服务', '<p>填写兼容本应用云协议的服务器地址。<br>切换服务会退出当前云账户，需要重新登录。</p><form id="welcome-server-form"><label for="welcome-server">云服务器地址</label><input id="welcome-server" type="url" required placeholder="https://cloud.example.com" autocomplete="url"><div class="welcome-actions"><button type="submit" class="btn btn-primary">连接并登录</button></div></form>', button('不登录继续','ready',true)); break;
        case 'ready':
            screen.innerHTML = state.returning || boot.hasData || cloudUser
                ? center('欢迎回来','<p>继续你的排座工作。</p>',button('进入应用','finish') + textButton('练习更多操作','practice'))
                : center('准备就绪','<p>现在，创建你的第一个班级。</p>',button('创建班级','create') + button('先看看','finish',true) + textButton('练习更多操作','practice')); break;
        case 'practice': screen.innerHTML = center('选择一个练习', '<p>示例数据仅用于练习。</p>', exercises.map((page,i)=>button(['拖拽换位','首字母换位','撤销与重做','布局编辑','自动排座'][i],`practice-${page}`,true)).join('') + Object.entries(WelcomeLessons.titles).map(([kind,label])=>button(label,`practice-lesson-${kind}`,true)).join('') + textButton('重新体验完整引导','replay') + textButton('进入应用','finish')); break;
        }
        if (state.page.startsWith('lesson-')) WelcomeLessons.render({kind:state.page.slice(7),screen,state,save,tell});
        if (exercises.includes(state.page) || state.page === 'news-cloud') renderSeats();
        screen.querySelector('h1')?.focus({preventScroll:true});
        if (state.success && exercises.includes(state.page)) { state.success = false; success('这一项已完成'); }
        if (state.page === 'drag' && !state.success) hintTimer = setTimeout(() => {
            document.getElementById('welcome-stage')?.classList.add('welcome-hint');
            tell('也可以用键盘：聚焦座位后按空格选中，再聚焦另一个座位并按空格交换。');
        }, 8000);
        document.getElementById('welcome-server-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const input = document.getElementById('welcome-server');
            if (!input.reportValidity()) return;
            const submit = event.submitter; submit.disabled = true;
            try { await CloudManager.setCloudServerUrl(input.value.trim()); cloudUser = null; if (input.isConnected && state.page === 'thirdparty') await login(); }
            catch (error) { tell(error.message || '连接失败，请检查地址。'); }
            finally { if (submit.isConnected) submit.disabled = false; }
        });
    }
    function record() { state.undo.push(structuredClone(state.scene)); state.redo = []; }
    function moved(seat, id, source) {
        if (state.success || demonstrating) return;
        const payload = SeatInteractions.movePayload(seat, id); if (!payload) return;
        const from = state.scene.find(cell => cell.student === Number(id));
        const to = state.scene.find(cell => cell.row === payload.row && cell.col === payload.col);
        if (!from || !to || to.type !== 'seat') return;
        record(); [from.student,to.student] = [to.student,from.student]; save(); renderSeats();
        if (state.page === 'drag' && ['drag','touch','keyboard'].includes(source) && state.scene[0].student === 2) timer = setTimeout(()=>success('恭喜你！完成了第一项操作'),650);
        if (state.page === 'initials' && source === 'initials' && state.scene[0].student === 2) timer = setTimeout(()=>success('你已经掌握了两种换位方式'),650);
    }
    function renderSeats() {
        const stage = document.getElementById('welcome-stage'); if (!stage) return;
        const currentRects = captureSeats(); if (currentRects.size) motionRects = currentRects;
        let html = '<div class="seat-grid" aria-label="练习用座位">';
        const rows = [...new Set(state.scene.map(cell => cell.row))];
        for (const row of rows) {
            html += '<div class="seat-row">';
            for (const cell of state.scene.filter(cell => cell.row === row)) {
                const student = names.find(s => s.id === cell.student);
                const target = state.page === 'layout' && (state.phase === 1 && cell.row === 2 && cell.col === 3 || state.phase === 2 && cell.row === 1 && cell.col === 2);
                html += `<div class="seat cell-${cell.type}${target ? ' welcome-target' : ''}" tabindex="0" role="button" aria-label="第${cell.row}排第${cell.col}列 ${student?.name || {seat:'空座',aisle:'走廊',podium:'讲台',empty:'空位'}[cell.type]}" data-row="${cell.row}" data-col="${cell.col}" data-cell-type="${cell.type}" data-student-id="${cell.student || ''}">${student ? `<div class="seat-content" draggable="true"><div class="seat-name">${student.name}</div></div>` : `<div class="seat-placeholder">${{seat:cell.row+'-'+cell.col,aisle:'走廊',podium:'讲台',empty:'空位'}[cell.type]}</div>`}</div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        document.querySelector('.welcome-layout-tools')?.remove();
        if (state.page === 'layout' && state.phase) {
            const tools = document.createElement('aside'); tools.className = 'welcome-layout-tools';
            tools.innerHTML = '<h3>编辑工具</h3>' + document.getElementById('welcome-layout-tools').innerHTML;
            screen.querySelector('.welcome-copy').append(tools);
        }
        if (state.page === 'arrange') {
            const unseated = names.filter(s=>!state.scene.some(c=>c.student===s.id));
            html += `<p class="welcome-caption">${unseated.length ? '待入座：'+unseated.map(s=>s.name).join('、') : '全部学生已入座'}</p>`;
        }
        if (state.page === 'news-cloud') html += `<div class="welcome-cloud-line"><span>完整基线</span><span>→</span><strong>${state.phase ? '2 个位置变化' : '等待一次调整'}</strong></div><span class="welcome-caption">同步原理演示，不会上传数据</span>`;
        stage.innerHTML = html;
        animateSeats();
        let dragId = null;
        const quick = seat => {
            if (state.page !== 'initials' || state.success || demonstrating) return;
            SeatInteractions.quickSwap(seat, {
                search: async query => names.slice(0,2).filter(s => [s.name,s.initials,s.student_id].some(v=>v.toLowerCase().includes(query.toLowerCase()))),
                swap: (target,id) => moved(target,id,'initials'),
                choose: (target,matches) => {
                    const chooser = document.createElement('div'); chooser.className = 'welcome-actions';
                    for (const match of matches) { const b = document.createElement('button'); b.className = 'btn btn-secondary'; b.textContent = match.name; b.onclick = () => moved(target,match.id,'initials'); chooser.append(b); }
                    stage.append(chooser); chooser.querySelector('button')?.focus();
                }, notify:tell
            });
        };
        stage.querySelectorAll('.seat').forEach(seat => {
            SeatInteractions.bindDrop(seat, event => moved(seat, dragId || event.dataTransfer.getData('text/plain'),'drag'), () => seat.classList.add('selected'));
            seat.addEventListener('dragleave', () => seat.classList.remove('selected'));
            seat.addEventListener('dragstart', event => { if (state.page !== 'drag') { event.preventDefault(); return; } clearTimeout(hintTimer); dragId = seat.dataset.studentId; event.dataTransfer.setData('text/plain',dragId); });
            seat.addEventListener('dblclick', () => quick(seat));
            seat.addEventListener('keydown', event => {
                if (event.target.matches('input')) return;
                if (event.key === 'Enter' && state.page === 'initials') { event.preventDefault(); quick(seat); }
                if ([' ', 'Enter'].includes(event.key) && state.page === 'drag') {
                    event.preventDefault();
                    if (selected) { const id = selected; selected = null; moved(seat,id,'keyboard'); }
                    else { selected = seat.dataset.studentId; seat.classList.add('selected'); tell('已选中。聚焦另一个座位，按空格交换。'); }
                }
                if ([' ', 'Enter'].includes(event.key) && state.page === 'layout') { event.preventDefault(); applyCell(seat); }
            });
            seat.addEventListener('click', () => { if (state.page === 'layout') applyCell(seat); });
            let pointer = null, ghost = null;
            seat.addEventListener('pointerdown', event => {
                if (state.page !== 'drag' || event.button !== 0 || state.success) return;
                event.preventDefault(); clearTimeout(hintTimer);
                pointer = {id:event.pointerId,student:seat.dataset.studentId,x:event.clientX,y:event.clientY};
                seat.setPointerCapture(event.pointerId);
                seat.classList.add('selected');
            });
            seat.addEventListener('pointermove', event => {
                if (!pointer || Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<6) return;
                if (!ghost) {
                    ghost = document.createElement('div'); ghost.className = 'drag-ghost touch-drag-ghost welcome-drag-ghost';
                    ghost.textContent = seat.textContent; ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10001;padding:16px;background:white;border:1px solid #0a59f7;border-radius:12px;';
                    document.body.append(ghost);
                }
                ghost.style.left = `${event.clientX+12}px`; ghost.style.top = `${event.clientY+12}px`;
            });
            seat.addEventListener('pointerup', event => {
                if (!pointer || event.pointerId !== pointer.id) return;
                const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.seat');
                seat.classList.remove('selected');
                ghost?.remove(); ghost = null;
                if (target && stage.contains(target) && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6) moved(target,pointer.student,event.pointerType === 'mouse' ? 'drag' : 'touch');
                pointer = null;
            });
            seat.addEventListener('pointercancel', () => { seat.classList.remove('selected'); ghost?.remove(); ghost = null; pointer = null; });
        });
        screen.querySelectorAll('[data-tool]').forEach(b => {
            b.classList.toggle('active',b.dataset.tool === activeTool);
            b.onclick = () => { activeTool = b.dataset.tool; screen.querySelectorAll('[data-tool]').forEach(t=>t.classList.toggle('active', t===b)); };
        });
    }
    function applyCell(seat) {
        if (!state.phase || state.success) return;
        const payload = SeatInteractions.cellPayload(seat,activeTool); if (!payload) return;
        const cell = state.scene.find(c=>c.row===payload.row && c.col===payload.col);
        const expected = state.phase === 1 ? [2,3,'aisle'] : [1,2,'podium'];
        if (state.phase > 2 || payload.row !== expected[0] || payload.col !== expected[1] || activeTool !== expected[2]) { tell('先选择提示中的工具，再点击蓝框标出的格子。'); return; }
        cell.type = activeTool; cell.student = null; state.phase++; save(); render();
        const changed = screen.querySelector(`.seat[data-row="${payload.row}"][data-col="${payload.col}"]`);
        if (!reduced) changed?.animate([{transform:'scale(.9)',background:'#dce9ff'},{transform:'scale(1)',background:'#fff'}],{duration:450,easing:'ease-out'});
    }
    async function login() {
        if (abortLogin) return;
        abortLogin = new AbortController();
        const controller = abortLogin;
        screen.querySelector('[data-action="login"]')?.setAttribute('disabled','');
        tell('正在打开浏览器，请完成登录。');
        const result = await CloudManager.openLogin({ inline:true, signal:controller.signal, onStatus:tell });
        if (controller.signal.aborted) return;
        abortLogin = null;
        if (result.status === 'success' || result.status === 'already_logged_in') { cloudUser = result.user; go('ready'); }
        else { screen.querySelector('[data-action="login"]')?.removeAttribute('disabled'); tell(result.error?.message || '登录未完成，可以重试或不登录继续。'); }
    }
    screen.addEventListener('click', async event => {
        if (changingPage) return;
        const trigger = event.target.closest('[data-action]');
        const action = trigger?.dataset.action; if (!action) return;
        if (action.startsWith('practice-')) { state.practiceMode = true; go(action.slice(9)); return; }
        switch(action) {
        case 'edit-layout': state.phase = 1; save(); render(); break;
        case 'start': state.practiceMode = false; go(state.returning ? 'news-toolbar' : 'drag'); break;
        case 'returning': state.returning = true; go('welcome'); break;
        case 'used': state.returning = true; state.skipped.push('basics','news'); go('login'); break;
        case 'news-next': go({'news-toolbar':'news-cloud','news-cloud':'news-ai','news-ai':'login'}[state.page]); break;
        case 'ready': go('ready'); break;
        case 'import-next': nextExercise(); break;
        case 'thirdparty': go('thirdparty'); break;
        case 'login': await login(); break;
        case 'finish': finish(); break;
        case 'create': finish('/create/'); break;
        case 'practice': go('practice'); break;
        case 'replay': state.practiceMode = false; state.returning = !!boot.returning; go('welcome'); break;
        case 'cloud-demo': [state.scene[0].student,state.scene[1].student] = [state.scene[1].student,state.scene[0].student]; state.phase = 1; save(); renderSeats(); break;
        case 'demonstrate':
            if (demonstrating || state.success) return;
            demonstrating = true; tell(state.page === 'drag' ? '演示：把张明拖到李华的位置。接下来请亲手试一次。' : '演示：双击张明，输入 lh，然后按回车。接下来请亲手试一次。');
            document.getElementById('welcome-stage').classList.add('welcome-hint');
            if (state.page === 'initials') {
                const input = document.createElement('input'); input.className = 'quick-swap-input'; input.value = 'lh'; input.readOnly = true; input.setAttribute('aria-label','演示：输入 lh 并按回车');
                document.querySelector('#welcome-stage .seat').append(input);
            }
            demoTimer = setTimeout(() => {
                motionRects = captureSeats();
                [state.scene[0].student,state.scene[1].student] = [state.scene[1].student,state.scene[0].student];
                renderSeats();
                [state.scene[0].student,state.scene[1].student] = [state.scene[1].student,state.scene[0].student];
                document.querySelector('#welcome-stage .quick-swap-input')?.remove();
            },900);
            timer = setTimeout(() => { demonstrating = false; renderSeats(); tell('现在，请亲手试一次。'); },2000); break;
        }
    });
    document.getElementById('welcome-back').onclick = () => {
        if (changingPage) return;
        if (state.practiceMode && state.page !== 'practice') { state.trail.pop(); go('practice', {back:true}); return; }
        const previous = state.trail.pop();
        if (previous) { if (previous === 'welcome') state.returning = !!boot.returning; go(previous,{back:true}); }
    };
    document.getElementById('welcome-skip').onclick = () => {
        if (changingPage) return;
        if (!state.skipped.includes(state.page)) state.skipped.push(state.page);
        if (tutorialSteps.includes(state.page)) nextExercise(); else go('login');
    };
    document.getElementById('undoBtn').onclick = () => {
        if (state.page === 'news-toolbar') { tell('“编辑 → 撤销”退回上一次操作。'); return; }
        if (state.page !== 'history' || state.phase !== 0 || state.success) return;
        state.redo.push(state.scene); state.scene = state.undo.pop(); state.phase = 1; save(); render();
    };
    document.getElementById('redoBtn').onclick = () => {
        if (state.page === 'news-toolbar') { tell('“编辑 → 重做”恢复刚才撤销的操作。'); return; }
        if (state.page !== 'history' || state.phase !== 1 || state.success) return;
        state.scene = state.redo.pop(); state.phase = 2; save(); renderSeats(); timer = setTimeout(()=>success('需要调整时，随时可以回来'),650);
    };
    document.getElementById('btn-layout-editor').onclick = event => {
        event.preventDefault();
        if (state.page === 'layout') { state.phase = 1; save(); render(); }
        else if (state.page === 'news-toolbar') tell('“视图 → 布局编辑”用于调整座位、走廊和讲台。');
    };
    document.getElementById('welcome-layout-done').onclick = event => {
        event.preventDefault();
        if (state.page === 'layout' && state.phase === 3) success('你的教室，已经有了自己的样子');
        else tell('先完成走廊和讲台的设置。');
    };
    document.getElementById('btn-import-students').onclick = event => { event.preventDefault(); tell('从“文件”菜单导入学生；选择文件后，在独立页面确认字段和导入方式。'); };
    document.getElementById('btn-export-excel').onclick = event => { event.preventDefault(); tell('从“文件”菜单导出排座表；先在独立页面确认格式，再保存文件。'); };
    document.getElementById('btn-auto-arrange').onclick = event => {
        event.preventDefault();
        if (state.page !== 'arrange' || state.success) return;
        if (document.querySelector('#welcome-toolbar select[name="method"]').value !== 'random') { tell('请先选择“随机排座”。'); return; }
        tell('');
        const seats = state.scene.filter(c=>c.type === 'seat');
        for (let i=seats.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [seats[i],seats[j]]=[seats[j],seats[i]]; }
        seats.forEach((c,i)=>{c.student=names[i]?.id || null;}); save(); renderSeats();
        timer = setTimeout(()=>success('准备好了，你已经会开始排座了'),700);
    };
    document.addEventListener('keydown', event => {
        if (state.page === 'history' && event.ctrlKey && !event.target.matches('input')) {
            if (event.key.toLowerCase() === 'z') {event.preventDefault(); document.getElementById('undoBtn').click();}
            if (event.key.toLowerCase() === 'y') {event.preventDefault(); document.getElementById('redoBtn').click();}
        }
    });
    if ((exercises.includes(state.page) || state.page === 'news-cloud') &&
        (!Array.isArray(state.scene) || state.scene.length < 2 || !state.scene.every(c=>c && Number.isInteger(c.row) && Number.isInteger(c.col)) || !Array.isArray(state.undo) || !Array.isArray(state.redo))) seed(state.page);
    const demoToolbar = document.getElementById('welcome-toolbar');
    demoToolbar.querySelectorAll('a').forEach(link => { link.href = '#'; link.removeAttribute('data-system-save'); });
    demoToolbar.querySelectorAll('form').forEach(form => form.removeAttribute('action'));
    demoToolbar.addEventListener('submit', event => event.preventDefault());
    demoToolbar.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (link) { event.preventDefault(); event.stopPropagation(); if (link.id !== 'btn-layout-editor' && !link.closest('#welcome-layout-toolbar')) tell('这是练习工具栏。实际文件操作请在进入班级后进行。'); }
        const trigger = event.target.closest('.arrange-method-trigger');
        const menu = document.getElementById('arrange-method-menu');
        if (trigger) { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded',String(!menu.hidden)); }
        const method = event.target.closest('[data-arrange-method]');
        if (method) { demoToolbar.querySelector('select[name="method"]').value = method.dataset.arrangeMethod; menu.hidden = true; demoToolbar.querySelector('.arrange-method-trigger').setAttribute('aria-expanded','false'); tell(`已选择${method.textContent}`); }
    });
    window.addEventListener('onboarding-save-error',()=>tell('进度尚未保存，请检查本地服务后重试。'));
    save(); render();
});
