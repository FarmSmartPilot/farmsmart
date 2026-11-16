"""Original background music for the FarmSmart video (synthesised from scratch; no samples, no third-party audio).
Usage: python music2.py <cues.json> <out.wav>
cues.json: {"length": 30.0, "beat_in": 1.5, "lift": 11.5, "accent": 17.25, "drums_out": 26.5, "resolve": 27.5}
120 BPM, warm D-major progression; pad + plucked motif from the start, light beat from beat_in, bass and fuller
drums from lift, an accent hit, a riser into the resolve, a final chord that rings out."""
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, lfilter

SR = 48000
C = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = sys.argv[2]
L = C["length"]; N = int(L * SR)
rng = np.random.default_rng(11)
BEAT = 0.5; BAR = 2.0
mid = lambda m: 440.0 * 2 ** ((m - 69) / 12)
PROG = [[50, 57, 62, 66, 69], [45, 57, 61, 64, 69], [47, 54, 59, 62, 66], [43, 55, 59, 62, 67]]
PROG2 = [[50, 57, 62, 66, 69], [45, 57, 61, 64, 69], [43, 55, 59, 62, 67], [45, 57, 61, 64, 69]]
HOME = [50, 57, 62, 66, 69]

Lc = np.zeros(N); Rc = np.zeros(N)


def add(sig, t0, pan=0.0, gain=1.0):
    i = int(round(t0 * SR))
    if i >= N or i < 0:
        return
    sig = sig[: N - i] * gain
    Lc[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan)); Rc[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))


def env(n, a, r):
    e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** 1.5
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def pad(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for det in (-0.1, 0.0, 0.09):
        ff = f * 2 ** (det / 12)
        for h in range(1, 8):
            if ff * h > 8000: break
            s += np.sin(2 * np.pi * ff * h * t + rng.uniform(0, 6.28)) * (1 / h) ** 1.7
    return s * env(n, min(0.7, dur * 0.35), min(1.0, dur * 0.4)) * (1 + 0.05 * np.sin(2 * np.pi * 0.4 * t)) / 6


def pluck(f, dur=1.4, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.42), (3, 0.2), (4, 0.11), (5, 0.06), (6, 0.03)):
        s += a * np.sin(2 * np.pi * f * h * t) * np.exp(-t * (2.6 + 1.9 * h))
    return (s + 0.25 * np.sin(np.pi * f * t) * np.exp(-t * 3)) * np.minimum(1, t / 0.004) * vel


def kick():
    n = int(0.4 * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(46 + 70 * np.exp(-t * 28)) / SR
    return np.sin(ph) * np.exp(-t * 9) * np.minimum(1, t / 0.002)


def noise_hit(dur, decay, hp=0.55):
    n = int(dur * SR); t = np.arange(n) / SR
    return lfilter([1, -1], [1, -hp], rng.standard_normal(n)) * np.exp(-t * decay)


def clap():
    n = int(0.25 * SR); t = np.arange(n) / SR
    x = lfilter([1, -1], [1, -0.3], rng.standard_normal(n)) * np.exp(-t * 22)
    return x * 0.6 + 0.3 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)


def bass(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return s * env(n, 0.012, min(0.2, dur * 0.4)) * np.exp(-t * 1.0)


def riser(t0, t1):
    n = int((t1 - t0) * SR); t = np.arange(n) / SR; p = t / t[-1]
    x = rng.standard_normal(n); y = np.zeros(n); a = 0.97
    for k in range(0, n, 480):  # lowpass that opens up
        a = 0.97 - 0.75 * p[k]
        seg = x[k:k + 480]
        y[k:k + 480] = lfilter([1 - a], [1, -a], seg)
    return y * p ** 2


BI, LI, AC, DO, RE = C["beat_in"], C["lift"], C["accent"], C["drums_out"], C["resolve"]
nbars = int(np.ceil(RE / BAR))
for b in range(nbars):
    t0 = b * BAR
    if t0 >= RE - 0.01:
        break
    ch = (PROG if (b // 4) % 2 == 0 else PROG2)[b % 4]
    end = min(t0 + BAR + 0.35, RE + 0.3)
    for k, m in enumerate(ch[1:]):
        add(pad(mid(m), end - t0), t0, pan=-0.5 + k / 3, gain=0.5 if t0 < LI else 0.62)
    notes = [m + 12 for m in ch[1:]] + [ch[2] + 24]
    for i, j in enumerate([0, 1, 2, 3, 4, 3, 2, 1]):
        tt = t0 + i * BEAT / 2
        if tt >= RE - 0.05:
            break
        add(pluck(mid(notes[j]), 1.3, (0.9 if i % 2 == 0 else 0.6)), tt + rng.normal(0, 0.003), pan=0.35 * np.sin(i), gain=0.15)
    for q in range(4):
        tt = t0 + q * BEAT
        if tt < BI - 0.01 or tt >= DO - 0.01:
            continue
        full = tt >= LI - 0.01
        if q in (0, 2) or full:
            add(kick(), tt, gain=0.34 if full else 0.3)
        if full and q in (1, 3):
            add(clap(), tt, pan=0.05, gain=0.16)
        add(noise_hit(0.08, 55), tt + BEAT / 2, pan=0.3, gain=0.09 if full else 0.07)
    if t0 >= LI - 0.01 and t0 < DO:
        add(bass(mid(ch[0] - 12), BEAT * 1.9), t0, gain=0.2)
        add(bass(mid(ch[0] - 12), BEAT * 1.9), t0 + 2 * BEAT, gain=0.17)

add(noise_hit(1.6, 2.4, 0.2), AC, gain=0.16)                  # accent on the profit numbers
add(kick(), AC, gain=0.4)
add(riser(DO - 1.0, RE), DO - 1.0, gain=0.10)                  # riser into the resolve
for k, m in enumerate(HOME):                                   # resolve: home chord rings out
    add(pad(mid(m), L - RE), RE, pan=-0.5 + k / 4, gain=0.6)
    if k:
        add(pluck(mid(m + 12), 3.0, 0.85), RE + k * 0.03, pan=-0.4 + k / 5, gain=0.16)
add(kick(), RE, gain=0.3)

ir_n = int(2.3 * SR); tt = np.arange(ir_n) / SR
irs = [lfilter([0.25], [1, -0.75], np.random.default_rng(s).standard_normal(ir_n) * np.exp(-tt * 2.7)) for s in (21, 22)]
wl = fftconvolve(Lc, irs[0])[:N]; wr = fftconvolve(Rc, irs[1])[:N]
st = np.stack([Lc + 0.22 * wl / np.max(np.abs(wl)) * np.max(np.abs(Lc)), Rc + 0.22 * wr / np.max(np.abs(wr)) * np.max(np.abs(Rc))], 1)
st /= np.max(np.abs(st)) + 1e-9
st = np.tanh(st * 1.4) / np.tanh(1.4)
fi = int(0.2 * SR); fo = int(max(0.5, L - (L - 1.0)) * SR)
st[:fi] *= np.linspace(0, 1, fi)[:, None]
st[-fo:] *= (np.linspace(1, 0, fo) ** 1.4)[:, None]
wavfile.write(OUT, SR, (st * 0.89).astype(np.float32))
print(f"music {L:.2f}s, 120 bpm, cues {C}")
