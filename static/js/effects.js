(function () {
    'use strict';

    function createRipple(event, element) {
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
        element.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }

    function initRipple() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-primary, .btn-danger');
            if (btn) createRipple(e, btn);
            const seat = e.target.closest('.seat:not(.cell-aisle):not(.cell-empty)');
            if (seat) createRipple(e, seat);
        });
    }

    function initMouseTracking(selector) {
        const target = selector || '.seat';
        document.addEventListener('mousemove', (e) => {
            const el = e.target.closest(target);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
            const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
            el.style.setProperty('--mouse-x', x + '%');
            el.style.setProperty('--mouse-y', y + '%');
        });
    }

    var SPRING_CURVES = {
        default: 'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.8%, 1)',
        fast: 'linear(0, 0.11 11.4%, 0.635 29.1%, 0.908 43.5%, 0.979 53%, 1.005 62.1%, 1.007 85.4%, 1)',
        gentle: 'linear(0, 0.004, 0.016 2.5%, 0.063 5.4%, 0.413 18%, 0.557 23.3%, 0.694 30%, 0.787 36.1%, 0.87 43.3%, 0.926 50.2%, 0.966 58.6%, 0.988 68.2%, 0.998 82.6%, 1)'
    };

    function springAnimate(element, keyframes, options) {
        var opts = Object.assign({
            duration: 400,
            spring: 'default',
            fill: 'forwards'
        }, options);
        opts.easing = SPRING_CURVES[opts.spring] || SPRING_CURVES.default;
        delete opts.spring;
        return element.animate(keyframes, opts);
    }

    function init() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        initRipple();
        initMouseTracking('.seat');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.FuckSeatsEffects = {
        createRipple: createRipple,
        initMouseTracking: initMouseTracking,
        springAnimate: springAnimate,
        SPRING_CURVES: SPRING_CURVES
    };
})();
