(function () {
    'use strict';

    var MAX_BLOBS = 8;

    function MetaballManager() {
        this.blobs = {};
        this.container = null;
        this._nextId = 1;
        this._init();
    }

    MetaballManager.prototype._init = function () {
        var existing = document.getElementById('metaball-layer');
        if (existing) {
            this.container = existing;
            return;
        }

        var svgNs = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNs, 'svg');
        svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;';
        svg.innerHTML =
            '<defs>' +
                '<filter id="metaball-filter">' +
                    '<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />' +
                    '<feColorMatrix in="blur" mode="matrix" ' +
                        'values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="metaball" />' +
                    '<feComposite in="SourceGraphic" in2="metaball" operator="atop" />' +
                '</filter>' +
            '</defs>';
        document.body.appendChild(svg);

        var layer = document.createElement('div');
        layer.id = 'metaball-layer';
        layer.className = 'metaball-layer';
        document.body.appendChild(layer);
        this.container = layer;
    };

    MetaballManager.prototype.spawn = function (x, y) {
        if (Object.keys(this.blobs).length >= MAX_BLOBS) return null;

        var id = 'blob-' + this._nextId++;
        var blob = document.createElement('div');
        blob.className = 'metaball-blob';
        blob.style.left = x + 'px';
        blob.style.top = y + 'px';
        blob.style.opacity = '0';
        this.container.appendChild(blob);

        requestAnimationFrame(function () {
            blob.style.opacity = '1';
        });

        this.blobs[id] = blob;
        return id;
    };

    MetaballManager.prototype.moveTo = function (id, x, y) {
        var blob = this.blobs[id];
        if (!blob) return;
        blob.style.left = x + 'px';
        blob.style.top = y + 'px';
    };

    MetaballManager.prototype.recall = function (id, targetX, targetY) {
        var blob = this.blobs[id];
        if (!blob) return;
        var self = this;

        blob.style.left = targetX + 'px';
        blob.style.top = targetY + 'px';

        function onEnd() {
            blob.style.opacity = '0';
            setTimeout(function () {
                if (blob.parentNode) blob.parentNode.removeChild(blob);
                delete self.blobs[id];
            }, 300);
        }

        blob.addEventListener('transitionend', function handler(e) {
            if (e.propertyName !== 'left' && e.propertyName !== 'top') return;
            blob.removeEventListener('transitionend', handler);
            onEnd();
        });

        setTimeout(onEnd, 1000);
    };

    MetaballManager.prototype.clear = function () {
        var self = this;
        Object.keys(this.blobs).forEach(function (id) {
            var blob = self.blobs[id];
            if (blob && blob.parentNode) blob.parentNode.removeChild(blob);
        });
        this.blobs = {};
    };

    MetaballManager.prototype.getIslandCenter = function () {
        var island = document.querySelector('.dynamic-island');
        if (!island) return { x: window.innerWidth - 40, y: 22 };
        var rect = island.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    window.MetaballManager = MetaballManager;
})();
