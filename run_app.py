import os
import sys
from io import StringIO
from django.core.management import call_command
from waitress import serve


def _filter_migration_noise(text):
    lines = (text or '').splitlines()
    filtered = []
    skip_next = False

    for line in lines:
        current = (line or '').strip()

        if skip_next:
            if "Run 'manage.py makemigrations' to make new migrations" in current:
                skip_next = False
                continue
            skip_next = False

        if "Your models in app(s):" in current and "have changes that are not yet reflected in a migration" in current:
            skip_next = True
            continue

        filtered.append(line)

    return '\n'.join(filtered).strip()


def main():
    # Setup Django environment
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    
    import django
    django.setup()
    
    from config.wsgi import application
    
    print("准备迁移数据库...", flush=True)
    try:
        migrate_stdout = StringIO()
        migrate_stderr = StringIO()
        call_command(
            'migrate',
            interactive=False,
            stdout=migrate_stdout,
            stderr=migrate_stderr,
        )
        stdout_text = _filter_migration_noise(migrate_stdout.getvalue())
        stderr_text = _filter_migration_noise(migrate_stderr.getvalue())
        if stdout_text:
            print(stdout_text, flush=True)
        if stderr_text:
            print(stderr_text, file=sys.stderr, flush=True)
        print("迁移数据库成功。", flush=True)
    except Exception as e:
        print(f"数据库迁移出错: {e}", file=sys.stderr, flush=True)


    PORT = 23948
    print(f"正在启动服务器 http://127.0.0.1:23948 ...", flush=True)
    print("服务器已启动，请使用浏览器打开 http://127.0.0.1:23948 访问\n在使用期间，请不要关闭本窗口。", flush=True)
    serve(application, host='127.0.0.1', port=PORT)

if __name__ == '__main__':
    main()
   
