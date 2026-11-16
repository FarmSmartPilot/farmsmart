"""Original background music for the FarmSmart video, synthesised from scratch (no samples, no third-party audio).
Usage: python music.py <seconds> <demo_start_seconds> <outro_start_seconds> <out.wav>
Warm D-major progression (D A Bm G ...), soft pad, piano-like arpeggio, bass + light drums from the demo on,
long ring-out over the end card. 48 kHz stereo float32."""
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, lfilter

SR = 48000
L = float(sys.argv[1]); DEMO = float(sys.argv[2]); OUTRO = float(sys.argv[3]); OUT = sys.argv[4]
N = int(L * SR)
rng = np.random.default_rng(7)

BARS = 12
bar = (OUTRO + 0.4) / (BARS - 1)          # last bar starts at the end card and rings out
beat = bar / 4
mid = lambda m: 440.0 * 2 ** ((m - 69) / 12)
# chord per bar (MIDI root-position voicings): D A Bm G | D A G A | Bm G D(add9) D
CH = [[50, 57, 62, 66, 69], [45, 57, 61, 64, 69], [47, 54, 59, 62, 66], [43, 55, 59, 62, 67],
      [50, 57, 62, 66, 69], [45, 57, 61, 64, 69], [43, 55, 59, 62, 67], [45, 57, 61, 64, 69],
      [47, 54, 59, 62, 66], [43, 55, 59, 62, 67], [50, 57, 62, 64, 66], [50, 57, 62, 66, 69]]

L_ch = np.zeros(N); R_ch = np.zeros(N)


def add(sig, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    L_ch[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan))
    R_ch[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** 1.5
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def pad_note(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for det in (-0.12, 0.0, 0.11):                       # detuned voices, band-limited saw-ish (soft)
        ff = f * 2 ** (det / 12)
        for h in range(1, 9):
            if ff * h > 9000: break
            s += np.sin(2 * np.pi * ff * h * t + rng.uniform(0, 6.28)) * (1 / h) ** 1.6
    s *= env(n, min(0.9, dur * 0.4), min(1.2, dur * 0.45))
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.35 * t)
    return s * trem / 6


def pluck(f, dur=1.6, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.42), (3, 0.2), (4, 0.11), (5, 0.06), (6, 0.03)):
        s += a * np.sin(2 * np.pi * f * h * t) * np.exp(-t * (2.6 + 1.9 * h))
    s += 0.25 * np.sin(2 * np.pi * f * 0.5 * t) * np.exp(-t * 3)  # body
    att = np.minimum(1, t / 0.004)
    return s * att * vel


def kick():
    n = int(0.42 * SR); t = np.arange(n) / SR
    f = 46 + 70 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * np.minimum(1, t / 0.002)


def shaker():
    n = int(0.09 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = lfilter([1, -1], [1, -0.55], x)                 # high-pass-ish
    return x * np.exp(-t * 55) * 0.5


def bass(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return s * env(n, 0.012, min(0.25, dur * 0.4)) * np.exp(-t * 1.2)


for b in range(BARS):
    t0 = b * bar
    ch = CH[b]
    last = b == BARS - 1
    dur = (L - t0) if last else bar + 0.35
    # pad: whole song, swells a little in the demo
    pg = 0.55 if t0 < DEMO else 0.7
    for k, m in enumerate(ch[1:]):
        add(pad_note(mid(m), dur), t0, pan=(-0.5 + k / 3), gain=pg)
    # arpeggio: from bar 1 (after the title swell), 8th notes, up and down the chord an octave higher
    if b >= 1 and not last:
        notes = [m + 12 for m in ch[1:]] + [ch[2] + 24]
        seq = [0, 1, 2, 3, 4, 3, 2, 1]
        for i, j in enumerate(seq):
            vel = (0.9 if i % 2 == 0 else 0.62) * (0.85 if t0 < DEMO else 1.0)
            add(pluck(mid(notes[j]), 1.4, vel), t0 + i * beat / 2 + rng.normal(0, 0.004), pan=0.35 * np.sin(i), gain=0.16)
    if last:  # final chord, struck once, ringing out
        for k, m in enumerate(ch[1:]):
            add(pluck(mid(m + 12), 4.0, 0.8), t0 + k * 0.035, pan=(-0.4 + k / 5), gain=0.16)
    # rhythm section from the demo on
    if t0 + 0.01 >= DEMO - bar * 0.5 and not last:
        for q in range(4):
            if q in (0, 2):
                add(kick(), t0 + q * beat, gain=0.38)
            add(shaker(), t0 + q * beat + beat / 2, pan=0.3, gain=0.10)
        add(bass(mid(ch[0] - 12), beat * 1.9), t0, gain=0.2)
        add(bass(mid(ch[0] - 12), beat * 1.9), t0 + 2 * beat, gain=0.17)

# reverb: stereo exponential-noise impulse (2.4 s), darkened
ir_n = int(2.4 * SR); tt = np.arange(ir_n) / SR
irs = []
for s in (11, 12):
    g = np.random.default_rng(s).standard_normal(ir_n) * np.exp(-tt * 2.6)
    irs.append(lfilter([0.25], [1, -0.75], g))
wetL = fftconvolve(L_ch, irs[0])[:N]; wetR = fftconvolve(R_ch, irs[1])[:N]
mixL = L_ch + 0.22 * wetL / np.max(np.abs(wetL)) * np.max(np.abs(L_ch))
mixR = R_ch + 0.22 * wetR / np.max(np.abs(wetR)) * np.max(np.abs(R_ch))
st = np.stack([mixL, mixR], 1)
st /= np.max(np.abs(st)) + 1e-9
st = np.tanh(st * 1.4) / np.tanh(1.4)               # gentle glue
fi = int(0.25 * SR); fo = int(2.6 * SR)
st[:fi] *= np.linspace(0, 1, fi)[:, None]
st[-fo:] *= (np.linspace(1, 0, fo) ** 1.6)[:, None]
wavfile.write(OUT, SR, (st * 0.89).astype(np.float32))
print(f"music {L:.2f}s, bar {bar:.2f}s ({240 / bar:.0f} bpm), demo at {DEMO:.1f}s, outro at {OUTRO:.1f}s -> {OUT}")
