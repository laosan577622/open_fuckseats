from django.db import models


class SeatCellType(models.TextChoices):
    SEAT = 'seat', '座位'
    AISLE = 'aisle', '走廊'
    PODIUM = 'podium', '讲台'
    EMPTY = 'empty', '空位'

class Classroom(models.Model):
    name = models.CharField(max_length=100, verbose_name="班级/教室名称")
    rows = models.IntegerField(default=6, verbose_name="行数")
    cols = models.IntegerField(default=8, verbose_name="列数")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        # 新建后补齐座位
        if is_new:
            self.generate_seats()

    def generate_seats(self):
        # 按网格补齐座位
        current_seats = self.seats.all()
        existing_coords = set((s.row, s.col) for s in current_seats)
        
        seats_to_create = []
        for r in range(1, self.rows + 1):
            for c in range(1, self.cols + 1):
                if (r, c) not in existing_coords:
                    seats_to_create.append(Seat(classroom=self, row=r, col=c))
        
        Seat.objects.bulk_create(seats_to_create)

    class Meta:
        verbose_name = "班级"
        verbose_name_plural = verbose_name


class FutureModeConfig(models.Model):
    classroom = models.OneToOneField(Classroom, on_delete=models.CASCADE, related_name='future_mode_config')
    api_key = models.CharField(max_length=512, blank=True, default='', verbose_name="OpenAI API Key")
    base_url = models.CharField(max_length=300, blank=True, default='', verbose_name="OpenAI Base URL")
    model = models.CharField(max_length=120, blank=True, default='', verbose_name="OpenAI Model")
    thinking_mode = models.CharField(max_length=32, blank=True, default='', verbose_name="思考模式")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Future Mode 配置"
        verbose_name_plural = verbose_name

    def __str__(self):
        return f"{self.classroom.name}-FutureModeConfig"


class AIConversation(models.Model):
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='ai_conversations')
    session_key = models.CharField(max_length=64, blank=True, default='', db_index=True, verbose_name="会话归属")
    title = models.CharField(max_length=120, blank=True, default='新对话', verbose_name="对话标题")
    last_mode = models.CharField(max_length=16, blank=True, default='', verbose_name="最近推理模式")
    last_response_id = models.CharField(max_length=120, blank=True, default='', verbose_name="最近响应ID")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AI 对话"
        verbose_name_plural = verbose_name
        ordering = ['-updated_at', '-pk']
        indexes = [
            models.Index(fields=['classroom', 'session_key', '-updated_at'], name='ai_conv_owner_idx'),
        ]

    def __str__(self):
        return f"{self.classroom.name}-{self.title}"


class AIConversationMessage(models.Model):
    class MessageRole(models.TextChoices):
        USER = 'user', '用户'
        ASSISTANT = 'assistant', '助手'
        SYSTEM = 'system', '系统'
        TOOL = 'tool', '工具'

    conversation = models.ForeignKey(AIConversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=16, choices=MessageRole.choices, default=MessageRole.USER, verbose_name="角色")
    content = models.TextField(blank=True, default='', verbose_name="消息正文")
    payload = models.JSONField(blank=True, default=dict, verbose_name="扩展载荷")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "AI 对话消息"
        verbose_name_plural = verbose_name
        ordering = ['created_at', 'pk']
        indexes = [
            models.Index(fields=['conversation', 'created_at', 'id'], name='ai_msg_order_idx'),
        ]

    def __str__(self):
        return f"{self.conversation_id}-{self.role}-{self.pk}"


class SeatGroup(models.Model):
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='groups')
    name = models.CharField(max_length=50, verbose_name="小组名称")
    leader = models.OneToOneField('Student', on_delete=models.SET_NULL, null=True, blank=True, related_name='led_group', verbose_name="组长")
    order = models.PositiveIntegerField(default=0, verbose_name="排序")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "小组"
        verbose_name_plural = verbose_name
        unique_together = ('classroom', 'name')
        ordering = ['order', 'created_at']

    def __str__(self):
        return f"{self.classroom.name}-{self.name}"

class Student(models.Model):
    GENDER_CHOICES = (
        ('M', '男'),
        ('F', '女'),
    )
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='students', verbose_name="所属班级")
    name = models.CharField(max_length=50, verbose_name="姓名")
    student_id = models.CharField(max_length=20, blank=True, null=True, verbose_name="学号")
    gender = models.CharField(max_length=1, choices=GENDER_CHOICES, blank=True, null=True, verbose_name="性别")
    score = models.FloatField(default=0, verbose_name="成绩", help_text="用于按成绩排座")

    def __str__(self):
        return self.name

    @property
    def display_score(self):
        if self.score is None:
            return ""
        if self.score % 1 == 0:
            return int(self.score)
        return self.score

    class Meta:
        verbose_name = "学生"
        verbose_name_plural = verbose_name

class Seat(models.Model):
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='seats')
    row = models.IntegerField(verbose_name="行")
    col = models.IntegerField(verbose_name="列")
    student = models.OneToOneField(Student, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_seat', verbose_name="入座学生")
    cell_type = models.CharField(max_length=10, choices=SeatCellType.choices, default=SeatCellType.SEAT, verbose_name="单元类型")
    group = models.ForeignKey(SeatGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='seats', verbose_name="所属小组")

    class Meta:
        unique_together = ('classroom', 'row', 'col')
        ordering = ['row', 'col']
        verbose_name = "座位"
        verbose_name_plural = verbose_name


class LayoutSnapshot(models.Model):
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='layout_snapshots')
    name = models.CharField(max_length=80, verbose_name="布局名称")
    data = models.JSONField(verbose_name="布局数据")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "布局快照"
        verbose_name_plural = verbose_name
        unique_together = ('classroom', 'name')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.classroom.name}-{self.name}"


class SeatConstraint(models.Model):
    class ConstraintType(models.TextChoices):
        MUST_SEAT = 'must_seat', '指定座位'
        FORBID_SEAT = 'forbid_seat', '禁用座位'
        MUST_ROW = 'must_row', '指定行'
        FORBID_ROW = 'forbid_row', '禁用行'
        MUST_COL = 'must_col', '指定列'
        FORBID_COL = 'forbid_col', '禁用列'
        MUST_TOGETHER = 'must_together', '指定相邻'
        FORBID_TOGETHER = 'forbid_together', '禁止相邻'

    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='constraints')
    constraint_type = models.CharField(max_length=20, choices=ConstraintType.choices, verbose_name="约束类型")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='constraints', verbose_name="学生")
    target_student = models.ForeignKey(Student, on_delete=models.CASCADE, null=True, blank=True, related_name='targeted_constraints', verbose_name="关联学生")
    row = models.IntegerField(null=True, blank=True, verbose_name="行")
    col = models.IntegerField(null=True, blank=True, verbose_name="列")
    distance = models.PositiveIntegerField(default=1, verbose_name="距离")
    enabled = models.BooleanField(default=True, verbose_name="启用")
    note = models.CharField(max_length=120, blank=True, default='', verbose_name="备注")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "排座约束"
        verbose_name_plural = verbose_name
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.classroom.name}-{self.get_constraint_type_display()}-{self.student.name}"

class FrontendKVStore(models.Model):
    key = models.CharField(max_length=255, unique=True, verbose_name="键")
    value = models.TextField(blank=True, default='', verbose_name="值")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "前端配置"
        verbose_name_plural = verbose_name

    def __str__(self):
        return self.key
