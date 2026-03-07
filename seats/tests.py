from django.test import TestCase
from django.urls import reverse
import json
import importlib.util
import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch, Mock

import httpx
import openai
import openpyxl
import pandas as pd

from .models import Classroom, SeatConstraint, SeatCellType, SeatGroup, FutureModeConfig, Seat
from .views import _arrange_standard, _arrange_grouped, _apply_internal_policy, _process_import, IMPORT_MODE_MATCH, IMPORT_MODE_REPLACE, _create_future_mode_response


class FutureModeErrorHandlingTests(TestCase):
    def setUp(self):
        self.classroom = Classroom.objects.create(name="AI测试班", rows=2, cols=2)

    def test_ai_chat_maps_authentication_error_to_bad_request(self):
        url = reverse("ai_chat", args=[self.classroom.pk])
        request = httpx.Request("POST", "https://api.openai.com/v1/responses")
        response = httpx.Response(401, request=request)
        auth_error = openai.AuthenticationError(
            "Incorrect API key provided",
            response=response,
            body={"error": {"code": "invalid_api_key"}},
        )

        with patch("seats.views._run_future_mode", side_effect=auth_error):
            resp = self.client.post(
                url,
                data=json.dumps({"action": "message", "message": "你好"}),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 400)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "error")
        self.assertIn("鉴权失败", payload.get("message", ""))

    def test_ai_chat_maps_not_found_responses_error_to_bad_request(self):
        url = reverse("ai_chat", args=[self.classroom.pk])
        request = httpx.Request("POST", "https://example.com/v1/responses")
        response = httpx.Response(404, request=request)
        not_found_error = openai.NotFoundError(
            "No route for /responses",
            response=response,
            body={"error": {"message": "No route"}},
        )

        with patch("seats.views._run_future_mode", side_effect=not_found_error):
            resp = self.client.post(
                url,
                data=json.dumps({"action": "message", "message": "你好"}),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 400)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "error")
        self.assertIn("不支持 Responses API", payload.get("message", ""))

    def test_ai_chat_maps_not_implemented_text_error_to_bad_request(self):
        url = reverse("ai_chat", args=[self.classroom.pk])

        with patch("seats.views._run_future_mode", side_effect=Exception("status_code=500, not implemented")):
            resp = self.client.post(
                url,
                data=json.dumps({"action": "message", "message": "你好"}),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 400)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "error")
        self.assertIn("不支持 Responses API", payload.get("message", ""))

    def test_tool_approval_falls_back_when_call_id_mismatch(self):
        url = reverse("ai_chat", args=[self.classroom.pk])
        session = self.client.session
        session["future_mode_pending_tools"] = {
            "token_1": {
                "classroom_id": self.classroom.pk,
                "response_id": "resp_123",
                "function_calls": [
                    {
                        "call_id": "call_123",
                        "name": "get_classroom_overview",
                        "arguments": {},
                    }
                ],
            }
        }
        session.save()

        with patch(
            "seats.views._run_future_mode",
            side_effect=Exception("No tool call found for function call output with call_id call_123."),
        ):
            resp = self.client.post(
                url,
                data=json.dumps(
                    {
                        "action": "tool_approval",
                        "approval_token": "token_1",
                        "decisions": [{"call_id": "call_123", "approved": True}],
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertIn("工具已执行", payload.get("reply", ""))
        self.assertIn("读取当前班级概览", payload.get("reply", ""))


class FutureModeResponsesCompatibilityTests(TestCase):
    def test_create_future_mode_response_retries_with_content_parts(self):
        client = Mock()
        expected = object()
        client.responses.create.side_effect = [
            Exception("status_code=500, json: cannot unmarshal object into Go struct field ***.***.content of type []***.ResponsesOutputContent"),
            expected,
        ]

        result = _create_future_mode_response(
            client=client,
            model="gpt-4.1-mini",
            conversation=[{"role": "user", "content": "你好"}],
        )

        self.assertIs(result, expected)
        self.assertEqual(client.responses.create.call_count, 2)

        first_input = client.responses.create.call_args_list[0].kwargs["input"]
        second_input = client.responses.create.call_args_list[1].kwargs["input"]

        self.assertIsInstance(first_input[0]["content"], str)
        self.assertIsInstance(second_input[0]["content"], list)
        self.assertEqual(second_input[0]["content"][0]["type"], "input_text")


class FutureModeConfigPersistenceTests(TestCase):
    def setUp(self):
        self.classroom = Classroom.objects.create(name="配置测试班", rows=2, cols=2)
        self.url = reverse("ai_chat", args=[self.classroom.pk])

    def test_config_save_and_get_roundtrip(self):
        save_resp = self.client.post(
            self.url,
            data=json.dumps(
                {
                    "action": "config_save",
                    "client_config": {
                        "api_key": "sk-db-123",
                        "base_url": "https://api.openai.com/v1",
                        "model": "gpt-4.1-mini",
                    },
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(save_resp.status_code, 200)
        self.assertEqual(save_resp.json().get("status"), "success")

        db_config = FutureModeConfig.objects.get(classroom=self.classroom)
        self.assertEqual(db_config.api_key, "sk-db-123")
        self.assertEqual(db_config.base_url, "https://api.openai.com/v1")
        self.assertEqual(db_config.model, "gpt-4.1-mini")

        get_resp = self.client.post(
            self.url,
            data=json.dumps({"action": "config_get"}),
            content_type="application/json",
        )
        self.assertEqual(get_resp.status_code, 200)
        payload = get_resp.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(payload.get("client_config", {}).get("api_key"), "sk-db-123")
        self.assertEqual(payload.get("client_config", {}).get("base_url"), "https://api.openai.com/v1")
        self.assertEqual(payload.get("client_config", {}).get("model"), "gpt-4.1-mini")

    def test_message_uses_persisted_config_when_payload_empty(self):
        FutureModeConfig.objects.create(
            classroom=self.classroom,
            api_key="sk-db-x",
            base_url="https://api.openai.com/v1",
            model="gpt-4.1-mini",
        )

        with patch(
            "seats.views._run_future_mode",
            return_value={"status": "completed", "reply": "ok", "tool_events": []},
        ) as mock_run:
            resp = self.client.post(
                self.url,
                data=json.dumps({"action": "message", "message": "你好"}),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 200)
        called_config = mock_run.call_args.kwargs.get("client_config", {})
        self.assertEqual(called_config.get("api_key"), "sk-db-x")
        self.assertEqual(called_config.get("base_url"), "https://api.openai.com/v1")
        self.assertEqual(called_config.get("model"), "gpt-4.1-mini")

    def test_payload_config_can_override_persisted_model(self):
        FutureModeConfig.objects.create(
            classroom=self.classroom,
            api_key="sk-db-y",
            base_url="https://api.openai.com/v1",
            model="gpt-4.1-mini",
        )

        with patch(
            "seats.views._run_future_mode",
            return_value={"status": "completed", "reply": "ok", "tool_events": []},
        ) as mock_run:
            resp = self.client.post(
                self.url,
                data=json.dumps(
                    {
                        "action": "message",
                        "message": "你好",
                        "client_config": {"model": "gpt-5-mini"},
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 200)
        called_config = mock_run.call_args.kwargs.get("client_config", {})
        self.assertEqual(called_config.get("api_key"), "sk-db-y")
        self.assertEqual(called_config.get("base_url"), "https://api.openai.com/v1")
        self.assertEqual(called_config.get("model"), "gpt-5-mini")

    def test_message_branch_uses_auto_mode(self):
        with patch(
            "seats.views._run_future_mode",
            return_value={"status": "completed", "reply": "ok", "tool_events": []},
        ) as mock_run:
            resp = self.client.post(
                self.url,
                data=json.dumps({"action": "message", "message": "你好"}),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_run.call_args.kwargs.get("mode"), "auto")

    def test_tool_approval_uses_pending_chat_mode(self):
        session = self.client.session
        session["future_mode_pending_tools"] = {
            "token_chat": {
                "classroom_id": self.classroom.pk,
                "response_id": "",
                "mode": "chat",
                "chat_messages": [{"role": "system", "content": "x"}],
                "function_calls": [
                    {"call_id": "call_1", "name": "get_classroom_overview", "arguments": {}}
                ],
            }
        }
        session.save()

        with patch(
            "seats.views._run_future_mode",
            return_value={"status": "completed", "reply": "ok", "tool_events": []},
        ) as mock_run:
            resp = self.client.post(
                self.url,
                data=json.dumps(
                    {
                        "action": "tool_approval",
                        "approval_token": "token_chat",
                        "decisions": [{"call_id": "call_1", "approved": True}],
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_run.call_args.kwargs.get("mode"), "chat")
        self.assertIsNone(mock_run.call_args.kwargs.get("previous_response_id"))
        self.assertEqual(mock_run.call_args.kwargs.get("chat_messages"), [{"role": "system", "content": "x"}])


class FutureModeDirectSwapTests(TestCase):
    def setUp(self):
        self.classroom = Classroom.objects.create(name="换座测试班", rows=1, cols=2)
        self.url = reverse("ai_chat", args=[self.classroom.pk])
        self.student_a = self.classroom.students.create(name="张三")
        self.student_b = self.classroom.students.create(name="李四")
        seat_1 = self.classroom.seats.get(row=1, col=1)
        seat_2 = self.classroom.seats.get(row=1, col=2)
        seat_1.student = self.student_a
        seat_1.save(update_fields=["student"])
        seat_2.student = self.student_b
        seat_2.save(update_fields=["student"])

    def test_message_detects_direct_swap_intent(self):
        resp = self.client.post(
            self.url,
            data=json.dumps({"action": "message", "message": "把张三和李四换位置"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "needs_approval")
        token = payload.get("approval_token")
        self.assertTrue(token)

        session_payload = self.client.session.get("future_mode_pending_tools", {}).get(token, {})
        self.assertEqual(session_payload.get("mode"), "direct")
        function_calls = session_payload.get("function_calls") or []
        self.assertEqual(len(function_calls), 1)
        self.assertEqual(function_calls[0].get("name"), "swap_students")

    def test_tool_approval_executes_direct_swap(self):
        session = self.client.session
        session["future_mode_pending_tools"] = {
            "token_swap": {
                "classroom_id": self.classroom.pk,
                "response_id": "",
                "mode": "direct",
                "chat_messages": [],
                "function_calls": [
                    {
                        "call_id": "call_swap_1",
                        "name": "swap_students",
                        "arguments": {"student_a": "张三", "student_b": "李四"},
                    }
                ],
            }
        }
        session.save()

        resp = self.client.post(
            self.url,
            data=json.dumps(
                {
                    "action": "tool_approval",
                    "approval_token": "token_swap",
                    "decisions": [{"call_id": "call_swap_1", "approved": True}],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload.get("status"), "success")

        self.student_a.refresh_from_db()
        self.student_b.refresh_from_db()
        self.assertEqual(self.student_a.assigned_seat.col, 2)
        self.assertEqual(self.student_b.assigned_seat.col, 1)


class ConstraintArrangeTests(TestCase):
    def test_must_together_does_not_assign_same_seat(self):
        classroom = Classroom.objects.create(name="T1", rows=2, cols=2)
        alice = classroom.students.create(name="Alice")
        bob = classroom.students.create(name="Bob")
        classroom.students.create(name="Carol")

        SeatConstraint.objects.create(
            classroom=classroom,
            constraint_type=SeatConstraint.ConstraintType.MUST_TOGETHER,
            student=alice,
            target_student=bob,
            distance=1,
        )

        students = list(classroom.students.all())
        seats = list(classroom.seats.select_related("student"))
        _arrange_standard(classroom, students, seats, "random")

        alice.refresh_from_db()
        bob.refresh_from_db()
        self.assertIsNotNone(alice.assigned_seat)
        self.assertIsNotNone(bob.assigned_seat)
        self.assertNotEqual(alice.assigned_seat.pk, bob.assigned_seat.pk)

        distance = abs(alice.assigned_seat.row - bob.assigned_seat.row) + abs(
            alice.assigned_seat.col - bob.assigned_seat.col
        )
        self.assertLessEqual(distance, 1)

    def test_special_internal_policy_keeps_working(self):
        classroom = Classroom.objects.create(name="T2", rows=2, cols=3)
        jqj = classroom.students.create(name="金千竣")
        hzh = classroom.students.create(name="胡哲豪")

        seat_jqj = classroom.seats.get(row=1, col=1)
        seat_hzh = classroom.seats.get(row=2, col=3)
        seat_jqj.student = jqj
        seat_jqj.save(update_fields=["student"])
        seat_hzh.student = hzh
        seat_hzh.save(update_fields=["student"])

        changed = _apply_internal_policy(classroom)
        self.assertTrue(changed)

        jqj.refresh_from_db()
        hzh.refresh_from_db()
        self.assertIsNotNone(jqj.assigned_seat)
        self.assertIsNotNone(hzh.assigned_seat)
        self.assertEqual(jqj.assigned_seat.row, hzh.assigned_seat.row)
        self.assertEqual(abs(jqj.assigned_seat.col - hzh.assigned_seat.col), 1)

    def test_group_mode_respects_must_seat_constraint(self):
        classroom = Classroom.objects.create(name="T3", rows=1, cols=4)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        for seat in classroom.seats.filter(cell_type=SeatCellType.SEAT):
            seat.group = g1 if seat.col <= 2 else g2
            seat.save(update_fields=["group"])

        s1 = classroom.students.create(name="A", score=100)
        classroom.students.create(name="B", score=0)

        SeatConstraint.objects.create(
            classroom=classroom,
            constraint_type=SeatConstraint.ConstraintType.MUST_SEAT,
            student=s1,
            row=1,
            col=2,
        )

        ok = _arrange_grouped(classroom, list(classroom.students.all()), "group_mentor")
        self.assertTrue(ok)

        s1.refresh_from_db()
        self.assertIsNotNone(s1.assigned_seat)
        self.assertEqual((s1.assigned_seat.row, s1.assigned_seat.col), (1, 2))


class GroupInteractionTests(TestCase):
    def test_apply_suggestion_disabled_type_returns_success(self):
        classroom = Classroom.objects.create(name="C0", rows=1, cols=2)
        url = reverse("apply_suggestion", args=[classroom.pk]) + "?type=jqj_hzh"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")

    def test_apply_suggestion_swap_rejects_cross_class_students(self):
        c1 = Classroom.objects.create(name="C1", rows=1, cols=2)
        c2 = Classroom.objects.create(name="C2", rows=1, cols=2)
        s1 = c1.students.create(name="A")
        s2 = c2.students.create(name="B")
        c1.seats.get(row=1, col=1).student = s1
        c1.seats.get(row=1, col=1).save(update_fields=["student"])
        c2.seats.get(row=1, col=1).student = s2
        c2.seats.get(row=1, col=1).save(update_fields=["student"])

        url = reverse("apply_suggestion", args=[c1.pk]) + f"?type=swap_balance&s1={s1.pk}&s2={s2.pk}"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")

    def test_classroom_state_filters_internal_name_suggestions(self):
        classroom = Classroom.objects.create(name="C2A", rows=1, cols=2)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        seat1 = classroom.seats.get(row=1, col=1)
        seat2 = classroom.seats.get(row=1, col=2)
        seat1.group = g1
        seat2.group = g2
        seat1.save(update_fields=["group"])
        seat2.save(update_fields=["group"])

        s1 = classroom.students.create(name="金千竣", score=100)
        s2 = classroom.students.create(name="普通同学", score=10)
        seat1.student = s1
        seat2.student = s2
        seat1.save(update_fields=["student"])
        seat2.save(update_fields=["student"])

        state_url = reverse("classroom_state", args=[classroom.pk])
        response = self.client.get(state_url, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(response.status_code, 200)
        suggestions = response.json().get("suggestions", [])

        joined = []
        for item in suggestions:
            if isinstance(item, dict):
                joined.append(str(item.get("message") or ""))
                joined.append(str(item.get("action_url") or ""))
                joined.append(str(item.get("type") or ""))
            else:
                joined.append(str(item))
        text = " | ".join(joined)
        self.assertNotIn("金千竣", text)
        self.assertNotIn("胡哲豪", text)
        self.assertNotIn("jqj_hzh", text)

    def test_group_balance_does_not_suggest_internal_policy_students(self):
        classroom = Classroom.objects.create(name="C2B", rows=1, cols=4)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        seat1 = classroom.seats.get(row=1, col=1)
        seat2 = classroom.seats.get(row=1, col=2)
        seat3 = classroom.seats.get(row=1, col=3)
        seat4 = classroom.seats.get(row=1, col=4)
        seat1.group = g1
        seat2.group = g1
        seat3.group = g2
        seat4.group = g2
        seat1.save(update_fields=["group"])
        seat2.save(update_fields=["group"])
        seat3.save(update_fields=["group"])
        seat4.save(update_fields=["group"])

        s_internal = classroom.students.create(name="金千竣", score=100)
        s_high = classroom.students.create(name="高分甲", score=90)
        s_low1 = classroom.students.create(name="低分乙", score=5)
        s_low2 = classroom.students.create(name="低分丙", score=5)

        seat1.student = s_internal
        seat2.student = s_high
        seat3.student = s_low1
        seat4.student = s_low2
        seat1.save(update_fields=["student"])
        seat2.save(update_fields=["student"])
        seat3.save(update_fields=["student"])
        seat4.save(update_fields=["student"])

        state_url = reverse("classroom_state", args=[classroom.pk])
        response = self.client.get(state_url, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(response.status_code, 200)
        suggestions = response.json().get("suggestions", [])

        text = " | ".join(str(item) for item in suggestions)
        self.assertNotIn("金千竣", text)

    def test_rename_group_duplicate_returns_error_in_ajax(self):
        classroom = Classroom.objects.create(name="C3", rows=1, cols=2)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        url = reverse("rename_group", args=[classroom.pk, g1.pk])
        response = self.client.post(
            url,
            {"name": "G2"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")

    def test_assign_group_clears_old_group_leader(self):
        classroom = Classroom.objects.create(name="C4", rows=1, cols=2)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)
        leader = classroom.students.create(name="Leader")
        seat = classroom.seats.get(row=1, col=1)
        seat.group = g1
        seat.student = leader
        seat.save(update_fields=["group", "student"])
        g1.leader = leader
        g1.save(update_fields=["leader"])

        url = reverse("assign_group", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps({"row": 1, "col": 1, "group_id": g2.pk}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        g1.refresh_from_db()
        self.assertIsNone(g1.leader_id)

    def test_move_student_auto_repairs_when_breaking_constraint(self):
        classroom = Classroom.objects.create(name="C5", rows=1, cols=2)
        s1 = classroom.students.create(name="A")
        s2 = classroom.students.create(name="B")
        seat1 = classroom.seats.get(row=1, col=1)
        seat2 = classroom.seats.get(row=1, col=2)
        seat1.student = s1
        seat1.save(update_fields=["student"])
        seat2.student = s2
        seat2.save(update_fields=["student"])

        SeatConstraint.objects.create(
            classroom=classroom,
            constraint_type=SeatConstraint.ConstraintType.MUST_SEAT,
            student=s1,
            row=1,
            col=1,
        )

        url = reverse("move_student", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps({"student_id": s1.pk, "row": 1, "col": 2}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")
        seat1.refresh_from_db()
        seat2.refresh_from_db()
        self.assertEqual(seat1.student_id, s1.pk)
        self.assertEqual(seat2.student_id, s2.pk)

    def test_first_move_of_special_student_keeps_target_position(self):
        classroom = Classroom.objects.create(name="C5S", rows=2, cols=3)
        jqj = classroom.students.create(name="金千竣")
        hzh = classroom.students.create(name="胡哲豪")

        seat_jqj = classroom.seats.get(row=1, col=1)
        seat_hzh = classroom.seats.get(row=1, col=2)
        seat_jqj.student = jqj
        seat_jqj.save(update_fields=["student"])
        seat_hzh.student = hzh
        seat_hzh.save(update_fields=["student"])

        url = reverse("move_student", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps({"student_id": jqj.pk, "row": 2, "col": 3}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")

        jqj.refresh_from_db()
        hzh.refresh_from_db()
        self.assertEqual((jqj.assigned_seat.row, jqj.assigned_seat.col), (2, 3))
        distance = abs(jqj.assigned_seat.row - hzh.assigned_seat.row) + abs(
            jqj.assigned_seat.col - hzh.assigned_seat.col
        )
        self.assertEqual(distance, 1)

    def test_move_students_batch_moves_multiple_students(self):
        classroom = Classroom.objects.create(name="C5B", rows=2, cols=3)
        s1 = classroom.students.create(name="A")
        s2 = classroom.students.create(name="B")
        seat_a = classroom.seats.get(row=1, col=1)
        seat_b = classroom.seats.get(row=1, col=2)
        seat_a.student = s1
        seat_a.save(update_fields=["student"])
        seat_b.student = s2
        seat_b.save(update_fields=["student"])

        url = reverse("move_students_batch", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "moves": [
                        {"student_id": s1.pk, "row": 2, "col": 1},
                        {"student_id": s2.pk, "row": 2, "col": 2},
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")

        s1.refresh_from_db()
        s2.refresh_from_db()
        self.assertEqual((s1.assigned_seat.row, s1.assigned_seat.col), (2, 1))
        self.assertEqual((s2.assigned_seat.row, s2.assigned_seat.col), (2, 2))

    def test_move_students_batch_rejects_duplicate_target(self):
        classroom = Classroom.objects.create(name="C5C", rows=2, cols=2)
        s1 = classroom.students.create(name="A")
        s2 = classroom.students.create(name="B")
        seat_a = classroom.seats.get(row=1, col=1)
        seat_b = classroom.seats.get(row=1, col=2)
        seat_a.student = s1
        seat_a.save(update_fields=["student"])
        seat_b.student = s2
        seat_b.save(update_fields=["student"])

        url = reverse("move_students_batch", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "moves": [
                        {"student_id": s1.pk, "row": 2, "col": 1},
                        {"student_id": s2.pk, "row": 2, "col": 1},
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")

    def test_move_students_batch_supports_undo_redo(self):
        classroom = Classroom.objects.create(name="C5D", rows=2, cols=2)
        s1 = classroom.students.create(name="A")
        s2 = classroom.students.create(name="B")
        seat_a = classroom.seats.get(row=1, col=1)
        seat_b = classroom.seats.get(row=1, col=2)
        seat_a.student = s1
        seat_a.save(update_fields=["student"])
        seat_b.student = s2
        seat_b.save(update_fields=["student"])

        move_url = reverse("move_students_batch", args=[classroom.pk])
        self.client.post(
            move_url,
            data=json.dumps(
                {
                    "moves": [
                        {"student_id": s1.pk, "row": 2, "col": 1},
                        {"student_id": s2.pk, "row": 2, "col": 2},
                    ]
                }
            ),
            content_type="application/json",
        )

        undo_url = reverse("undo_action", args=[classroom.pk])
        redo_url = reverse("redo_action", args=[classroom.pk])

        undo_resp = self.client.post(undo_url)
        self.assertEqual(undo_resp.status_code, 200)
        s1.refresh_from_db()
        s2.refresh_from_db()
        self.assertEqual((s1.assigned_seat.row, s1.assigned_seat.col), (1, 1))
        self.assertEqual((s2.assigned_seat.row, s2.assigned_seat.col), (1, 2))

        redo_resp = self.client.post(redo_url)
        self.assertEqual(redo_resp.status_code, 200)
        s1.refresh_from_db()
        s2.refresh_from_db()
        self.assertEqual((s1.assigned_seat.row, s1.assigned_seat.col), (2, 1))
        self.assertEqual((s2.assigned_seat.row, s2.assigned_seat.col), (2, 2))

    def test_swap_suggestion_auto_repairs_when_breaking_constraint(self):
        classroom = Classroom.objects.create(name="C6", rows=1, cols=2)
        s1 = classroom.students.create(name="A")
        s2 = classroom.students.create(name="B")
        seat1 = classroom.seats.get(row=1, col=1)
        seat2 = classroom.seats.get(row=1, col=2)
        seat1.student = s1
        seat1.save(update_fields=["student"])
        seat2.student = s2
        seat2.save(update_fields=["student"])

        SeatConstraint.objects.create(
            classroom=classroom,
            constraint_type=SeatConstraint.ConstraintType.MUST_SEAT,
            student=s1,
            row=1,
            col=1,
        )

        url = reverse("apply_suggestion", args=[classroom.pk]) + f"?type=swap_balance&s1={s1.pk}&s2={s2.pk}"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")
        seat1.refresh_from_db()
        seat2.refresh_from_db()
        self.assertEqual(seat1.student_id, s1.pk)
        self.assertEqual(seat2.student_id, s2.pk)

    def test_auto_group_nearby_uses_shape_profile(self):
        classroom = Classroom.objects.create(name="C7", rows=6, cols=6)
        ref_group = SeatGroup.objects.create(classroom=classroom, name="1", order=1)

        ref_coords = [(5, 5), (5, 6), (6, 5), (6, 6)]
        for idx, (r, c) in enumerate(ref_coords, start=1):
            stu = classroom.students.create(name=f"Ref{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = ref_group
            seat.save(update_fields=["student", "group"])

        line_coords = [(1, 1), (1, 2), (1, 3), (1, 4)]
        block_coords = [(2, 1), (2, 2), (3, 1), (3, 2)]
        target_coords = line_coords + block_coords
        for idx, (r, c) in enumerate(target_coords, start=1):
            stu = classroom.students.create(name=f"T{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = None
            seat.save(update_fields=["student", "group"])

        url = reverse("auto_group_from_reference", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "reference_group_id": ref_group.pk,
                    "remainder_strategy": "merge_prev",
                    "auto_detect_group_style": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(payload.get("group_style"), "nearby")
        self.assertEqual(payload.get("group_shape"), "block_2x2")

        created_groups = payload.get("created_groups") or []
        self.assertGreaterEqual(len(created_groups), 2)
        first_group_id = created_groups[0]["id"]
        first_group_coords = set(
            classroom.seats.filter(
                group_id=first_group_id,
                row__in=[1, 2, 3],
                col__in=[1, 2, 3, 4],
            ).values_list("row", "col")
        )
        self.assertEqual(len(first_group_coords), 4)
        min_row = min(r for r, _ in first_group_coords)
        min_col = min(c for _, c in first_group_coords)
        normalized = {(r - min_row, c - min_col) for r, c in first_group_coords}
        self.assertEqual(normalized, {(0, 0), (0, 1), (1, 0), (1, 1)})

    def test_auto_group_nearby_tiles_three_rows_and_puts_remainder_to_one_group(self):
        classroom = Classroom.objects.create(name="C8", rows=7, cols=4)
        ref_group = SeatGroup.objects.create(classroom=classroom, name="1", order=1)

        ref_coords = [(5, 1), (5, 2), (6, 1), (6, 2), (7, 1), (7, 2)]
        for idx, (r, c) in enumerate(ref_coords, start=1):
            stu = classroom.students.create(name=f"RefG{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = ref_group
            seat.save(update_fields=["student", "group"])

        target_coords = [(r, c) for r in range(1, 5) for c in range(1, 5)]
        for idx, (r, c) in enumerate(target_coords, start=1):
            stu = classroom.students.create(name=f"S{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = None
            seat.save(update_fields=["student", "group"])

        url = reverse("auto_group_from_reference", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "reference_group_id": ref_group.pk,
                    "remainder_strategy": "new_group",
                    "auto_detect_group_style": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(payload.get("group_style"), "nearby")
        self.assertEqual(payload.get("group_shape"), "block_3x2")

        created_groups = payload.get("created_groups") or []
        self.assertGreaterEqual(len(created_groups), 3)
        group_ids = [g["id"] for g in created_groups[:3]]

        counts = []
        group_coords = {}
        for gid in group_ids:
            coords = set(
                classroom.seats.filter(group_id=gid).values_list("row", "col")
            )
            group_coords[gid] = coords
            counts.append(len(coords))
        self.assertEqual(sorted(counts), [4, 6, 6])

        remainder_groups = [gid for gid in group_ids if len(group_coords[gid]) == 4]
        self.assertEqual(len(remainder_groups), 1)
        remainder_coords = group_coords[remainder_groups[0]]
        self.assertEqual(remainder_coords, {(4, 1), (4, 2), (4, 3), (4, 4)})

    def test_auto_group_horizontal_ignores_group_size_and_groups_by_row(self):
        classroom = Classroom.objects.create(name="C9", rows=4, cols=4)
        ref_group = SeatGroup.objects.create(classroom=classroom, name="1", order=1)

        ref_coords = [(4, 1), (4, 2)]
        for idx, (r, c) in enumerate(ref_coords, start=1):
            stu = classroom.students.create(name=f"RefH{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = ref_group
            seat.save(update_fields=["student", "group"])

        target_coords = [(r, c) for r in [1, 2] for c in [1, 2, 3, 4]]
        for idx, (r, c) in enumerate(target_coords, start=1):
            stu = classroom.students.create(name=f"H{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = None
            seat.save(update_fields=["student", "group"])

        url = reverse("auto_group_from_reference", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "reference_group_id": ref_group.pk,
                    "remainder_strategy": "skip",
                    "auto_detect_group_style": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(payload.get("group_style"), "horizontal")
        self.assertTrue(payload.get("linear_grouping"))

        created_groups = payload.get("created_groups") or []
        self.assertEqual(len(created_groups), 2)

        group_rows = {}
        for g in created_groups:
            coords = set(classroom.seats.filter(group_id=g["id"]).values_list("row", "col"))
            self.assertEqual(len(coords), 4)
            rows = {r for r, _ in coords}
            self.assertEqual(len(rows), 1)
            group_rows[g["id"]] = rows.pop()
        self.assertEqual(set(group_rows.values()), {1, 2})

    def test_auto_group_vertical_ignores_group_size_and_groups_by_col(self):
        classroom = Classroom.objects.create(name="C10", rows=4, cols=4)
        ref_group = SeatGroup.objects.create(classroom=classroom, name="1", order=1)

        ref_coords = [(1, 4), (2, 4)]
        for idx, (r, c) in enumerate(ref_coords, start=1):
            stu = classroom.students.create(name=f"RefV{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = ref_group
            seat.save(update_fields=["student", "group"])

        target_coords = [(r, c) for c in [1, 2] for r in [1, 2, 3, 4]]
        for idx, (r, c) in enumerate(target_coords, start=1):
            stu = classroom.students.create(name=f"V{idx}")
            seat = classroom.seats.get(row=r, col=c)
            seat.student = stu
            seat.group = None
            seat.save(update_fields=["student", "group"])

        url = reverse("auto_group_from_reference", args=[classroom.pk])
        response = self.client.post(
            url,
            data=json.dumps(
                {
                    "reference_group_id": ref_group.pk,
                    "remainder_strategy": "skip",
                    "auto_detect_group_style": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(payload.get("group_style"), "vertical")
        self.assertTrue(payload.get("linear_grouping"))

        created_groups = payload.get("created_groups") or []
        self.assertEqual(len(created_groups), 2)

        group_cols = {}
        for g in created_groups:
            coords = set(classroom.seats.filter(group_id=g["id"]).values_list("row", "col"))
            self.assertEqual(len(coords), 4)
            cols = {c for _, c in coords}
            self.assertEqual(len(cols), 1)
            group_cols[g["id"]] = cols.pop()
        self.assertEqual(set(group_cols.values()), {1, 2})


class GroupRotationTests(TestCase):
    def test_rotate_groups_swaps_group_positions_with_students(self):
        classroom = Classroom.objects.create(name="R1", rows=1, cols=4)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        seats = {col: classroom.seats.get(row=1, col=col) for col in [1, 2, 3, 4]}
        for col in [1, 2]:
            seats[col].group = g1
            seats[col].save(update_fields=["group"])
        for col in [3, 4]:
            seats[col].group = g2
            seats[col].save(update_fields=["group"])

        students = {}
        for idx, name in enumerate(["A", "B", "C", "D"], start=1):
            students[idx] = classroom.students.create(name=name, score=80 - idx)
            seats[idx].student = students[idx]
            seats[idx].save(update_fields=["student"])

        g1.leader = students[1]
        g1.save(update_fields=["leader"])

        url = reverse("rotate_groups", args=[classroom.pk])
        response = self.client.post(url, data=json.dumps({}), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")

        seats = {col: classroom.seats.get(row=1, col=col) for col in [1, 2, 3, 4]}
        self.assertEqual(seats[1].group_id, g2.pk)
        self.assertEqual(seats[2].group_id, g2.pk)
        self.assertEqual(seats[3].group_id, g1.pk)
        self.assertEqual(seats[4].group_id, g1.pk)

        self.assertEqual(seats[1].student.name, "C")
        self.assertEqual(seats[2].student.name, "D")
        self.assertEqual(seats[3].student.name, "A")
        self.assertEqual(seats[4].student.name, "B")

        g1.refresh_from_db()
        self.assertEqual(g1.leader_id, students[1].pk)

    def test_rotate_groups_rejects_when_group_sizes_differ(self):
        classroom = Classroom.objects.create(name="R2", rows=1, cols=5)
        g1 = SeatGroup.objects.create(classroom=classroom, name="G1", order=1)
        g2 = SeatGroup.objects.create(classroom=classroom, name="G2", order=2)

        for col in [1, 2, 3]:
            seat = classroom.seats.get(row=1, col=col)
            seat.group = g1
            seat.save(update_fields=["group"])
        for col in [4, 5]:
            seat = classroom.seats.get(row=1, col=col)
            seat.group = g2
            seat.save(update_fields=["group"])

        url = reverse("rotate_groups", args=[classroom.pk])
        response = self.client.post(url, data=json.dumps({}), content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")
        self.assertIn("座位数量不一致", response.json().get("message", ""))


class StudentImportTests(TestCase):
    def test_process_import_match_updates_existing_students(self):
        classroom = Classroom.objects.create(name="导入匹配", rows=2, cols=2)
        stu_by_id = classroom.students.create(name="张三", student_id="1001", score=60)
        stu_by_name = classroom.students.create(name="李四", score=55)

        df = pd.DataFrame(
            [
                {"姓名": "张三", "学号": "1001", "总分": 95},
                {"姓名": "李四", "总分": 88},
                {"姓名": "王五", "总分": 77},
            ]
        )

        result = _process_import(
            classroom,
            df,
            "姓名",
            "学号",
            None,
            "总分",
            import_mode=IMPORT_MODE_MATCH,
        )

        stu_by_id.refresh_from_db()
        stu_by_name.refresh_from_db()
        self.assertEqual(stu_by_id.score, 95)
        self.assertEqual(stu_by_name.score, 88)
        self.assertEqual(classroom.students.count(), 3)
        self.assertTrue(classroom.students.filter(name="王五", score=77).exists())
        self.assertEqual(result["updated"], 2)
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["skipped"], 0)

    def test_process_import_replace_rebuilds_students(self):
        classroom = Classroom.objects.create(name="导入清空", rows=2, cols=2)
        classroom.students.create(name="旧学生", student_id="A01", score=30)

        df = pd.DataFrame(
            [
                {"姓名": "新学生1", "学号": "N01", "总分": 91},
                {"姓名": "新学生2", "学号": "N02", "总分": 85},
            ]
        )

        result = _process_import(
            classroom,
            df,
            "姓名",
            "学号",
            None,
            "总分",
            import_mode=IMPORT_MODE_REPLACE,
        )

        self.assertEqual(classroom.students.count(), 2)
        self.assertFalse(classroom.students.filter(name="旧学生").exists())
        self.assertEqual(result["created"], 2)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["skipped"], 0)


class ClassroomFeatureTests(TestCase):
    def test_export_options_pages_render(self):
        classroom = Classroom.objects.create(name="导出配置页", rows=2, cols=2)

        excel_url = reverse("export_students_options_page", args=[classroom.pk])
        svg_url = reverse("export_students_svg_options_page", args=[classroom.pk])
        pptx_url = reverse("export_students_pptx_options_page", args=[classroom.pk])

        excel_resp = self.client.get(excel_url)
        svg_resp = self.client.get(svg_url)
        pptx_resp = self.client.get(pptx_url)

        self.assertEqual(excel_resp.status_code, 200)
        self.assertEqual(svg_resp.status_code, 200)
        self.assertEqual(pptx_resp.status_code, 200)
        self.assertIn("导出排座表", excel_resp.content.decode("utf-8"))
        self.assertIn("导出 SVG 图片", svg_resp.content.decode("utf-8"))
        self.assertIn("导出 PPTX（单页 16:9）", pptx_resp.content.decode("utf-8"))

    def test_import_options_pages_render(self):
        classroom = Classroom.objects.create(name="导入配置页", rows=2, cols=2)

        score_url = reverse("import_students_options_page", args=[classroom.pk])
        layout_url = reverse("import_layout_excel_options_page", args=[classroom.pk])

        score_resp = self.client.get(score_url)
        layout_resp = self.client.get(layout_url)

        self.assertEqual(score_resp.status_code, 200)
        self.assertEqual(layout_resp.status_code, 200)
        self.assertIn("导入 Excel 成绩表", score_resp.content.decode("utf-8"))
        self.assertIn("导入座位表（Excel）", layout_resp.content.decode("utf-8"))

    def test_export_students_default_layout(self):
        classroom = Classroom.objects.create(name="导出默认", rows=2, cols=2)
        seat_a = classroom.seats.get(row=1, col=1)
        seat_d = classroom.seats.get(row=2, col=2)
        seat_a.student = classroom.students.create(name="A")
        seat_d.student = classroom.students.create(name="D")
        seat_a.save(update_fields=["student"])
        seat_d.save(update_fields=["student"])

        url = reverse("export_students", args=[classroom.pk])
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        wb = openpyxl.load_workbook(BytesIO(response.content))
        ws = wb.active
        self.assertEqual(ws.cell(row=2, column=1).value, "讲台")
        self.assertEqual(ws.cell(row=3, column=1).value, "A")
        self.assertEqual(ws.cell(row=4, column=2).value, "D")

    def test_export_students_rotate_180_layout(self):
        classroom = Classroom.objects.create(name="导出翻转", rows=2, cols=2)
        seat_a = classroom.seats.get(row=1, col=1)
        seat_d = classroom.seats.get(row=2, col=2)
        seat_a.student = classroom.students.create(name="A")
        seat_d.student = classroom.students.create(name="D")
        seat_a.save(update_fields=["student"])
        seat_d.save(update_fields=["student"])

        url = reverse("export_students", args=[classroom.pk]) + "?layout_transform=rotate_180"
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        wb = openpyxl.load_workbook(BytesIO(response.content))
        ws = wb.active
        self.assertIn("180°翻转", ws.cell(row=1, column=1).value or "")
        self.assertEqual(ws.cell(row=4, column=1).value, "讲台")
        self.assertEqual(ws.cell(row=2, column=1).value, "D")
        self.assertEqual(ws.cell(row=3, column=2).value, "A")

    def test_export_students_svg_returns_svg_content(self):
        classroom = Classroom.objects.create(name="SVG班", rows=1, cols=2)
        student = classroom.students.create(name="Alice", score=95)
        seat = classroom.seats.get(row=1, col=1)
        seat.student = student
        seat.save(update_fields=["student"])

        url = reverse("export_students_svg", args=[classroom.pk])
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        self.assertIn("image/svg+xml", response.get("Content-Type", ""))
        content = response.content.decode("utf-8")
        self.assertIn("<svg", content)
        self.assertIn("Alice", content)
        self.assertIn("SVG班", content)
        self.assertNotIn("总座位", content)
        self.assertNotIn("网格", content)

    def test_export_students_svg_respects_visibility_options(self):
        classroom = Classroom.objects.create(name="SVG配置班", rows=1, cols=1)
        student = classroom.students.create(name="Alice", score=95)
        seat = classroom.seats.get(row=1, col=1)
        seat.student = student
        seat.save(update_fields=["student"])

        url = reverse("export_students_svg", args=[classroom.pk]) + (
            "?show_title=0&show_podium=0&show_coords=0&show_name=0&show_score=0&show_empty_label=0"
        )
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertNotIn("座次图", content)
        self.assertNotIn("讲台", content)
        self.assertNotIn("Alice", content)
        self.assertNotIn("95分", content)
        self.assertNotIn("(1-1)", content)

    def test_export_students_svg_supports_theme_and_hide_seat_type(self):
        classroom = Classroom.objects.create(name="SVG主题班", rows=1, cols=2)
        seat = classroom.seats.get(row=1, col=2)
        seat.cell_type = SeatCellType.AISLE
        seat.save(update_fields=["cell_type"])

        url = reverse("export_students_svg", args=[classroom.pk]) + "?theme=contrast&show_podium=0&show_seat_type=0"
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertIn("#0b1220", content)
        self.assertNotIn("走廊", content)

    def test_export_students_svg_name_with_group_uses_emphasis_layout(self):
        classroom = Classroom.objects.create(name="SVG姓名小组班", rows=1, cols=1)
        group = classroom.groups.create(name="第1组", order=1)
        student = classroom.students.create(name="赵小明")
        seat = classroom.seats.get(row=1, col=1)
        seat.student = student
        seat.group = group
        seat.save(update_fields=["student", "group"])

        url = reverse("export_students_svg", args=[classroom.pk]) + (
            "?show_coords=0&show_name=1&show_score=0&show_group=1"
        )
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertIn('class="cell-name" font-size="', content)
        self.assertIn('dominant-baseline="middle"', content)

    @unittest.skipUnless(importlib.util.find_spec("pptx"), "python-pptx not installed")
    def test_export_students_pptx_returns_pptx_content(self):
        classroom = Classroom.objects.create(name="PPT班", rows=1, cols=1)
        student = classroom.students.create(name="Alice", score=91)
        seat = classroom.seats.get(row=1, col=1)
        seat.student = student
        seat.save(update_fields=["student"])

        url = reverse("export_students_pptx", args=[classroom.pk]) + "?show_coords=0&show_score=0"
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            response.get("Content-Type", ""),
        )
        self.assertIn(".pptx", response.get("Content-Disposition", ""))
        self.assertTrue(response.content.startswith(b"PK"))

    def test_export_students_svg_preview_student_returns_real_student(self):
        classroom = Classroom.objects.create(name="SVG预览班", rows=1, cols=2)
        s1 = classroom.students.create(name="Alice", score=90)
        s2 = classroom.students.create(name="Bob", score=80)
        seat = classroom.seats.get(row=1, col=1)
        seat.student = s1
        seat.save(update_fields=["student"])

        url = reverse("export_students_svg_preview_student", args=[classroom.pk])
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        sample = payload.get("sample") or {}
        self.assertEqual(sample.get("classroom"), "SVG预览班")
        self.assertIn(sample.get("name"), ["Alice", "Bob"])

    def test_export_group_report_header_font_size_code_is_delimited(self):
        classroom = Classroom.objects.create(name="09班", rows=2, cols=2)

        url = reverse("export_group_report", args=[classroom.pk])
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(BytesIO(response.content)) as zf:
            sheet_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")

        self.assertIn("&amp;20 09", sheet_xml)
        self.assertNotIn("&amp;1409", sheet_xml)

    def test_rename_classroom_success(self):
        classroom = Classroom.objects.create(name="原班级", rows=2, cols=2)
        url = reverse("rename_classroom", args=[classroom.pk])

        response = self.client.post(
            url,
            data=json.dumps({"name": "新班级名称"}),
            content_type="application/json",
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "success")
        classroom.refresh_from_db()
        self.assertEqual(classroom.name, "新班级名称")

    def test_rename_classroom_rejects_empty_name(self):
        classroom = Classroom.objects.create(name="原班级2", rows=2, cols=2)
        url = reverse("rename_classroom", args=[classroom.pk])

        response = self.client.post(
            url,
            data=json.dumps({"name": "   "}),
            content_type="application/json",
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")
        classroom.refresh_from_db()
        self.assertEqual(classroom.name, "原班级2")
