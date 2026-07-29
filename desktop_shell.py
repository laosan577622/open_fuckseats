import mimetypes
import json
import re
import sys
import threading
import uuid
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path


LOCAL_DESKTOP_HOSTS = {"127.0.0.1", "localhost"}
FILENAME_SANITIZE_RE = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
WinForms = None
Point = None
Func = None
Object = None

if sys.platform.startswith("win"):
    try:
        import clr

        clr.AddReference("System.Windows.Forms")
        clr.AddReference("System.Drawing")

        from System import Func, Object
        from System.Drawing import Point
        import System.Windows.Forms as WinForms
    except Exception:
        WinForms = None
        Point = None
        Func = None
        Object = None
WINDOWS_CONTEXT_MENU_BRIDGE_SCRIPT = """
(function () {
    if (window.__fuckseatsWindowsContextBridgeInstalled) {
        return;
    }
    window.__fuckseatsWindowsContextBridgeInstalled = true;

    const EDITABLE_SELECTOR = [
        'textarea',
        'input:not([type="button"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"])',
        '[contenteditable]',
        '[contenteditable="true"]',
        '[contenteditable=""]'
    ].join(',');

    const getTarget = (event) => {
        if (event && event.target instanceof Element) {
            return event.target;
        }
        return document.elementFromPoint(event.clientX, event.clientY);
    };

    const getEditableTarget = (target) => {
        if (!target || !target.closest) {
            return null;
        }
        return target.closest(EDITABLE_SELECTOR);
    };

    const getSelectedText = (editableTarget) => {
        if (
            editableTarget &&
            typeof editableTarget.value === 'string' &&
            typeof editableTarget.selectionStart === 'number' &&
            typeof editableTarget.selectionEnd === 'number' &&
            editableTarget.selectionEnd > editableTarget.selectionStart
        ) {
            return editableTarget.value.slice(editableTarget.selectionStart, editableTarget.selectionEnd);
        }

        try {
            return String(window.getSelection ? window.getSelection() : '');
        } catch (_) {
            return '';
        }
    };

    document.addEventListener('contextmenu', function (event) {
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.handle_windows_context_menu !== 'function') {
            return;
        }

        const target = getTarget(event);
        const editableTarget = getEditableTarget(target);
        const linkTarget = target && target.closest ? target.closest('a[href]') : null;
        const selectedText = getSelectedText(editableTarget).slice(0, 4000);
        const className = target && typeof target.className === 'string' ? target.className : '';

        event.preventDefault();

        const payload = {
            key: 'contextmenu',
            pos: {
                x: Number(event.clientX) || 0,
                y: Number(event.clientY) || 0
            },
            context: {
                tagName: target && target.tagName ? String(target.tagName) : '',
                id: target && target.id ? String(target.id) : '',
                className: className,
                isEditable: Boolean(editableTarget),
                isTextInput: Boolean(
                    editableTarget &&
                    (editableTarget.tagName === 'INPUT' || editableTarget.tagName === 'TEXTAREA')
                ),
                inputType: editableTarget && editableTarget.type ? String(editableTarget.type) : '',
                selectionText: selectedText,
                linkHref: linkTarget && linkTarget.href ? String(linkTarget.href) : '',
                seatStage: Boolean(target && target.closest && target.closest('.seat-stage')),
                customMenu: Boolean(target && target.closest && target.closest('.context-menu'))
            }
        };

        Promise.resolve(api.handle_windows_context_menu(payload)).catch(function () {});
    }, false);
})();
""".strip()


def sanitize_filename(name, fallback="导出文件"):
    normalized = FILENAME_SANITIZE_RE.sub("_", str(name or ""))
    normalized = normalized.rstrip(". ").strip()
    return normalized or fallback


def parse_content_disposition_filename(content_disposition):
    if not content_disposition:
        return ""

    utf8_match = re.search(r"filename\*\s*=\s*UTF-8''([^;]+)", content_disposition, re.I)
    if utf8_match and utf8_match.group(1):
        try:
            return urllib.parse.unquote(utf8_match.group(1))
        except Exception:
            return utf8_match.group(1)

    plain_match = re.search(r'filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)', content_disposition, re.I)
    if not plain_match:
        return ""

    return (plain_match.group(1) or plain_match.group(2) or "").strip()


def normalize_accept_extensions(raw_extensions, fallback_filename=""):
    if raw_extensions is None:
        items = []
    elif isinstance(raw_extensions, str):
        items = raw_extensions.split(",")
    else:
        items = list(raw_extensions)

    normalized = []
    seen = set()
    for item in items:
        value = str(item or "").strip()
        if not value:
            continue
        if not value.startswith("."):
            value = f".{value}"
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(value)

    if normalized:
        return normalized

    fallback_suffix = Path(str(fallback_filename or "")).suffix.strip()
    if fallback_suffix:
        return [fallback_suffix if fallback_suffix.startswith(".") else f".{fallback_suffix}"]

    return []


def infer_filename_from_url(url, fallback="导出文件"):
    try:
        parsed = urllib.parse.urlparse(url)
        last_part = parsed.path.rstrip("/").split("/")[-1]
        if last_part and "." in last_part:
            return sanitize_filename(last_part, fallback)
    except Exception:
        pass
    return fallback


def resolve_local_export_url(server_origin, export_url):
    if not export_url:
        raise ValueError("导出地址无效")

    origin = str(server_origin or "").rstrip("/")
    if not origin:
        raise ValueError("桌面服务地址未初始化")

    parsed_origin = urllib.parse.urlparse(origin)
    if parsed_origin.scheme not in {"http", "https"} or parsed_origin.hostname not in LOCAL_DESKTOP_HOSTS:
        raise ValueError("桌面服务地址不受支持")

    joined = urllib.parse.urljoin(f"{origin}/", str(export_url or "").strip())
    parsed_target = urllib.parse.urlparse(joined)

    if parsed_target.scheme != parsed_origin.scheme:
        raise ValueError("禁止访问非本地导出地址")
    if parsed_target.hostname not in LOCAL_DESKTOP_HOSTS:
        raise ValueError("禁止访问非本地导出地址")
    if parsed_target.port != parsed_origin.port:
        raise ValueError("禁止访问非本地导出端口")

    return joined


def ensure_allowed_extension(file_path, accept_extensions):
    target = Path(str(file_path or ""))
    normalized_extensions = normalize_accept_extensions(accept_extensions)
    allowed = [ext.lower() for ext in normalized_extensions]
    if not allowed or target.suffix.lower() in allowed or not str(target):
        return str(target)
    if target.suffix:
        return str(target)
    return f"{target}{allowed[0]}"


def is_allowed_extension(file_path, accept_extensions):
    normalized_extensions = normalize_accept_extensions(accept_extensions)
    allowed = [ext.lower() for ext in normalized_extensions]
    if not allowed:
        return True
    return Path(str(file_path or "")).suffix.lower() in allowed


def build_multipart_form_data(fields=None, files=None):
    boundary = f"----FuckSeatsBoundary{uuid.uuid4().hex}"
    chunks = []

    def quote_header(value):
        return str(value or "").replace("\\", "\\\\").replace('"', '\\"')

    for name, value in (fields or {}).items():
        chunks.append(f"--{boundary}".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{quote_header(name)}"'.encode("utf-8"))
        chunks.append(b"")
        chunks.append(str(value or "").encode("utf-8"))

    for item in (files or []):
        field_name = item.get("field_name") or "file"
        filename = item.get("filename") or "upload"
        content_type = item.get("content_type") or "application/octet-stream"
        content = item.get("content") or b""
        chunks.append(f"--{boundary}".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{quote_header(field_name)}"; '
                f'filename="{quote_header(filename)}"'
            ).encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}".encode("utf-8"))
        chunks.append(b"")
        if isinstance(content, bytes):
            chunks.append(content)
        elif isinstance(content, str):
            chunks.append(content.encode("utf-8"))
        else:
            chunks.append(bytes(content))

    chunks.append(f"--{boundary}--".encode("utf-8"))
    chunks.append(b"")
    return boundary, b"\r\n".join(chunks)


def build_file_dialog_types(accept_mime="", accept_extensions=None):
    extensions = normalize_accept_extensions(accept_extensions)
    if not extensions:
        return ()

    masks = ";".join(f"*{ext}" for ext in extensions)
    primary_ext = extensions[0].lower()
    label_map = {
        ".xlsx": "Excel 文件",
        ".xls": "Excel 文件",
        ".pptx": "PowerPoint 文件",
        ".svg": "SVG 图片",
        ".seats": "座位快照",
        ".json": "JSON 文件",
    }
    label = label_map.get(primary_ext)
    if not label:
        guessed = mimetypes.guess_type(f"file{primary_ext}")[0] or accept_mime or ""
        label = guessed.split("/")[-1].upper() if guessed else "导出文件"
    return (f"{label} ({masks})", "所有文件 (*.*)")


def default_export_directory():
    home = Path.home()
    downloads_dir = home / "Downloads"
    if downloads_dir.exists():
        return downloads_dir
    desktop_dir = home / "Desktop"
    if desktop_dir.exists():
        return desktop_dir
    return home


class DesktopBridge:
    def __init__(self, server_origin):
        self._server_origin = str(server_origin or "").rstrip("/")
        self._window = None
        self._last_export_dir = str(default_export_directory())
        self._last_import_dir = str(default_export_directory())
        self._save_lock = threading.Lock()
        self._import_lock = threading.Lock()
        self._active_context_menu = None
        self._windows_context_loaded_hook_registered = False
        self._windows_context_document_script_registered = False
        self._windows_context_init_handler = None
        self._windows_context_menu_init_handler = None
        self._windows_context_menu_requested_handler = None

    def _attach_window(self, window):
        self._window = window

    def close_app_for_update(self):
        if self._window is None:
            raise RuntimeError("桌面窗口尚未准备完成")

        self._close_active_context_menu()

        def _close():
            native_window = getattr(self._window, "native", None) if self._window is not None else None
            if native_window is not None:
                try:
                    native_window.Close()
                    return True
                except Exception:
                    pass

            destroy = getattr(self._window, "destroy", None) if self._window is not None else None
            if callable(destroy):
                try:
                    destroy()
                    return True
                except Exception:
                    pass

            return False

        def _close_later():
            try:
                self._invoke_on_ui(_close)
            except Exception:
                pass

        timer = threading.Timer(0.08, _close_later)
        timer.daemon = True
        timer.start()
        return {"status": "closing"}

    def _debug_context_menu(self, source, payload=None):
        try:
            if isinstance(payload, str):
                payload_text = payload
            else:
                payload_text = json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:
            payload_text = str(payload)

        print(f"[windows-context-menu] {source}: {payload_text}", flush=True)

    def log_context_menu_debug(self, source, payload=None):
        self._debug_context_menu(source, payload)
        return True

    def _invoke_on_ui(self, callback):
        if Func is None or Object is None:
            return callback()
        native_window = getattr(self._window, "native", None) if self._window is not None else None
        if native_window is None:
            return callback()
        if native_window.InvokeRequired:
            return native_window.Invoke(Func[Object](callback))
        return callback()

    def _get_native_webview(self):
        if self._window is None:
            return None
        native_window = getattr(self._window, "native", None)
        browser = getattr(native_window, "browser", None) if native_window is not None else None
        return getattr(browser, "webview", None) if browser is not None else None

    def _run_js(self, script, expect_result=False):
        if self._window is None:
            return None
        if expect_result:
            return self._window.evaluate_js(script)
        self._window.run_js(script)
        return None

    def _set_clipboard_text(self, text):
        value = str(text or "")

        def _write():
            try:
                if value:
                    WinForms.Clipboard.SetText(value)
                else:
                    WinForms.Clipboard.Clear()
                return True
            except Exception:
                return False

        return bool(self._invoke_on_ui(_write))

    def _get_clipboard_text(self):
        def _read():
            try:
                if WinForms.Clipboard.ContainsText():
                    return WinForms.Clipboard.GetText()
            except Exception:
                return ""
            return ""

        return str(self._invoke_on_ui(_read) or "")

    def _clipboard_has_text(self):
        def _has_text():
            try:
                return WinForms.Clipboard.ContainsText()
            except Exception:
                return False

        return bool(self._invoke_on_ui(_has_text))

    def _sanitize_context_payload(self, payload):
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return None

        if not isinstance(payload, dict):
            return None

        pos = payload.get("pos") or {}
        context = payload.get("context") or {}

        try:
            x = max(0, int(round(float(pos.get("x", 0)))))
            y = max(0, int(round(float(pos.get("y", 0)))))
        except Exception:
            return None

        selection_text = str(context.get("selectionText") or "")
        if len(selection_text) > 4000:
            selection_text = selection_text[:4000]

        link_href = str(context.get("linkHref") or "").strip()

        return {
            "pos": {"x": x, "y": y},
            "context": {
                "tag_name": str(context.get("tagName") or "").strip().upper(),
                "element_id": str(context.get("id") or "").strip(),
                "class_name": str(context.get("className") or "").strip(),
                "is_editable": bool(context.get("isEditable")),
                "is_text_input": bool(context.get("isTextInput")),
                "input_type": str(context.get("inputType") or "").strip().lower(),
                "selection_text": selection_text,
                "link_href": link_href,
                "seat_stage": bool(context.get("seatStage")),
                "custom_menu": bool(context.get("customMenu")),
            },
        }

    def _resolve_screen_point(self, x, y):
        if WinForms is None or Point is None:
            return None
        webview_control = self._get_native_webview()
        if webview_control is None:
            return WinForms.Cursor.Position

        try:
            client_point = Point(int(round(x)), int(round(y)))
            return webview_control.PointToScreen(client_point)
        except Exception:
            return WinForms.Cursor.Position

    def _get_candidate_web_points(self, x, y):
        native_window = getattr(self._window, "native", None) if self._window is not None else None
        try:
            scale_factor = float(getattr(native_window, "scale_factor", 1) or 1) if native_window is not None else 1
        except Exception:
            scale_factor = 1

        if scale_factor <= 0:
            scale_factor = 1

        candidates = []
        for px, py in (
            (x, y),
            (x / scale_factor, y / scale_factor),
            (x * scale_factor, y * scale_factor),
        ):
            point = (
                max(0, int(round(float(px)))),
                max(0, int(round(float(py)))),
            )
            if point not in candidates:
                candidates.append(point)

        return candidates

    def _dispatch_page_context_menu(self, points):
        serialized_points = json.dumps(
            [{"x": int(x), "y": int(y)} for x, y in points],
            ensure_ascii=False,
        )
        script = f"""
(() => {{
    const points = {serialized_points};
    for (const point of points) {{
        const x = Number(point.x) || 0;
        const y = Number(point.y) || 0;
        const target = document.elementFromPoint(x, y);
        const pageManaged = !!(
            target &&
            target.closest &&
            (target.closest('.seat') || target.closest('.context-menu'))
        );

        if (pageManaged) {{
            const detail = {{ x, y, handled: false }};
            document.dispatchEvent(new CustomEvent('fuckseats:windows-contextmenu', {{ detail }}));
            return !!detail.handled;
        }}
    }}

    return false;
}})();
""".strip()

        try:
            return bool(self._run_js(script, expect_result=True))
        except Exception:
            return False

    def _build_payload_from_context_menu_target(self, x, y, target):
        link_href = ""
        selection_text = ""
        tag_name = ""

        try:
            if bool(getattr(target, "HasLinkUri", False)):
                link_href = str(getattr(target, "LinkUri", "") or "").strip()
        except Exception:
            link_href = ""

        try:
            if bool(getattr(target, "HasSelection", False)):
                selection_text = str(getattr(target, "SelectionText", "") or "")
        except Exception:
            selection_text = ""

        try:
            tag_name = str(getattr(target, "Kind", "") or "").strip().upper()
        except Exception:
            tag_name = ""

        return {
            "pos": {"x": int(x), "y": int(y)},
            "context": {
                "tag_name": tag_name,
                "element_id": "",
                "class_name": "",
                "is_editable": bool(getattr(target, "IsEditable", False)),
                "is_text_input": False,
                "input_type": "",
                "selection_text": selection_text[:4000],
                "link_href": link_href,
                "seat_stage": False,
                "custom_menu": False,
            },
        }

    def _build_editable_action_script(self, x, y, action, text=""):
        return f"""
(function () {{
    const EDITABLE_SELECTOR = [
        'textarea',
        'input:not([type="button"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"])',
        '[contenteditable]',
        '[contenteditable="true"]',
        '[contenteditable=""]'
    ].join(',');

    const source = document.elementFromPoint({int(x)}, {int(y)});
    const target = source && source.closest ? source.closest(EDITABLE_SELECTOR) : null;
    if (!target) {{
        return false;
    }}

    try {{
        if (typeof target.focus === 'function') {{
            target.focus({{ preventScroll: true }});
        }}
    }} catch (_) {{}}

    const action = {json.dumps(str(action), ensure_ascii=False)};
    const value = {json.dumps(str(text or ""), ensure_ascii=False)};

    const dispatchInputEvents = () => {{
        try {{
            target.dispatchEvent(new InputEvent('input', {{ bubbles: true, data: value, inputType: 'insertText' }}));
        }} catch (_) {{
            target.dispatchEvent(new Event('input', {{ bubbles: true }}));
        }}
        try {{
            target.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }} catch (_) {{}}
    }};

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {{
        const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
        const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;

        if (action === 'select_all') {{
            target.select();
            return true;
        }}

        if (action === 'delete_selection') {{
            if (end <= start) {{
                return false;
            }}
            target.setRangeText('', start, end, 'end');
            dispatchInputEvents();
            return true;
        }}

        if (action === 'paste_text') {{
            target.setRangeText(value, start, end, 'end');
            dispatchInputEvents();
            return true;
        }}

        return false;
    }}

    if (!target.isContentEditable) {{
        return false;
    }}

    const selection = window.getSelection();
    if (!selection) {{
        return false;
    }}

    if (action === 'select_all') {{
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    }}

    if (selection.rangeCount === 0) {{
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection.addRange(range);
    }}

    if (action === 'delete_selection') {{
        document.execCommand('delete', false);
        dispatchInputEvents();
        return true;
    }}

    if (action === 'paste_text') {{
        document.execCommand('insertText', false, value);
        dispatchInputEvents();
        return true;
    }}

    return false;
}})();
""".strip()

    def _paste_clipboard_text(self, x, y):
        text = self._get_clipboard_text()
        if not text:
            return False
        script = self._build_editable_action_script(x, y, "paste_text", text)
        return bool(self._run_js(script, expect_result=True))

    def _delete_selection_at_point(self, x, y):
        script = self._build_editable_action_script(x, y, "delete_selection")
        return bool(self._run_js(script, expect_result=True))

    def _select_all_at_point(self, x, y):
        script = self._build_editable_action_script(x, y, "select_all")
        return bool(self._run_js(script, expect_result=True))

    def _reload_current_page(self):
        try:
            self._run_js("window.location.reload();")
            return True
        except Exception:
            return False

    def _open_current_page_in_browser(self):
        current_url = ""
        try:
            if self._window is not None:
                current_url = str(self._window.get_current_url() or "").strip()
        except Exception:
            current_url = ""

        target_url = current_url or self._server_origin
        if not target_url:
            return False

        try:
            webbrowser.open(target_url)
            return True
        except Exception:
            return False

    def _close_active_context_menu(self):
        def _close():
            menu = self._active_context_menu
            if menu is None:
                return False
            try:
                menu.Close()
            except Exception:
                pass
            try:
                menu.Dispose()
            except Exception:
                pass
            self._active_context_menu = None
            return True

        return bool(self._invoke_on_ui(_close))

    def _show_webview_context_menu(self, args, x, y):
        if WinForms is None:
            return False

        def _show():
            self._close_active_context_menu()

            menu = WinForms.ContextMenuStrip()
            self._active_context_menu = menu

            def create_menu_item(source_item):
                kind = str(getattr(source_item, "Kind", "") or "")
                if kind == "Separator":
                    return WinForms.ToolStripSeparator()

                label = str(getattr(source_item, "Label", "") or "").replace("&", "")
                item = WinForms.ToolStripMenuItem(label)
                item.Enabled = bool(getattr(source_item, "IsEnabled", True))

                shortcut = str(getattr(source_item, "ShortcutKeyDescription", "") or "").strip()
                if shortcut:
                    item.ShortcutKeyDisplayString = shortcut

                if kind in {"CheckBox", "Radio"}:
                    item.CheckOnClick = False
                    item.Checked = bool(getattr(source_item, "IsChecked", False))

                if kind == "Submenu":
                    for child in list(getattr(source_item, "Children", []) or []):
                        child_item = create_menu_item(child)
                        if child_item is not None:
                            item.DropDownItems.Add(child_item)
                    return item

                command_id = int(getattr(source_item, "CommandId", 0) or 0)

                def _on_click(*_):
                    try:
                        args.SelectedCommandId = command_id
                    finally:
                        try:
                            menu.Close()
                        except Exception:
                            pass

                item.Click += _on_click
                return item

            for source_item in list(getattr(args, "MenuItems", []) or []):
                created = create_menu_item(source_item)
                if created is not None:
                    menu.Items.Add(created)

            if menu.Items.Count == 0:
                self._active_context_menu = None
                try:
                    menu.Dispose()
                except Exception:
                    pass
                return False

            def _on_closed(*_):
                try:
                    menu.Dispose()
                except Exception:
                    pass
                if self._active_context_menu is menu:
                    self._active_context_menu = None

            menu.Closed += _on_closed
            screen_point = self._resolve_screen_point(x, y)
            if screen_point is None:
                screen_point = WinForms.Cursor.Position
            menu.Show(screen_point.X, screen_point.Y)
            return True

        return bool(self._invoke_on_ui(_show))

    def _handle_native_context_menu_requested(self, sender, args):
        try:
            location = getattr(args, "Location", None)
            raw_x = int(getattr(location, "X", 0) or 0)
            raw_y = int(getattr(location, "Y", 0) or 0)
            candidate_points = self._get_candidate_web_points(raw_x, raw_y)
            x, y = candidate_points[0]
            deferral = args.GetDeferral()
            args.Handled = True

            target = getattr(args, "ContextMenuTarget", None)
            self._debug_context_menu("native-requested", {
                "raw": {"x": raw_x, "y": raw_y},
                "candidates": [{"x": px, "y": py} for px, py in candidate_points],
                "is_editable": bool(getattr(target, "IsEditable", False)) if target is not None else False,
                "has_selection": bool(getattr(target, "HasSelection", False)) if target is not None else False,
                "has_link": bool(getattr(target, "HasLinkUri", False)) if target is not None else False,
                "kind": str(getattr(target, "Kind", "") or "") if target is not None else "",
                "menu_items": len(list(getattr(args, "MenuItems", []) or [])),
            })

            page_handled = self._dispatch_page_context_menu(candidate_points)
            self._debug_context_menu("native-dispatch-page", {
                "handled": bool(page_handled),
                "points": [{"x": px, "y": py} for px, py in candidate_points],
            })
            if page_handled:
                deferral.Complete()
                return

            shown = self._show_webview_context_menu(args, x, y)
            self._debug_context_menu("native-show-webview-menu", {
                "shown": bool(shown),
                "point": {"x": x, "y": y},
            })
            if not shown:
                deferral.Complete()
                return

            active_menu = self._active_context_menu
            if active_menu is None:
                self._debug_context_menu("native-active-menu", {"exists": False})
                deferral.Complete()
                return

            def _complete(*_):
                try:
                    self._debug_context_menu("native-menu-closed", {"point": {"x": x, "y": y}})
                    deferral.Complete()
                except Exception:
                    pass

            active_menu.Closed += _complete
        except Exception:
            try:
                args.Handled = True
            except Exception:
                pass

    def _register_native_context_menu_requested_handler(self):
        if not sys.platform.startswith("win") or self._window is None or Func is None:
            return False

        webview_control = self._get_native_webview()
        if webview_control is None:
            return False

        def _install():
            core = getattr(webview_control, "CoreWebView2", None)
            if core is None:
                return False

            try:
                core.Settings.AreDefaultContextMenusEnabled = True
            except Exception:
                pass

            if self._windows_context_menu_requested_handler is None:
                self._windows_context_menu_requested_handler = self._handle_native_context_menu_requested
                core.ContextMenuRequested += self._windows_context_menu_requested_handler

            return True

        installed = bool(self._invoke_on_ui(_install))
        if installed:
            return True

        if self._windows_context_menu_init_handler is None:
            def _handle_initialized(sender, args):
                if getattr(args, "IsSuccess", False):
                    self._register_native_context_menu_requested_handler()

            self._windows_context_menu_init_handler = _handle_initialized
            webview_control.CoreWebView2InitializationCompleted += self._windows_context_menu_init_handler

        return False

    def _inject_windows_context_menu_script(self, *_):
        if not sys.platform.startswith("win") or self._window is None:
            return False

        try:
            self._run_js(WINDOWS_CONTEXT_MENU_BRIDGE_SCRIPT)
            return True
        except Exception:
            return False

    def _register_windows_context_document_script(self):
        if not sys.platform.startswith("win") or self._window is None or Func is None:
            return False

        if self._windows_context_document_script_registered:
            return True

        webview_control = self._get_native_webview()
        if webview_control is None:
            return False

        def _install():
            core = getattr(webview_control, "CoreWebView2", None)
            if core is None:
                return False

            try:
                core.Settings.AreDefaultContextMenusEnabled = False
            except Exception:
                pass

            core.AddScriptToExecuteOnDocumentCreatedAsync(WINDOWS_CONTEXT_MENU_BRIDGE_SCRIPT)
            self._windows_context_document_script_registered = True
            return True

        installed = bool(self._invoke_on_ui(_install))
        if installed:
            return True

        if self._windows_context_init_handler is None:
            def _handle_initialized(sender, args):
                if getattr(args, "IsSuccess", False):
                    self._register_windows_context_document_script()
                    if self._window is not None and self._window.events.loaded.is_set():
                        self._inject_windows_context_menu_script()

            self._windows_context_init_handler = _handle_initialized
            webview_control.CoreWebView2InitializationCompleted += self._windows_context_init_handler

        return False

    def _enable_windows_context_menu_bridge(self, wait_timeout=20):
        if not sys.platform.startswith("win") or self._window is None or WinForms is None:
            return False

        if not self._window.events.shown.wait(wait_timeout):
            return False

        if self._register_native_context_menu_requested_handler():
            return True

        if not self._windows_context_loaded_hook_registered:
            self._window.events.loaded += self._inject_windows_context_menu_script
            self._windows_context_loaded_hook_registered = True

        self._register_windows_context_document_script()

        if self._window.events.loaded.wait(wait_timeout):
            self._inject_windows_context_menu_script()

        return True

    def handle_windows_context_menu(self, payload):
        if not sys.platform.startswith("win") or WinForms is None:
            return {"status": "ignored", "reason": "platform"}

        normalized = self._sanitize_context_payload(payload)
        if not normalized:
            return {"status": "ignored", "reason": "payload"}

        context = normalized["context"]
        if context["seat_stage"] or context["custom_menu"]:
            handled = self._dispatch_page_context_menu([(normalized["pos"]["x"], normalized["pos"]["y"])])
            return {"status": "page" if handled else "ignored"}

        return {"status": "ignored", "reason": "native-handler"}

    def _download_export(self, export_url):
        target_url = resolve_local_export_url(self._server_origin, export_url)
        request = urllib.request.Request(
            target_url,
            method="GET",
            headers={
                "User-Agent": "FuckSeats Desktop",
                "X-Requested-With": "pywebview",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise ValueError(f"导出失败（{status}）")
                return {
                    "content": response.read(),
                    "content_disposition": response.headers.get("Content-Disposition", ""),
                }
        except urllib.error.HTTPError as exc:
            raise ValueError(f"导出失败（{exc.code}）") from exc
        except urllib.error.URLError as exc:
            raise ValueError(f"无法连接本地导出服务：{exc.reason}") from exc

    def _show_save_dialog(self, suggested_filename, accept_mime, accept_extensions):
        if self._window is None:
            raise RuntimeError("桌面窗口尚未准备完成")

        import webview

        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            directory=self._last_export_dir,
            save_filename=suggested_filename,
            file_types=build_file_dialog_types(accept_mime, accept_extensions),
        )

        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else ""
        return str(result)

    def _show_open_dialog(self, file_types=()):
        if self._window is None:
            raise RuntimeError("桌面窗口尚未准备完成")

        import webview

        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            directory=self._last_import_dir,
            allow_multiple=False,
            file_types=file_types or (),
        )

        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else ""
        return str(result)

    def select_macos_update_package(self):
        if sys.platform != "darwin":
            raise RuntimeError("本地 PKG 更新仅支持 macOS")
        selected_path = self._show_open_dialog(("macOS 安装包 (*.pkg)",))
        if not selected_path:
            return {"status": "cancelled"}
        source_path = Path(selected_path).expanduser()
        if source_path.is_symlink() or not source_path.is_file():
            return {"status": "error", "message": "选择的升级包不存在或不是普通文件"}
        if source_path.suffix.lower() != ".pkg":
            return {"status": "error", "message": "请选择 .pkg 格式的 macOS 升级包"}
        self._last_import_dir = str(source_path.parent)
        return {
            "status": "selected",
            "filename": source_path.name,
            "path": str(source_path.resolve()),
            "size": source_path.stat().st_size,
        }

    def save_export(self, export_url, suggested_filename="", accept_mime="", accept_extensions=None):
        with self._save_lock:
            exported = self._download_export(export_url)

            header_filename = parse_content_disposition_filename(exported["content_disposition"])
            fallback_filename = infer_filename_from_url(export_url)
            dialog_filename = sanitize_filename(header_filename or suggested_filename or fallback_filename)
            normalized_exts = normalize_accept_extensions(accept_extensions, dialog_filename)

            selected_path = self._show_save_dialog(dialog_filename, accept_mime, normalized_exts)
            if not selected_path:
                return {
                    "status": "cancelled",
                    "filename": dialog_filename,
                }

            final_path = ensure_allowed_extension(selected_path, normalized_exts)
            target_path = Path(final_path).expanduser()
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(exported["content"])
            self._last_export_dir = str(target_path.parent)

            return {
                "status": "saved",
                "filename": target_path.name,
                "path": str(target_path),
            }

    def _upload_selected_file(self, upload_url, csrf_token="", field_name="file", accept_extensions=None):
        with self._import_lock:
            normalized_exts = normalize_accept_extensions(accept_extensions)
            selected_path = self._show_open_dialog()
            if not selected_path:
                return {"status": "cancelled"}

            source_path = Path(selected_path).expanduser()
            if not source_path.exists() or not source_path.is_file():
                return {"status": "error", "message": "选择的文件不存在"}
            if not is_allowed_extension(source_path, normalized_exts):
                display_exts = " / ".join(normalized_exts) if normalized_exts else "有效"
                return {"status": "error", "message": f"请选择 {display_exts} 文件"}

            target_url = resolve_local_export_url(self._server_origin, upload_url)
            content = source_path.read_bytes()
            content_type = mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
            fields = {}
            csrf_value = str(csrf_token or "").strip()
            if csrf_value:
                fields["csrfmiddlewaretoken"] = csrf_value
            boundary, body = build_multipart_form_data(
                fields=fields,
                files=[
                    {
                        "field_name": field_name or "file",
                        "filename": source_path.name,
                        "content_type": content_type,
                        "content": content,
                    }
                ],
            )
            headers = {
                "User-Agent": "FuckSeats Desktop",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            }
            if csrf_value:
                headers["X-CSRFToken"] = csrf_value
                headers["Cookie"] = f"csrftoken={urllib.parse.quote(csrf_value)}"

            request = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method="POST",
            )

            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    status = getattr(response, "status", 200)
                    if status >= 400:
                        raise ValueError(f"导入失败（{status}）")
                    raw_response = response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as exc:
                error_payload = None
                try:
                    error_body = exc.read().decode("utf-8", errors="replace")
                    error_payload = json.loads(error_body)
                except Exception:
                    pass
                if isinstance(error_payload, dict):
                    raise ValueError(error_payload.get("message") or f"导入失败（{exc.code}）") from exc
                raise ValueError(f"导入失败（{exc.code}）") from exc
            except urllib.error.URLError as exc:
                raise ValueError(f"无法连接本地导入服务：{exc.reason}") from exc

            self._last_import_dir = str(source_path.parent)
            result = {
                "status": "imported",
                "filename": source_path.name,
                "path": str(source_path),
            }
            try:
                response_payload = json.loads(raw_response) if raw_response else None
            except Exception:
                response_payload = None
            if isinstance(response_payload, dict):
                result["response"] = response_payload
                if response_payload.get("status"):
                    result["status"] = response_payload.get("status")
                if response_payload.get("message"):
                    result["message"] = response_payload.get("message")
            return result

    def upload_local_file(self, upload_url, csrf_token="", field_name="file", accept_extensions=None):
        return self._upload_selected_file(upload_url, csrf_token, field_name, accept_extensions)

    def import_seats_file(self, import_url, csrf_token="", accept_extensions=None):
        normalized_exts = normalize_accept_extensions(accept_extensions) or [".seats", ".json"]
        return self._upload_selected_file(import_url, csrf_token, "seats_file", normalized_exts)
