/* The last button and the incoming page share one expanding rounded rectangle. */
window.WelcomeTransitions = (() => {
    const key = 'fuckseats-welcome-arrival';
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,radius:parseFloat(style.borderRadius)||0,
            background:style.backgroundColor,color:style.color,fontSize:parseFloat(style.fontSize),fontFamily:style.fontFamily,fontWeight:style.fontWeight,letterSpacing:style.letterSpacing};
    };
    function suppressBrowserTransition() {
        const style = document.createElement('style');
        style.textContent = '@view-transition { navigation: none; }';
        document.head.append(style);
        return style;
    }
    function depart(button) {
        if (reduced()) return;
        const finale = button.closest('.wf-finale');
        if (!finale) return;
        const scene = {time:Date.now(),width:innerWidth,height:innerHeight,button:box(button),
            squares:[...finale.querySelectorAll('.wf-square')].map(box),word:box(finale.querySelector('.wf-wordmark'))};
        try {
            sessionStorage.setItem(key,JSON.stringify(scene));
            suppressBrowserTransition();
        } catch (_) {}
    }
    function present(scene) {
        const ns='http://www.w3.org/2000/svg', width=innerWidth, height=innerHeight;
        const sx=width/scene.width, sy=height/scene.height;
        const scale=b=>({...b,x:b.x*sx,y:b.y*sy,width:b.width*sx,height:b.height*sy});
        const button=scale(scene.button);
        const make=(tag,attributes,parent)=>{
            const node=document.createElementNS(ns,tag);
            Object.entries(attributes).forEach(([name,value])=>node.setAttribute(name,String(value)));
            parent?.append(node);return node;
        };
        const svg=make('svg',{viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true',class:'welcome-reveal-cover','data-progress':0});
        const defs=make('defs',{},svg);
        const mask=make('mask',{id:'welcome-portal-mask',maskUnits:'userSpaceOnUse',x:0,y:0,width,height},defs);
        make('rect',{width,height,fill:'white'},mask);
        const hole=make('rect',{fill:'black'},mask);
        const oldPage=make('g',{mask:'url(#welcome-portal-mask)'},svg);
        make('rect',{width,height,fill:'white'},oldPage);
        scene.squares.forEach(square=>{
            const b=scale(square);make('rect',{x:b.x,y:b.y,width:b.width,height:b.height,rx:b.radius*sx,fill:b.background},oldPage);
        });
        const label=(text,source,parent)=>{
            const b=scale(source);
            const foreign=make('foreignObject',{x:b.x,y:b.y,width:b.width,height:b.height},parent);
            const content=document.createElementNS('http://www.w3.org/1999/xhtml','div');
            Object.assign(content.style,{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',whiteSpace:'nowrap',
                fontSize:`${source.fontSize*sy}px`,fontFamily:source.fontFamily,fontWeight:source.fontWeight,letterSpacing:source.letterSpacing,color:source.color});
            content.textContent=text;foreign.append(content);return foreign;
        };
        label('不想排座位',scene.word,oldPage);
        const surface=make('rect',{fill:scene.button.background},svg);
        const caption=label('继续',scene.button,svg);
        const clamp=value=>Math.max(0,Math.min(1,value));
        const frame=progress=>{
            // One uninterrupted trajectory drives the blue surface AND the page aperture.
            const t=clamp(progress),eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
            const attributes={x:button.x*(1-eased),y:button.y*(1-eased),
                width:button.width+(width-button.width)*eased,height:button.height+(height-button.height)*eased,
                rx:(button.height/2)*(1-eased)};
            for(const node of [hole,surface])Object.entries(attributes).forEach(([name,value])=>node.setAttribute(name,String(value)));
            // The page appears inside the still-growing button, never after its growth ends.
            surface.setAttribute('opacity',String(1-clamp((t-.12)/.55)));
            caption.setAttribute('opacity',String(1-clamp(t/.24)));
            svg.dataset.progress=String(t);
        };
        frame(0);document.documentElement.append(svg);
        const transitionStyle=suppressBrowserTransition();
        let started=false;
        const start=()=>{
            if(started)return;started=true;
            const body=document.body,wasInert=body.inert;body.inert=true;
            let began;
            const tick=now=>{
                began??=now;const progress=(now-began)/1120;frame(progress);
                if(progress<1)requestAnimationFrame(tick);
                else{svg.remove();transitionStyle.remove();body.inert=wasInert;window.dispatchEvent(new Event('welcome-arrival-complete'));}
            };
            requestAnimationFrame(tick);
        };
        if('onpagereveal' in window)window.addEventListener('pagereveal',event=>{event.viewTransition?.skipTransition();start();},{once:true});
        else document.addEventListener('DOMContentLoaded',start,{once:true});
    }
    try {
        const scene=JSON.parse(sessionStorage.getItem(key)||'null');sessionStorage.removeItem(key);
        if(scene&&Date.now()-scene.time<15000&&scene.width>0&&scene.height>0&&scene.button&&scene.word&&scene.squares?.length===4&&!reduced())present(scene);
    } catch (_) {}
    return {depart};
})();
