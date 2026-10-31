"""生成应用图标，沿用四座位蓝色标识。"""
from pathlib import Path

from PIL import Image, ImageDraw


def build_icons(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGBA', (1024, 1024))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, 1000, 1000), radius=220, fill='#ffffff')
    for x, y, color in ((176, 176, '#0a59f7'), (548, 176, '#548df9'),
                        (176, 548, '#548df9'), (548, 548, '#0a59f7')):
        draw.rounded_rectangle((x, y, x + 300, y + 300), radius=78, fill=color)
    image.save(destination / 'app-icon.png')
    image.save(destination / 'app-icon.ico', sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
    image.save(destination / 'app-icon.icns', sizes=[(size, size) for size in (16, 32, 64, 128, 256, 512, 1024)])


if __name__ == '__main__':
    build_icons(Path(__file__).resolve().parents[1] / 'static')
