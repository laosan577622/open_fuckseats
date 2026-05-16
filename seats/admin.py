from django.contrib import admin

from .models import StudentTag, StudentTagMembership, StudentTagRule


@admin.register(StudentTag)
class StudentTagAdmin(admin.ModelAdmin):
    list_display = ('name', 'classroom', 'color', 'sort_order', 'created_at')
    list_filter = ('classroom',)
    search_fields = ('name', 'description')


@admin.register(StudentTagMembership)
class StudentTagMembershipAdmin(admin.ModelAdmin):
    list_display = ('student', 'tag', 'classroom', 'created_at')
    list_filter = ('classroom', 'tag')
    search_fields = ('student__name', 'student__student_id', 'tag__name')


@admin.register(StudentTagRule)
class StudentTagRuleAdmin(admin.ModelAdmin):
    list_display = ('tag', 'rule_type', 'classroom', 'enabled', 'priority')
    list_filter = ('classroom', 'rule_type', 'enabled')
    search_fields = ('tag__name', 'note')
