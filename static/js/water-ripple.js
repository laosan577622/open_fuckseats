(function () {
    'use strict';

    var MAX_RIPPLES = 5;
    var activeCount = 0;

    function emitRipple(x, y, options) {
        if (activeCount >= MAX_RIPPLES) return;
        var opts = Object.assign({ color: 'rgba(10,89,247,0.12)', radius: 200, count: 3 }, options);

        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'water-ripple-svg');

        var vw = window.innerWidth;
        var vh = window.innerHeight;
        svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);

        for (var i = 0; i < opts.count; i++) {
            var circle = document.createElementNS(ns, 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', '0');
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', opts.color);
            circle.setAttribute('stroke-width', '2');

            var dur = 0.8;
            var delay = i * 0.15;
            var anim = document.createElementNS(ns, 'animate');
            anim.setAttribute('attributeName', 'r');
            anim.setAttribute('from', '0');
            anim.setAttribute('to', String(opts.radius));
            anim.setAttribute('dur', dur + 's');
            anim.setAttribute('begin', delay + 's');
            anim.setAttribute('fill', 'freeze');
            circle.appendChild(anim);

            var animOpacity = document.createElementNS(ns, 'animate');
            animOpacity.setAttribute('attributeName', 'opacity');
            animOpacity.setAttribute('from', '1');
            animOpacity.setAttribute('to', '0');
            animOpacity.setAttribute('dur', dur + 's');
            animOpacity.setAttribute('begin', delay + 's');
            animOpacity.setAttribute('fill', 'freeze');
            circle.appendChild(animOpacity);

            var animStroke = document.createElementNS(ns, 'animate');
            animStroke.setAttribute('attributeName', 'stroke-width');
            animStroke.setAttribute('from', '3');
            animStroke.setAttribute('to', '0.5');
            animStroke.setAttribute('dur', dur + 's');
            animStroke.setAttribute('begin', delay + 's');
            animStroke.setAttribute('fill', 'freeze');
            circle.appendChild(animStroke);

            svg.appendChild(circle);
        }

        document.body.appendChild(svg);
        activeCount++;

        var totalDuration = (opts.count - 1) * 150 + 900;
        setTimeout(function () {
            if (svg.parentNode) svg.parentNode.removeChild(svg);
            activeCount--;
        }, totalDuration);
    }

    function emitSeatRipple(seatElement, color) {
        if (!seatElement) return;
        var rect = seatElement.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        emitRipple(cx, cy, { color: color || 'rgba(10,89,247,0.1)', radius: 150, count: 2 });
    }

    function emitIslandRipple(color) {
        var island = document.querySelector('.dynamic-island');
        if (!island) return;
        var rect = island.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.bottom;
        emitRipple(cx, cy, { color: color || 'rgba(10,89,247,0.15)', radius: 400, count: 3 });
    }

    window.WaterRipple = {
        emit: emitRipple,
        emitSeat: emitSeatRipple,
        emitIsland: emitIslandRipple
    };
})();
