"""Disposable exam UI fixture. Run with .venv/bin/python scripts/preview_exam.py."""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    with TemporaryDirectory(prefix='fuckseats-exam-qa-') as directory:
        os.environ['FUCKSEATS_DATABASE_PATH'] = str(Path(directory) / 'preview.sqlite3')
        os.environ['FUCKSEATS_DISABLE_DATABASE_ENCRYPTION'] = '1'
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
        import django
        django.setup()
        from django.core.management import call_command
        from django.core.wsgi import get_wsgi_application
        from django.contrib.staticfiles.handlers import StaticFilesHandler
        from seats.models import Classroom, Student
        from waitress import serve
        call_command('migrate', verbosity=0)
        room = Classroom.objects.create(name='考场演示 · 56 桌', rows=7, cols=11,
            doors=[{'id': 'front', 'name': '前门', 'corner': 'front_left', 'offset': 0}])
        room.seats.filter(col__in=(3, 6, 9)).update(cell_type='aisle')
        for i, seat in enumerate(room.seats.filter(cell_type='seat')):
            seat.student = Student.objects.create(classroom=room, name=f'同学{i + 1:02}')
            seat.save(update_fields=['student'])
        print(f'http://127.0.0.1:23949/classroom/{room.pk}/exam/', flush=True)
        serve(StaticFilesHandler(get_wsgi_application()), host='127.0.0.1', port=23949, threads=4)


if __name__ == '__main__':
    main()
