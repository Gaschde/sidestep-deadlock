from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np


VIDEO = Path(r"C:\Users\sampa\Desktop\chinese news 1.mp4")
FFMPEG = Path(r"C:\Program Files\DownloadHelper CoApp\ffmpeg.exe")
WIDTH = 720
HEIGHT = 100
FPS = 30


def main() -> None:
    command = [
        str(FFMPEG),
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(VIDEO),
        "-vf",
        "crop=720:100:0:890,format=gray",
        "-f",
        "rawvideo",
        "-",
    ]
    result = subprocess.run(command, check=True, stdout=subprocess.PIPE)
    frames = np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, HEIGHT, WIDTH)

    masks = frames > 165
    counts = masks.sum(axis=(1, 2))
    changes = np.zeros(len(frames), dtype=np.float64)
    changes[1:] = np.mean(masks[1:] != masks[:-1], axis=(1, 2))

    print(f"frames={len(frames)} duration={len(frames) / FPS:.3f}")
    print("largest mask changes:")
    for index in np.argsort(changes)[-30:][::-1]:
        print(f"{index / FPS:7.3f}s frame={index:3d} change={changes[index]:.5f} count={counts[index]}")

    print("\n0.1-second samples:")
    for index in range(0, len(frames), 3):
        print(f"{index / FPS:7.3f} {counts[index]:5d} {changes[index]:.5f}")


if __name__ == "__main__":
    main()
