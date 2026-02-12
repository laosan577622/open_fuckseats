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
        # Automatically create seats if new
        if is_new:
            self.generate_seats()

    def generate_seats(self):
        # Create seats for the grid
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
