/* Local teaching fixtures: no File API, upload, fetch, or classroom writes. */
window.WelcomeImport = (() => {
    const files = [{kind:'import',name:'期中成绩表（模拟）.xlsx'}, {kind:'layoutimport',name:'教室座位表（模拟）.xlsx'}];
    const names = ['张明','李华'];
    async function chooseFile(kind, done, tell) {
        const requestId=crypto.randomUUID();
        let popup=null;
        const accept=detail=>{if(detail?.requestId!==requestId||detail.kind!==kind)return;cleanup();done();};
        const message=event=>{if(event.origin===location.origin&&event.source===popup&&event.data?.type==='welcome-file-picked')accept(event.data);};
        const native=event=>accept(event.detail);
        const cleanup=()=>{window.removeEventListener('message',message);window.removeEventListener('welcome-file-picked',native);window.removeEventListener('welcome-page-leave',cleanup);};
        window.addEventListener('message',message);window.addEventListener('welcome-file-picked',native);window.addEventListener('welcome-page-leave',cleanup,{once:true});
        try {
            if(window.pywebview?.api?.open_tutorial_file_picker){
                const result=await window.pywebview.api.open_tutorial_file_picker(kind,requestId);
                if(result.status!=='opened')throw new Error(result.message||'无法打开练习文件窗口。');
            } else {
                popup=window.open(`/welcome/files/${kind}/?request=${requestId}`,'welcome-file-'+requestId,'popup=yes,width=780,height=540,resizable=yes');
                if(!popup)throw new Error('请允许本地应用弹出窗口，然后重新选择文件。');
            }
        }catch(error){cleanup();tell(error.message);}
    }
    function render({kind,screen,state,save,tell}) {
        if(state.lesson?.kind!==kind)state.lesson={kind,done:false};
        const lesson=state.lesson, grades=kind==='import';
        const file=files.find(item=>item.kind===kind).name;
        let controller, active=true;
        screen.replaceChildren();
        screen.append(document.getElementById(grades?'welcome-import-students':'welcome-import-layout').content.cloneNode(true));
        const root=screen.querySelector('.options-shell');
        const heading=root.querySelector('h1');heading.id='welcome-heading';heading.tabIndex=-1;
        root.dataset.importUrl='/welcome/simulated-import';root.dataset.classroomId='';root.dataset.backUrl='';
        const coach=document.createElement('div');coach.className='welcome-import-coach';coach.setAttribute('role','status');
        heading.after(coach);
        const guide=()=>{
            if(lesson.done){coach.innerHTML='<strong>模拟导入完成</strong><span>已导入四位模拟学生，真实班级没有变化。</span><button type="button" class="btn btn-primary" data-action="'+(state.practiceMode?'practice':'import-next')+'">继续</button>';return;}
            const saved=controller?.getState();
            let step=grades?'1 / 3':'1 / 2',text='点击“选择文件”，在“班管理”文件夹选择'+file+'。窗口内均为模拟数据。';
            if(saved?.preview){
                step=grades?(saved.region?'3 / 3':'2 / 3'):'2 / 2';
                text=grades?(saved.region?'点击第 2 行，再点击第 5 行，排除表头和平均分。绿色是有效区域；核对首尾学生后点击“确定导入”。':'点击表格 A、B、E 列的列标，在弹窗中依次选择姓名、学号、分数。也可先选左侧字段再点列标；“自定义信息”可绑定身高等其他列。'):'保留第 1 至 4 行，查看前后排预览。试试方向按钮，再切回“原始方向”；确认讲台在前、姓名为 4。识别错误时可手动标记，并点击“更新预览”。';
            }
            coach.replaceChildren();const badge=document.createElement('strong');badge.textContent='模拟练习 · '+step;const copy=document.createElement('span');copy.textContent=text;coach.append(badge,copy);
        };
        const persist=()=>{if(!active)return;lesson.sharedImport=controller?.getState();save();guide();};
        const later=()=>queueMicrotask(persist);
        const complete=()=>{lesson.done=true;if(!state.completed.includes('lesson-'+kind))state.completed.push('lesson-'+kind);save();root.querySelectorAll('form,.options-layout').forEach(node=>node.hidden=true);guide();};
        const exit=completed=>{if(!active)return;if(completed)complete();else document.getElementById('welcome-back').click();};
        const transport=async(_url,options)=>{
            try{const data=WelcomeImportFixtures.respond(kind,options.body,lesson.fileSelected);setTimeout(persist,0);return {ok:true,json:async()=>data};}
            catch(error){return {ok:false,json:async()=>({status:'error',message:error.message})};}
        };
        const form=root.querySelector('form');form.removeAttribute('action');form.noValidate=true;
        const nativeFile=form.querySelector('input[type=file]');nativeFile.type='hidden';nativeFile.removeAttribute('required');
        let chooser=form.querySelector('.student-import-file-button');
        if(chooser){const button=document.createElement('button');button.type='button';button.className=chooser.className;button.innerHTML=chooser.innerHTML;chooser.replaceWith(button);chooser=button;}
        else{chooser=document.createElement('button');chooser.type='button';chooser.className='btn btn-secondary';chooser.textContent='选择文件';nativeFile.after(chooser);const label=document.createElement('span');label.className='welcome-fixture-name';label.textContent='未选择文件';chooser.after(label);}
        const filename=()=>{const label=root.querySelector('#student-import-file-name,.welcome-fixture-name');if(label)label.textContent=lesson.fileSelected?file:'未选择文件';};
        const choose=event=>{event?.preventDefault();chooseFile(kind,()=>{if(!active)return;lesson.fileSelected=true;filename();save();},tell);};
        chooser.onclick=choose;nativeFile.onclick=choose;
        controller=(grades?window.StudentImportPage:window.LayoutImportPage)({fetch:transport,onExit:exit});
        controller.restore(lesson.sharedImport);filename();guide();
        const modeHint=document.createElement('p');modeHint.className='student-import-section-description';modeHint.textContent='匹配更新：按已有学生匹配并更新数据。全量替换：替换原名单。练习中两种模式均只使用模拟数据。';
        root.querySelector('.student-import-mode-switch')?.after(modeHint);
        screen.addEventListener('click',later);screen.addEventListener('input',later);screen.addEventListener('change',later);
        const cleanup=()=>{persist();active=false;controller.destroy();screen.removeEventListener('click',later);screen.removeEventListener('input',later);screen.removeEventListener('change',later);};
        window.addEventListener('welcome-page-leave',cleanup,{once:true});
        if(lesson.done)complete();
    }
    return {render};
})();
