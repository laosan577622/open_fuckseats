from django.test import TestCase
from django.urls import reverse
import json

from .models import Classroom, SeatConstraint, SeatCellType, SeatGroup
from .views import _arrange_standard, _arrange_grouped, _apply_internal_policy


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
