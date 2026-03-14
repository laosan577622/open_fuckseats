from django.apps import AppConfig


class SeatsConfig(AppConfig):
    name = 'seats'

    def ready(self):
        from .plugin_system import plugin_registry

        plugin_registry.ensure_loaded()
        plugin_registry.emit('app_ready')
