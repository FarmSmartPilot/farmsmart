"""Assemble the FarmSmart video: timestamped 4K screencast frames -> constant 24 fps H.264, plus the original music
(loudness-normalised) and an .srt of the captions. Usage: python build.py <out_dir>"""
import json
import os
import subprocess
import sys

SRC = os.path.dirname(os.path.abspath(__file__))
HERE = os.environ.get("FS_VIDEO_DIR") or os.path.join(SRC, "work")  # frames + timeline from record_farm.mjs
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
tl = json.load(open(os.path.join(HERE, "timeline.json"), encoding="utf-8"))
# Trim to an exact length: drop START seconds of the opening title hold, end at START + LENGTH.
START = float(os.environ.get("TRIM_START", "0")); LENGTH = float(os.environ.get("LENGTH", "0")) or (tl["endWall"] - START)
t0, end = tl["t0Wall"] + START, LENGTH
tl["marks"] = {k: v - START for k, v in tl["marks"].items()}
tl["captions"] = [{**c, "start": c["start"] - START, "end": c["end"] - START} for c in tl["captions"]]
fr = [f for f in tl["frames"] if os.path.exists(os.path.join(HERE, "frames", f"{f['i']:06d}.jpg"))]
# keep the last frame at or before t0 (it covers t=0) and everything after
first = max([k for k, f in enumerate(fr) if f["ts"] <= t0] or [0])
fr = [f for f in fr[first:] if f["ts"] - t0 < end]
times = [max(0.0, f["ts"] - t0) for f in fr]
print(f"{len(fr)} frames, {fr[0]['w']}x{fr[0]['h']}, video {end:.2f}s, mean capture {len(fr) / end:.1f} fps")

lst = os.path.join(HERE, "frames.txt")
with open(lst, "w", encoding="utf-8") as fh:
    # the first frame covers t=0 .. its successor
    for k, f in enumerate(fr):
        nxt = times[k + 1] if k + 1 < len(fr) else end
        d = max(0.001, nxt - (0.0 if k == 0 else times[k]))
        fh.write(f"file 'frames/{f['i']:06d}.jpg'\nduration {d:.5f}\n")
    fh.write(f"file 'frames/{fr[-1]['i']:06d}.jpg'\n")

marks = tl["marks"]
wav = os.path.join(HERE, "music.wav")
py = sys.executable
cues = {"length": end, "beat_in": marks["beat_in"], "lift": marks["lift"], "accent": marks["accent"],
        "drums_out": marks["resolve"] - 1.0, "resolve": marks["resolve"]}
cj = os.path.join(HERE, "cues.json")
json.dump(cues, open(cj, "w"))
subprocess.run([py, "-I", os.path.join(SRC, "music2.py"), cj, wav], check=True)

def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

srt = os.path.join(OUT, "farmsmart_30s_wholefarm.en.srt")
with open(srt, "w", encoding="utf-8") as fh:
    n = 0
    for c in tl["captions"]:
        if not c.get("text"):
            continue
        n += 1
        fh.write(f"{n}\n{ts(c['start'])} --> {ts(min(c['end'], end))}\n{c['text']}\n\n")
    n += 1
    o = marks["resolve"] + 0.4
    fh.write(f"{n}\n{ts(o)} --> {ts(end)}\nFarmSmart: plan the whole farm, one field at a time. Built on NASA, USDA and NOAA data. You make the call.\n\n")

mp4 = os.path.join(OUT, "farmsmart_30s_wholefarm_4k24.mp4")
cmd = ["ffmpeg", "-y", "-v", "error", "-stats",
       "-f", "concat", "-safe", "0", "-i", lst, "-i", wav,
       "-filter_complex",
       "[0:v]scale=3840:2160:flags=lanczos,fps=24,format=yuv420p[v];"
       "[1:a]highpass=f=32,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
       "-map", "[v]", "-map", "[a]", "-t", f"{end:.3f}",
       "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high", "-level:v", "5.1",
       "-x264-params", "keyint=48:min-keyint=24", "-r", "24", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
       "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
       "-metadata", "title=FarmSmart: Smarter choices. Better seasons.",
       "-metadata", "comment=Screen recording of the real FarmSmart app (real data). Captions, cursor and title cards added; music generated with SI.",
       "-movflags", "+faststart", mp4]
subprocess.run(cmd, cwd=HERE, check=True)
print("wrote", mp4, "and", srt)
