"""Measure exam planning scenarios for the website. Run: .venv/bin/python scripts/exam_benchmarks.py"""
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

from seats.exam_planner import plan_exam, plan_restore, target_snapshot  # noqa: E402

OUTPUT = ROOT / 'website' / 'src' / 'preview3-exam.json'


def classroom(rows, cols, aisles=()):
    return {'classroom': {'rows': rows, 'cols': cols, 'doors': [
        {'id': 'front', 'name': '前门', 'corner': 'front_left'},
        {'id': 'back', 'name': '后门', 'corner': 'front_right'}]},
        'seats': [{'row': r, 'col': c, 'cell_type': 'aisle' if c in aisles else 'seat',
                   'student_name': f'{r}-{c}'}
                  for r in range(1, rows + 1) for c in range(1, cols + 1)]}


SCENARIOS = [
    ('row_to_column_128', '128 桌，单行改单列', classroom(1, 128), 128, 1),
    ('wide_1536', '1,536 桌，12 列改 128 组', classroom(128, 12), 12, 128),
    ('class_56_to_42', '56 桌班级，改 6 组 × 7 排', classroom(7, 11, (3, 6, 9)), 7, 6),
    ('class_56_to_30', '56 桌班级，改 6 组 × 5 排', classroom(7, 11, (3, 6, 9)), 5, 6),
]


def main():
    results = []
    for key, label, source, rows, cols in SCENARIOS:
        started = time.monotonic()
        plan = plan_exam(source, rows, cols)
        elapsed = time.monotonic() - started
        restored = plan_restore(target_snapshot(source, plan), source, plan)
        metrics = plan['metrics']
        original = metrics['original']
        results.append({
            'case': key, 'label': label, 'original': original, 'target': metrics['target'],
            'carried': metrics['carried'], 'minimum_carried': metrics['minimum_carried'],
            'untouched': original - metrics['carried'] if original >= metrics['target'] else metrics['target'] - metrics['carried'],
            'restore_carried': restored['metrics']['carried'],
            'serial_duration': plan['scheduling']['baseline_duration'],
            'duration': metrics['duration'], 'planning_seconds': round(elapsed, 3),
        })
    OUTPUT.write_text(json.dumps({'measured_at': time.strftime('%Y-%m-%d'), 'scenarios': results},
                                 ensure_ascii=False, indent=2) + '\n')
    for row in results:
        print(row)


if __name__ == '__main__':
    main()
