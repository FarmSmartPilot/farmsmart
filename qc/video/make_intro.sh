#!/usr/bin/env bash
# Record the intro (Playwright, real app on :5173) and cut the 10-second clip to docs/demo/field_shift_intro_10s.mp4.
set -e
cd "$(dirname "$0")/../../web"
rm -rf ../qc/video/out
NODE_PATH="$(pwd)/node_modules" PATH="/c/Program Files/nodejs:$PATH" npx playwright test -c ../qc/video/video.config.ts
START=$(cat ../qc/video/out/start.txt)
FFMPEG=${FFMPEG:-ffmpeg}
"$FFMPEG" -y -v error -ss "$START" -i ../qc/video/out/intro-intro-video/video.webm -t 10   -vf "fade=t=in:st=0:d=0.3,fade=t=out:st=9.5:d=0.5,format=yuv420p" -c:v libx264 -preset slow -crf 20 -movflags +faststart -an   ../docs/demo/field_shift_intro_10s.mp4
echo "clip from ${START}s -> docs/demo/field_shift_intro_10s.mp4"
