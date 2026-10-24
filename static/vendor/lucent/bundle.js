/* Lucent 澄光 — optional behaviours for the CSS components (no dependencies). */
(function () {
  function rect(root, el) {
    var r = root.getBoundingClientRect(), e = el.getBoundingClientRect();
    return { l: e.left - r.left, r: r.right - e.right, t: e.top - r.top, b: r.bottom - e.bottom, w: e.width };
  }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Liquid selection pill for .lc-tabbar, .lc-seg, .lc-tabs, .lc-chips.
     opts.item: selector of the selectable children; opts.width: fixed pill width (centred). */
  function liquid(root, opts) {
    if (!root || root.__lcLiquid) return;
    opts = opts || {};
    var item = opts.item || '.lc-tab, .lc-seg__item, .lc-tabs__tab, .lc-chip';
    var pill = document.createElement('span');
    pill.className = 'lc-liquid';
    pill.setAttribute('aria-hidden', 'true');
    root.insertBefore(pill, root.firstChild);
    root.classList.add('is-liquid');
    var lastL = null;
    function place(el, animate) {
      var m = rect(root, el), L = m.l, R = m.r;
      if (opts.width) { var c = m.l + m.w / 2; L = c - opts.width / 2; R = root.clientWidth - c - opts.width / 2; }
      if (animate && lastL !== null && !reduce) {
        var lead = 'var(--duration-base, 250ms) var(--ease-spring-soft, ease-out)';
        var trail = 'var(--duration-spring, 560ms) var(--ease-spring, ease-out) 50ms';
        pill.style.transition = L > lastL ? 'right ' + lead + ', left ' + trail : 'left ' + lead + ', right ' + trail;
        if (pill.animate) pill.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.84)', offset: .35 }, { transform: 'scaleY(1)' }], { duration: 480, easing: 'ease-out' });
      } else {
        pill.style.transition = 'none';
      }
      pill.style.left = L + 'px'; pill.style.right = R + 'px';
      pill.style.top = m.t + 'px'; pill.style.bottom = m.b + 'px';
      lastL = L;
    }
    function current() { return root.querySelector('[aria-selected="true"], [aria-current="page"]'); }
    var cur = current(); if (cur) place(cur, false);
    root.addEventListener('click', function (ev) {
      var el = ev.target.closest(item);
      if (!el || !root.contains(el) || el.disabled) return;
      Array.prototype.forEach.call(root.querySelectorAll(item), function (o) { o.setAttribute('aria-selected', o === el ? 'true' : 'false'); });
      place(el, true);
    });
    if (window.ResizeObserver) new ResizeObserver(function () { var c = current(); if (c) place(c, false); }).observe(root);
    root.__lcLiquid = true;
  }

  /* Play the exit animation, then remove (or hide) the element. */
  function dismiss(el, keep) {
    if (!el) return;
    el.classList.add('is-leaving');
    var done = function () { el.removeEventListener('animationend', done); if (keep) { el.hidden = true; el.classList.remove('is-leaving'); } else if (el.parentNode) { el.parentNode.removeChild(el); } };
    el.addEventListener('animationend', done);
    if (reduce) done();
  }

  /* Re-run an element's entrance animation (for demos). */
  function replay(el) {
    if (!el) return;
    el.classList.remove('is-leaving'); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }


  /* ---------------------------------------------------------------------
     MorphMenu — physically driven liquid-glass menu.
     Every edge of the glass is its own damped spring (SwiftUI-style
     response / dampingFraction). Edges next to the button are stiff, the far
     edges are heavier, so the glass is dragged out of the button, stretches,
     overshoots and settles. Corner radius and shadow follow the live speed:
     the faster it moves, the rounder (more droplet) and the heavier it looks.
     Re-tapping mid-flight simply retargets the springs from where they are.
     --------------------------------------------------------------------- */
  function Spring(x, response, damping) { this.x = x; this.v = 0; this.t = x; this.set(response, damping); }
  Spring.prototype.set = function (response, damping) { var w = 2 * Math.PI / response; this.k = w * w; this.c = 2 * damping * w; };
  Spring.prototype.step = function (dt) { var a = -this.k * (this.x - this.t) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; };
  Spring.prototype.rest = function () { return Math.abs(this.x - this.t) < 0.05 && Math.abs(this.v) < 0.5; };
  Spring.prototype.snap = function (x) { this.x = this.t = x; this.v = 0; };

  /* Signed distance helpers for the liquid outline. */
  function sdBox(px, py, hw, hh, r) {
    var qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }
  function smin(a, b, k) { if (k <= 0) return Math.min(a, b); var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; }

  function morph(root) {
    if (!root || root.__lcMorph) return;
    var trigger = root.querySelector('.lc-morph__trigger');
    var panel = root.querySelector('.lc-morph__panel');
    var inner = panel.querySelector('.lc-morph__inner');
    var items = Array.prototype.slice.call(inner.querySelectorAll('.lc-morph__item, .lc-morph__sep'));
    var NS = 'http://www.w3.org/2000/svg', PAD = 72, uid = 'lcm' + Math.random().toString(36).slice(2, 7);

    /* one glass, always present: closed it IS the button, open it IS the menu — nothing ever swaps */
    root.classList.add('is-morph');
    root.style.setProperty('--lc-morph-w', (panel.getAttribute('data-width') || 248) + 'px');
    var glyph = document.createElement('span');
    glyph.className = 'lc-morph__glyph'; glyph.setAttribute('aria-hidden', 'true');
    var tg = trigger.querySelector('.lc-ico'); if (tg) glyph.appendChild(tg.cloneNode(true));
    panel.appendChild(glyph);
    function svgLayer(cls) { var v = document.createElementNS(NS, 'svg'); v.setAttribute('class', cls); v.setAttribute('aria-hidden', 'true'); root.insertBefore(v, cls.indexOf('rim') > -1 ? null : panel); return v; }
    var shadowSvg = svgLayer('lc-morph__shadow'), rimSvg = svgLayer('lc-morph__rim');
    shadowSvg.innerHTML = '<defs><filter id="' + uid + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter></defs><path fill="#000" filter="url(#' + uid + ')"/>';
    rimSvg.innerHTML = '<defs><linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient></defs><path fill="none" stroke="url(#' + uid + 'g)" stroke-width="1.2"/>';
    var shadowPath = shadowSvg.querySelector('path'), blurEl = shadowSvg.querySelector('feGaussianBlur'), rimPath = rimSvg.querySelector('path');

    var W0, H0, W, H, BW, BH, ax, ay, RR = 28, toR = true, toB = false, calm = false, ghost = false, baseBg = null, baseSheen = null, lastA = -1;
    function rgba(str) {
      str = (str || '').trim();
      if (str.charAt(0) === '#') { var hx = str.slice(1); if (hx.length === 3) hx = hx.replace(/./g, '$&$&'); return [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16), hx.length > 6 ? parseInt(hx.slice(6, 8), 16) / 255 : 1]; }
      var n = (str.match(/[\d.]+/g) || []).map(Number); return n.length >= 3 ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : null;
    }
    function css(c, k) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * k).toFixed(3) + ')'; }
    /* data-origin: which corner of the button the menu grows from — auto | top-right | top-left | bottom-right | bottom-left.
       auto picks the corner that points into the free space of the viewport (a button in a bottom bar opens upward). */
    function pickOrigin() {
      var o = root.getAttribute('data-origin') || 'auto';
      if (o === 'auto') {
        var r = trigger.getBoundingClientRect(), vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        toR = (r.left + r.width / 2) > vw / 2;          /* button on the right half → menu hangs to its left */
        toB = (r.top + r.height / 2) > vh * .62;        /* button low on screen → menu opens upward */
      } else { toR = o.indexOf('right') > -1; toB = o.indexOf('bottom') > -1; }
      root.setAttribute('data-placement', (toB ? 'bottom' : 'top') + '-' + (toR ? 'right' : 'left'));
    }
    function place(el, inset) {
      el.style.left = toR ? 'auto' : inset + 'px'; el.style.right = toR ? inset + 'px' : 'auto';
      el.style.top = toB ? 'auto' : inset + 'px'; el.style.bottom = toB ? inset + 'px' : 'auto';
    }
    function layout() {
      pickOrigin();
      var cs = getComputedStyle(root);
      RR = parseFloat(cs.getPropertyValue('--lc-morph-r')) || 28;
      calm = root.getAttribute('data-motion') === 'calm';
      /* a ghost trigger (plain icon in a bar) has no glass of its own: the glass only condenses as the menu grows */
      /* closed shape: a standalone corner button keeps its glass disc; a button that already sits in a bar
         (toolbar, tab bar, dock, side bar, composer, any glass strip) shows only its icon — never glass on glass */
      var closedAttr = root.getAttribute('data-closed');
      var inBar = !!(root.parentElement && root.parentElement.closest('.lc-glass, .lc-glass--strong, .lc-toolbar, .lc-tabbar, .lc-side, .lc-rail, .lc-ai-composer, [data-bar]'));
      ghost = closedAttr === 'icon' || (closedAttr !== 'glass' && (inBar || trigger.classList.contains('lc-iconbtn--ghost')));
      root.classList.toggle('is-ghost', ghost);
      panel.style.backgroundColor = panel.style.backgroundImage = panel.style.backdropFilter = panel.style.webkitBackdropFilter = '';
      var pcs = getComputedStyle(panel); baseBg = rgba(pcs.backgroundColor); baseSheen = null; lastA = -1;
      var want = parseFloat(panel.getAttribute('data-width')) || parseFloat(cs.getPropertyValue('--lc-morph-default-w')) || 248;
      root.style.setProperty('--lc-morph-w', Math.min(want, (window.innerWidth || want + 32) - 32) + 'px');
      W0 = trigger.offsetWidth; H0 = trigger.offsetHeight;
      var was = panel.style.clipPath; panel.style.clipPath = 'none';
      W = inner.offsetWidth; H = inner.offsetHeight; panel.style.clipPath = was;
      PAD = Math.round(Math.max(72, Math.max(W, H) * .3));
      BW = W + PAD * 2; BH = H + PAD * 2;
      [panel, shadowSvg, rimSvg].forEach(function (el) { el.style.width = BW + 'px'; el.style.height = BH + 'px'; place(el, -PAD); });
      [shadowSvg, rimSvg].forEach(function (el) { el.setAttribute('viewBox', '0 0 ' + BW + ' ' + BH); });
      place(inner, PAD); place(glyph, PAD);
      glyph.style.width = W0 + 'px'; glyph.style.height = H0 + 'px';
      var ti = trigger.querySelector('.lc-ico'), gi = glyph.querySelector('.lc-ico');
      if (ti && gi) { gi.style.width = ti.getBoundingClientRect().width + 'px'; gi.style.height = ti.getBoundingClientRect().height + 'px'; }
      inner.style.transformOrigin = (toR ? '100%' : '0%') + ' ' + (toB ? '100%' : '0%');
      ax = toR ? BW - PAD - W0 / 2 : PAD + W0 / 2;     /* the button's centre in box space */
      ay = toB ? BH - PAD - H0 / 2 : PAD + H0 / 2;
    }
    layout();
    var tx = function (o) { return o ? (toR ? BW - PAD - W / 2 : PAD + W / 2) : ax; },
        ty = function (o) { return o ? (toB ? BH - PAD - H / 2 : PAD + H / 2) : ay; };
    var DX = function () { return toR ? 1 : -1; }, DY = function () { return toB ? -1 : 1; };   /* direction the menu grows */

    /* the mass (menu body): centre, half-size and tilt each ride their own spring */
    var cx = new Spring(ax, .4, .8), cy = new Spring(ay, .4, .8);
    var hw = new Spring(W0 / 2, .4, .8), hh = new Spring(H0 / 2, .4, .8);
    var tilt = new Spring(0, .24, .62);
    var jelly = new Spring(0, .34, .5);                 /* volume-preserving wobble: + = wider & flatter */
    var anchor = new Spring(W0 / 2, .25, .9);           /* the drop that stays on the button */
    var reveal = new Spring(0, .4, .9);
    var itemS = items.map(function () { return new Spring(0, .5, .74); });
    var open = false, raf = 0, last = 0, t0 = 0, closeKick = false, openKick = false;

    function aim(o) {
      if (o) {
        /* opening: the drop leaves the button first (position leads), then pours out (size lags) */
        /* under-damped on purpose: the panel overshoots ~20% and rings two or three times */
        if (calm) { cx.set(.3, .9); cy.set(.32, .9); hw.set(.36, .82); hh.set(.4, .82); }
        else { cx.set(.36, .64); cy.set(.4, .62); hw.set(.5, .44); hh.set(.56, .46); }
        anchor.set(.18, 1); anchor.t = 0;
        reveal.set(.42, .9); reveal.t = 1;
        itemS.forEach(function (s) { s.set(.46, .55); s.t = 1; });
      } else {
        /* closing: the body shrinks fast but its mass lags behind → a neck is pulled from the button */
        if (calm) { hw.set(.24, .92); hh.set(.26, .92); cx.set(.28, .9); cy.set(.3, .9); }
        else { hw.set(.3, .78); hh.set(.34, .76); cx.set(.42, .56); cy.set(.46, .54); }
        /* the button drop re-forms straight away; the landing swell comes from the jelly kick */
        anchor.set(.2, .62); anchor.t = W0 / 2; if (anchor.x < W0 * .36) anchor.x = W0 * .36;
        reveal.set(.15, 1); reveal.t = 0;
        itemS.forEach(function (s) { s.set(.15, 1); s.t = 0; });
      }
      cx.t = tx(o); cy.t = ty(o); hw.t = o ? W / 2 : W0 / 2; hh.t = o ? H / 2 : H0 / 2;
    }

    function shape() {
      var vx = cx.v, vy = cy.v, sp = Math.sqrt(vx * vx + vy * vy);
      var speed = Math.min(1, sp / 1400);
      var a = tilt.x, ca = Math.cos(a), sa = Math.sin(a);
      var jw = 1 + jelly.x, jh = 1 / Math.max(.4, 1 + jelly.x);
      var floor = open ? 2 : W0 * .42;
      var w = Math.max(hw.x * jw, floor), h = Math.max(hh.x * jh, floor), mn = Math.min(w, h);
      var big = Math.min(1, Math.max(0, (mn * 2 - W0) / 70));
      var r = Math.min(mn, (Math.min(W0, H0) / 2 + (RR - Math.min(W0, H0) / 2) * big) + 46 * speed);   /* rounder while moving: a droplet, not a card */
      var ar = Math.max(anchor.x, 0), k = 26 + 40 * speed;
      function f(px, py) {
        var dx = px - cx.x, dy = py - cy.x;
        var rx = dx * ca + dy * sa, ry = -dx * sa + dy * ca;
        var d = sdBox(rx, ry, w, h, r);
        if (ar > .5) { var ex = px - ax, ey = py - ay; d = smin(d, Math.sqrt(ex * ex + ey * ey) - ar, k); }
        return d;
      }
      /* march rays out of the body's centre and bisect the surface (the union stays star-shaped from here) */
      var N = 120, pts = [], maxT = Math.sqrt(BW * BW + BH * BH);
      for (var i = 0; i < N; i++) {
        var th = i / N * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th), lo = 0, hi = 0, t = 0;
        while (t < maxT) { t += 6; if (f(cx.x + dx * t, cy.x + dy * t) > 0) { hi = t; lo = t - 6; break; } }
        if (!hi) hi = lo = maxT;
        for (var j = 0; j < 12; j++) { var m = (lo + hi) / 2; if (f(cx.x + dx * m, cy.x + dy * m) > 0) hi = m; else lo = m; }
        pts.push([cx.x + dx * hi, cy.x + dy * hi]);
      }
      /* Catmull-Rom → cubic Bézier for a smooth liquid edge */
      var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
      for (i = 0; i < N; i++) {
        var p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
        d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
             (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' +
             p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
      }
      return { d: d + 'Z', speed: speed, big: big };
    }

    function glassAlpha() {
      if (!ghost) return 1;
      var g = Math.max(hw.x * 2 / W0, hh.x * 2 / H0);
      return Math.max(0, Math.min(1, (g - 1.08) / .7));
    }
    function render() {
      var s = shape();
      var ga = glassAlpha();
      if (Math.abs(ga - lastA) > .004) {
        lastA = ga;
        if (ghost && ga < 1 && baseBg) {
          panel.style.backgroundColor = css(baseBg, ga);
          panel.style.backgroundImage = baseSheen ? 'linear-gradient(180deg,' + css(baseSheen, ga) + ' 0%, transparent 40%)' : 'none';
          panel.style.backdropFilter = panel.style.webkitBackdropFilter = 'blur(' + (50 * ga).toFixed(1) + 'px) saturate(' + (100 + 100 * ga).toFixed(0) + '%)';
        } else { panel.style.backgroundColor = panel.style.backgroundImage = panel.style.backdropFilter = panel.style.webkitBackdropFilter = ''; }
        rimSvg.style.opacity = shadowSvg.style.opacity = ga.toFixed(3);
      }
      panel.style.clipPath = 'path("' + s.d + '")';
      rimPath.setAttribute('d', s.d);
      shadowPath.setAttribute('d', s.d);
      var lift = Math.max(s.speed, s.big * .5);
      blurEl.setAttribute('stdDeviation', (7 + 16 * lift).toFixed(1));
      shadowPath.setAttribute('transform', 'translate(0 ' + (5 + 16 * lift).toFixed(1) + ')');
      shadowPath.setAttribute('fill-opacity', (.13 + .17 * lift).toFixed(3));
      /* the content lives inside the drop: same centre, same scale, same tilt, same wobble */
      var jw = 1 + jelly.x, jh = 1 / Math.max(.4, 1 + jelly.x);
      var sx = (hw.x * 2 * jw) / W, sy = (hh.x * 2 * jh) / H;
      var sc = Math.max(.05, Math.sqrt(Math.max(sx, .01) * Math.max(sy, .01)));
      var stretchX = Math.max(.85, Math.min(1.15, sx / sc)), stretchY = Math.max(.85, Math.min(1.15, sy / sc));
      var grow = Math.max(0, Math.min(1, (sc - .12) / .88));
      var p = Math.max(0, Math.min(1, reveal.x)) * Math.min(1, grow * 1.25);
      var blurPx = 16 * Math.pow(1 - Math.min(1, grow), 1.4) + 6 * (1 - Math.max(0, Math.min(1, reveal.x)));
      inner.style.opacity = Math.max(0, Math.min(1, (p - .18) / .45)).toFixed(3);
      inner.style.filter = blurPx > .25 ? 'blur(' + blurPx.toFixed(1) + 'px)' : 'none';
      inner.style.transform = 'translate(' + (cx.x - tx(true)).toFixed(1) + 'px,' + (cy.x - ty(true)).toFixed(1) + 'px) rotate(' + tilt.x.toFixed(4) + 'rad) scale(' + (sc * stretchX).toFixed(4) + ',' + (sc * stretchY).toFixed(4) + ')';
      /* each row trails the body a little, so the list pours in rather than popping */
      items.forEach(function (it, i) {
        var dd = 1 - itemS[i].x, on = Math.abs(dd) > .002;
        it.style.transform = on ? 'translate(' + ((10 + i * 6) * dd * DX()).toFixed(1) + 'px,' + ((-6 - i * 5) * dd * DY()).toFixed(1) + 'px)' : '';
        var ic = it.querySelector('.lc-ico');
        if (ic) ic.style.transform = on ? 'scale(' + (1 + .35 * dd).toFixed(3) + ')' : '';
      });
      var g = Math.max(0, Math.min(1, 1 - (sc - .16) * 3.2));
      glyph.style.opacity = g.toFixed(3);
      glyph.style.transform = 'translate(' + (cx.x - ax).toFixed(1) + 'px,' + (cy.x - ay).toFixed(1) + 'px) scale(' + (Math.max(.4, Math.min(1.4, (hw.x * 2 * jw) / W0)) * (.7 + .3 * g)).toFixed(3) + ')';
    }

    function tick(now) {
      var dt = Math.min(.032, (now - last) / 1000 || .016); last = now;
      var n = Math.ceil(dt / .004), h = dt / n, el = (now - t0) / 1000;
      for (var s = 0; s < n; s++) {
        cx.step(h); cy.step(h); hw.step(h); hh.step(h); anchor.step(h); reveal.step(h);
        if (closeKick && hw.x < W0 * .8) { closeKick = false; jelly.v += calm ? 1 : 4.2; anchor.v += W0 * (calm ? .8 : 3.2); }   /* lands in the button: swells, then wobbles — duang */
        if (openKick && hh.x > H / 2) { openKick = false; jelly.v += calm ? .6 : 3.4; }        /* hits its full height: squashes wide, then rings */
        /* the drop tilts into its direction of travel, then rights itself */
        /* only a small drop tilts; as it grows into a panel it rights itself */
        var grown = Math.min(1, Math.max(0, (Math.min(hw.x, hh.x) * 2 - W0) / 50));
        tilt.t = (1 - grown) * Math.max(-.45, Math.min(.45, (cx.v * .00035) - (cy.v * .00012))); tilt.step(h);
        /* the faster width grows relative to height, the more it squashes — then it keeps ringing */
        jelly.v += (hw.v - hh.v) * .0006 * h * 60; jelly.step(h);
        for (var i = 0; i < itemS.length; i++) if (!open || el > .04 + i * .022) itemS[i].step(h);
      }
      render();
      var all = [cx, cy, hw, hh, anchor, reveal].concat(itemS);
      if (all.every(function (x) { return x.rest(); }) && Math.abs(tilt.x) < .002 && Math.abs(jelly.x) < .002 && Math.abs(jelly.v) < .02) {
        raf = 0; tilt.snap(0); jelly.snap(0); render();
        panel.classList.toggle('is-open', open);
        root.classList.toggle('is-rest', !open);
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

    function doOpen() {
      if (open) return; open = true; root.classList.remove('is-rest'); layout(); t0 = performance.now(); openKick = true; closeKick = false;
      if (!raf) { cx.snap(ax); cy.snap(ay); hw.snap(W0 / 2); hh.snap(H0 / 2); anchor.snap(W0 / 2); }
      panel.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (!raf) { var f = calm ? .35 : 1; cx.v += -160 * DX() * f; cy.v += 220 * DY() * f; jelly.v -= 2.2 * f; }   /* the tap flicks the drop down-left, first stretched tall */
      aim(true);
      if (reduce) { [cx, cy, hw, hh, anchor, reveal].forEach(function (x) { x.snap(x.t); }); itemS.forEach(function (x) { x.snap(1); }); render(); return; }
      run();
    }
    function doClose() {
      if (!open) return; open = false; t0 = performance.now(); closeKick = true; openKick = false;
      trigger.setAttribute('aria-expanded', 'false');
      aim(false);
      if (reduce) { [cx, cy, hw, hh, anchor, reveal].forEach(function (x) { x.snap(x.t); }); itemS.forEach(function (x) { x.snap(0); }); render(); panel.classList.remove('is-open'); root.classList.add('is-rest'); return; }
      run();
    }

    /* re-measure when the window changes size (rotation, fold / unfold, split screen) */
    window.addEventListener('resize', function () {
      if (raf) return;
      layout(); [cx, cy, hw, hh, anchor].forEach(function (x) { x.snap(x.t); });
      cx.snap(tx(open)); cy.snap(ty(open)); hw.snap(open ? W / 2 : W0 / 2); hh.snap(open ? H / 2 : H0 / 2); anchor.snap(open ? 0 : W0 / 2);
      render();
    });
    render(); root.classList.add('is-rest');
    trigger.addEventListener('click', function () { open ? doClose() : doOpen(); });
    panel.addEventListener('click', function (e) { if (e.target.closest('.lc-morph__item')) doClose(); });
    document.addEventListener('pointerdown', function (e) { if (open && !root.contains(e.target)) doClose(); });
    document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') { doClose(); trigger.focus(); } });
    root.__lcMorph = { open: doOpen, close: doClose, state: function () { return { w: hw.x * 2 * (1 + jelly.x), h: hh.x * 2 / Math.max(.4, 1 + jelly.x), j: jelly.x, W: W, H: H }; } };
  }


  /* ---------------------------------------------------------------------
     AI · stream text in, a few characters at a time. Each chunk condenses
     out of a blur instead of popping; a light caret leads the line.
     --------------------------------------------------------------------- */
  function stream(el, text, opts) {
    opts = opts || {};
    var stop = false, timer = 0;
    el.textContent = ''; el.classList.add('is-streaming'); el.classList.remove('is-done');
    var caret = document.createElement('span'); caret.className = 'lc-ai-caret'; caret.setAttribute('aria-hidden', 'true');
    el.appendChild(caret);
    function done() { if (caret.parentNode) caret.parentNode.removeChild(caret); el.classList.remove('is-streaming'); el.classList.add('is-done'); if (opts.onDone) opts.onDone(); }
    if (reduce) { el.insertBefore(document.createTextNode(text), caret); done(); return { stop: function () {} }; }
    var i = 0, base = opts.interval || 42;
    (function next() {
      if (stop) return done();
      if (i >= text.length) return done();
      var n = 1 + Math.floor(Math.random() * 3), chunk = text.slice(i, i + n); i += n;
      if (chunk.indexOf('\n') > -1) { var parts = chunk.split('\n'); parts.forEach(function (pt, k) { if (k) el.insertBefore(document.createElement('br'), caret); if (pt) tok(pt); }); }
      else tok(chunk);
      timer = setTimeout(next, base * (.6 + Math.random() * .9) + (/[，。！？；：,.]/.test(chunk) ? base * 2.5 : 0));
    })();
    function tok(t) { var s = document.createElement('span'); s.className = 'lc-ai-tok'; s.textContent = t; el.insertBefore(s, caret); }
    return { stop: function () { stop = true; clearTimeout(timer); done(); } };
  }

  function easeVar(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function dur(name, fallback) { var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return v || fallback; }

  /* ---------------------------------------------------------------------
     一镜到底 · continuity(card, page, {under, back}).
     The page is revealed out of the card's exact shape (clip-path), the
     elements marked data-shared="key" in both fly between their two
     positions, everything else in the page fades in after the shape has
     travelled. back:true runs the same shot in reverse into the card.
     --------------------------------------------------------------------- */
  function continuity(card, page, opts) {
    opts = opts || {};
    var back = !!opts.back, under = opts.under;
    page.hidden = false;
    /* measure where the card will be when the page underneath has settled back (not where it sits while pushed back) */
    if (back && under) { under.style.transform = ''; under.style.opacity = ''; }
    var rc = card.getBoundingClientRect(), rp = page.getBoundingClientRect();
    var rCard = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    var rPage = opts.radius != null ? opts.radius : (parseFloat(getComputedStyle(page).borderTopLeftRadius) || 0);
    var small = 'inset(' + (rc.top - rp.top) + 'px ' + (rp.right - rc.right) + 'px ' + (rp.bottom - rc.bottom) + 'px ' + (rc.left - rp.left) + 'px round ' + rCard + 'px)';
    var full = 'inset(0px 0px 0px 0px round ' + rPage + 'px)';
    var springSoft = easeVar('--ease-spring-soft', 'cubic-bezier(.2,.9,.3,1.05)');
    var T = back ? 460 : 620, anims = [];
    var easing = back ? easeVar('--ease-emphasized', 'cubic-bezier(.05,.7,.1,1)') : springSoft;
    function A(el, kf, o) { if (reduce) { o = Object.assign({}, o, { duration: 1, delay: 0 }); } var a = el.animate(kf, Object.assign({ duration: T, easing: easing, fill: 'both' }, o)); anims.push(a); return a; }
    /* going in, the card is replaced by the page; coming back, the card waits underneath and the page dissolves onto it */
    card.style.visibility = '';
    /* the page starts as the card: same outline AND the card's own surface colour, so nothing changes colour at the first frame */
    var cardBg = getComputedStyle(card).backgroundColor, pageBg = getComputedStyle(page).backgroundColor;
    var k0 = { clipPath: small }, k1 = { clipPath: full };
    var opaque = cardBg && cardBg !== 'rgba(0, 0, 0, 0)';
    if (opaque) { k0.backgroundColor = cardBg; k1.backgroundColor = pageBg; }
    /* going in, the page is clear for its first frames so the card's own caption is still there, then takes on the card colour */
    A(page, back ? [k1, k0] : (opaque ? [{ clipPath: small, backgroundColor: 'rgba(0, 0, 0, 0)' }, { backgroundColor: cardBg, offset: .14 }, k1] : [k0, k1]));
    if (back) { A(page, [{ opacity: 1 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { easing: 'linear' }); A(card, [{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { easing: 'linear' }); }
    var shared = {};
    Array.prototype.forEach.call(card.querySelectorAll('[data-shared]'), function (e) { shared[e.getAttribute('data-shared')] = e; e.style.visibility = back ? '' : 'hidden'; });
    Array.prototype.forEach.call(page.querySelectorAll('[data-shared]'), function (e) {
      var s = shared[e.getAttribute('data-shared')]; if (!s) return;
      var a = s.getBoundingClientRect(), b = e.getBoundingClientRect();
      var sx = a.width / b.width, sy = a.height / b.height;
      var first = 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + sx + ',' + sy + ')';
      /* keep the corners round while scaled: the start radius is the source radius divided by the scale on each axis */
      var ra = parseFloat(getComputedStyle(s).borderTopLeftRadius) || 0, rb = getComputedStyle(e).borderRadius || '0px';
      var f0 = { transform: first, borderRadius: (ra / sx).toFixed(2) + 'px / ' + (ra / sy).toFixed(2) + 'px' }, f1 = { transform: 'none', borderRadius: rb };
      e.style.transformOrigin = '0 0';
      A(e, back ? [f1, f0] : [f0, f1]);
    });
    Array.prototype.forEach.call(page.querySelectorAll('[data-continuity="content"]'), function (e, i) {
      if (back) A(e, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px)' }], { duration: 160, easing: 'ease-in' });
      else A(e, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 180 + i * 40, easing: easeVar('--ease-emphasized', 'ease-out') });
    });
    if (under) A(under, back ? [{ transform: 'scale(.94)', opacity: .6 }, { transform: 'none', opacity: 1 }] : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: .6 }], { easing: easeVar('--ease-standard', 'ease') });
    return Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
      if (back) { page.hidden = true; card.style.visibility = ''; }
      anims.forEach(function (a) { a.cancel(); });
      if (!back && under) { under.style.transform = 'scale(.94)'; under.style.opacity = .6; }
      if (back && under) { under.style.transform = ''; under.style.opacity = ''; }
    });
  }

  /* ---------------------------------------------------------------------
     navigate(from, to, kind, {back}) — the other page transitions.
     push  : hierarchy. New page slides in from the trailing edge, the old one
             moves a third of the way back and dims (parallax = depth).
     modal : a task on top. Rises from the bottom; the page behind recedes.
     fade  : peers (tabs). Fade-through with no direction: out 90ms, in 210ms.
     --------------------------------------------------------------------- */
  function navigate(from, to, kind, opts) {
    opts = opts || {}; var back = !!opts.back, anims = [];
    var emph = easeVar('--ease-emphasized', 'cubic-bezier(.05,.7,.1,1)'), soft = easeVar('--ease-spring-soft', 'ease-out'), exit = easeVar('--ease-exit', 'ease-in');
    function A(el, kf, o) { var a = el.animate(kf, Object.assign({ fill: 'both' }, o, reduce ? { duration: 1, delay: 0 } : {})); anims.push(a); }
    to.hidden = false;
    if (kind === 'push') {
      var top = back ? from : to, low = back ? to : from;
      top.style.zIndex = 2; low.style.zIndex = 1;
      var kfTop = [{ transform: 'translateX(100%)', boxShadow: '0 0 0 rgba(0,0,0,0)' }, { transform: 'none', boxShadow: '-16px 0 40px rgba(0,0,0,.12)' }];
      var kfLow = [{ transform: 'none', filter: 'brightness(1)' }, { transform: 'translateX(-30%)', filter: 'brightness(.82)' }];
      var o = back ? { duration: 360, easing: emph, direction: 'reverse' } : { duration: 480, easing: emph };
      A(top, kfTop, o); A(low, kfLow, o);
    } else if (kind === 'modal') {
      var sheet = back ? from : to, behind = back ? to : from;
      sheet.style.zIndex = 2; behind.style.zIndex = 1;
      A(sheet, back ? [{ transform: 'none' }, { transform: 'translateY(100%)' }] : [{ transform: 'translateY(100%)' }, { transform: 'none' }], back ? { duration: 300, easing: exit } : { duration: 560, easing: soft });
      A(behind, back ? [{ transform: 'scale(.92)', borderRadius: '24px', filter: 'brightness(.8)' }, { transform: 'none', borderRadius: '0px', filter: 'brightness(1)' }] : [{ transform: 'none', borderRadius: '0px', filter: 'brightness(1)' }, { transform: 'scale(.92)', borderRadius: '24px', filter: 'brightness(.8)' }], { duration: back ? 300 : 480, easing: back ? emph : emph });
    } else {
      from.style.zIndex = 1; to.style.zIndex = 2;
      A(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], { duration: 90, easing: exit });
      A(to, [{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'none' }], { duration: 210, delay: 90, easing: emph });
    }
    return Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
      var keep = kind === 'modal' && !back;
      anims.forEach(function (a) { a.cancel(); });
      if (keep) { from.style.transform = 'scale(.92)'; from.style.borderRadius = '24px'; from.style.filter = 'brightness(.8)'; }
      else { from.hidden = true; from.style.transform = from.style.borderRadius = from.style.filter = ''; }
      if (kind === 'modal' && back) { to.style.transform = to.style.borderRadius = to.style.filter = ''; }
      from.style.zIndex = to.style.zIndex = '';
    });
  }

  /* ---------------------------------------------------------------------
     Liquid touch: pointer highlight, jelly press / drag, optional edge
     refraction (Chromium only, auto-degrades), progressive blur bars and
     a circular theme reveal. Deformation only writes the individual
     `scale` / `translate` properties, never `transform`, so it never
     fights a component's own transform.
     --------------------------------------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var GLASS_BTN = '.lc-btn, .lc-iconbtn, .lc-fab, .lc-chip, .lc-pager__btn', GLASS_CARD = '.lc-card--glass.lc-card--action, a.lc-widget--glass, button.lc-widget--glass';

  function spec(el) {
    if (!el || el.__lcSpec) return; el.__lcSpec = 1;
    el.classList.add('lc-spec');
    function at(e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
      el.style.setProperty('--spec-size', Math.round(clamp(Math.max(r.width, r.height) * .9, 48, 220)) + 'px');
    }
    el.addEventListener('pointerenter', at, { passive: true });
    el.addEventListener('pointermove', at, { passive: true });
    el.addEventListener('pointerdown', function (e) { at(e); el.classList.add('is-pressed'); }, { passive: true });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { el.addEventListener(n, function () { el.classList.remove('is-pressed'); }, { passive: true }); });
  }

  /* Glass controls grow a little when pressed (the light is "lifted"),
     follow the finger with a rubber band, stretch along the drag and settle
     with one overshoot. data-jelly="press" keeps the press but no drag
     (use it inside horizontal scrollers); data-jelly="off" opts out. */
  function jelly(el) {
    if (!el || el.__lcJelly || reduce) return;
    var mode = el.getAttribute('data-jelly');
    if (mode === 'off') return;
    el.__lcJelly = 1;
    var drag = mode !== 'press' && !el.classList.contains('lc-card') && !el.closest('.lc-tabbar, .lc-seg, .lc-tabs, .lc-side, .lc-rail, .lc-chips, [data-jelly-scope="press"]');
    el.classList.add('lc-jelly'); if (drag) el.classList.add('lc-jelly--drag');
    var s = new Spring(1, .34, .5), sx = new Spring(0, .3, .5), sy = new Spring(0, .3, .5),
        tx = new Spring(0, .38, .62), ty = new Spring(0, .38, .62), all = [s, sx, sy, tx, ty];
    var down = null, raf = 0, last = 0, max = 8, grow = 1.06, sup = 0;
    function still(p, e) { return Math.abs(p.x - p.t) < e && Math.abs(p.v) < e * 10; }
    function render() {
      el.style.scale = (s.x * (1 + sx.x)).toFixed(4) + ' ' + (s.x * (1 + sy.x)).toFixed(4);
      el.style.translate = tx.x.toFixed(2) + 'px ' + ty.x.toFixed(2) + 'px';
    }
    function tick(t) {
      var dt = Math.min(.064, (t - (last || t)) / 1000 || .016); last = t;
      if (down && drag) {
        tx.t = max * Math.tanh(down.dx * down.k / max);
        ty.t = max * Math.tanh(down.dy * down.k / max);
      }
      var px = clamp(Math.abs(tx.x) / max + Math.abs(tx.v) / (max * 14), 0, 1),
          py = clamp(Math.abs(ty.x) / max + Math.abs(ty.v) / (max * 14), 0, 1);
      sx.t = drag && down ? (px - py * .36) * .07 : 0;
      sy.t = drag && down ? (py - px * .36) * .07 : 0;
      var n = Math.max(1, Math.ceil(dt / .004)), h = dt / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < all.length; j++) all[j].step(h);
      render();
      if (down || !(still(s, .0008) && still(sx, .0008) && still(sy, .0008) && still(tx, .05) && still(ty, .05))) raf = requestAnimationFrame(tick);
      else { raf = 0; last = 0; el.style.scale = el.style.translate = el.style.willChange = ''; }
    }
    function go() { if (!raf) raf = requestAnimationFrame(tick); }
    el.addEventListener('pointerdown', function (e) {
      if (e.button || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      var r = el.getBoundingClientRect();
      grow = 1 + clamp(18 / Math.hypot(r.width, r.height), .025, .08);
      max = clamp(Math.min(r.width, r.height) * .18, 4, 18);
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, far: 0, k: e.pointerType === 'mouse' ? .22 : .45 };
      s.t = grow; el.style.willChange = 'scale, translate';
      el.classList.add('is-pressed', 'is-lifted');
      if (drag && e.pointerType === 'mouse') try { el.setPointerCapture(e.pointerId); } catch (x) {}
      go();
    });
    el.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.id) return;
      down.dx = e.clientX - down.x; down.dy = e.clientY - down.y;
      down.far = Math.max(down.far, Math.hypot(down.dx, down.dy));
    }, { passive: true });
    function up(e) {
      if (!down || (e && e.pointerId !== down.id)) return;
      if (down.far > 8) sup = Date.now() + 600;
      down = null; s.t = 1; tx.t = ty.t = 0;
      el.classList.remove('is-pressed', 'is-lifted'); go();
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { el.addEventListener(n, up); });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') up(e); });
    el.addEventListener('click', function (e) { if (Date.now() < sup) { e.preventDefault(); e.stopPropagation(); sup = 0; } }, true);
    el.addEventListener('dragstart', function (e) { if (drag) e.preventDefault(); });
  }

  /* Edge refraction: a displacement map built from the rounded-rect SDF
     bends what is behind the glass inside a 6–20px bezel; the centre stays
     still so text behind and on the glass is unaffected. Chromium only
     (backdrop-filter: url()); elsewhere the CSS blur stays as it is. */
  var NS = 'http://www.w3.org/2000/svg';
  var RF = { ok: null, off: false, defs: null, n: 0, cache: {}, keys: [], list: [] };
  function svgEl(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function canRefract() {
    if (RF.ok === null) {
      var ua = navigator.userAgent;
      RF.ok = !!(window.CSS && CSS.supports && CSS.supports('backdrop-filter', 'url(#x)')) && !(/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua));
    }
    return RF.ok && !RF.off && !mq('(prefers-reduced-transparency: reduce)');
  }
  function refractMap(w, h, r, bezel, strength, pad) {
    var key = [w, h, r, bezel, strength, pad].join('|');
    if (RF.cache[key]) return RF.cache[key];
    var W = w + pad * 2, H = h + pad * 2, L = Math.max(W, H), ds = L > 220 ? Math.min(3, L / 160) : 1;
    var cw = Math.max(2, Math.round(W / ds)), ch = Math.max(2, Math.round(H / ds));
    var dx = new Float32Array(cw * ch), dy = new Float32Array(cw * ch), hw = w / 2, hh = h / 2, mx = 0, i, j, k;
    for (j = 0; j < ch; j++) for (i = 0; i < cw; i++) {
      var x = (i + .5) * W / cw - pad - hw, y = (j + .5) * H / ch - pad - hh;
      var qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
      var d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
      var m = d < 0 ? smooth(-bezel, 0, d) : 1 - smooth(0, pad, d); m *= m;
      var nx, ny;
      if (qx > 0 && qy > 0) { var q = Math.hypot(qx, qy) || 1; nx = qx / q; ny = qy / q; }
      else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
      if (x < 0) nx = -nx; if (y < 0) ny = -ny;
      var a = m * strength * bezel; k = j * cw + i;
      dx[k] = -nx * a; dy[k] = -ny * a;
      mx = Math.max(mx, Math.abs(dx[k]), Math.abs(dy[k]));
    }
    var scale = mx * 2 || 1, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(cw, ch), p = img.data;
    for (k = 0; k < cw * ch; k++) { p[k * 4] = Math.round((dx[k] / scale + .5) * 255); p[k * 4 + 1] = Math.round((dy[k] / scale + .5) * 255); p[k * 4 + 2] = 128; p[k * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    var out = { url: cv.toDataURL(), scale: scale };
    RF.cache[key] = out; RF.keys.push(key);
    if (RF.keys.length > 32) delete RF.cache[RF.keys.shift()];
    return out;
  }
  function refract(el, opts) {
    if (!el || el.__lcRefract || !canRefract()) return null;
    opts = opts || {};
    if (!RF.defs) {
      var svg = svgEl('svg', { 'aria-hidden': 'true', width: 0, height: 0 });
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      RF.defs = svgEl('defs', {}); svg.appendChild(RF.defs); document.body.appendChild(svg); fpsWatch();
    }
    var id = 'lc-refract-' + (++RF.n);
    var f = svgEl('filter', { id: id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    var bl = svgEl('feGaussianBlur', { 'in': 'SourceGraphic', edgeMode: 'duplicate', result: 'b' });
    var im = svgEl('feImage', { preserveAspectRatio: 'none', result: 'm' });
    var dm = svgEl('feDisplacementMap', { 'in': 'b', in2: 'm', xChannelSelector: 'R', yChannelSelector: 'G' });
    f.appendChild(bl); f.appendChild(im); f.appendChild(dm); RF.defs.appendChild(f);
    var pend = 0;
    function update() {
      pend = 0; if (RF.off) return;
      var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight); if (!w || !h) return;
      var cs = getComputedStyle(el), r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
      var bezel = Math.round(clamp(Math.min(w, h) / 2 * (+el.getAttribute('data-bezel') || opts.bezel || .5), 6, 20));
      var strength = +(el.getAttribute('data-strength') || opts.strength || .6);
      var sd = +(el.getAttribute('data-refract-blur') || opts.blur || 4);
      var pad = Math.round(clamp(sd * 3 + bezel * strength, 16, 64));
      var m = refractMap(w, h, r, bezel, strength, pad), box = { x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2 };
      for (var k in box) { f.setAttribute(k, box[k]); im.setAttribute(k, box[k]); }
      bl.setAttribute('stdDeviation', sd);
      im.setAttribute('href', m.url);
      dm.setAttribute('scale', m.scale.toFixed(2));
      el.style.backdropFilter = 'url(#' + id + ') saturate(var(--glass-saturate, 200%))';
    }
    var ro = window.ResizeObserver ? new ResizeObserver(function () { if (!pend) pend = requestAnimationFrame(update); }) : null;
    if (ro) ro.observe(el);
    update();
    el.__lcRefract = function () { if (ro) ro.disconnect(); if (f.parentNode) f.parentNode.removeChild(f); el.style.backdropFilter = ''; el.classList.remove('is-refract'); el.__lcRefract = null; };
    el.classList.add('is-refract');
    RF.list.push(el);
    return el.__lcRefract;
  }
  function unrefractAll() { RF.off = true; RF.list.forEach(function (el) { if (el.__lcRefract) el.__lcRefract(); }); RF.list = []; }
  /* Sample the frame rate only while the page is being scrolled or touched;
     three 1-second windows under 50 fps turn refraction off for the page. */
  function fpsWatch() {
    var born = performance.now(), until = 0, raf = 0, win = 0, frames = 0, bad = 0;
    function loop(t) {
      raf = 0; if (RF.off) return;
      if (t - born > 4000 && !document.hidden) {
        if (!win) { win = t; frames = 0; }
        frames++;
        if (t - win >= 1000) {
          var span = t - win; win = 0;
          if (span < 2000) { if (frames * 1000 / span < 50) { if (++bad >= 3) return unrefractAll(); } else bad = 0; }
        }
      }
      if (t < until) raf = requestAnimationFrame(loop); else win = 0;
    }
    function poke() { until = performance.now() + 1500; if (!raf && !RF.off) raf = requestAnimationFrame(loop); }
    ['scroll', 'wheel', 'touchmove', 'pointermove', 'resize'].forEach(function (n) { window.addEventListener(n, poke, { passive: true, capture: true }); });
  }

  /* Progressive blur: three stacked, masked blur layers + a tint, so the
     bar is blurriest at the top and fades out below its edge. */
  function progressive(bar) {
    if (!bar || bar.querySelector(':scope > .lc-pblur')) return;
    var pos = getComputedStyle(bar).position;
    if (pos !== 'absolute' && pos !== 'fixed' && pos !== 'sticky' && !bar.hasAttribute('data-overlay')) bar.classList.add('is-inflow');
    var p = document.createElement('div'); p.className = 'lc-pblur'; p.setAttribute('aria-hidden', 'true');
    p.innerHTML = '<i></i><i></i><i></i>';
    bar.insertBefore(p, bar.firstChild);
  }

  /* Circular theme reveal from the control that triggered it. */
  function theme(next, from) {
    var root = document.documentElement;
    next = next || (root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    function apply() { root.setAttribute('data-theme', next); }
    if (!document.startViewTransition || reduce) { apply(); return Promise.resolve(next); }
    var r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
    var x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : 0;
    var R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('lc-vt-reveal');
    var vt = document.startViewTransition(apply);
    vt.ready.then(function () {
      root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + R + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 560, easing: easeVar('--ease-emphasized', 'cubic-bezier(.05,.7,.1,1)'), pseudoElement: '::view-transition-new(root)' });
    });
    return vt.finished.then(function () { root.classList.remove('lc-vt-reveal'); return next; }, function () { root.classList.remove('lc-vt-reveal'); return next; });
  }

  function auto(scope) {
    function each(sel, fn) { Array.prototype.forEach.call((scope || document).querySelectorAll(sel), fn); }
    each('[data-liquid]', function (el) { liquid(el, { width: el.classList.contains('lc-tabs') ? 24 : 0 }); });
    each('.lc-morph', function (el) { morph(el); });
    each('.lc-titlebar, [data-progressive]', progressive);
    each('[data-spec], ' + GLASS_BTN + ', ' + GLASS_CARD, spec);
    each('[data-jelly], ' + GLASS_BTN + ', ' + GLASS_CARD, function (el) { if (!el.closest('.lc-morph')) jelly(el); });
    each('[data-refract]', function (el) { refract(el); });
  }

  window.Lucent = { liquid: liquid, morph: morph, stream: stream, continuity: continuity, navigate: navigate, dismiss: dismiss, replay: replay, auto: auto,
    spec: spec, jelly: jelly, refract: refract, progressive: progressive, theme: theme };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { auto(); }); else auto();
})();
