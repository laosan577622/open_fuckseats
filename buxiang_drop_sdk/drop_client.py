"""Local Drop SDK. Standard library only; teacher credentials stay in the teacher app."""
from dataclasses import dataclass
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import time
import uuid

FINAL_STATES = frozenset(('succeeded', 'failed', 'cancelled'))
SEATS_FIELDS = frozenset(('show_title', 'show_podium', 'show_coords', 'show_name',
                         'show_score', 'show_group', 'show_empty_label', 'show_seat_type'))


def _validate_filename(filename):
    if (not isinstance(filename, str) or not filename or len(filename.encode('utf-16-le')) // 2 > 150
            or filename.endswith(('.', ' ')) or re.search(r'[<>:"/\\|?*\x00-\x1f]', filename)
            or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', filename, re.I)):
        raise ValueError('文件名不正确')


def _validate_options(options):
    if not isinstance(options, dict): raise ValueError('显示选项必须是字典')
    for key, value in options.items():
        if key == 'theme' and value in ('classic', 'minimal', 'contrast'): continue
        if key not in SEATS_FIELDS or type(value) is not bool: raise ValueError('座次图显示选项不正确')


def _write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False)
    temporary.replace(path)


@dataclass(frozen=True)
class DropTicket:
    id: str
    request_path: Path
    result_path: Path

    def status(self):
        try:
            with self.result_path.open(encoding='utf-8-sig') as stream:
                value = json.load(stream)
        except FileNotFoundError:
            return dict(version=1, id=self.id, state='pending')
        if not isinstance(value, dict) or value.get('id') != self.id:
            raise ValueError('教师端返回的投送记录不正确')
        return value

    def wait(self, timeout=600, poll_interval=0.2):
        if timeout <= 0 or poll_interval <= 0:
            raise ValueError('等待时间必须大于 0')
        deadline = time.monotonic() + timeout
        while True:
            result = self.status()
            if result.get('state') in FINAL_STATES:
                return result
            if time.monotonic() >= deadline:
                raise TimeoutError('等待教师操作或接收完成超时；投送不会因此自动取消')
            time.sleep(min(poll_interval, max(0, deadline - time.monotonic())))


class DropClient:
    def __init__(self, executable=None, *, source='本地应用', data_dir=None, launch_args=()):
        local = os.environ.get('LOCALAPPDATA')
        if data_dir is None and not local:
            raise RuntimeError('当前环境没有 Windows LOCALAPPDATA，请指定 data_dir')
        self.data_dir = Path(data_dir or Path(local) / 'Laosan' / 'BuxiangTeacher').resolve()
        self.directory = self.data_dir / 'DropRequests'
        self.executable = Path(executable).resolve() if executable else None
        self.source = str(source).strip()
        if not self.source or len(self.source) > 80 or any(ord(ch) < 32 for ch in self.source):
            raise ValueError('来源应用名称不正确')
        self.launch_args = tuple(str(arg) for arg in launch_args)
        self._custom_data = data_dir is not None

    def _find_executable(self):
        if self.executable:
            if not self.executable.is_file(): raise FileNotFoundError('未找到指定的教师端程序')
            return self.executable
        candidates = []
        registered = set()
        if os.name == 'nt':
            import winreg
            for hive, key, name in (
                (winreg.HKEY_CURRENT_USER, r'Software\Laosan\BuxiangTeacher', 'dropExecutable'),
                (winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\App Paths\BuxiangTeacher.exe', ''),
                (winreg.HKEY_LOCAL_MACHINE, r'Software\Microsoft\Windows\CurrentVersion\App Paths\BuxiangTeacher.exe', ''),
            ):
                try:
                    with winreg.OpenKey(hive, key) as handle:
                        candidate = Path(winreg.QueryValueEx(handle, name)[0])
                        if name == 'dropExecutable':
                            if int(winreg.QueryValueEx(handle, 'dropVersion')[0]) < 1: continue
                            registered.add(candidate.resolve())
                        candidates.append(candidate)
                except (OSError, ValueError, TypeError): pass
        found = shutil.which('BuxiangTeacher.exe')
        if found: candidates.append(Path(found))
        candidates.append(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'BuxiangClass/teacher/BuxiangTeacher.exe')
        project = Path(__file__).resolve().parent.parent
        candidates.extend((project / 'dist/buxiang-teacher-windows-x64/BuxiangTeacher.exe', project / 'build/teacher/BuxiangTeacher.exe'))
        for candidate in candidates:
            if not candidate.is_file(): continue
            if candidate.resolve() in registered: return candidate.resolve()
            try:
                manifest = json.loads((candidate.parent / 'RELEASE.json').read_text(encoding='utf-8-sig'))
                if isinstance(manifest, dict) and manifest.get('product') == 'BuxiangTeacher' and manifest.get('dropSdk', 0) >= 1:
                    return candidate.resolve()
            except (OSError, ValueError, TypeError): pass
            if candidate == project / 'build/teacher/BuxiangTeacher.exe' and (project / 'teacher-desktop/src/drop_session.cpp').is_file():
                return candidate.resolve()
        raise FileNotFoundError('未找到支持 Drop 的教师端，请安装或运行一次新版不想班管教师端，或指定 executable')

    def _submit(self, path, *, identity=None, filename=None, options=None, room_id=None):
        file = Path(path).expanduser().resolve(strict=True)
        if not file.is_file(): raise ValueError('投送路径必须是文件')
        filename = file.name if filename is None else filename
        options = {} if options is None else options
        _validate_filename(filename)
        _validate_options(options)
        if room_id is not None and not isinstance(room_id, str): raise ValueError('教室编号必须是字符串')
        identity = identity or str(uuid.uuid4())
        self.directory.mkdir(parents=True, exist_ok=True)
        request = self.directory / (identity + '.json')
        result = self.directory / (identity + '.result.json')
        value = dict(version=1, id=identity, file=str(file), filename=filename,
                     source=self.source, options=options, room_id=room_id or '')
        # Resolve the application before writing a pending request.
        executable = self._find_executable()
        _write_json(request, value)
        args = [str(executable), *self.launch_args]
        if self._custom_data: args.extend(('--profile-dir', str(self.data_dir), '--no-register-protocol'))
        args.extend(('--drop-request', str(request)))
        try:
            subprocess.Popen(args, cwd=executable.parent, shell=False, close_fds=True,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except OSError:
            _write_json(result, dict(version=1, id=identity, state='failed', result='无法启动教师端'))
            raise
        return DropTicket(identity, request, result)

    def send_file(self, path, *, options=None, room_id=None):
        return self._submit(path, options=options, room_id=room_id)

    def send_seats(self, document, *, filename='班级.seats', options=None, room_id=None):
        if isinstance(document, (str, os.PathLike)):
            if Path(document).suffix.lower() != '.seats': raise ValueError('座次图文件名必须以 .seats 结尾')
            return self.send_file(document, options=options, room_id=room_id)
        if not isinstance(document, dict): raise ValueError('座次图必须是文件路径或字典')
        _validate_filename(filename)
        if not filename.lower().endswith('.seats'): raise ValueError('座次图文件名必须以 .seats 结尾')
        self._find_executable()
        identity = str(uuid.uuid4())
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / (identity + '.seats')
        _write_json(path, document)
        return self._submit(path, identity=identity, filename=filename, options=options, room_id=room_id)

    def send_content(self, content, *, filename='教师投送.txt', room_id=None):
        _validate_filename(filename)
        self._find_executable()
        identity = str(uuid.uuid4())
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / (identity + '.content')
        if isinstance(content, str): path.write_text(content, encoding='utf-8')
        elif isinstance(content, bytes): path.write_bytes(content)
        else: _write_json(path, content)
        return self._submit(path, identity=identity, filename=filename, room_id=room_id)
