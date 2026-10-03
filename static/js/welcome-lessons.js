/* Optional lessons use built-in fictitious data, never classroom endpoints. */
window.WelcomeLessons = (() => {
    const titles = {fixed:'固定一个座位',groups:'把他们分到同一组',batch:'一起移动两位学生',import:'导入成绩表',layoutimport:'导入座位表',export:'导出排座表'};
    const roster = ['张明','李华'];
    function seat(name,row,col,extra='') {
        return `<div class="seat ${name?'occupied':''}" role="button" tabindex="0" data-row="${row}" data-col="${col}" data-cell-type="seat" aria-label="第${row}排第${col}列 ${name||'空座'}" ${extra}><div class="${name?'seat-content':'seat-placeholder'}" draggable="${!!name}">${name?`<span class="seat-name">${name}</span>`:`${row}-${col}`}</div></div>`;
    }
    function render({kind,screen,state,save,tell}) {
        if(kind==='import'||kind==='layoutimport'){WelcomeImport.render({kind,screen,state,save,tell});return;}
        const oldPositions = new Map([...screen.querySelectorAll('.seat')].filter(node=>node.querySelector('.seat-name')).map(node=>[node.querySelector('.seat-name').textContent,node.getBoundingClientRect()]));
        if (state.lesson?.kind !== kind) state.lesson={kind,done:false,selected:[],phase:0};
        const lesson=state.lesson;
        const persist=()=>save();
        const complete=()=>{
            lesson.done=true;
            if(!state.completed.includes(`lesson-${kind}`))state.completed.push(`lesson-${kind}`);
            persist(); render({kind,screen,state,save,tell}); tell('练习完成。');
        };
        const rerender=()=>{persist();render({kind,screen,state,save,tell});};
        const btn=(text,action,disabled=false)=>`<button type="button" class="btn btn-secondary" data-lesson-action="${action}" ${disabled?'disabled':''}>${text}</button>`;
        const prompts={fixed:'右键张明的座位，选择“固定座位”。使用键盘时可点击下方的菜单按钮。',groups:'选中两位学生，再选择小组并应用。',batch:'按住 Ctrl、Command 或 Shift 点击两位学生，再把张明拖到第二排左侧空座。也可使用下方复选框选择。',import:'打开内置示例名单，确认姓名和学号字段后导入。',export:'选择 SVG 格式，预览并下载这张示例排座表。'};
        screen.innerHTML=`<div class="welcome-split welcome-enter"><div class="welcome-stage" id="lesson-stage"></div><div class="welcome-copy"><p class="welcome-eyebrow">独立练习</p><h1 id="welcome-heading" tabindex="-1">${titles[kind]}</h1><p>${lesson.done?'练习完成。你可以返回，继续学习其他操作。':prompts[kind]}</p></div></div>`;
        const stage=screen.querySelector('#lesson-stage');
        if(kind==='fixed') {
            stage.innerHTML=`<div class="seat-grid"><div class="seat-row">${seat('张明',1,1)}${seat('李华',1,2)}</div></div>${lesson.done?'<p class="welcome-caption">张明 · 座位已固定</p>':btn('打开张明的座位菜单','menu')}<div class="welcome-lesson-menu" role="menu" hidden><button type="button" class="menu-item-button" role="menuitem" data-lesson-action="fix">固定座位</button></div>`;
            const target=stage.querySelector('.seat');target.classList.toggle('is-fixed-seat',lesson.done);
            const open=event=>{event?.preventDefault();if(lesson.done)return;const menu=stage.querySelector('[role=menu]');menu.hidden=false;menu.querySelector('button').focus();};
            target.oncontextmenu=open;
            stage.querySelector('[data-lesson-action=menu]')?.addEventListener('click',open);
            stage.querySelector('[data-lesson-action=fix]').onclick=complete;
        }
        if(kind==='groups'||kind==='batch') {
            const selected=lesson.selected;
            stage.innerHTML=`<div class="seat-grid"><div class="seat-row">${roster.map((name,i)=>seat(lesson.done&&kind==='batch'?'':name,1,i+1)).join('')}</div>${kind==='batch'?`<div class="seat-row">${roster.map((name,i)=>seat(lesson.done?name:'',2,i+1)).join('')}</div>`:''}</div><div class="welcome-lesson-options">${roster.map((name,i)=>`<label><input type="checkbox" data-select="${i}" ${selected.includes(i)?'checked':''} ${lesson.done?'disabled':''}> ${name}</label>`).join('')}</div>`;
            if(kind==='groups')stage.insertAdjacentHTML('beforeend',`<label>分配到 <select aria-label="分配小组"><option value="">选择小组</option><option value="1" ${lesson.done?'selected':''}>第一组</option></select></label>${btn(lesson.done?'已分配到第一组':'应用分组','group',lesson.done)}`);
            stage.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>{const i=Number(input.dataset.select);lesson.selected=input.checked?[...new Set([...lesson.selected,i])]:lesson.selected.filter(x=>x!==i);rerender();});
            stage.querySelectorAll('.seat').forEach((cell,i)=>cell.classList.toggle('multi-selected',i<2&&selected.includes(i)));
            stage.querySelectorAll('.seat').forEach((cell,i)=>cell.addEventListener('click',event=>{
                if(i>1||lesson.done||!(event.ctrlKey||event.metaKey||event.shiftKey))return;
                lesson.selected=selected.includes(i)?selected.filter(id=>id!==i):[...selected,i];rerender();
            }));
            stage.querySelector('[data-lesson-action=group]')?.addEventListener('click',()=>{
                if(lesson.selected.length!==2||stage.querySelector('select').value!=='1'){tell('选中两位学生，并选择“第一组”。');return;}complete();
            });
            if(kind==='batch'&&!lesson.done){
                const cells=[...stage.querySelectorAll('.seat')];
                const drop=()=>{if(lesson.selected.length!==2){tell('先选中两位学生。');return;}complete();};
                SeatInteractions.bindDrop(cells[2],drop);
                cells[0].ondragstart=e=>e.dataTransfer.setData('text/plain','lesson-batch');
                cells[0].onpointerdown=e=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();cells[0].setPointerCapture(e.pointerId);};
                cells[0].onpointerup=e=>{if(document.elementFromPoint(e.clientX,e.clientY)?.closest('.seat')===cells[2])drop();};
                cells[2].onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();drop();}};
                stage.insertAdjacentHTML('beforeend','<span class="welcome-caption">键盘：选中两人后，聚焦第二排左侧空座并按回车。</span>');
            }
        }
        if(kind==='export') {
            const svg='<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160" viewBox="0 0 360 160"><rect width="360" height="160" fill="white"/><g fill="none" stroke="#0a59f7"><rect x="30" y="40" width="130" height="80" rx="12"/><rect x="200" y="40" width="130" height="80" rx="12"/></g><g fill="#1d1d1f" font-family="sans-serif" font-size="20" text-anchor="middle"><text x="95" y="88">张明</text><text x="265" y="88">李华</text></g></svg>';
            stage.innerHTML=`<label>导出格式 <select aria-label="导出格式"><option value="">选择格式</option><option value="svg" ${lesson.phase?'selected':''}>SVG</option></select></label>${btn('生成预览','preview')}${lesson.phase?svg+btn('下载示例排座表','download'):''}`;
            stage.querySelector('[data-lesson-action=preview]').onclick=()=>{if(stage.querySelector('select').value!=='svg'){tell('请选择 SVG 格式。');return;}lesson.phase=1;rerender();};
            stage.querySelector('[data-lesson-action=download]')?.addEventListener('click',()=>{
                const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download='练习排座表.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);complete();
            });
        }
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches) stage.querySelectorAll('.seat').forEach(cell=>{
            const content=cell.querySelector('.seat-content'),name=cell.querySelector('.seat-name')?.textContent,old=oldPositions.get(name);
            if(!content||!old)return;const rect=cell.getBoundingClientRect();
            if(Math.hypot(old.left-rect.left,old.top-rect.top)<2)return;
            content.animate([{transform:`translate(${old.left-rect.left}px,${old.top-rect.top}px)`},{transform:'translate(0,0)'}],{duration:520,easing:'cubic-bezier(.2,.9,.25,1)'});
        });
        persist();
    }
    return {render,titles};
})();
