(() => {
    const kind=document.body.dataset.kind, requestId=new URLSearchParams(location.search).get('request');
    const open=document.getElementById('picker-open'), error=document.getElementById('picker-error');
    document.querySelectorAll('input').forEach(input=>input.onchange=()=>{open.disabled=false;error.textContent='';});
    document.getElementById('picker-cancel').onclick=()=>{if(window.pywebview?.api?.cancel_tutorial_file_picker)window.pywebview.api.cancel_tutorial_file_picker();else window.close();};
    open.onclick=async()=>{
        if(document.querySelector('input:checked')?.value!==kind){error.textContent=`本次请打开${kind==='import'?'期中成绩表':'教室座位表'}（模拟）.xlsx。`;return;}
        open.disabled=true;
        try{
            if(window.pywebview?.api?.complete_tutorial_file_picker)await window.pywebview.api.complete_tutorial_file_picker();
            else if(window.opener){window.opener.postMessage({type:'welcome-file-picked',kind,requestId},location.origin);window.close();}
            else throw new Error('练习主窗口已关闭，请返回引导重新选择文件。');
        }catch(e){error.textContent=e.message;open.disabled=false;}
    };
})();
