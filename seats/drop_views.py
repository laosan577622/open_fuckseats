"""Hand the current classroom to the local BuxiangTeacher native Drop UI."""
import ipaddress
import logging
import re
import sys
from urllib.parse import urlsplit

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from buxiang_drop_sdk import DropClient
from .models import Classroom
from .client_control import feature_gate

logger = logging.getLogger(__name__)


def _local_request(request):
    try:
        return (ipaddress.ip_address(request.META.get('REMOTE_ADDR', '')).is_loopback
                and urlsplit('http://' + request.get_host()).hostname in ('127.0.0.1', 'localhost', '::1'))
    except ValueError:
        return False


def _filename(name):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(name)).strip().rstrip('. ') or '班级'
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value, re.I): value = '班级_' + value
    return value.encode('utf-16-le')[:288].decode('utf-16-le', errors='ignore').rstrip('. ') + '.seats'


@require_POST
@feature_gate('drop')
def drop_classroom(request, pk):
    if not _local_request(request):
        return JsonResponse({'status': 'error', 'message': '请在本机的不想排座位中使用 Drop'}, status=403)
    classroom = get_object_or_404(Classroom, pk=pk)
    if not sys.platform.startswith('win'):
        return JsonResponse({'status': 'not_installed', 'message': '请先安装 Windows 版不想班管教师端，再使用 Drop。'})
    try:
        from .views import _serialize_seats_file_bundle
        document = _serialize_seats_file_bundle(classroom, history_limit=0,
                                                include_future_mode_config=False, include_ai_conversations=False)
        ticket = DropClient(source='不想排座位').send_seats(document, filename=_filename(classroom.name))
    except FileNotFoundError:
        return JsonResponse({'status': 'not_installed', 'message': '请先安装不想班管教师端（支持 Drop 的新版），安装后再点击 Drop。便携版请先运行一次教师端。'})
    except (OSError, RuntimeError, ValueError):
        logger.exception('无法打开本地教师端 Drop 窗口')
        return JsonResponse({'status': 'error', 'message': '无法唤起不想班管教师端，请确认安装后重试。'}, status=503)
    return JsonResponse({'status': 'success', 'request_id': ticket.id, 'message': '已打开不想班管教师端'})
