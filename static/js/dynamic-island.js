(function () {
    'use strict';

    var STATES = { IDLE: 'idle', COMPACT: 'compact', EXPANDED: 'expanded', FULLSCREEN: 'fullscreen' };
    var EXPANDED_MAX = 400;
    var EXPANDED_MIN = 120;

    var TOOL_MARQUEE = {
        get_classroom_overview: '正在查看教室布局...',
        get_student_info: '正在查找学生信息...',
        get_group_scores: '正在统计小组分数...',
        get_student_list: '正在获取学生列表...',
        send_card_info: '正在生成操作卡片...',
        swap_students: '正在交换座位...',
        execute_classroom_action: '正在执行操作...'
    };

    function DynamicIsland() {
        this.el = null;
        this.state = STATES.IDLE;
        this._conversationId = null;
        this._approvalToken = null;
        this._pendingCalls = null;
        this._metaball = null;
        this._abortCtrl = null;
        
        // Initial sizing fallback (handled explicitly to guarantee stability)
        this.targetW = 44;
        this.targetH = 28;
        this.targetR = 14;

        this._init();
    }

    DynamicIsland.prototype._init = function () {
        var existing = document.getElementById('dynamic-island');
        if (existing) {
            this.el = existing;
            this._bind();
            return;
        }
        this._build();
        this._bind();
        
        // Apply initial explicit size
        this._updateSize();
    };

    DynamicIsland.prototype._build = function () {
        var el = document.createElement('div');
        el.id = 'dynamic-island';
        el.className = 'dynamic-island';
        el.setAttribute('data-state', 'idle');

        el.innerHTML =
            '<div class="island-inner">' +
                '<div class="island-idle-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-4h2v2h-2v-2zm1-10c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" fill="currentColor"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="island-compact-row">' +
                    '<div class="island-pulse-dot"></div>' +
                    '<div class="island-marquee">' +
                        '<span class="island-marquee-text">思考中...</span>' +
                    '</div>' +
                '</div>' +
                '<div class="island-expanded-body">' +
                    '<div class="island-response-text" style="display:none;"></div>' +
                '</div>' +
                '<div class="island-input-bar">' +
                    '<input type="text" class="island-input" placeholder="输入消息..." />' +
                    '<button type="button" class="island-send-btn">' +
                        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" fill="currentColor"/>' +
                        '</svg>' +
                    '</button>' +
                '</div>' +
                '<button type="button" class="island-fullscreen-close">' +
                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M6.7 6.7a1 1 0 011.4 0L12 10.6l3.9-3.9a1 1 0 111.4 1.4L13.4 12l3.9 3.9a1 1 0 01-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 01-1.4-1.4L10.6 12 6.7 8.1a1 1 0 010-1.4z" fill="currentColor"/>' +
                    '</svg>' +
                '</button>' +
            '</div>';

        document.body.appendChild(el);
        this.el = el;
    };

    DynamicIsland.prototype._bind = function () {
        var self = this;
        var el = this.el;

        // Auto resize logic on window resize (especially for fullscreen)
        window.addEventListener('resize', function() {
            if (self.state === STATES.FULLSCREEN) {
                self._updateSize();
            }
        });

        el.addEventListener('click', function (e) {
            // Ignore clicks on actionable items
            if (e.target.closest('.island-input-bar') ||
                e.target.closest('.island-approval-actions') ||
                e.target.closest('.island-perm-toggle') ||
                e.target.closest('.island-fullscreen-close')) return;

            // Expand logic
            if (self.state === STATES.IDLE) self.setState(STATES.EXPANDED);
            else if (self.state === STATES.COMPACT) self.setState(STATES.EXPANDED);
            else if (self.state === STATES.EXPANDED) self.setState(STATES.FULLSCREEN);
        });

        el.querySelector('.island-fullscreen-close').addEventListener('click', function (e) {
            e.stopPropagation();
            self.setState(STATES.EXPANDED);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (self.state === STATES.FULLSCREEN) self.setState(STATES.EXPANDED);
            else if (self.state === STATES.EXPANDED) self.setState(self._hasActivity() ? STATES.COMPACT : STATES.IDLE);
            else if (self.state === STATES.COMPACT) self.setState(STATES.IDLE);
        });

        document.addEventListener('click', function (e) {
            if (self.state !== STATES.EXPANDED) return;
            if (el.contains(e.target)) return; // clicked inside
            // Clicked outside, collapse
            self.setState(self._hasActivity() ? STATES.COMPACT : STATES.IDLE);
        });

        el.addEventListener('mousemove', function (e) {
            var rect = el.getBoundingClientRect();
            el.style.setProperty('--highlight-x', (e.clientX - rect.left) + 'px');
            el.style.setProperty('--highlight-y', (e.clientY - rect.top) + 'px');
        });

        var input = el.querySelector('.island-input');
        var sendBtn = el.querySelector('.island-send-btn');

        sendBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            self._send();
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                self._send();
            }
        });
    };

    DynamicIsland.prototype._hasActivity = function () {
        return this._abortCtrl !== null || this._pendingCalls !== null;
    };

    DynamicIsland.prototype._updateSize = function () {
        if (this._sizeRaf) cancelAnimationFrame(this._sizeRaf);

        var self = this;

        if (this.state === STATES.FULLSCREEN) {
            this._sizeRaf = requestAnimationFrame(function() {
                self.el.style.width = window.innerWidth + 'px';
                self.el.style.height = window.innerHeight + 'px';
                self.el.style.borderRadius = '0px';
                self.el.style.top = '0px';
                self.el.style.right = '0px';
            });
            return;
        }

        // Base positioned
        this.el.style.top = '8px';
        this.el.style.right = '16px';
        
        var w, h, r;
        
        if (this.state === STATES.IDLE) {
            w = 44; h = 28; r = 14;
        } else if (this.state === STATES.COMPACT) {
            w = 240; h = 36; r = 18;
        } else if (this.state === STATES.EXPANDED) {
            w = 360; r = 20;
            
            var prevTrans = this.el.style.transition;
            var startH = this.el.offsetHeight;
            var startW = this.el.offsetWidth;
            
            this.el.style.transition = 'none';
            this.el.style.width = w + 'px';
            this.el.style.height = 'auto';
            
            h = this.el.offsetHeight;
            h = Math.max(EXPANDED_MIN, Math.min(h, EXPANDED_MAX));
            
            this.el.style.width = startW + 'px';
            this.el.style.height = startH + 'px';
            this.el.offsetHeight; // Force reflow
            
            this.el.style.transition = prevTrans;
        }

        this._sizeRaf = requestAnimationFrame(function() {
            self.el.style.width = w + 'px';
            self.el.style.height = h + 'px';
            self.el.style.borderRadius = r + 'px';
        });
    };

    DynamicIsland.prototype.setState = function (newState) {
        if (this.state === newState) return;
        this.state = newState;
        this.el.setAttribute('data-state', newState);

        this._updateSize();

        // Optional class toggle for layout squish
        var layout = document.querySelector('.classroom-layout');
        if (layout) {
            if (newState === STATES.FULLSCREEN) layout.classList.add('ai-active');
            else layout.classList.remove('ai-active');
        }

        if (newState === STATES.EXPANDED || newState === STATES.FULLSCREEN) {
            var input = this.el.querySelector('.island-input');
            if (input) {
                // Delay focus slightly to let expansion start
                setTimeout(function () { input.focus(); }, 300);
            }
        }
    };

    DynamicIsland.prototype.setMarquee = function (text) {
        var marqueeText = this.el.querySelector('.island-marquee-text');
        if (!marqueeText) return;
        marqueeText.textContent = text;
        this._updateMarqueeDuration(marqueeText);
    };

    DynamicIsland.prototype._updateMarqueeDuration = function (textEl) {
        var width = textEl.scrollWidth || textEl.offsetWidth || 200;
        var duration = Math.max(3, width / 60);
        textEl.style.setProperty('--marquee-duration', duration + 's');
    };

    DynamicIsland.prototype._getClassroomId = function () {
        var root = document.getElementById('classroom-root');
        return root ? root.getAttribute('data-classroom-id') : null;
    };

    DynamicIsland.prototype._getCsrf = function () {
        var root = document.getElementById('classroom-root');
        if (root && root.getAttribute('data-csrf')) return root.getAttribute('data-csrf');
        var input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        return input ? input.value : '';
    };

    DynamicIsland.prototype._send = function () {
        var input = this.el.querySelector('.island-input');
        var message = (input.value || '').trim();
        if (!message) return;
        input.value = '';

        this._setResponse('思考中...');
        this._streamChat(message);
    };

    DynamicIsland.prototype._setResponse = function (text) {
        var body = this.el.querySelector('.island-expanded-body');
        if (!body) return;
        
        var responseEl = body.querySelector('.island-response-text');
        if (!responseEl) {
            responseEl = document.createElement('div');
            responseEl.className = 'island-response-text';
            body.insertBefore(responseEl, body.firstChild);
        }
        
        responseEl.style.display = 'block';
        responseEl.textContent = text;
        
        var approval = body.querySelector('.island-approval');
        if (approval) approval.remove();

        // Content changed, trigger resize
        this._updateSize();
    };

    DynamicIsland.prototype._clearApproval = function () {
        this._approvalToken = null;
        this._pendingCalls = null;
        var body = this.el.querySelector('.island-expanded-body');
        var approval = body ? body.querySelector('.island-approval') : null;
        if (approval) approval.remove();
        
        this._updateSize();
    };

    DynamicIsland.prototype._streamChat = function (message) {
        var self = this;
        var classroomId = this._getClassroomId();
        if (!classroomId) return;

        if (this._abortCtrl) this._abortCtrl.abort();
        this._abortCtrl = new AbortController();

        this.setState(STATES.COMPACT);
        this.setMarquee('思考中...');

        if (typeof WaterRipple !== 'undefined') WaterRipple.emitIsland();

        var url = '/classroom/' + classroomId + '/ai/chat/stream/';
        var body = JSON.stringify({
            action: 'message',
            message: message,
            conversation_id: this._conversationId
        });

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this._getCsrf()
            },
            body: body,
            signal: this._abortCtrl.signal
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return self._readSSE(response);
        }).catch(function (err) {
            if (err.name === 'AbortError') return;
            self._onError(err.message || '网络错误');
        }).finally(function () {
            self._abortCtrl = null;
            self._updateSize();
        });
    };

    DynamicIsland.prototype._readSSE = function (response) {
        var self = this;
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var replyParts = [];

        function process(result) {
            if (result.done) {
                if (replyParts.length > 0) {
                    self._finishReply(replyParts.join(''));
                }
                return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';

            for (var i = 0; i < chunks.length; i++) {
                var chunk = chunks[i].trim();
                if (!chunk) continue;

                var eventName = '';
                var dataStr = '';
                var lines = chunk.split('\n');
                for (var j = 0; j < lines.length; j++) {
                    var line = lines[j];
                    if (line.indexOf('event: ') === 0) eventName = line.substring(7).trim();
                    else if (line.indexOf('data: ') === 0) dataStr = line.substring(6);
                }

                if (!eventName || !dataStr) continue;

                var payload;
                try { payload = JSON.parse(dataStr); } catch (e) { continue; }

                if (eventName === 'delta') {
                    var text = payload.text || '';
                    if (text) {
                        replyParts.push(text);
                        self.setMarquee('AI 正在回复...');
                        self._setResponse(replyParts.join(''));
                    }
                } else if (eventName === 'done') {
                    self._onDone(payload, replyParts.join(''));
                    replyParts = [];
                } else if (eventName === 'error') {
                    self._onError(payload.message || '未知错误');
                }
            }

            return reader.read().then(process);
        }

        return reader.read().then(process);
    };

    DynamicIsland.prototype._onDone = function (payload, accumulatedReply) {
        var status = payload.status || 'success';
        this._conversationId = payload.conversation_id || this._conversationId;

        if (status === 'needs_approval') {
            this._approvalToken = payload.approval_token;
            this._pendingCalls = payload.pending_calls || [];
            this._showApproval(this._pendingCalls);
            this._triggerToolEffects(this._pendingCalls);
            return;
        }

        var reply = payload.reply || accumulatedReply || '';
        if (reply) {
            this._setResponse(reply);
        } else {
            this._setResponse('操作已完成。');
        }

        this._recallMetaballs();
        this.setState(STATES.EXPANDED);

        if (typeof window.refreshState === 'function') {
            window.refreshState();
        }
    };

    DynamicIsland.prototype._finishReply = function (text) {
        if (text) {
            this._setResponse(text);
        } else {
            this._setResponse('操作已完成。');
        }
        this._recallMetaballs();
        this.setState(STATES.EXPANDED);
    };

    DynamicIsland.prototype._onError = function (msg) {
        this._setResponse('发生错误: ' + msg);
        this._recallMetaballs();
        this.setState(STATES.EXPANDED);
    };

    DynamicIsland.prototype._showApproval = function (calls) {
        var self = this;
        this.setState(STATES.EXPANDED);

        var body = this.el.querySelector('.island-expanded-body');
        if (!body) return;
        
        var responseEl = body.querySelector('.island-response-text');
        if (responseEl) {
            responseEl.style.display = 'none';
        }

        var existing = body.querySelector('.island-approval');
        if (existing) existing.remove();

        var card = document.createElement('div');
        card.className = 'island-approval';

        var titleText = calls.length > 1
            ? 'AI 需要以下 ' + calls.length + ' 个权限'
            : 'AI 需要以下权限';

        var html = '<div class="island-approval-title">' + _escapeHtml(titleText) + '</div>';

        if (calls.length > 1) {
            html += '<div class="island-permissions">' +
                '<div class="island-perm-summary">' +
                    '<span>即将调用 ' + calls.length + ' 个权限</span>' +
                    '<button type="button" class="island-perm-toggle">查看详情</button>' +
                '</div>' +
                '<div class="island-perm-list">';
            for (var i = 0; i < calls.length; i++) {
                html += '<div class="island-perm-item">' +
                    '<code>' + _escapeHtml(calls[i].label || calls[i].name) + '</code> ' +
                    _escapeHtml(calls[i].summary || '') +
                '</div>';
            }
            html += '</div></div>';
        } else if (calls.length === 1) {
            html += '<div class="island-approval-detail">' +
                '<code>' + _escapeHtml(calls[0].label || calls[0].name) + '</code> ' +
                _escapeHtml(calls[0].summary || '') +
            '</div>';
        }

        html += '<div class="island-approval-actions">' +
            '<button type="button" class="btn btn-secondary island-deny-btn">拒绝</button>' +
            '<button type="button" class="btn btn-primary island-approve-btn">批准执行</button>' +
        '</div>';

        card.innerHTML = html;
        body.appendChild(card);

        // Content changed, recalculate size
        this._updateSize();

        var permToggle = card.querySelector('.island-perm-toggle');
        if (permToggle) {
            permToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                var list = card.querySelector('.island-perm-list');
                if (list) {
                    list.classList.toggle('open');
                }
                permToggle.textContent = list && list.classList.contains('open') ? '收起' : '查看详情';
                // Need to resize again because list expanded/collapsed
                self._updateSize();
            });
        }

        card.querySelector('.island-approve-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            self._submitApproval(true);
        });
        card.querySelector('.island-deny-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            self._submitApproval(false);
        });
    };

    DynamicIsland.prototype._submitApproval = function (approved) {
        var self = this;
        if (!this._approvalToken || !this._pendingCalls) return;

        var classroomId = this._getClassroomId();
        if (!classroomId) return;

        var token = this._approvalToken;
        var decisions = [];
        for (var i = 0; i < this._pendingCalls.length; i++) {
            decisions.push({
                call_id: this._pendingCalls[i].call_id,
                approved: approved
            });
        }

        this._clearApproval();

        if (approved) {
            this.setState(STATES.COMPACT);
            this.setMarquee('正在执行...');

            if (typeof WaterRipple !== 'undefined') {
                WaterRipple.emitIsland('rgba(52, 199, 89, 0.15)');
            }
        } else {
            if (typeof WaterRipple !== 'undefined') {
                WaterRipple.emitIsland('rgba(255, 59, 48, 0.12)');
            }
        }

        var url = '/classroom/' + classroomId + '/ai/chat/';
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this._getCsrf()
            },
            body: JSON.stringify({
                action: 'tool_approval',
                approval_token: token,
                decisions: decisions,
                conversation_id: this._conversationId
            })
        }).then(function (r) { return r.json(); })
        .then(function (data) {
            self._approvalToken = null;
            self._pendingCalls = null;

            if (data.status === 'error') {
                self._onError(data.message || '操作失败');
                return;
            }

            if (data.status === 'needs_approval') {
                self._approvalToken = data.approval_token;
                self._pendingCalls = data.pending_calls || [];
                self._showApproval(self._pendingCalls);
                return;
            }

            var reply = data.reply || (approved ? '操作已执行。' : '已拒绝执行。');
            self._setResponse(reply);
            self._conversationId = data.conversation_id || self._conversationId;

            self._recallMetaballs();
            self.setState(STATES.EXPANDED);

            if (typeof window.refreshState === 'function') {
                window.refreshState();
            }
        }).catch(function (err) {
            self._onError(err.message || '网络错误');
        });
    };

    DynamicIsland.prototype._triggerToolEffects = function (calls) {
        if (!calls || !calls.length) return;

        for (var i = 0; i < calls.length; i++) {
            var call = calls[i];
            var toolName = call.name;

            this.setMarquee('等待授权...');

            this._spawnToolMetaballs(call);
            this._emitToolRipple(call);
        }
    };

    DynamicIsland.prototype._spawnToolMetaballs = function (call) {
        if (!this._metaball) return;
        var center = this._metaball.getIslandCenter();

        if (call.name === 'swap_students') {
            var id1 = this._metaball.spawn(center.x, center.y);
            var id2 = this._metaball.spawn(center.x, center.y);
            if (id1 && id2) {
                var seatA = this._findSeatElement(call.arguments && call.arguments.student_a);
                var seatB = this._findSeatElement(call.arguments && call.arguments.student_b);
                if (seatA) {
                    var rA = seatA.getBoundingClientRect();
                    this._metaball.moveTo(id1, rA.left + rA.width / 2, rA.top + rA.height / 2);
                }
                if (seatB) {
                    var rB = seatB.getBoundingClientRect();
                    this._metaball.moveTo(id2, rB.left + rB.width / 2, rB.top + rB.height / 2);
                }
            }
        } else if (call.name === 'get_student_info') {
            var id = this._metaball.spawn(center.x, center.y);
            if (id) {
                var seat = this._findSeatElement(call.arguments && call.arguments.student_query);
                if (seat) {
                    var r = seat.getBoundingClientRect();
                    this._metaball.moveTo(id, r.left + r.width / 2, r.top + r.height / 2);
                }
            }
        } else if (call.name === 'execute_classroom_action') {
            this._metaball.spawn(center.x, center.y);
        }
    };

    DynamicIsland.prototype._emitToolRipple = function (call) {
        if (typeof WaterRipple === 'undefined') return;

        if (call.name === 'swap_students' && call.arguments) {
            var sA = this._findSeatElement(call.arguments.student_a);
            var sB = this._findSeatElement(call.arguments.student_b);
            if (sA) WaterRipple.emitSeat(sA, 'rgba(10,89,247,0.1)');
            if (sB) WaterRipple.emitSeat(sB, 'rgba(10,89,247,0.1)');
        } else if (call.name === 'get_student_info' && call.arguments) {
            var seat = this._findSeatElement(call.arguments.student_query);
            if (seat) WaterRipple.emitSeat(seat, 'rgba(10,89,247,0.1)');
        } else if (call.name === 'get_classroom_overview') {
            var stage = document.querySelector('.seat-stage');
            if (stage) {
                var rect = stage.getBoundingClientRect();
                WaterRipple.emit(rect.left + rect.width / 2, rect.top + rect.height / 2, {
                    color: 'rgba(10,89,247,0.08)', radius: 300, count: 2
                });
            }
        } else if (call.name === 'execute_classroom_action') {
            var stage2 = document.querySelector('.seat-stage');
            if (stage2) {
                var rect2 = stage2.getBoundingClientRect();
                WaterRipple.emit(rect2.left + rect2.width / 2, rect2.top + rect2.height / 2, {
                    color: 'rgba(10,89,247,0.08)', radius: 400, count: 4
                });
            }
        }
    };

    DynamicIsland.prototype._findSeatElement = function (studentName) {
        if (!studentName) return null;
        var seats = document.querySelectorAll('.seat');
        for (var i = 0; i < seats.length; i++) {
            var nameEl = seats[i].querySelector('.student-name');
            if (nameEl && nameEl.textContent.trim() === studentName.trim()) {
                return seats[i];
            }
        }
        return null;
    };

    DynamicIsland.prototype._recallMetaballs = function () {
        if (!this._metaball) return;
        var center = this._metaball.getIslandCenter();
        var blobs = this._metaball.blobs;
        var keys = Object.keys(blobs);
        for (var i = 0; i < keys.length; i++) {
            this._metaball.recall(keys[i], center.x, center.y);
        }
    };

    DynamicIsland.prototype.attachMetaball = function (manager) {
        this._metaball = manager;
    };

    function _escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    window.DynamicIsland = DynamicIsland;
})();
