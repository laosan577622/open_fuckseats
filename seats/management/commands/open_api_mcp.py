from django.core.management.base import BaseCommand

from seats.open_api.mcp import serve_stdio


class Command(BaseCommand):
    help = 'Run the FuckSeats Open API MCP stdio server.'

    def handle(self, *args, **options):
        serve_stdio()
