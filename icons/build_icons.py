#!/usr/bin/env python3
"""Regenerate PNG icons from the SVG sources.

Requires: pip install cairosvg
Run:      python3 icons/build_icons.py

Outputs:
  icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png, icons/favicon-32.png
  icons/icon-maskable-512.png
  android/app/src/main/res/mipmap-*/ic_launcher.png
"""
import os
import cairosvg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
MASTER = os.path.join(ICONS, "icon.svg")
MASKABLE = os.path.join(ICONS, "icon-maskable.svg")


def render(src, out, size):
    cairosvg.svg2png(url=src, write_to=out, output_width=size, output_height=size)
    print(f"{os.path.relpath(out, ROOT)} ({size}x{size})")


def main():
    render(MASTER, os.path.join(ICONS, "icon-192.png"), 192)
    render(MASTER, os.path.join(ICONS, "icon-512.png"), 512)
    render(MASKABLE, os.path.join(ICONS, "apple-touch-icon.png"), 180)
    render(MASTER, os.path.join(ICONS, "favicon-32.png"), 32)
    render(MASKABLE, os.path.join(ICONS, "icon-maskable-512.png"), 512)

    # Android legacy launcher icons (full-bleed, masked by the launcher)
    android = os.path.join(ROOT, "android", "app", "src", "main", "res")
    for bucket, size in [
        ("mipmap-mdpi", 48),
        ("mipmap-hdpi", 72),
        ("mipmap-xhdpi", 96),
        ("mipmap-xxhdpi", 144),
        ("mipmap-xxxhdpi", 192),
    ]:
        out = os.path.join(android, bucket, "ic_launcher.png")
        if os.path.isdir(os.path.dirname(out)):
            render(MASKABLE, out, size)


if __name__ == "__main__":
    main()
