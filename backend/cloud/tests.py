import json
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from . import oauth
from .crypto import decrypt_payload, encrypt_payload, ensure_service_key, generate_rsa_keypair
from .models import CloudClassroom, CloudSession, CloudUser
from .sync import push_classroom_snapshot


class CloudOAuthRequestTests(TestCase):
    class _FakeJsonResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"ok":true}'

    def test_oauth_request_uses_fuckseats_user_agent(self):
        captured_requests = []

        def fake_urlopen(req, timeout=None, context=None):
            captured_requests.append(req)
            return self._FakeJsonResponse()

        with patch("cloud.oauth._get_ssl_context", return_value=object()):
            with patch("cloud.oauth.urllib.request.urlopen", side_effect=fake_urlopen):
                payload = oauth._request_json(
                    "https://example.test/oauth/token",
                    method="POST",
                    data={"code": "login-code"},
                )

        self.assertTrue(payload["ok"])
        self.assertEqual(captured_requests[0].get_header("User-agent"), "fuckseats_cilent")


class CloudCryptoTests(TestCase):
    def test_service_key_encrypts_and_decrypts_payload(self):
        service_key = ensure_service_key()
        envelope = encrypt_payload({'hello': 'world'}, service_key.public_key_pem, sender_key_id='client-key')
        payload = decrypt_payload(envelope, service_key.private_key_pem)

        self.assertEqual(payload['hello'], 'world')


class CloudSyncDeleteTests(TestCase):
    def create_session(self, user):
        client_keys = generate_rsa_keypair()
        session = CloudSession.objects.create(
            user=user,
            token="delete-token",
            device_id="test-device",
            client_key_id=client_keys["key_id"],
            client_public_key_pem=client_keys["public_key_pem"],
            expires_at=timezone.now() + timedelta(days=1),
        )
        return session, client_keys

    def encrypted_body(self, client_keys, payload):
        service_key = ensure_service_key()
        return json.dumps({
            "encrypted": encrypt_payload(
                payload,
                service_key.public_key_pem,
                sender_key_id=client_keys["key_id"],
            )
        })

    def decrypted_response(self, response, client_keys):
        payload = response.json()
        self.assertIn("encrypted", payload)
        return decrypt_payload(payload["encrypted"], client_keys["private_key_pem"])

    def test_sync_delete_marks_classroom_deleted_and_hides_from_status(self):
        user = CloudUser.objects.create(uid="u-delete")
        session, client_keys = self.create_session(user)
        classroom = CloudClassroom.objects.create(
            user=user,
            uuid=uuid.uuid4(),
            name="待删除云班",
            rows=2,
            cols=2,
            data_snapshot={},
            version=4,
        )

        response = self.client.delete(
            f"/api/sync/{classroom.uuid}",
            data=self.encrypted_body(client_keys, {"device_id": "local-delete"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {session.token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = self.decrypted_response(response, client_keys)
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["version"], 5)
        classroom.refresh_from_db()
        self.assertTrue(classroom.is_deleted)
        self.assertEqual(classroom.last_modified_by, "local-delete")

        status_response = self.client.get(
            "/api/sync/status",
            HTTP_AUTHORIZATION=f"Bearer {session.token}",
        )
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(self.decrypted_response(status_response, client_keys)["classrooms"], [])

    def test_sync_delete_is_idempotent_for_already_deleted_classroom(self):
        user = CloudUser.objects.create(uid="u-delete-again")
        session, client_keys = self.create_session(user)
        classroom = CloudClassroom.objects.create(
            user=user,
            uuid=uuid.uuid4(),
            name="已删除云班",
            rows=2,
            cols=2,
            data_snapshot={},
            version=7,
            is_deleted=True,
        )

        response = self.client.delete(
            f"/api/sync/{classroom.uuid}",
            data=self.encrypted_body(client_keys, {}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {session.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.decrypted_response(response, client_keys)["version"], 7)
        classroom.refresh_from_db()
        self.assertTrue(classroom.is_deleted)
        self.assertEqual(classroom.version, 7)

    def test_sync_delete_returns_encrypted_payload_when_session_has_client_key(self):
        user = CloudUser.objects.create(uid="u-delete-encrypted")
        client_keys = generate_rsa_keypair()
        session = CloudSession.objects.create(
            user=user,
            token="delete-token-encrypted",
            device_id="test-device",
            client_key_id=client_keys['key_id'],
            client_public_key_pem=client_keys['public_key_pem'],
            expires_at=timezone.now() + timedelta(days=1),
        )
        classroom = CloudClassroom.objects.create(
            user=user,
            uuid=uuid.uuid4(),
            name="加密删除云班",
            rows=2,
            cols=2,
            data_snapshot={},
            version=2,
        )

        response = self.client.delete(
            f"/api/sync/{classroom.uuid}",
            data=self.encrypted_body(client_keys, {}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {session.token}",
        )

        self.assertEqual(response.status_code, 200)
        decrypted = self.decrypted_response(response, client_keys)
        self.assertEqual(decrypted['status'], 'success')
        self.assertEqual(decrypted['version'], 3)


class CloudSyncStorageTests(TestCase):
    def fuckseats_snapshot(self, name="云端同步班", rows=3, cols=4, history_entries=None, ai_conversations=None):
        seats = [
            {
                "row": row,
                "col": col,
                "cell_type": "seat",
                "student_pk": None,
                "student_id": None,
                "student_name": None,
                "group_name": None,
            }
            for row in range(1, rows + 1)
            for col in range(1, cols + 1)
        ]
        state_seats = [
            {
                "row": row,
                "col": col,
                "cell_type": "seat",
                "student_pk": None,
                "group_pk": None,
            }
            for row in range(1, rows + 1)
            for col in range(1, cols + 1)
        ]
        data = {
            "meta": {
                "app": "不想排座位",
                "version": "2.0",
                "schema": "full",
                "exported_at": timezone.now().isoformat(),
            },
            "classroom": {
                "name": name,
                "rows": rows,
                "cols": cols,
                "left_guardian_student_pk": None,
                "left_guardian_student_id": None,
                "left_guardian_student_name": None,
                "right_guardian_student_pk": None,
                "right_guardian_student_id": None,
                "right_guardian_student_name": None,
            },
            "seats": seats,
            "groups": [],
            "students": [{"name": "张三", "student_id": "001", "gender": "M", "score": 90}],
            "constraints": [],
            "current_state": {
                "classroom": {
                    "pk": 1,
                    "name": name,
                    "rows": rows,
                    "cols": cols,
                    "left_guardian_student_pk": None,
                    "right_guardian_student_pk": None,
                    "created_at": "",
                },
                "students": [{"pk": 1, "name": "张三", "student_id": "001", "gender": "M", "score": 90}],
                "groups": [],
                "seats": state_seats,
                "constraints": [],
                "layout_snapshots": [],
            },
            "history": {"entries": history_entries or []},
        }
        if ai_conversations is not None:
            data["ai_conversations"] = ai_conversations
        return data

    def test_push_stores_classroom_snapshot(self):
        user = CloudUser.objects.create(uid="u-sync")
        classroom_uuid = uuid.uuid4()

        result = push_classroom_snapshot(user, {
            "uuid": str(classroom_uuid),
            "base_version": 0,
            "device_id": "test-device",
            "data": self.fuckseats_snapshot(),
        })

        self.assertTrue(result["ok"])
        classroom = CloudClassroom.objects.get(user=user, uuid=classroom_uuid)
        self.assertEqual(classroom.name, "云端同步班")
        self.assertEqual(classroom.rows, 3)
        self.assertEqual(classroom.cols, 4)
        self.assertEqual(classroom.version, 1)
        self.assertEqual(classroom.data_snapshot["students"][0]["name"], "张三")

    def test_push_stores_client_operation_time(self):
        user = CloudUser.objects.create(uid="u-sync-operation-time")
        classroom_uuid = uuid.uuid4()
        operation_at = timezone.now() - timedelta(hours=3)

        result = push_classroom_snapshot(user, {
            "uuid": str(classroom_uuid),
            "base_version": 0,
            "device_id": "test-device",
            "last_operation_at": operation_at.isoformat(),
            "data": self.fuckseats_snapshot(),
        })

        classroom = CloudClassroom.objects.get(user=user, uuid=classroom_uuid)
        self.assertTrue(result["ok"])
        self.assertEqual(classroom.last_modified_at, operation_at)
        self.assertEqual(result["last_operation_at"], operation_at.isoformat())

    def test_push_accepts_student_tag_fields(self):
        user = CloudUser.objects.create(uid="u-tags")
        classroom_uuid = uuid.uuid4()
        data = self.fuckseats_snapshot()
        data["student_tags"] = [{
            "tag_pk": 1,
            "name": "近视",
            "color": "#0a59f7",
            "description": "需要靠前",
            "sort_order": 0,
        }]
        data["student_tag_memberships"] = [{
            "student_pk": 1,
            "student_id": "001",
            "student_name": "张三",
            "tag_pk": 1,
            "tag_name": "近视",
            "note": "",
        }]
        data["student_tag_rules"] = [{
            "tag_rule_pk": 1,
            "tag_pk": 1,
            "tag_name": "近视",
            "rule_type": "must_area",
            "row_min": 1,
            "row_max": 2,
            "col_min": None,
            "col_max": None,
            "distance": 1,
            "enabled": True,
            "priority": 0,
            "note": "近视学生安排前两排",
        }]
        data["current_state"]["student_tags"] = [{
            "pk": 1,
            "name": "近视",
            "color": "#0a59f7",
            "description": "需要靠前",
            "sort_order": 0,
            "created_at": "",
            "updated_at": "",
        }]
        data["current_state"]["student_tag_memberships"] = [{
            "pk": 1,
            "student_pk": 1,
            "tag_pk": 1,
            "note": "",
            "created_at": "",
        }]
        data["current_state"]["student_tag_rules"] = [{
            "pk": 1,
            "tag_pk": 1,
            "rule_type": "must_area",
            "row_min": 1,
            "row_max": 2,
            "col_min": None,
            "col_max": None,
            "distance": 1,
            "enabled": True,
            "priority": 0,
            "note": "近视学生安排前两排",
            "created_at": "",
            "updated_at": "",
        }]
        data["current_state"]["layout_snapshots"] = [{
            "pk": 1,
            "name": "带标签快照",
            "created_at": "",
            "data": {
                "meta": {
                    "app": "不想排座位",
                    "version": "1.0",
                    "exported_at": timezone.now().isoformat(),
                },
                "classroom": data["classroom"],
                "seats": data["seats"],
                "groups": data["groups"],
                "constraints": data["constraints"],
                "student_tags": data["student_tags"],
                "student_tag_rules": data["student_tag_rules"],
            },
        }]

        result = push_classroom_snapshot(user, {
            "uuid": str(classroom_uuid),
            "base_version": 0,
            "device_id": "test-device",
            "data": data,
        })

        self.assertTrue(result["ok"])
        classroom = CloudClassroom.objects.get(user=user, uuid=classroom_uuid)
        self.assertEqual(classroom.data_snapshot["student_tags"][0]["name"], "近视")
        self.assertEqual(classroom.data_snapshot["student_tag_rules"][0]["rule_type"], "must_area")

    def test_force_push_overwrites_newer_cloud_version(self):
        user = CloudUser.objects.create(uid="u-force")
        classroom_uuid = uuid.uuid4()
        classroom = CloudClassroom.objects.create(
            user=user,
            uuid=classroom_uuid,
            name="旧班级",
            rows=2,
            cols=2,
            data_snapshot=self.fuckseats_snapshot("旧班级", 2, 2),
            version=5,
        )

        conflict = push_classroom_snapshot(user, {
            "uuid": str(classroom_uuid),
            "base_version": 4,
            "data": self.fuckseats_snapshot("本地版本", 4, 4),
        })
        self.assertTrue(conflict["conflict"])

        result = push_classroom_snapshot(user, {
            "uuid": str(classroom_uuid),
            "base_version": 4,
            "force": True,
            "data": self.fuckseats_snapshot("本地版本", 4, 4),
        })

        self.assertTrue(result["ok"])
        classroom.refresh_from_db()
        self.assertEqual(classroom.name, "本地版本")
        self.assertEqual(classroom.version, 6)

    def test_push_rejects_non_fuckseats_payload(self):
        user = CloudUser.objects.create(uid="u-invalid")
        classroom_uuid = uuid.uuid4()
        data = self.fuckseats_snapshot()
        data["meta"]["app"] = "other-app"

        with self.assertRaisesMessage(ValueError, "仅允许上传 FuckSeats"):
            push_classroom_snapshot(user, {
                "uuid": str(classroom_uuid),
                "base_version": 0,
                "data": data,
            })

        self.assertFalse(CloudClassroom.objects.filter(user=user, uuid=classroom_uuid).exists())

    def test_free_tier_rejects_history_entries(self):
        user = CloudUser.objects.create(uid="u-free")
        classroom_uuid = uuid.uuid4()
        data = self.fuckseats_snapshot(history_entries=[{
            "action_type": "move",
            "payload": {},
            "is_applied": True,
            "created_at": timezone.now().isoformat(),
        }])

        with self.assertRaisesMessage(PermissionError, "当前订阅不支持同步历史记录"):
            push_classroom_snapshot(user, {
                "uuid": str(classroom_uuid),
                "base_version": 0,
                "data": data,
            })

        self.assertFalse(CloudClassroom.objects.filter(user=user, uuid=classroom_uuid).exists())

    def test_pro_tier_rejects_ai_conversations(self):
        user = CloudUser.objects.create(uid="u-pro", subscription_tier="pro")
        classroom_uuid = uuid.uuid4()
        data = self.fuckseats_snapshot(ai_conversations=[{
            "session_key": "s1",
            "title": "AI 对话",
            "last_mode": "",
            "last_response_id": "",
            "created_at": timezone.now().isoformat(),
            "updated_at": timezone.now().isoformat(),
            "messages": [{"role": "user", "content": "你好", "payload": {}, "created_at": timezone.now().isoformat()}],
        }])

        with self.assertRaisesMessage(PermissionError, "当前订阅不支持同步 AI 对话"):
            push_classroom_snapshot(user, {
                "uuid": str(classroom_uuid),
                "base_version": 0,
                "data": data,
            })

        self.assertFalse(CloudClassroom.objects.filter(user=user, uuid=classroom_uuid).exists())

    def test_expired_subscription_uses_free_limits(self):
        user = CloudUser.objects.create(
            uid="u-expired",
            subscription_tier="pro_max",
            subscription_expires_at=timezone.now() - timedelta(days=1),
        )
        classroom_uuid = uuid.uuid4()
        data = self.fuckseats_snapshot(history_entries=[{
            "action_type": "move",
            "payload": {},
            "is_applied": True,
            "created_at": timezone.now().isoformat(),
        }])

        with self.assertRaisesMessage(PermissionError, "当前订阅不支持同步历史记录"):
            push_classroom_snapshot(user, {
                "uuid": str(classroom_uuid),
                "base_version": 0,
                "data": data,
            })
