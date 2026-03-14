from django.db.models import Q

PLUGIN_META = {
    'id': 'student_search_plugin',
    'name': '学生搜索插件',
    'version': '1.0.0',
    'description': '在工作界面快速搜索学生，并定位座位。',
    'author': '老三',
    'website': 'www.577622.xyz',
}


def _coerce_limit(raw_value, default=20, min_value=1, max_value=50):
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, value))


def _search_students(context):
    payload = context.get('payload') or {}
    classroom = context.get('classroom')
    keyword = str(payload.get('query') or payload.get('keyword') or '').strip()
    limit = _coerce_limit(payload.get('limit'), default=20)

    if classroom is None:
        return {
            'query': keyword,
            'count': 0,
            'items': [],
            'message': '缺少 classroom 上下文，请在请求中附带 classroom_id。',
        }

    queryset = classroom.students.select_related('assigned_seat__group').all()
    if keyword:
        queryset = queryset.filter(
            Q(name__icontains=keyword)
            | Q(student_id__icontains=keyword)
        )

    rows = []
    for student in queryset.order_by('name')[:limit]:
        seat = getattr(student, 'assigned_seat', None)
        group = seat.group if seat else None
        rows.append({
            'id': student.pk,
            'name': student.name,
            'student_id': student.student_id or '',
            'score': float(student.score or 0),
            'seat': {
                'row': seat.row,
                'col': seat.col,
            } if seat else None,
            'group': {
                'id': group.pk,
                'name': group.name,
            } if group else None,
        })

    return {
        'query': keyword,
        'count': len(rows),
        'items': rows,
        'limit': limit,
    }


STUDENT_SEARCH_UI_SCRIPT = """
payload_obj = payload if isinstance(payload, dict) else {}
query = str(payload_obj.get('query') or payload_obj.get('keyword') or '').strip()
limit_raw = payload_obj.get('limit', 20)
try:
    limit = int(limit_raw)
except Exception:
    limit = 20
if limit < 1:
    limit = 1
if limit > 50:
    limit = 50

students_qs = classroom.students.select_related('assigned_seat__group').all() if classroom else []
if classroom and query:
    students_qs = students_qs.filter(name__icontains=query) | students_qs.filter(student_id__icontains=query)

rows = []
if classroom:
    for student in students_qs.order_by('name')[:limit]:
        seat = getattr(student, 'assigned_seat', None)
        seat_text = f"{seat.row}-{seat.col}" if seat else '未入座'
        rows.append({
            'name': student.name,
            'student_id': student.student_id or '无学号',
            'seat': seat_text,
            'score': float(student.score or 0),
        })

list_rows = [f"{item['name']}（{item['student_id']}） · 座位 {item['seat']}" for item in rows]

ui = components.page(
    title='学生搜索插件',
    subtitle='支持按姓名或学号搜索',
    theme={'primary': '#0a59f7', 'style': 'apple-like'},
    blocks=[
        components.metric('命中人数', len(rows), hint=f"关键词：{query or '（空）'}"),
        components.text('说明', '工作页可授权注入搜索面板，支持无感快捷搜索与定位。'),
        components.actions('常用调用', items=[
            {
                'label': '搜索全部（前20）',
                'action': 'search_students',
                'method': 'POST',
                'payload': {'query': '', 'limit': 20},
            },
        ]),
        components.table(
            '搜索结果表格',
            columns=[
                {'key': 'name', 'label': '姓名'},
                {'key': 'student_id', 'label': '学号'},
                {'key': 'seat', 'label': '座位'},
                {'key': 'score', 'label': '分数'},
            ],
            rows=rows,
        ),
        components.list('搜索结果', list_rows, empty_text='暂无结果'),
    ],
)
""".strip()


STUDENT_SEARCH_WORKSPACE_SCRIPT = """
const rootId = 'student-search-plugin-floating';
if (document.getElementById(rootId)) {
    return;
}

const searchHitsClass = 'plugin-student-search-hit';
const styleId = 'student-search-plugin-style';

const ensureStyle = () => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .${searchHitsClass} {
            outline: 2px solid rgba(10, 89, 247, 0.85) !important;
            outline-offset: 2px;
            box-shadow: 0 0 0 4px rgba(10, 89, 247, 0.18);
            border-radius: 8px;
        }
        #${rootId} {
            position: fixed;
            right: 14px;
            bottom: 16px;
            width: min(360px, calc(100vw - 24px));
            z-index: 1600;
            border: 1px solid rgba(10, 89, 247, 0.2);
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(14px);
            box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18);
            padding: 10px;
            display: grid;
            gap: 8px;
            font-size: 12px;
        }
        #${rootId} .ssp-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        #${rootId} .ssp-title {
            font-weight: 700;
            font-size: 13px;
            color: #0f172a;
        }
        #${rootId} .ssp-close {
            border: 1px solid rgba(15, 23, 42, 0.15);
            background: #fff;
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 12px;
            cursor: pointer;
        }
        #${rootId} .ssp-input {
            border: 1px solid rgba(10, 89, 247, 0.25);
            border-radius: 999px;
            min-height: 36px;
            padding: 0 12px;
            font-size: 13px;
            outline: none;
        }
        #${rootId} .ssp-list {
            max-height: 240px;
            overflow: auto;
            display: grid;
            gap: 6px;
        }
        #${rootId} .ssp-item {
            border: 1px solid rgba(10, 89, 247, 0.14);
            border-radius: 10px;
            padding: 6px 8px;
            background: #fff;
            cursor: pointer;
            display: grid;
            gap: 2px;
        }
        #${rootId} .ssp-item-main {
            font-size: 13px;
            font-weight: 600;
            color: #0f172a;
        }
        #${rootId} .ssp-item-sub {
            font-size: 12px;
            color: #64748b;
        }
        #${rootId} .ssp-tip {
            color: #64748b;
            font-size: 11px;
        }
    `;
    document.head.appendChild(style);
};

ensureStyle();

const panel = document.createElement('div');
panel.id = rootId;
panel.innerHTML = `
    <div class="ssp-head">
        <div class="ssp-title">学生快速搜索</div>
        <button type="button" class="ssp-close">隐藏</button>
    </div>
    <input type="text" class="ssp-input" placeholder="输入姓名或学号，回车搜索" autocomplete="off">
    <div class="ssp-tip">快捷键：Ctrl+Shift+F 聚焦，Esc 清空高亮</div>
    <div class="ssp-list"></div>
`;
document.body.appendChild(panel);

const closeBtn = panel.querySelector('.ssp-close');
const input = panel.querySelector('.ssp-input');
const list = panel.querySelector('.ssp-list');
let hidden = false;
let timer = null;

const clearHighlights = () => {
    document.querySelectorAll('.' + searchHitsClass).forEach((el) => {
        el.classList.remove(searchHitsClass);
    });
};

const markHits = (ids) => {
    clearHighlights();
    if (!ids || !ids.size) return;

    document.querySelectorAll('.seat[data-student-id], .unseated-item[data-student-id]').forEach((el) => {
        const sid = String(el.dataset.studentId || '').trim();
        if (!sid) return;
        if (ids.has(sid)) {
            el.classList.add(searchHitsClass);
        }
    });
};

const renderRows = (items) => {
    list.innerHTML = '';
    if (!items || !items.length) {
        list.innerHTML = '<div class="ssp-tip">未找到匹配学生</div>';
        markHits(new Set());
        return;
    }

    const hitSet = new Set(items.map((item) => String(item.id)));
    markHits(hitSet);

    items.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ssp-item';
        row.dataset.studentId = String(item.id || '');

        const seatText = item.seat ? `${item.seat.row}-${item.seat.col}` : '未入座';
        row.innerHTML = `
            <span class="ssp-item-main">${item.name || ''}</span>
            <span class="ssp-item-sub">学号 ${item.student_id || '无'} · 座位 ${seatText}</span>
        `;

        row.addEventListener('click', () => {
            const sid = String(item.id || '');
            if (!sid) return;
            const target = document.querySelector(`.seat[data-student-id="${sid}"]`) || document.querySelector(`.unseated-item[data-student-id="${sid}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                target.classList.add(searchHitsClass);
            }
        });

        list.appendChild(row);
    });
};

const doSearch = async (keyword) => {
    const query = String(keyword || '').trim();
    const response = await api.runtime.runAction('search_students', {
        query,
        limit: 30,
    });
    const result = response && response.result ? response.result : {};
    renderRows(Array.isArray(result.items) ? result.items : []);
};

const queueSearch = (keyword) => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    timer = setTimeout(() => {
        doSearch(keyword).catch((error) => {
            list.innerHTML = `<div class=\"ssp-tip\">搜索失败：${String(error)}</div>`;
        });
    }, 260);
};

input.addEventListener('input', () => {
    queueSearch(input.value);
});

input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        doSearch(input.value).catch((error) => {
            list.innerHTML = `<div class=\"ssp-tip\">搜索失败：${String(error)}</div>`;
        });
        return;
    }
    if (event.key === 'Escape') {
        input.value = '';
        clearHighlights();
        list.innerHTML = '';
        return;
    }
});

const onShortcut = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (hidden) {
            hidden = false;
            panel.style.display = 'grid';
        }
        input.focus();
        input.select();
    }
};

document.addEventListener('keydown', onShortcut);

closeBtn.addEventListener('click', () => {
    hidden = !hidden;
    if (hidden) {
        panel.style.display = 'none';
        clearHighlights();
    } else {
        panel.style.display = 'grid';
        input.focus();
    }
});

queueSearch('');

return () => {
    document.removeEventListener('keydown', onShortcut);
    clearHighlights();
    if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
    }
};
""".strip()


def register(registry):
    registry.register_action(
        'search_students',
        _search_students,
        methods=('GET', 'POST'),
        description='按姓名或学号搜索学生',
    )
    registry.register_ui_script(
        'search_dashboard',
        STUDENT_SEARCH_UI_SCRIPT,
        methods=('GET', 'POST'),
        description='学生搜索脚本式 UI',
    )
    registry.register_workspace_script(
        'inject_search_panel',
        STUDENT_SEARCH_WORKSPACE_SCRIPT,
        methods=('GET',),
        description='向工作页注入搜索浮层并高亮座位',
        requires_permission=True,
        auto_run=True,
    )
