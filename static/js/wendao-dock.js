(() => {
    'use strict';
    const root = document.getElementById('future-mode-root');
    if (!root?.dataset.inlineDock) return;
    const launch = document.getElementById('wd-launch');
    const gear = document.getElementById('wd-model-trigger');
    const orb = document.getElementById('wd-orb');
    const panels = {compose: document.getElementById('wd-composer-panel'), chat: document.getElementById('wd-chat'), model: document.getElementById('wd-model-panel'), suggestions: document.getElementById('wd-suggestions')};
    const anchors = {compose: launch, chat: launch, model: gear, suggestions: orb};
    const input = document.getElementById('userInput');
    const list = document.getElementById('wd-suggestion-list');
    const status = document.getElementById('wd-suggestion-status');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const draftKey = `wendao-draft:${root.dataset.classroomId}`;
    const ignoredKey = `wendao-suggestions:${root.dataset.classroomId}`;
    let active = null, modelOpen = false, switching = false, pendingChat = false, running = false, awaitingApproval = false, suggestionBusy = false, responseStart = 0;
    let items = [], rawItems = [], actions = {}, initialized = false, initPromise;
    let seen = new Set(), ignored = new Set();
    const frames = new Map();
    const skins = new Map();
    const bridges = new Map();
    let orbExit = null;
    const halos = new Map();
    let launchOriginRect = null, launchParked = false, launchSlide = null, pointerDriven = false;
    let transition = Promise.resolve();
    let suggestionMotion = null, suggestionsExpanded = false, suggestionsNeedRender = false;
    function enqueue(work) {
        const next = transition.then(work);
        transition = next.catch(() => {});
        return next;
    }
    try { input.value = sessionStorage.getItem(draftKey) || ''; ignored = new Set(JSON.parse(sessionStorage.getItem(ignoredKey) || '[]')); } catch (_) {}
    function saveDraft() { try { sessionStorage.setItem(draftKey, input.value); } catch (_) {} }
    input.addEventListener('input', saveDraft);
    function key(item) { return JSON.stringify([item.type || '', item.message || '', item.action_url || '']); }
    function allowed(item) {
        try { return localStorage.getItem(item.type === 'export_suggestion' ? 'seats_show_group_completion_suggestion' : 'seats_show_layout_suggestions') !== '0'; } catch (_) { return true; }
    }
    // 按下时的 scale(.97) 等变换会让测量结果比按钮实际布局小一圈，液态面板从这里起步会先"跳"一下。
    function anchorRect(element) {
        const rect = element.getBoundingClientRect();
        const transform = getComputedStyle(element).transform;
        if (!transform || transform === 'none') return rect;
        const matrix = new DOMMatrixReadOnly(transform);
        const scale = matrix.a || 1;
        const width = rect.width/scale, height = rect.height/scale;
        const left = rect.left + rect.width/2 - matrix.e - width/2, top = rect.top + rect.height/2 - matrix.f - height/2;
        return {left, top, width, height, right: left+width, bottom: top+height};
    }
    // 启动按钮变成面板后要让出位置；宽度、内边距一起过渡，旁边的建议按钮平滑滑动，不再瞬间跳位。
    const parkProps = ['width', 'minWidth', 'paddingLeft', 'paddingRight', 'marginLeft', 'marginRight', 'borderLeftWidth', 'borderRightWidth'];
    function park(next) {
        if (launchParked === next) return anchorRect(launch);
        const read = () => { const style = getComputedStyle(launch); return Object.fromEntries(parkProps.map(name => [name, style[name]])); };
        const before = read();
        launchSlide?.cancel(); launchSlide = null;
        launchParked = next; launch.classList.toggle('wd-parked', next);
        const after = read(), rect = anchorRect(launch);
        before.minWidth = after.minWidth = '0px';
        if (!reduced.matches) {
            const slide = launch.animate([before, after], {duration: 380, easing: 'cubic-bezier(.32,.72,0,1)'});
            launchSlide = slide;
            slide.onfinish = () => { if (launchSlide === slide) launchSlide = null; };
        }
        return rect;
    }
    function targetRect(kind) {
        const a = anchors[kind] === launch && launchParked && launchOriginRect ? launchOriginRect : anchorRect(anchors[kind]);
        const viewport = window.visualViewport;
        const vw = viewport?.width || innerWidth, vh = viewport?.height || innerHeight;
        const vx = viewport?.offsetLeft || 0, vy = viewport?.offsetTop || 0;
        if (kind === 'suggestions') {
            const width = Math.max(40, Math.min(340, vw - 24));
            const statusbar = document.querySelector('.classroom-statusbar')?.getBoundingClientRect().height || 0;
            const top = Math.max(vy + 12, Math.max(a.bottom, document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0) + 14);
            return {left: Math.max(vx + 12, Math.min(a.left, vx + vw - width - 12)), top, width, height: Math.max(80, vy + vh - statusbar - top - 16)};
        }
        const width = Math.max(40, Math.min(kind === 'model' ? 300 : kind === 'compose' ? 380 : 520, vw - 24));
        const headerBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom || a.bottom;
        const top = Math.max(vy + 12, Math.min(Math.max(a.bottom, headerBottom) + 14, vy + vh - 180));
        const desired = kind === 'chat' ? Math.max(210, Math.min(460, 112 + [...document.querySelectorAll('#chatContainer [data-wd-current]')].reduce((sum, node) => sum + node.scrollHeight, 0))) : kind === 'compose' ? 48 : 240;
        const preferredLeft = kind === 'compose' ? a.left : a.right - width;
        return {left: Math.max(vx + 12, Math.min(preferredLeft, vx + vw - width - 12)), top, width, height: Math.max(32, Math.min(desired, vy + vh - top - 12))};
    }
    const smooth = value => {
        const t = Math.max(0, Math.min(1, value));
        return t * t * (3 - 2 * t);
    };
    const mix = (from, to, t) => from + (to - from) * t;
    function mixRect(from, to, t) {
        return Object.fromEntries(['left', 'top', 'width', 'height'].map(name => [name, mix(from[name], to[name], t)]));
    }
    // 输入框和建议卡片共用弹簧参数；反向时保留当前位置与速度。
    function stepSpringRect(state, goal, dt) {
        const steps = Math.max(1, Math.ceil(dt / .008));
        for (let step = 0; step < steps; step++) {
            const span = dt / steps;
            for (const name of ['left', 'top', 'width', 'height']) {
                const stiffness = name === 'width' || name === 'height' ? 440 : 350;
                const damping = 2 * Math.sqrt(stiffness) * .7;
                state.velocity[name] += ((goal[name] - state.rect[name]) * stiffness - state.velocity[name] * damping) * span;
                state.rect[name] += state.velocity[name] * span;
            }
        }
        state.rect.width = Math.max(22, state.rect.width);
        state.rect.height = Math.max(20, state.rect.height);
    }
    // 按钮与面板的内阴影强度不同，按展开程度插值，首尾两帧才能和按钮、面板各自完全一致。
    function innerShadow(k) {
        const offset = mix(3, 7, k).toFixed(2), blur = mix(3, 17, k).toFixed(2), spread = mix(-3, -12, k).toFixed(2);
        const alpha = (from, to) => mix(from, to, k).toFixed(3);
        return `inset 0 ${offset}px ${blur}px ${spread}px rgba(78,101,255,${alpha(.149, .282)}), inset -${offset}px 0 ${blur}px ${spread}px rgba(146,72,255,${alpha(.133, .239)}), inset 0 -${offset}px ${blur}px ${spread}px rgba(255,75,114,${alpha(.133, .239)}), inset ${offset}px 0 ${blur}px ${spread}px rgba(255,184,77,${alpha(.133, .239)})`;
    }
    // 面板外阴影会被 clip-path 裁掉，形变期间改由面板下方的透明层承载，结束时不再突然冒出。
    function liquidHalo(kind) {
        if (halos.has(kind)) return halos.get(kind);
        const halo = document.createElement('div');
        halo.className = 'wd-liquid-halo'; halo.hidden = true; halo.setAttribute('aria-hidden', 'true');
        document.body.append(halo); halos.set(kind, halo);
        return halo;
    }
    // 过渡标签直接复刻按钮内容（文字或图标），避免首尾一帧文字与按钮不符。
    function paintLabel(label, anchor) {
        const nodes = [...anchor.childNodes].filter(node => !(node.nodeType === 1 && node.matches('.wd-notice, .wd-count')));
        label.replaceChildren(...nodes.map(node => node.cloneNode(true)));
        label.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        const style = getComputedStyle(anchor);
        Object.assign(label.style, {font: style.font, letterSpacing: style.letterSpacing, color: style.color, gap: style.columnGap});
    }
    function liquidSkin(kind) {
        if (skins.has(kind)) return skins.get(kind);
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.classList.add('wd-liquid-outline');
        svg.setAttribute('aria-hidden', 'true');
        const gradient = document.createElementNS(svgNS, 'linearGradient');
        gradient.id = `wd-liquid-gradient-${kind}`;
        gradient.setAttribute('x1', '0%'); gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '100%');
        ['#4e65ff', '#9248ff', '#ff4b72', '#ffb84d', '#4e65ff'].forEach((color, index) => {
            const stop = document.createElementNS(svgNS, 'stop');
            stop.setAttribute('offset', `${index * 25}%`);
            stop.setAttribute('stop-color', color);
            gradient.append(stop);
        });
        const defs = document.createElementNS(svgNS, 'defs'); defs.append(gradient); svg.append(defs);
        const path = document.createElementNS(svgNS, 'path');
        path.classList.add('wd-liquid-edge');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', `url(#${gradient.id})`);
        const glow = document.createElementNS(svgNS, 'path');
        glow.classList.add('wd-liquid-glow');
        glow.setAttribute('fill', 'none');
        glow.setAttribute('stroke', `url(#${gradient.id})`);
        svg.append(glow, path); panels[kind].append(svg);
        const skin = {svg, path, glow}; skins.set(kind, skin);
        return skin;
    }
    function liquidBridge(kind) {
        if (bridges.has(kind)) return bridges.get(kind);
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.classList.add('wd-liquid-bridge');
        svg.setAttribute('aria-hidden', 'true');
        const gradient = document.createElementNS(namespace, 'linearGradient');
        gradient.id = `wd-bridge-gradient-${kind}`;
        gradient.setAttribute('x1', '0%'); gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '100%');
        ['#4e65ff', '#9248ff', '#ff4b72', '#ffb84d', '#4e65ff'].forEach((color, index) => {
            const stop = document.createElementNS(namespace, 'stop');
            stop.setAttribute('offset', `${index*25}%`);
            stop.setAttribute('stop-color', color);
            gradient.append(stop);
        });
        const defs = document.createElementNS(namespace, 'defs'); defs.append(gradient); svg.append(defs);
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('fill', '#fff');
        path.setAttribute('fill-opacity', '.35');
        path.setAttribute('stroke', `url(#${gradient.id})`);
        path.classList.add('wd-liquid-bridge-shape'); svg.append(path);
        document.body.append(svg);
        const bridge = {svg, path}; bridges.set(kind, bridge);
        return bridge;
    }
    function drawBridge(bridge, anchor, rect, opening, elapsed, detachGap) {
        const gap = rect.top-anchor.bottom;
        const nearby = smooth((gap-.5)/5) * (1-smooth((gap-detachGap)/14));
        const lifetime = opening ? 1-smooth((elapsed-.32)/.2) : smooth((elapsed-.06)/.1);
        const strength = nearby*lifetime;
        if (strength < .025) { bridge.svg.setAttribute('hidden', ''); return false; }
        bridge.svg.removeAttribute('hidden');
        bridge.svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
        const x = Math.max(rect.left+10, Math.min(anchor.left+anchor.width/2, rect.left+rect.width-10));
        const root = Math.max(.75, 2.6*strength);
        const neck = Math.max(.7, 3.2*strength);
        const tip = Math.max(1, Math.min(10, rect.width*.07)*strength);
        const bottom = rect.top+2;
        const base = Math.max(anchor.bottom, bottom-28);
        const length = Math.max(1, bottom-base);
        const fmt = value => value.toFixed(2);
        bridge.path.setAttribute('d', [
            `M ${fmt(x-root)} ${fmt(base)}`,
            `C ${fmt(x-root*1.5)} ${fmt(base+length*.2)} ${fmt(x-neck)} ${fmt(base+length*.37)} ${fmt(x-neck)} ${fmt(base+length*.55)}`,
            `C ${fmt(x-neck)} ${fmt(base+length*.8)} ${fmt(x-tip)} ${fmt(bottom-length*.13)} ${fmt(x-tip)} ${fmt(bottom)}`,
            `L ${fmt(x+tip)} ${fmt(bottom)}`,
            `C ${fmt(x+tip)} ${fmt(bottom-length*.13)} ${fmt(x+neck)} ${fmt(base+length*.8)} ${fmt(x+neck)} ${fmt(base+length*.55)}`,
            `C ${fmt(x+neck)} ${fmt(base+length*.37)} ${fmt(x+root*1.5)} ${fmt(base+length*.2)} ${fmt(x+root)} ${fmt(base)} Z`,
        ].join(' '));
        bridge.svg.style.opacity = String(Math.min(1, strength*1.8));
        return true;
    }
    function liquidPath(width, height, radius, edge, speed, direction, dt, elapsed, recoilAge, amount = 1) {
        const w = Math.max(8, width), h = Math.max(8, height);
        const r = Math.min(radius, w / 2 - 1, h / 2 - 1);
        const points = [];
        const add = (x, y, nx, ny) => points.push({x, y, nx, ny});
        for (let i = 0; i <= 6; i++) add(mix(r, w-r, i/6), 0, 0, -1);
        for (let i = 1; i <= 5; i++) { const a = -Math.PI/2 + i*Math.PI/10; add(w-r+r*Math.cos(a), r+r*Math.sin(a), Math.cos(a), Math.sin(a)); }
        for (let i = 1; i <= 6; i++) add(w, mix(r, h-r, i/6), 1, 0);
        for (let i = 1; i <= 5; i++) { const a = i*Math.PI/10; add(w-r+r*Math.cos(a), h-r+r*Math.sin(a), Math.cos(a), Math.sin(a)); }
        for (let i = 1; i <= 6; i++) add(mix(w-r, r, i/6), h, 0, 1);
        for (let i = 1; i <= 5; i++) { const a = Math.PI/2 + i*Math.PI/10; add(r+r*Math.cos(a), h-r+r*Math.sin(a), Math.cos(a), Math.sin(a)); }
        for (let i = 1; i <= 6; i++) add(0, mix(h-r, r, i/6), -1, 0);
        for (let i = 1; i <= 5; i++) { const a = Math.PI + i*Math.PI/10; add(r+r*Math.cos(a), r+r*Math.sin(a), Math.cos(a), Math.sin(a)); }
        // 轮廓上的点各自跟随弹簧。运动越快，前缘承受的压力越大；后缘稍后才归位。
        const pressure = Math.min(14, h * .18, speed * .006 + Math.max(0, 1 - elapsed / .13) * 5);
        const positions = points.map((point, index) => {
            const leading = Math.max(0, point.nx*direction.x + point.ny*direction.y);
            const wave = .46 + .29*Math.sin(index*.71 - elapsed*14) + .19*Math.sin(index*1.63 + elapsed*8);
            const target = pressure * Math.max(0, wave + .58*leading*leading);
            const pointState = edge[index] ||= {offset: 0, velocity: 0};
            const stiffness = 220 + leading*210 + index%4*22;
            const damping = 2*Math.sqrt(stiffness)*(.58 + leading*.12);
            const steps = Math.max(1, Math.ceil(dt / .008));
            for (let step = 0; step < steps; step++) {
                const span = dt / steps;
                pointState.velocity += ((target-pointState.offset)*stiffness - pointState.velocity*damping)*span;
                pointState.offset += pointState.velocity*span;
            }
            const recoil = recoilAge >= 0 ? Math.exp(-recoilAge*17)*Math.sin(recoilAge*65+index*.66)*1.6 : 0;
            // amount 在动画首尾趋近 0，轮廓回到与按钮/面板完全相同的圆角矩形。
            const inward = Math.max(0, pointState.offset+recoil)*amount;
            const pad = .6*amount;
            return {x: Math.max(pad, Math.min(w-pad, point.x-point.nx*inward)), y: Math.max(pad, Math.min(h-pad, point.y-point.ny*inward))};
        });
        const fmt = number => number.toFixed(2);
        // 每个采样点拥有独立位移，曲线连接各点，轮廓不会变成统一缩放的椭圆。
        let data = `M ${fmt(positions[0].x)} ${fmt(positions[0].y)}`;
        positions.forEach((point, index) => {
            const next = positions[(index+1) % positions.length];
            data += ` Q ${fmt(point.x)} ${fmt(point.y)} ${fmt((point.x+next.x)/2)} ${fmt((point.y+next.y)/2)}`;
        });
        return data + ' Z';
    }
    // 短暂收紧只改变弹簧的目标，位置与速度连续，随后由惯性带着各部分舒展和归位。
    function morph(kind, opening, spring = true) {
        // 保留弹簧驱动的位置、尺寸和内容过渡；只停用液态轮廓、拉丝和光晕。
        const liquid = false;
        const panel = panels[kind], anchor = anchors[kind];
        const previous = frames.get(kind);
        if (previous) { cancelAnimationFrame(previous.id); previous.resolve(); frames.delete(kind); }
        const fresh = panel.hidden;
        const openWidth = targetRect(kind).width;
        let a;
        if (anchor !== launch) a = anchorRect(anchor);
        else if (!opening) a = park(false);
        else a = launchParked && launchOriginRect ? launchOriginRect : anchorRect(launch);
        if (opening && anchor === launch) launchOriginRect = a;
        const bounds = fresh ? a : panel.getBoundingClientRect();
        const from = {left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height};
        const to = opening ? targetRect(kind) : a;
        const fromRadius = fresh ? a.height / 2 : parseFloat(getComputedStyle(panel).borderRadius);
        const toRadius = opening ? (kind === 'compose' ? 999 : kind === 'model' ? 18 : 24) : a.height / 2;
        const content = panel.querySelector('.wd-panel-content');
        const label = panel.querySelector('.wd-morph-label');
        if (fresh) paintLabel(label, anchor);
        const fromLabelOpacity = fresh ? 1 : Number(getComputedStyle(label).opacity);
        const fromOpacity = fresh ? 0 : Number(getComputedStyle(content).opacity);
        const skin = liquid && !reduced.matches ? liquidSkin(kind) : null;
        const bridge = skin ? liquidBridge(kind) : null;
        const halo = skin ? liquidHalo(kind) : null;
        const envFrom = skin && !fresh ? skin.env || 0 : 0;
        const names = ['left', 'top', 'width', 'height'];
        if (skin) { skin.svg.style.opacity = '0'; skin.svg.removeAttribute('hidden'); }
        else { skins.get(kind)?.svg.setAttribute('hidden', ''); halos.get(kind)?.setAttribute('hidden', ''); panel.style.clipPath = ''; panel.style.boxShadow = ''; }
        if (bridge) bridge.svg.setAttribute('hidden', '');
        content.style.width = `${(opening ? to.width : from.width) - 3}px`;
        content.style.height = `${(opening ? to.height : from.height) - 3}px`;
        panel.hidden = false; panel.inert = !opening;
        anchor.style.visibility = 'hidden';
        if (opening && anchor === launch) park(true);
        anchor.setAttribute('aria-expanded', String(opening));
        const duration = reduced.matches ? 0 : spring ? (kind === 'compose' ? 540 : kind === 'model' ? 500 : 690) : 260;
        const start = performance.now();
        const pinchRect = {
            left: a.left + a.width*.18,
            top: a.top + a.height*.12,
            width: a.width*.64,
            height: a.height*.76,
        };
        const travelX = to.left + to.width/2 - from.left - from.width/2;
        const travelY = to.top + to.height/2 - from.top - from.height/2;
        const travel = Math.hypot(travelX, travelY) || 1;
        const direction = {x: travelX/travel, y: travelY/travel};
        const detachGap = 32;
        const state = {rect: {...from}, velocity: {left: 0, top: 0, width: 0, height: 0}, edge: [], last: start, bridgeSeen: false, ruptureAt: -1};
        return new Promise(resolve => {
            const job = {id: 0, resolve}; frames.set(kind, job);
            function frame(now) {
                const elapsed = now - start;
                const t = duration ? Math.min(1, elapsed / duration) : 1;
                const dt = Math.min(.05, Math.max(0, (now-state.last)/1000));
                state.last = now;
                let rect;
                if (spring && duration) {
                    if (opening) {
                        Object.assign(to, targetRect(kind));
                        content.style.width = `${to.width-3}px`;
                        content.style.height = `${to.height-3}px`;
                    }
                    const goal = elapsed < (opening ? 64 : 80) ? pinchRect : to;
                    stepSpringRect(state, goal, dt);
                    rect = state.rect;
                } else rect = mixRect(from, to, smooth(t));
                for (const name of ['left','top','width','height']) panel.style[name] = `${rect[name]}px`;
                const sizeProgress = Math.max(0, Math.min(1, (rect.width-from.width) / (to.width-from.width || 1)));
                const radius = spring && duration ? Math.min(rect.width/2, rect.height/2, mix(fromRadius, toRadius, sizeProgress)) : mix(fromRadius, toRadius, smooth(t));
                panel.style.borderRadius = `${radius}px`;
                if (skin) {
                    const speed = Math.hypot(state.velocity.left+state.velocity.width/2, state.velocity.top+state.velocity.height/2, state.velocity.width*.45, state.velocity.height*.45);
                    const connected = drawBridge(bridge, a, rect, opening, elapsed/1000, detachGap);
                    if (connected) state.bridgeSeen = true;
                    else if (state.bridgeSeen && state.ruptureAt < 0) state.ruptureAt = elapsed/1000;
                    const recoilAge = state.ruptureAt < 0 ? -1 : elapsed/1000-state.ruptureAt;
                    // 液态效果的包络：起步时从 0 淡入，接近终点时随剩余距离与速度归零，首尾都与静态外观无缝衔接。
                    const gap = Math.max(...names.map(name => Math.abs(rect[name]-to[name]))) + Math.max(...names.map(name => Math.abs(state.velocity[name])))*.01;
                    const env = mix(envFrom, 1, smooth(elapsed/110)) * smooth((gap-1.5)/10);
                    skin.env = env;
                    const path = liquidPath(rect.width, rect.height, radius, state.edge, speed, direction, dt, elapsed/1000, recoilAge, env);
                    panel.style.clipPath = `path('${path}')`;
                    skin.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
                    skin.path.setAttribute('d', path);
                    skin.glow.setAttribute('d', path);
                    const energy = Math.min(1, speed/1800);
                    skin.svg.style.opacity = String(Math.min(1, .35 + energy*.65)*env);
                    skin.glow.style.opacity = String(.38 + energy*.42);
                    // 展开程度只看宽度处于按钮与面板之间的位置，开合两个方向共用同一套插值。
                    const depth = smooth((rect.width-a.width)/((opening ? to.width : openWidth)-a.width || 1));
                    const glass = Math.sin(Math.PI*depth);
                    const alpha = (1-glass*.28).toFixed(3);
                    panel.style.background = `linear-gradient(rgba(255,255,255,${alpha}),rgba(255,255,255,${alpha})) padding-box, conic-gradient(from var(--wd-angle), var(--wd-colors)) border-box`;
                    panel.style.backdropFilter = `blur(${(glass*12).toFixed(1)}px) saturate(1.15)`;
                    panel.style.webkitBackdropFilter = panel.style.backdropFilter;
                    panel.style.boxShadow = innerShadow(depth);
                    halo.hidden = false;
                    for (const name of names) halo.style[name] = `${rect[name]}px`;
                    halo.style.borderRadius = `${radius}px`;
                    halo.style.opacity = String(depth*(1-env));
                }
                const reveal = spring && duration ? opening ? smooth((elapsed-(kind === 'compose' ? 60 : 90))/(kind === 'compose' ? 180 : 240)) : 1-smooth((elapsed-35)/190) : smooth(t);
                content.style.opacity = String(spring && duration ? reveal : mix(fromOpacity, opening ? 1 : 0, reveal));
                label.style.opacity = String(spring && duration ? (opening ? 1-smooth((elapsed-35)/150) : smooth((elapsed-35)/150)) : mix(fromLabelOpacity, opening ? 0 : 1, reveal));
                if (spring && duration) {
                    const lagX = Math.max(-10, Math.min(10, -(state.velocity.left+state.velocity.width/2)*.004));
                    const lagY = Math.max(-10, Math.min(10, -(state.velocity.top+state.velocity.height/2)*.004));
                    content.style.transform = `translate3d(${lagX}px, ${lagY}px, 0)`;
                }
                const settled = ['left','top','width','height'].every(name => Math.abs(rect[name]-to[name]) < 1.2 && Math.abs(state.velocity[name]) < 18);
                const finished = spring && duration ? ((elapsed > duration*.7 && settled) || t >= 1) : t >= 1;
                if (!finished) { job.id = requestAnimationFrame(frame); return; }
                frames.delete(kind);
                for (const name of ['left','top','width','height']) panel.style[name] = `${to[name]}px`;
                panel.style.borderRadius = `${toRadius}px`;
                content.style.opacity = opening ? '1' : '0';
                content.style.transform = '';
                label.style.opacity = opening ? '0' : '1';
                panel.style.background = '';
                panel.style.backdropFilter = '';
                panel.style.webkitBackdropFilter = '';
                panel.style.clipPath = '';
                panel.style.boxShadow = '';
                if (halo) halo.hidden = true;
                if (skin) { skin.env = 0; skin.svg.setAttribute('hidden', ''); }
                if (bridge) bridge.svg.setAttribute('hidden', '');
                if (!opening) { panel.hidden = true; anchor.style.visibility = ''; }
                else { content.style.width = ''; content.style.height = ''; }
                resolve();
            }
            job.id = requestAnimationFrame(frame);
        });
    }
    function layoutSuggestions() {
        const rect = targetRect('suggestions');
        for (const name of ['left', 'top', 'width', 'height']) panels.suggestions.style[name] = `${rect[name]}px`;
    }
    function animateSuggestions(opening) {
        if (suggestionMotion?.opening === opening) return suggestionMotion.promise;
        const panel = panels.suggestions;
        const previous = suggestionMotion;
        const fresh = panel.hidden;
        if (previous) { cancelAnimationFrame(previous.id); previous.resolve(false); }
        suggestionsExpanded = opening;
        orb.setAttribute('aria-expanded', String(opening));
        panel.hidden = false;
        layoutSuggestions();
        if (fresh) list.scrollTop = 0;
        const anchor = anchorRect(orb);
        const rectOf = rect => Object.fromEntries(['left', 'top', 'width', 'height'].map(name => [name, rect[name]]));
        const listBounds = list.getBoundingClientRect();
        const visibleCards = [...list.querySelectorAll('.wd-suggestion')].filter(card => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > listBounds.top && rect.top < listBounds.bottom;
        });
        // 只有一组形变状态。卡片由同一个按钮轮廓舒展成扇状排布，正文按最终宽度排版。
        const entries = previous?.entries || visibleCards.map((card, index, cards) => {
            const target = rectOf(card.getBoundingClientRect());
            const shell = card.cloneNode(true);
            shell.classList.add('wd-panel', 'wd-suggestion-flight');
            shell.setAttribute('aria-hidden', 'true');
            shell.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
            shell.style.zIndex = String(1710 + cards.length - index);
            const content = shell.querySelector('.wd-suggestion-content');
            content.style.width = `${target.width - 3}px`;
            // 外壳起点与建议按钮一模一样：渐变圆环加灯泡，展开时逐渐褪成纯白卡片。
            const clip = document.createElement('div'); clip.className = 'wd-flight-clip';
            clip.append(content); shell.append(clip);
            const ring = document.createElement('span'); ring.className = 'wd-flight-ring'; shell.append(ring);
            const icon = orb.querySelector('svg').cloneNode(true);
            icon.querySelector('defs')?.remove(); icon.classList.add('wd-flight-icon'); shell.append(icon);
            document.body.append(shell);
            return {card, shell, content, icon, target, rect: fresh ? rectOf(anchor) : {...target}};
        });
        panel.classList.add('wd-suggestions-moving');
        panel.inert = true;
        // 一镜到底：按钮本身变成卡片，运动期间与展开后不再单独留在原处。
        if (entries.length) orb.style.visibility = 'hidden';
        const start = performance.now();
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const state = previous?.state || {rect: rectOf(fresh ? anchor : entries[0]?.target || anchor), velocity: {left: 0, top: 0, width: 0, height: 0}};
        const motion = {opening, entries, state, promise, resolve, id: 0, last: start};
        suggestionMotion = motion;
        function paint(entry) {
            const {target, shell, content, icon} = entry;
            const first = entries[0].target;
            const progress = Math.max(0, Math.min(1, (state.rect.width - anchor.width) / (first.width - anchor.width || 1)));
            const travel = Math.max(0, Math.min(1, (state.rect.top - anchor.top) / (first.top - anchor.top || 1)));
            // 初始轮廓重合，变宽后整组同时舒展；收起时先合拢，再回到唯一的按钮。
            const spread = smooth((progress - .18) / .82);
            const rect = entry.rect = {...state.rect, top: state.rect.top + (target.top - first.top) * spread, height: state.rect.height + (target.height - first.height) * progress};
            for (const name of ['left', 'top', 'width', 'height']) shell.style[name] = `${rect[name]}px`;
            shell.style.borderRadius = `${Math.min(rect.width / 2, rect.height / 2, mix(anchor.height / 2, 18, progress))}px`;
            content.style.opacity = String(smooth((progress - .12) / .7));
            icon.style.opacity = String(1 - smooth(progress / .3));
            // 按钮渐变圆环随展开褪去；扫光在途中最亮，起点和终点都归零，首尾与静态外观无缝衔接。
            shell.style.setProperty('--wd-orb', String(1 - smooth(progress / .45)));
            shell.style.setProperty('--wd-sweep', String(Math.pow(Math.sin(Math.PI * Math.max(progress, travel * .5)), .7)));
            const velocity = state.velocity;
            const lagX = Math.max(-10, Math.min(10, -(velocity.left + velocity.width / 2) * .004));
            const lagY = Math.max(-10, Math.min(10, -(velocity.top + velocity.height / 2) * .004));
            content.style.transform = `translate3d(${lagX}px, ${lagY}px, 0)`;
            // 连贯形变：沿运动方向随速度轻微拉长、垂直方向收窄，速度归零时自然复原。
            const moveX = velocity.left + velocity.width / 2, moveY = velocity.top + velocity.height / 2;
            const stretch = Math.min(.07, Math.hypot(moveX, moveY) / 5200);
            const vertical = Math.abs(moveY) >= Math.abs(moveX);
            shell.style.transform = `scale(${vertical ? 1 - stretch * .55 : 1 + stretch}, ${vertical ? 1 + stretch : 1 - stretch * .55})`;
        }
        entries.forEach(paint);
        function frame(now) {
            const elapsed = now - start;
            const dt = Math.min(.05, Math.max(0, (now - motion.last) / 1000));
            motion.last = now;
            const home = rectOf(anchorRect(orb));
            const goal = opening && entries.length ? entries[0].target : home;
            if (reduced.matches) state.rect = {...goal};
            else {
                // 与输入框相同的 64ms 收紧起步；收起和中途反向直接续接现有速度。
                const pinch = opening && fresh && elapsed < 64 ? {left: home.left + home.width * .18, top: home.top + home.height * .12, width: home.width * .64, height: home.height * .76} : goal;
                stepSpringRect(state, pinch, dt);
            }
            entries.forEach(paint);
            const settled = ['left', 'top', 'width', 'height'].every(name => Math.abs(state.rect[name] - goal[name]) < .35 && Math.abs(state.velocity[name]) < 8);
            const finished = reduced.matches || !entries.length || (elapsed >= 360 && settled);
            if (!finished) { motion.id = requestAnimationFrame(frame); return; }
            entries.forEach(entry => entry.shell.remove());
            if (!opening) orb.style.visibility = '';
            suggestionMotion = null;
            panel.classList.remove('wd-suggestions-moving');
            panel.hidden = !opening;
            panel.inert = !opening;
            if (suggestionsNeedRender) { suggestionsNeedRender = false; renderSuggestions(); }
            resolve(true);
        }
        motion.id = requestAnimationFrame(frame);
        return promise;
    }
    function open(kind, focus = false) {
        if (kind === 'suggestions' && active === kind) return animateSuggestions(true).then(() => { switching = false; });
        return enqueue(() => performOpen(kind, focus));
    }
    async function performOpen(kind, focus) {
        if ((kind === 'chat' || kind === 'compose') && !initialized) {
            initialized = true;
            initPromise = window.WendaoChat?.initialize();
            Promise.resolve(initPromise).then(() => { if (active === 'chat') reposition(); });
        }
        switching = true;
        if (modelOpen) { await morph('model', false); modelOpen = false; }
        if (active && active !== kind) {
            if (active === 'suggestions') await performClose('suggestions', false);
            else await morph(active, false);
        }
        active = kind;
        if (kind === 'chat') { pendingChat = false; launch.querySelector('.wd-notice').hidden = true; }
        if (kind === 'suggestions') {
            const fromOrb = document.activeElement === orb;
            await animateSuggestions(true);
            // 按钮已变成卡片，键盘操作时把焦点交给第一张建议的按钮。
            if (fromOrb && !pointerDriven) list.querySelector('button')?.focus({preventScroll: true});
        } else await morph(kind, true);
        switching = false;
        if (kind === 'chat') {
            const messages = document.getElementById('chatContainer');
            messages.scrollTop = messages.scrollHeight;
        }
        if (kind === 'chat' && !running) { pendingChat = false; launch.querySelector('.wd-notice').hidden = true; }
        if (focus && kind === 'compose' && !running) input.focus({preventScroll: true});
        if (focus && kind === 'chat' && !running) document.getElementById('wd-continue').focus({preventScroll: true});
    }
    function close(kind = active, restoreFocus = true) {
        if (kind === 'suggestions' && active === kind) return performClose(kind, restoreFocus);
        return enqueue(() => performClose(kind, restoreFocus));
    }
    async function performClose(kind, restoreFocus = true) {
        if (!kind || active !== kind) return;
        switching = true;
        if (kind === 'suggestions') {
            const returnFocus = restoreFocus && panels.suggestions.contains(document.activeElement);
            if (!await animateSuggestions(false)) return;
            active = null;
            switching = false;
            if (returnFocus) orb.focus({preventScroll: true, focusVisible: !pointerDriven});
            if (!items.length && !suggestionBusy) status.textContent = '';
            updateOrb();
            if (pendingChat) open('chat');
            return;
        }
        const returnFocus = restoreFocus && panels[kind].contains(document.activeElement);
        const modelClosing = modelOpen ? morph('model', false, false) : Promise.resolve();
        modelOpen = false;
        await Promise.all([modelClosing, morph(kind, false)]); active = null; switching = false;
        // 鼠标操作收起时不显示焦点环，否则按钮归位的那一帧会突然套上一圈蓝框。
        if (returnFocus) anchors[kind].focus({preventScroll: true, focusVisible: !pointerDriven});
        if (pendingChat) open('chat');
        updateOrb();
    }
    function updateOrb() {
        const visible = items.length > 0 || suggestionBusy || active === 'suggestions' || !!status.textContent;
        if (visible) {
            orbExit?.cancel(); orbExit = null; orb.hidden = false;
        } else if (!orb.hidden && !orbExit) {
            if (reduced.matches) orb.hidden = true;
            else {
                const exit = orb.animate([{transform:'none',opacity:1},{transform:'translateX(-24px) scale(.12)',opacity:0}], {duration:400,easing:'cubic-bezier(.4,0,.6,1)',fill:'forwards'});
                orbExit = exit;
                exit.onfinish = () => { if (orbExit !== exit) return; orb.hidden = true; exit.cancel(); orbExit = null; };
            }
        }
        orb.querySelector('.wd-count').textContent = items.length > 1 ? String(items.length) : '';
        orb.querySelector('.wd-count').hidden = items.length < 2;
        orb.setAttribute('aria-label', `排座建议，${items.length} 条`);
    }
    function renderSuggestions() {
        if (suggestionBusy) return;
        const signature = JSON.stringify(items.map(key));
        if (list.dataset.signature === signature) return;
        if (suggestionMotion || (!items.length && active === 'suggestions' && !panels.suggestions.hidden)) {
            suggestionsNeedRender = true;
            if (!items.length) close('suggestions', false);
            return;
        }
        list.dataset.signature = signature;
        list.replaceChildren();
        items.forEach(item => {
            const card = document.createElement('article'); card.className = 'wd-suggestion';
            const content = document.createElement('div'); content.className = 'wd-suggestion-content'; card.append(content);
            const heading = document.createElement('div'); heading.className = 'wd-suggestion-heading'; heading.textContent = item.type === 'export_suggestion' ? '分组完成提示' : '优化建议'; content.append(heading);
            const text = document.createElement('p'); text.textContent = item.message; content.append(text);
            const row = document.createElement('div'); row.className = 'wd-suggestion-actions';
            if (item.action_label && ['group_balance','export_suggestion'].includes(item.type)) {
                const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'btn wd-send'; apply.textContent = item.action_label;
                apply.addEventListener('click', () => executeSuggestion(item)); row.append(apply);
            }
            const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'btn wd-secondary'; dismiss.textContent = item.ignore_label || '忽略此条';
            dismiss.addEventListener('click', async () => {
                dismiss.disabled = true;
                try {
                    if (item.ignore_url && item.ignore_url !== '#') await actions.dismiss(item);
                    ignored.add(key(item));
                    try { sessionStorage.setItem(ignoredKey, JSON.stringify([...ignored])); } catch (_) {}
                    status.textContent = '';
                    // 还有其他建议时，这张卡片先淡出收起，下方卡片顺势上移；最后一条则整体收回按钮。
                    if (items.length > 1) await dismissCard(card);
                    setSuggestions(rawItems, actions);
                    if (!items.length) await close('suggestions');
                } catch (error) { status.textContent = error.message; dismiss.disabled = false; }
            }); row.append(dismiss); content.append(row); list.append(card);
        });
        if (!items.length) { const empty = document.createElement('p'); empty.textContent = '当前没有新的建议'; list.append(empty); }
        updateOrb();
    }
    function dismissCard(card) {
        if (reduced.matches) return Promise.resolve();
        const height = card.getBoundingClientRect().height;
        const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
        card.style.overflow = 'hidden';
        card.style.pointerEvents = 'none';
        const motion = card.animate([
            {opacity: 1, transform: 'scale(1)', height: `${height}px`, marginBottom: '0px'},
            {opacity: 0, transform: 'scale(.94)', height: '0px', marginBottom: `${-gap}px`},
        ], {duration: 320, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards'});
        // 页面在后台时动画时间线暂停，超时后照常更新列表，不让建议卡住。
        return Promise.race([motion.finished.catch(() => {}), new Promise(done => setTimeout(done, 480))]);
    }
    function setSuggestions(incoming, handlers) {
        rawItems = incoming || []; actions = handlers || actions;
        const normalized = rawItems.map(item => typeof item === 'string' ? {message:item} : item).filter(item => item && allowed(item));
        items = [...new Map(normalized.filter(item => !ignored.has(key(item))).map(item => [key(item),item])).values()];
        const newKeys = items.filter(item => !seen.has(key(item)));
        normalized.forEach(item => seen.add(key(item)));
        renderSuggestions(); updateOrb();
        if (newKeys.length && active !== 'suggestions') {
            orb.classList.remove('wd-born'); void orb.offsetWidth; orb.classList.add('wd-born');
        }
    }
    async function executeSuggestion(item) {
        if (suggestionBusy || running || awaitingApproval) { status.textContent = '请先完成或拒绝闻道当前操作，再执行建议。'; return; }
        suggestionBusy = true;
        list.querySelectorAll('button').forEach(button => { button.disabled = true; });
        orb.classList.add('wd-running');
        await close('suggestions');
        try {
            const result = await actions.execute(item);
            if (result?.status !== 'cancelled') {
                ignored.add(key(item));
                try { sessionStorage.setItem(ignoredKey, JSON.stringify([...ignored])); } catch (_) {}
            }
            status.textContent = result?.status === 'cancelled' ? '已取消保存，建议仍然保留。' : '';
        } catch (error) { status.textContent = error.message || '操作失败，请检查当前座位后重试。'; }
        finally {
            suggestionBusy = false; orb.classList.remove('wd-running');
            delete list.dataset.signature;
            setSuggestions(rawItems, actions);
        }
    }
    function toggleModel(forceClose = false) { return enqueue(async () => {
        if (modelOpen) { await morph('model', false); modelOpen = false; return; }
        if (forceClose || active !== 'compose') return;
        await morph('model', true); modelOpen = true;
    }); }
    gear.addEventListener('click', () => toggleModel());
    document.getElementById('wendao-model').addEventListener('change', () => toggleModel(true));
    document.getElementById('wd-continue').addEventListener('click', async () => { await close('chat'); await open('compose', true); });
    document.getElementById('wd-full-workspace').addEventListener('click', event => {
        if (active !== 'chat') return;
        event.preventDefault();
        window.WendaoChat?.transferPending();
        leavingForWorkspace = true;
        if (window.WendaoWorkspaceTransition) window.WendaoWorkspaceTransition.depart(panels.chat, event.currentTarget.href);
        else location.href = event.currentTarget.href;
    });
    launch.addEventListener('click', () => active === 'compose' || active === 'chat' ? close(active) : open(awaitingApproval || pendingChat ? 'chat' : 'compose', true));
    orb.addEventListener('click', () => { if (!suggestionBusy) active === 'suggestions' && suggestionsExpanded ? close('suggestions') : open('suggestions'); });
    document.querySelectorAll('[data-wd-close]').forEach(button => button.addEventListener('click', () => close()));
    document.getElementById('btn-open-future-mode')?.addEventListener('click', event => { event.preventDefault(); open(awaitingApproval || pendingChat ? 'chat' : 'compose', true); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { if (modelOpen) { event.preventDefault(); toggleModel(true); } else if (active) { event.preventDefault(); close(); } } });
    window.addEventListener('storage', event => { if (event.key?.startsWith('seats_show_')) setSuggestions(rawItems, actions); });
    function reposition() {
        if (!active) return;
        if (active === 'suggestions') {
            layoutSuggestions();
            suggestionMotion?.entries.forEach(entry => {
                const rect = entry.card.getBoundingClientRect();
                for (const name of ['left', 'top', 'width', 'height']) entry.target[name] = rect[name];
                entry.content.style.width = `${rect.width - 3}px`;
            });
            return;
        }
        if (switching) return;
        const current = panels[active].getBoundingClientRect(), target = targetRect(active);
        if (['left','top','width','height'].every(name => Math.abs(current[name]-target[name]) < 2)) return;
        morph(active, true, false);
        if (modelOpen) morph('model', true, false);
    }
    document.addEventListener('keydown', () => { pointerDriven = false; }, true);
    document.addEventListener('pointerdown', event => {
        pointerDriven = true;
        const insideCompose = panels.compose.contains(event.target);
        const insideModel = panels.model.contains(event.target);
        const insideSuggestion = !!event.target.closest('.wd-suggestion') || suggestionMotion?.entries.some(({rect}) => event.clientX >= rect.left && event.clientX <= rect.left + rect.width && event.clientY >= rect.top && event.clientY <= rect.top + rect.height);
        // 点在面板外面时焦点已交给用户点中的位置，不再抢回按钮上。
        if (active === 'compose' && !insideCompose && !insideModel && !launch.contains(event.target)) close('compose', false);
        else if (active === 'chat' && !panels.chat.contains(event.target) && !launch.contains(event.target)) close('chat', false);
        else if (active === 'suggestions' && !insideSuggestion && !orb.contains(event.target)) close('suggestions', false);
        else if (modelOpen && !insideModel && !gear.contains(event.target)) toggleModel(true);
    });
    window.addEventListener('resize', reposition); window.visualViewport?.addEventListener('resize', reposition);
    let leavingForWorkspace = false;
    window.addEventListener('beforeunload', event => { if (!leavingForWorkspace && (running || awaitingApproval || suggestionBusy)) { event.preventDefault(); event.returnValue = ''; } });
    window.WendaoDock = {
        open, setSuggestions, saveDraft,
        async run() { running = true; awaitingApproval = false; pendingChat = false; responseStart = document.getElementById('chatContainer').children.length; launch.classList.add('wd-running'); panels.chat.classList.add('wd-running'); await close(active, false); },
        async finish(needsApproval) {
            awaitingApproval = !!needsApproval;
            running = false; launch.classList.remove('wd-running'); panels.chat.classList.remove('wd-running');
            const continueButton = document.getElementById('wd-continue');
            continueButton.disabled = !!needsApproval;
            continueButton.title = needsApproval ? '请先处理授权请求' : '';
            if (needsApproval) document.getElementById('wendao-status').textContent = '需要你的授权才能继续。';
            const messages = document.getElementById('chatContainer');
            [...messages.children].forEach((node, index) => { node.toggleAttribute('data-wd-current', index >= responseStart && !node.classList.contains('user') && !node.classList.contains('status')); });
            messages.dataset.currentOnly = '1';
            saveDraft();
            if (active === 'suggestions' || switching) {
                pendingChat = true; launch.querySelector('.wd-notice').hidden = false;
                launch.dataset.replyPending = needsApproval ? 'approval' : 'complete';
            } else await open('chat');
            window.refreshState?.();
        },
        async beforeSend(text) {
            await initPromise;
            if (suggestionBusy) return false;
            // 快捷命令有直接执行路径，在进入该路径前明确确认，避免绕过工具授权。
            if (/^[\/／]/.test(text)) return window.confirm(`执行此班级命令？\n${text}\n命令可能直接修改当前班级数据。`);
            return true;
        },
        conversation(id) {
            const link = document.getElementById('wd-full-workspace');
            link.search = `conversation=${encodeURIComponent(id)}`;
        }
    };
    input.addEventListener('focus', () => { if (!initialized) { initialized = true; initPromise = window.WendaoChat?.initialize(); } });
})();
