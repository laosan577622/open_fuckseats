import os
import sys
from django.core.management import call_command
from waitress import serve

def main():
    # Setup Django environment
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    
    import django
    django.setup()
    
    from config.wsgi import application
    
    print("准备迁移数据库...", flush=True)
    try:
        call_command('migrate', interactive=False)
        print("迁移数据库成功。", flush=True)
    except Exception as e:
        print(f"数据库迁移出错: {e}", file=sys.stderr, flush=True)


    PORT = 23948
    print(f"正在启动服务器 http://127.0.0.1:23948 ...", flush=True)
    print("服务器已启动，请使用浏览器打开 http://127.0.0.1:23948 访问\n在使用期间，请不要关闭本窗口。", flush=True)
    serve(application, host='127.0.0.1', port=PORT)

if __name__ == '__main__':
    main()
   