import base64
import json

from django.test import Client, TestCase

from seats.models import Classroom, FrontendKVStore, Seat, Student
from seats.open_api.auth import OPEN_API_STORE_KEY, get_or_create_open_api_key
from seats.open_api.ai_session import STORE_KEY as AI_SESSION_STORE_KEY
from seats.open_api.mcp import handle_mcp_message
from seats.open_api.realtime import STORE_KEY as REALTIME_STORE_KEY
from seats.open_api import ai_session, realtime


class OpenApiHttpTests(TestCase):
    def setUp(self):
        FrontendKVStore.objects.update_or_create(
            key=OPEN_API_STORE_KEY,
            defaults={'value': 'fks-test-open-api'},
        )
        self.client = Client(HTTP_AUTHORIZATION='Bearer fks-test-open-api')

    def post_tool(self, payload):
        return self.client.post(
            '/open_api/tools/execute',
            data=json.dumps(payload, ensure_ascii=False),
            content_type='application/json',
        )

    def test_requires_bearer_key(self):
        response = Client().get('/open_api')

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'UNAUTHORIZED')

    def test_discovery_and_classroom_read_endpoints(self):
        classroom = Classroom.objects.create(name='开放接口班', rows=2, cols=2)
        Student.objects.create(classroom=classroom, name='张三', student_id='S001', score=91)

        discovery = self.client.get('/open_api')
        self.assertEqual(discovery.status_code, 200)
        payload = discovery.json()
        self.assertEqual(payload['status'], 'ok')
        self.assertGreaterEqual(payload['tool_count'], 70)
        self.assertIn('move_student', payload['categories']['seating']['tools'])

        classrooms = self.client.get('/open_api/classrooms')
        self.assertEqual(classrooms.status_code, 200)
        self.assertEqual(classrooms.json()['classrooms'][0]['name'], '开放接口班')

        detail = self.client.get(f'/open_api/classrooms/{classroom.pk}')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['classroom']['id'], classroom.pk)

        enums = self.client.get(f'/open_api/classrooms/{classroom.pk}/enums')
        self.assertEqual(enums.status_code, 200)
        self.assertIn('score_balanced', [item['value'] for item in enums.json()['arrange_modes']])

    def test_execute_student_move_swap_export_and_delete_via_http(self):
        create_response = self.post_tool({
            'tool': 'create_classroom',
            'arguments': {'name': 'Agent 操作班', 'rows': 2, 'cols': 2},
        })
        self.assertEqual(create_response.status_code, 200)
        classroom_id = create_response.json()['result']['classroom']['id']

        add_response = self.post_tool({
            'tool': 'add_students_batch',
            'classroom_id': classroom_id,
            'arguments': {
                'students': [
                    {'name': '张三', 'student_id': 'S001', 'score': 90},
                    {'name': '李四', 'student_id': 'S002', 'score': 80},
                ],
            },
        })
        self.assertEqual(add_response.status_code, 200)
        self.assertEqual(add_response.json()['result']['count'], 2)

        for name, col in [('张三', 1), ('李四', 2)]:
            response = self.post_tool({
                'tool': 'move_student',
                'classroom_id': classroom_id,
                'arguments': {'student': name, 'row': 1, 'col': col},
            })
            self.assertEqual(response.status_code, 200, response.content)

        swap_response = self.post_tool({
            'tool': 'swap_students',
            'classroom_id': classroom_id,
            'arguments': {'student_a': '张三', 'student_b': '李四'},
        })
        self.assertEqual(swap_response.status_code, 200)

        seats_response = self.client.get(f'/open_api/classrooms/{classroom_id}/seats')
        self.assertEqual(seats_response.status_code, 200)
        self.assertEqual(seats_response.json()['matrix'][0][0]['student']['name'], '李四')

        export_response = self.post_tool({
            'tool': 'export_seats_file',
            'classroom_id': classroom_id,
            'arguments': {},
        })
        self.assertEqual(export_response.status_code, 200)
        raw = base64.b64decode(export_response.json()['result']['base64']).decode('utf-8')
        self.assertIn('Agent 操作班', raw)

        delete_response = self.post_tool({
            'tool': 'delete_classroom',
            'classroom_id': classroom_id,
            'arguments': {},
        })
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(Classroom.objects.filter(pk=classroom_id).exists())

    def test_batch_is_atomic_on_error(self):
        classroom = Classroom.objects.create(name='批量回滚班', rows=2, cols=2)
        Student.objects.create(classroom=classroom, name='张三', score=90)

        response = self.client.post(
            '/open_api/tools/batch',
            data=json.dumps({
                'classroom_id': classroom.pk,
                'operations': [
                    {'tool': 'rename_classroom', 'arguments': {'name': '不应保留'}},
                    {'tool': 'move_student', 'arguments': {'student': '不存在', 'row': 1, 'col': 1}},
                ],
            }, ensure_ascii=False),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        classroom.refresh_from_db()
        self.assertEqual(classroom.name, '批量回滚班')

    def test_tags_constraints_and_analysis_through_http(self):
        classroom = Classroom.objects.create(name='分析班', rows=2, cols=2)
        Student.objects.create(classroom=classroom, name='张三', score=95)

        tag_response = self.post_tool({
            'tool': 'create_tag',
            'classroom_id': classroom.pk,
            'arguments': {'name': '近视', 'color': '#0a59f7'},
        })
        self.assertEqual(tag_response.status_code, 200)

        assign_response = self.post_tool({
            'tool': 'assign_tag_to_student',
            'classroom_id': classroom.pk,
            'arguments': {'student': '张三', 'tag': '近视'},
        })
        self.assertEqual(assign_response.status_code, 200)

        constraint_response = self.post_tool({
            'tool': 'add_constraint',
            'classroom_id': classroom.pk,
            'arguments': {'constraint_type': 'must_row', 'student': '张三', 'row': 1},
        })
        self.assertEqual(constraint_response.status_code, 200, constraint_response.content)

        analysis_response = self.post_tool({
            'tool': 'analyze_seating',
            'classroom_id': classroom.pk,
            'arguments': {},
        })
        self.assertEqual(analysis_response.status_code, 200)
        self.assertIn('density', analysis_response.json()['result'])

    def test_write_tool_marks_page_and_classroom_refresh_signal(self):
        before = realtime.snapshot()['data_seq']

        with self.captureOnCommitCallbacks(execute=True):
            response = self.post_tool({
                'tool': 'create_classroom',
                'arguments': {'name': '首页刷新班', 'rows': 2, 'cols': 2},
            })

        self.assertEqual(response.status_code, 200)
        classroom_id = response.json()['result']['classroom']['id']
        status = Client().get('/api/ai-session/').json()
        rt = status['realtime']
        self.assertGreater(rt['data_seq'], before)
        self.assertGreater(rt['classroom_seq'][str(classroom_id)], 0)

    def test_status_reads_external_agent_shared_state(self):
        classroom = Classroom.objects.create(name='外部刷新班', rows=1, cols=1)
        current_rt = realtime.snapshot()
        current_session = ai_session.status()
        shared_rt = {
            'global_seq': current_rt['global_seq'] + 5,
            'data_seq': current_rt['data_seq'] + 3,
            'classroom_seq': {str(classroom.pk): 9},
            'last_classroom_id': classroom.pk,
        }
        FrontendKVStore.objects.update_or_create(
            key=REALTIME_STORE_KEY,
            defaults={'value': json.dumps(shared_rt, ensure_ascii=False)},
        )
        FrontendKVStore.objects.update_or_create(
            key=AI_SESSION_STORE_KEY,
            defaults={'value': json.dumps({
                'active': True,
                'task_id': 'external-agent',
                'message': '外部 agent 正在操作',
                'progress': 60,
                'started_at': 100.0,
                'updated_at': 101.0,
                'seq': current_session['seq'] + 7,
            }, ensure_ascii=False)},
        )

        response = Client().get('/api/ai-session/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['session']['task_id'], 'external-agent')
        self.assertEqual(payload['session']['progress'], 60)
        self.assertEqual(payload['realtime']['data_seq'], shared_rt['data_seq'])
        self.assertEqual(payload['realtime']['classroom_seq'][str(classroom.pk)], 9)


class OpenApiMcpTests(TestCase):
    def test_mcp_lists_and_calls_tools(self):
        init = handle_mcp_message({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}})
        self.assertEqual(init['result']['serverInfo']['name'], 'fuckseats')

        listed = handle_mcp_message({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
        tool_names = {tool['name'] for tool in listed['result']['tools']}
        self.assertIn('create_classroom', tool_names)
        self.assertIn('move_student', tool_names)

        called = handle_mcp_message({
            'jsonrpc': '2.0',
            'id': 3,
            'method': 'tools/call',
            'params': {
                'name': 'create_classroom',
                'arguments': {'name': 'MCP 操作班', 'rows': 1, 'cols': 1},
            },
        })
        self.assertFalse(called['result']['isError'])
        text_payload = json.loads(called['result']['content'][0]['text'])
        classroom_id = text_payload['result']['classroom']['id']
        self.assertTrue(Classroom.objects.filter(pk=classroom_id, name='MCP 操作班').exists())

        resources = handle_mcp_message({'jsonrpc': '2.0', 'id': 4, 'method': 'resources/list', 'params': {}})
        self.assertIn(f'fuckseats://classrooms/{classroom_id}', [item['uri'] for item in resources['result']['resources']])
