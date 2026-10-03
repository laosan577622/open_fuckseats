window.WelcomeFinale = (() => {
    let playing;
    const wendaoImage = new URL('../img/wendao-window.svg', document.currentScript.src).href;
    const threeImage = new URL('../img/three.png', document.currentScript.src).href;
    function play(options = {}) {
        if (playing) return playing;
        playing = new Promise(resolve => {
            const previous = document.activeElement;
            const overlay = document.createElement('section'); overlay.className='wf-finale'; overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','欢迎使用不想排座位');overlay.tabIndex=-1;
            overlay.innerHTML=`<div class="wf-lockup"><div class="wf-mark" aria-hidden="true">${'<i class="wf-square"></i>'.repeat(4)}</div><h1 class="wf-wordmark">不想排座位</h1></div>
                <div class="wf-three-stage"><i class="wf-three-light" aria-hidden="true"></i><i class="wf-three-depth" aria-hidden="true"></i><img class="wf-three" src="${threeImage}" width="1122" height="1402" alt="版本 3" decoding="async"><i class="wf-three-sheen" aria-hidden="true"></i></div>
                <div class="wf-credit"><span>Made smart by</span><img src="${wendaoImage}" width="441" height="76" alt="闻道 Window"></div>
                <button class="wf-continue" hidden disabled>继续</button>`;
            const inerted=[...document.body.children].filter(node=>!node.inert && !['SCRIPT','STYLE'].includes(node.tagName));inerted.forEach(node=>node.inert=true);
            document.body.append(overlay);overlay.focus();
            const lockup=overlay.querySelector('.wf-lockup'),mark=overlay.querySelector('.wf-mark'),word=overlay.querySelector('.wf-wordmark');
            overlay.style.setProperty('--wf-three-mask',`url("${threeImage}")`);
            const three=overlay.querySelector('.wf-three'),stage=overlay.querySelector('.wf-three-stage'),light=overlay.querySelector('.wf-three-light'),depth=overlay.querySelector('.wf-three-depth'),sheen=overlay.querySelector('.wf-three-sheen'),credit=overlay.querySelector('.wf-credit'),button=overlay.querySelector('.wf-continue');
            const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
            const shift=(word.getBoundingClientRect().width+28)/2;
            const animate=(node,frames,options)=>node.animate(frames,{fill:'forwards',...options}).finished;
            async function sequence() {
                // 解码失败也要让引导可继续，不能把用户留在动画中。
                const imageReady = three.decode?.().catch(()=>{});
                if(!reduced){
                    const particles=Array.from({length:80},(_,i)=>{
                        const node=document.createElement('i');node.className='wf-particle';node.setAttribute('aria-hidden','true');overlay.querySelector('.wf-lockup').append(node);
                        const angle=i*2.39996, radius=Math.min(innerWidth,innerHeight)*(.28+(i%7)*.045),x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
                        const tx=(i%2?28:-28),ty=(Math.floor(i/2)%2?28:-28);
                        return animate(node,[{opacity:0,transform:`translate(${x}px,${y}px) rotate(${i*17}deg) scale(.5)`},{opacity:.85,offset:.18,transform:`translate(${x*.86}px,${y*.86}px) rotate(${i*9}deg)`},{opacity:1,offset:.88,transform:`translate(${tx}px,${ty}px) rotate(0deg) scale(.6)`},{opacity:0,transform:`translate(${tx}px,${ty}px) scale(.1)`}],{duration:1100,delay:(i%10)*28,easing:'cubic-bezier(.45,0,.18,1)'}).then(()=>node.remove());
                    });
                    const squares=[...mark.children].map((node,index)=>animate(node,[{opacity:0,transform:'scale(.65)'},{opacity:1,transform:'scale(1)'}],{duration:500,delay:760+index*55,easing:'cubic-bezier(.16,1,.3,1)'}));
                    await Promise.all([...particles,...squares]);
                }else{[...mark.children].forEach(n=>n.style.opacity='1');mark.style.transform=`translateX(${-shift}px)`;word.style.opacity='1';word.style.transform=`translate(${76-shift}px,-50%)`;}
                const markBounds=mark.getBoundingClientRect(),wordBounds=word.getBoundingClientRect();
                const lockupWidth=Math.max(markBounds.right,wordBounds.right)-Math.min(markBounds.left,wordBounds.left);
                const move=innerWidth<=640?0:Math.min(innerWidth*(innerWidth<=1100?.25:.16),Math.max(0,(innerWidth-lockupWidth)/2-16));
                if(!reduced){
                    await Promise.race([imageReady, new Promise(done=>setTimeout(done,1500))]);
                    const fromCenter=innerWidth*.5-(stage.getBoundingClientRect().left+stage.getBoundingClientRect().width/2);
                    await Promise.all([
                        animate(mark,[{transform:'translateX(0)'},{transform:`translateX(${-shift}px)`}],{duration:1200,easing:'cubic-bezier(.65,0,.2,1)'}),
                        animate(word,[{opacity:0,transform:`translate(${96-shift}px,-50%)`,clipPath:'inset(0 100% 0 0)'},{opacity:1,transform:`translate(${76-shift}px,-50%)`,clipPath:'inset(0 0 0 0)'}],{duration:1000,delay:160,easing:'cubic-bezier(.16,1,.3,1)'}),
                        animate(lockup,[{transform:'translateX(0)'},{transform:`translateX(${-move}px)`}],{duration:1600,delay:120,easing:'cubic-bezier(.22,.8,.2,1)'}),
                        animate(stage,[
                            {opacity:0,filter:'blur(12px)',transform:`translate(calc(-50% + ${fromCenter}px),-34%) scale(1.48) rotateY(-32deg) rotateZ(-7deg)`},
                            {opacity:1,filter:'blur(4px)',offset:.18},
                            {opacity:1,filter:'blur(0px)',offset:.62,transform:'translate(-50%,-52%) scale(1.02) rotateY(6deg) rotateZ(1deg)'},
                            {opacity:1,filter:'blur(0px)',offset:.84,transform:'translate(-50%,-49%) scale(.995) rotateY(-2deg) rotateZ(-.3deg)'},
                            {opacity:1,filter:'blur(0px)',transform:'translate(-50%,-50%) scale(1) rotateY(0deg) rotateZ(0deg)'}
                        ],{duration:1900,delay:140,easing:'cubic-bezier(.25,.1,.25,1)'}),
                        animate(three,[
                            {clipPath:'ellipse(0% 0% at 58% 82%)',filter:'brightness(1.8)'},
                            {clipPath:'ellipse(24% 22% at 58% 76%)',filter:'brightness(1.35)',offset:.25},
                            {clipPath:'ellipse(80% 86% at 54% 58%)',filter:'brightness(1.04)',offset:.6},
                            {clipPath:'ellipse(130% 130% at 50% 50%)',filter:'brightness(1)'}
                        ],{duration:1700,delay:140,easing:'cubic-bezier(.25,.1,.25,1)'}),
                        animate(light,[{opacity:0,transform:'scale(.35)'},{opacity:.7,transform:'scale(.9)',offset:.32},{opacity:.12,transform:'scale(1.3)',offset:.76},{opacity:0,transform:'scale(1.45)'}],{duration:2100,easing:'ease-in-out'}),
                        animate(depth,[{opacity:0,transform:'translate(22px,-18px) scale(1.05)'},{opacity:.18,transform:'translate(-8px,12px) scale(1.02)',offset:.42},{opacity:0,transform:'translate(14px,18px) scale(.98)'}],{duration:1900,delay:140,easing:'ease-in-out'}),
                        animate(sheen,[{opacity:0,backgroundPosition:'150% 50%'},{opacity:.6,offset:.3},{opacity:0,backgroundPosition:'-150% 50%'}],{duration:900,delay:1500,easing:'ease-in-out'}),
                        animate(credit,[{opacity:0},{opacity:1}],{duration:560,delay:1600,easing:'ease-out'})
                    ]);
                    button.hidden=false;
                    await Promise.all([
                        animate(credit,[{transform:'translate(-50%, 32px)'},{transform:'translate(-50%, 0)'}],{duration:550,easing:'cubic-bezier(.16,1,.3,1)'}),
                        animate(button,[{opacity:0},{opacity:1}],{duration:550,easing:'ease-out'})
                    ]);
                }else{
                    lockup.style.transform=`translateX(${-move}px)`;
                    stage.style.opacity='1';
                    credit.style.opacity='1';credit.style.transform='translate(-50%, 0)';
                    button.hidden=false;button.style.opacity='1';
                }
                button.disabled=false;button.focus();
            }
            sequence().catch(()=>{[...mark.children].forEach(n=>n.style.opacity='1');word.style.opacity='1';stage.style.opacity='1';three.style.clipPath='none';credit.style.opacity='1';credit.style.transform='translate(-50%,0)';button.hidden=false;button.style.opacity='1';button.disabled=false;button.focus();});
            overlay.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();(button.disabled?overlay:button).focus();}});
            button.onclick=async()=>{
                button.disabled=true;
                if(options.onContinue){
                    button.classList.add('is-expanding');
                    try{await options.onContinue(button);resolve();}
                    catch(error){button.classList.remove('is-expanding');button.disabled=false;let status=overlay.querySelector('.wf-error');if(!status){status=document.createElement('p');status.className='wf-error';status.setAttribute('role','alert');overlay.append(status);}status.textContent=error.message||'保存失败，请重试。';button.focus();}
                    return;
                }
                await animate(overlay,[{opacity:1},{opacity:0}],{duration:reduced?0:220});overlay.remove();inerted.forEach(node=>node.inert=false);previous?.focus?.();playing=null;resolve();
            };
        });
        return playing;
    }
    return {play};
})();
