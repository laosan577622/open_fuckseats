@require_POST
def set_group_leader(request, pk):
    classroom = get_object_or_404(Classroom, pk=pk)
    try:
        data = json.loads(request.body)
        student_id = data.get('student_id')
        
        student = get_object_or_404(Student, pk=student_id, classroom=classroom)
        seat = student.assigned_seat
        if not seat or not seat.group:
            return JsonResponse({'status': 'error', 'message': '该学生未分配或未在小组中'}, status=400)
            
        group = seat.group
        group.leader = student
        group.save()
        
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
