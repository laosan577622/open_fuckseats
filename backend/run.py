import os
import sys
import logging
from io import StringIO

from django.core.management import call_command, execute_from_command_line


def _is_dev_mode(argv):
    return any(arg in {'-dev', '--dev'} for arg in argv[1:])


def _run_migrations():
    stdout = StringIO()
    stderr = StringIO()
    call_command('migrate', interactive=False, stdout=stdout, stderr=stderr)


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    logging.getLogger('waitress').setLevel(logging.ERROR)

    from cloud.config import get_config

    config = get_config()
    port = int(os.getenv('PORT') or config.get('server', {}).get('port') or 8000)
    host = os.getenv('HOST') or config.get('server', {}).get('host') or '0.0.0.0'

    if _is_dev_mode(sys.argv):
        execute_from_command_line([sys.argv[0], 'runserver', f'{host}:{port}'])
        return

    import django
    django.setup()

    from waitress import serve
    from config.wsgi import application

    _run_migrations()
    print(f'云端后端启动：http://{host}:{port}', flush=True)
    serve(application, host=host, port=port)


if __name__ == '__main__':
    main()
