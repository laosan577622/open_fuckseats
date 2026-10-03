window.WendaoWorkspaceTransition = (() => {
    function depart(panel, destination) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { location.href = destination; return; }
        const rect = panel.getBoundingClientRect();
        const cover = document.createElement('div');
        cover.className = 'wd-workspace-cover';
        Object.assign(cover.style, {
            position:'fixed', zIndex:'40000', pointerEvents:'auto', boxSizing:'border-box',
            left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`,
            borderRadius:getComputedStyle(panel).borderRadius, background:'#fff',
            border:'1px solid #dde5f5', overflow:'hidden',
        });
        const content = panel.querySelector('.wd-panel-content').cloneNode(true);
        content.querySelectorAll('button,a').forEach(node => { node.tabIndex = -1; });
        cover.append(content);
        document.body.append(cover);
        panel.style.visibility = 'hidden';
        const animation = cover.animate([
            {left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,borderRadius:'24px'},
            {left:'0px',top:'0px',width:'100vw',height:'100dvh',borderRadius:'0px'},
        ], {duration:580,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
        content.animate([{opacity:1,transform:'translateY(0)'},{opacity:.85,transform:'translateY(-2px)'},{opacity:0,transform:'translateY(-8px)'}], {duration:560,easing:'ease-out',fill:'forwards'});
        animation.finished.then(() => { location.href = destination; }).catch(() => { location.href = destination; });
    }
    return {depart};
})();
