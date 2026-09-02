from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(r"C:\Users\sampa\Desktop\sidestep-deadlock")
PORTRAIT_SOURCE = Path(r"C:\Users\sampa\Desktop\Bewerbung\Yeshe.jpg")
ASSET_DIR = ROOT / "edit_assets"
WIDTH, HEIGHT = 720, 1280


def center_x(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return (WIDTH - (box[2] - box[0])) / 2 - box[0]


def make_portrait() -> Image.Image:
    source = Image.open(PORTRAIT_SOURCE).convert("RGB")
    target_width, target_height = 317, 203

    # Use the same portrait at two scales: a soft full-bleed office background and
    # the complete source frame on top. This keeps the subject's native proportions
    # while matching the original broadcast inset's subject size and right bias.
    background_scale = max(target_width / source.width, target_height / source.height)
    background_size = (
        round(source.width * background_scale),
        round(source.height * background_scale),
    )
    background = source.resize(background_size, Image.Resampling.LANCZOS)
    left = (background.width - target_width) // 2
    top = max(0, (background.height - target_height) // 2 - 8)
    background = background.crop((left, top, left + target_width, top + target_height))
    background = background.filter(ImageFilter.GaussianBlur(7.0))

    foreground_scale = target_height / source.height
    foreground = source.resize(
        (round(source.width * foreground_scale), target_height),
        Image.Resampling.LANCZOS,
    )
    foreground_left = 74
    mask = Image.new("L", foreground.size, 255)
    mask_pixels = mask.load()
    feather = 14
    for x in range(foreground.width):
        edge_alpha = min(255, round(255 * min(x + 1, foreground.width - x) / feather))
        if edge_alpha < 255:
            for y in range(foreground.height):
                mask_pixels[x, y] = edge_alpha
    background.paste(foreground, (foreground_left, 0), mask)

    background = ImageEnhance.Color(background).enhance(0.94)
    background = ImageEnhance.Contrast(background).enhance(0.96)
    background = background.filter(ImageFilter.GaussianBlur(0.35))

    # A JPEG round trip introduces the same gentle softness and chroma compression
    # visible in the source inset before the final H.264 encode.
    intermediate = ASSET_DIR / "portrait_broadcast.jpg"
    background.save(intermediate, quality=82, subsampling=2, optimize=True)
    return Image.open(intermediate).convert("RGBA")


def make_headline_overlay() -> Image.Image:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    red = (226, 0, 0, 255)

    # Repaint only the interior of the two-part rounded banner, leaving the source
    # banner's compressed outer edge and shadow untouched beneath this overlay.
    draw.rounded_rectangle((99, 185, 627, 327), radius=13, fill=red)
    draw.rounded_rectangle((59, 303, 660, 387), radius=13, fill=red)

    font = ImageFont.truetype(r"C:\Windows\Fonts\LiberationSansNarrow-Regular.ttf", 40)
    color = (241, 238, 238, 255)
    lines = [
        "Swiss Deadlock Profi",
        '"Sidestep Gaschde" officially been',
        "mentioned in Chinese state Media",
    ]
    tops = (204, 265, 326)
    for text, y in zip(lines, tops):
        x = center_x(draw, text, font)
        draw.text((x, y), text, font=font, fill=color)
    return overlay


def make_subtitle_overlay(lines: list[str], tops: list[int]) -> Image.Image:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(r"C:\Windows\Fonts\Roboto-Bold_2.ttf", 27)
    for text, y in zip(lines, tops):
        x = center_x(draw, text, font)
        draw.text(
            (x + 1, y + 2),
            text,
            font=font,
            fill=(2, 3, 15, 220),
            stroke_width=1,
            stroke_fill=(2, 3, 15, 220),
        )
        draw.text(
            (x, y),
            text,
            font=font,
            fill=(242, 242, 246, 255),
            stroke_width=1,
            stroke_fill=(29, 29, 43, 255),
        )
    return overlay


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    portrait_overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    portrait_overlay.alpha_composite(make_portrait(), (0, 454))
    portrait_overlay.save(ASSET_DIR / "portrait_overlay.png", optimize=True)

    make_headline_overlay().save(ASSET_DIR / "headline_overlay.png", optimize=True)
    make_subtitle_overlay(["in Zürich, Switzerland"], [913]).save(
        ASSET_DIR / "subtitle_first.png", optimize=True
    )
    make_subtitle_overlay(
        ["to arrest the best Deadlock Player", "in the world"], [913, 944]
    ).save(ASSET_DIR / "subtitle_last.png", optimize=True)


if __name__ == "__main__":
    main()
