from django.apps import AppConfig


class CloudConfig(AppConfig):
    name = 'cloud'
    verbose_name = '不想排座位云端后端'

    def ready(self):
        pass # 此部分代码未被披露至开源版本
