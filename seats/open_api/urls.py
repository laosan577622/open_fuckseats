from django.urls import path

from . import views


urlpatterns = [
    path('', views.discovery, name='open_api_discovery'),
    path('classrooms', views.classrooms, name='open_api_classrooms'),
    path('classrooms/<int:classroom_id>', views.classroom_detail, name='open_api_classroom_detail'),
    path('classrooms/<int:classroom_id>/enums', views.classroom_enums, name='open_api_classroom_enums'),
    path('classrooms/<int:classroom_id>/seats', views.classroom_seats, name='open_api_classroom_seats'),
    path('classrooms/<int:classroom_id>/students', views.classroom_students, name='open_api_classroom_students'),
    path('classrooms/<int:classroom_id>/constraints', views.classroom_constraints, name='open_api_classroom_constraints'),
    path('classrooms/<int:classroom_id>/groups', views.classroom_groups, name='open_api_classroom_groups'),
    path('classrooms/<int:classroom_id>/snapshots', views.classroom_snapshots, name='open_api_classroom_snapshots'),
    path('classrooms/<int:classroom_id>/tags', views.classroom_tags, name='open_api_classroom_tags'),
    path('tools/execute', views.execute_tool, name='open_api_execute_tool'),
    path('tools/batch', views.batch_tools, name='open_api_batch_tools'),
    path('openapi.json', views.openapi_json, name='open_api_openapi_json'),
]
