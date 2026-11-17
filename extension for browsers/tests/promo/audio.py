"""Synthesizes the promo soundtrack from the composition's sound cues (no samples, no voice).

    python tests/promo/audio.py .artifacts/promo/out/cues-16x9.json out.wav

Every UI sound is built from sines and filtered noise: soft clicks, key taps, pops, whooshes,
a riser into a sub "boom" with a bell shimmer, and a quiet ambient pad whose chords change on
scene cuts. A convolution reverb glues it together.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(11)


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def env_exp(n, attack, decay):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def sweep_sine(f0, f1, d, curve="exp"):
    t = t_axis(d)
    if curve == "exp":
        f = f0 * (f1 / f0) ** (t / d)
    else:
        f = f0 + (f1 - f0) * t / d
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def svf(x, fc, q=0.7, mode="bp"):
    """Topology-preserving (Zavalishin) state-variable filter, stable at any cutoff."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    g = np.tan(np.pi * np.clip(fc, 20, 9000) / SR)
    k = 1 / q
    a1 = 1 / (1 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    ic1 = ic2 = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + a2[i] * v3
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v1 if mode == "bp" else v2 if mode == "lp" else x[i] - k * v1 - v2
    return out


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s = (1 - a) * x[i] + a * s
        y[i] = s
    return y


def fft_filter(x, lo=20, hi=20000, tilt=0.0):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = (f >= lo) & (f <= hi)
    shape = np.where(m, 1.0, 0.0) * np.where(f > 0, (np.maximum(f, 1) / 1000) ** tilt, 0)
    return np.fft.irfft(X * shape, len(x))


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def noise(n):
    return rng.standard_normal(n)


# --- Sound library -------------------------------------------------------------------------
def s_click(pitch=1.0):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 2900 * pitch * t) * np.exp(-t / 0.006)
    thock = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.01) * 0.6
    tick = np.diff(noise(n + 1)) * np.exp(-t / 0.0012) * 0.35
    return norm(body * 0.5 + thock + tick, 0.9)


def s_clickup(pitch=1.0):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 4100 * pitch * t) * np.exp(-t / 0.003)
    tick = np.diff(noise(n + 1)) * np.exp(-t / 0.0008) * 0.3
    return norm(body + tick, 0.6)


def s_key(pitch=1.0):
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    clack = svf(noise(n), 2300 * pitch, 2.2) * np.exp(-t / 0.009)
    thock = np.sin(2 * np.pi * 150 * pitch * t) * np.exp(-t / 0.014)
    return norm(clack * 0.8 + thock * 0.55, 0.8)


def s_pop(pitch=1.0):
    d = 0.16
    t = t_axis(d)
    f = 520 * pitch * (0.55 + 0.45 * np.exp(-t / 0.025))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * env_exp(len(t), 0.002, 0.045)
    return norm(x, 0.8)


def s_tick(pitch=1.0):
    n = int(0.04 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1900 * pitch * t) * np.exp(-t / 0.007)
    x += np.sin(2 * np.pi * 3800 * pitch * t) * np.exp(-t / 0.003) * 0.3
    return norm(x, 0.7)


def s_drop(pitch=1.0):
    d = 0.3
    t = t_axis(d)
    thud = sweep_sine(150, 60, d) * env_exp(len(t), 0.002, 0.07)
    soft = onepole_lp(noise(len(t)), 900) * env_exp(len(t), 0.001, 0.03) * 2
    return norm(thud + soft + s_click_pad(len(t)) * 0.3, 0.85)


def s_click_pad(n):
    x = np.zeros(n)
    c = s_click(0.8)
    x[: len(c)] = c
    return x


def s_swish(pitch=1.0):
    d = 0.32
    t = t_axis(d)
    fc = 700 * (6 ** (t / d))
    x = svf(noise(len(t)), fc, 1.4) * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    return norm(x, 0.6)


def s_whoosh(d=1.0, bright=1.0):
    t = t_axis(d)
    u = t / d
    shape = np.sin(np.pi * u ** 0.85) ** 2.2
    fc = (250 + 2600 * bright * shape) * (0.8 + 0.4 * u)
    x = svf(noise(len(t)), fc, 0.9) * shape
    rumble = onepole_lp(noise(len(t)), 160) * shape * 3
    return norm(x + rumble * 0.4, 0.9)


def s_riser(d=1.4):
    t = t_axis(d)
    u = t / d
    fc = 180 * (40 ** u)
    x = svf(noise(len(t)), fc, 2.5) * u ** 2.2
    tone = sweep_sine(110, 440, d) * u ** 2.5 * 0.35
    tone += sweep_sine(165, 660, d) * u ** 3 * 0.2
    y = x + tone
    y[-int(0.015 * SR):] *= np.linspace(1, 0, int(0.015 * SR))
    return norm(y, 0.8)


def s_suck(d=0.55):
    t = t_axis(d)
    u = t / d
    fc = 400 * (12 ** u)
    x = svf(noise(len(t)), fc, 1.2) * u ** 3
    x[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return norm(x, 0.8)


def s_boom(pitch=1.0):
    d = 2.4
    t = t_axis(d)
    f = 38 * pitch + 50 * pitch * np.exp(-t / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.004, 0.75)
    hit = onepole_lp(noise(len(t)), 600) * env_exp(len(t), 0.001, 0.09) * 2.5
    x = np.tanh((sub * 1.2 + hit * 0.5) * 1.6)
    return norm(x, 1.0)


def bell(freqs, d, decay, bright=1.0):
    t = t_axis(d)
    x = np.zeros(len(t))
    for i, f in enumerate(freqs):
        for k, (ratio, amp) in enumerate([(1, 1), (2.76, 0.35 * bright), (5.4, 0.12 * bright)]):
            dec = decay / (1 + k * 1.6)
            x += amp * np.sin(2 * np.pi * f * ratio * t + i) * env_exp(len(t), 0.003 + 0.01 * i, dec) / (1 + i * 0.15)
    return x


def s_shimmer(pitch=1.0):
    notes = [880, 1108.73, 1318.51, 1661.22, 1975.53]
    x = bell([n * pitch for n in notes], 3.5, 1.4, 0.8)
    sparkle = svf(noise(len(x)), 7000, 1.5) * env_exp(len(x), 0.005, 0.5) * 0.3
    return norm(x + sparkle, 0.7)


def s_chime(pitch=1.0):
    notes = [587.33, 739.99, 880.0, 1108.73, 1318.51]
    return norm(bell([n * pitch for n in notes], 4.5, 2.0, 0.6), 0.75)


def s_thump(pitch=1.0):
    d = 0.5
    t = t_axis(d)
    f = 48 * pitch + 90 * pitch * np.exp(-t / 0.04)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.002, 0.16)
    x += s_click_pad(len(t)) * 0.25
    return norm(np.tanh(x * 1.5), 0.9)


def s_tone(pitch=1.0):
    d = 1.8
    t = t_axis(d)
    e = np.clip(t / 0.35, 0, 1) * np.exp(-np.maximum(t - 0.35, 0) / 0.5)
    x = (np.sin(2 * np.pi * 659.25 * t) + 0.5 * np.sin(2 * np.pi * 987.77 * t)) * e
    return norm(x, 0.5)


LIB = {
    "click": s_click, "clickup": s_clickup, "key": s_key, "pop": s_pop, "tick": s_tick,
    "drop": s_drop, "swish": s_swish, "boom": s_boom, "shimmer": s_shimmer, "chime": s_chime,
    "thump": s_thump, "tone": s_tone,
}
# (base gain, reverb send)
MIX = {
    "click": (0.30, 0.08), "clickup": (0.18, 0.05), "key": (0.22, 0.08), "pop": (0.32, 0.25),
    "tick": (0.22, 0.2), "drop": (0.4, 0.15), "swish": (0.22, 0.2), "whoosh": (0.3, 0.3),
    "swoosh": (0.22, 0.3), "riser": (0.32, 0.25), "suck": (0.34, 0.2), "boom": (0.42, 0.25),
    "shimmer": (0.32, 0.6), "chime": (0.34, 0.6), "thump": (0.55, 0.2), "tone": (0.2, 0.5),
}


# --- Music bed -----------------------------------------------------------------------------
def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


CHORDS = [
    [50, 57, 61, 64, 66, 69],  # Dmaj9
    [47, 54, 57, 61, 62, 66],  # Bm11-ish
    [43, 50, 54, 57, 62, 66],  # Gmaj9
    [45, 52, 57, 59, 61, 64],  # A6/9
]


def pad_voice(freqs, d, fade=0.9):
    t = t_axis(d)
    x = np.zeros(len(t))
    for j, f in enumerate(freqs):
        for det in (-0.07, 0.0, 0.06):
            ff = f * 2 ** (det / 12)
            for h in range(1, 6):
                amp = (1 / h) ** 1.6 * (0.6 if j == 0 else 1)
                x += amp * np.sin(2 * np.pi * ff * h * t + rng.uniform(0, 6.28))
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.23 * t + rng.uniform(0, 6))
    e = np.minimum(np.clip(t / fade, 0, 1), np.clip((d - t) / fade, 0, 1))
    return x * lfo * np.sin(e * np.pi / 2) ** 2


def music(total, m):
    out = np.zeros((int(total * SR) + SR, 2))
    # Low tension drone into the impact.
    dd = m["impact"]
    t = t_axis(dd)
    drone = (np.sin(2 * np.pi * midi(38) * t) + 0.4 * np.sin(2 * np.pi * midi(45) * t)) * (t / dd) ** 1.5
    out[: len(t)] += drone[:, None] * 0.05
    marks = [m["impact"]] + [s for s in m["scenes"] if s > m["impact"] + 1] + [m["priv"], m["outro"]]
    marks = sorted(set(round(x, 3) for x in marks))
    ends = marks[1:] + [m["end"]]
    for i, (a, b) in enumerate(zip(marks, ends)):
        if a >= m["outro"] - 0.01:
            chord = CHORDS[0]
        elif a >= m["priv"] - 0.01:
            chord = [52, 59, 62, 66, 67, 71]  # Em9 lift before the resolve
        else:
            chord = CHORDS[i % len(CHORDS)]
        d = (b - a) + 1.0
        v = pad_voice([midi(n) for n in chord], d)
        sub = np.sin(2 * np.pi * midi(chord[0] - 12) * t_axis(d)) * 0.8
        e = np.minimum(np.clip(t_axis(d) / 0.6, 0, 1), np.clip((d - t_axis(d)) / 0.9, 0, 1))
        v = v + sub * e
        s0 = int((a - 0.25) * SR)
        seg = v[: max(0, min(len(v), len(out) - s0))]
        wob = np.sin(2 * np.pi * 0.11 * t_axis(len(seg) / SR))
        out[s0 : s0 + len(seg), 0] += seg * (1 + 0.1 * wob)
        out[s0 : s0 + len(seg), 1] += seg * (1 - 0.1 * wob)
    # Fade in after the impact, out at the end.
    tt = np.arange(len(out)) / SR
    g = np.clip((tt - m["impact"]) / 2.5, 0, 1) * np.clip((m["end"] - tt) / 2.2, 0, 1)
    g = np.maximum(g, (tt < m["impact"]).astype(float))
    out *= g[:, None]
    # Soften with a gentle lowpass via FFT tilt.
    for c in range(2):
        out[:, c] = fft_filter(out[:, c], 30, 5000, -0.35)
    return norm(out, 1.0) * 0.16


# --- Reverb --------------------------------------------------------------------------------
def reverb(x, seconds=2.4):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)], 1) * np.exp(-t / (seconds / 6.5))[:, None]
    for c in range(2):
        ir[:, c] = fft_filter(ir[:, c], 150, 9000, -0.5)
    ir[: int(0.012 * SR)] = 0  # pre-delay
    ir /= np.sqrt(np.sum(ir ** 2, 0))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.zeros((len(x), 2))
    for c in range(2):
        Y = np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size)
        y[:, c] = np.fft.irfft(Y, size)[: len(x)]
    return y


def place(buf, t, sig, gain, pan):
    s0 = int(t * SR)
    if s0 >= len(buf):
        return
    sig = sig[: len(buf) - s0]
    p = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    buf[s0 : s0 + len(sig), 0] += sig * gain * np.cos(p)
    buf[s0 : s0 + len(sig), 1] += sig * gain * np.sin(p)


def main(cues_path, out_path):
    data = json.load(open(cues_path, encoding="utf8"))
    total = data["duration"]
    n = int((total + 1.0) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    cache = {}
    for c in data["cues"]:
        s = c["s"]
        base, rv = MIX.get(s, (0.3, 0.2))
        g = base * c.get("g", 1.0)
        pan = c.get("p", 0.0)
        pitch = round(c.get("pitch", 1.0) * (1 + rng.uniform(-0.02, 0.02)), 3)
        if s in ("whoosh", "swoosh"):
            key = (s, round(c.get("d", 1), 2))
            if key not in cache:
                cache[key] = s_whoosh(c.get("d", 1.0), 1.0 if s == "whoosh" else 1.7)
            sig = cache[key]
            # Moving pan across the whoosh.
            L = len(sig)
            pp = np.linspace(-pan, pan, L) if pan else np.zeros(L)
            s0 = int(c["t"] * SR)
            sig = sig[: n - s0]
            pp = pp[: len(sig)]
            ang = (pp + 1) * np.pi / 4
            for buf, k in ((dry, 1 - rv), (send, rv)):
                buf[s0 : s0 + len(sig), 0] += sig * g * k * np.cos(ang)
                buf[s0 : s0 + len(sig), 1] += sig * g * k * np.sin(ang)
            continue
        if s == "riser":
            sig = s_riser(c.get("d", 1.4))
        elif s == "suck":
            sig = s_suck(c.get("d", 0.55))
        else:
            key = (s, pitch)
            if key not in cache:
                cache[key] = LIB[s](pitch)
            sig = cache[key]
        place(dry, c["t"], sig, g * (1 - rv * 0.5), pan)
        place(send, c["t"], sig, g * rv, pan)
    wet = reverb(send)
    mus = music(total, data["music"])
    mix = dry + wet * 0.9 + mus[: len(dry)] if len(mus) >= len(dry) else dry + wet * 0.9
    if len(mus) < len(dry):
        mix[: len(mus)] += mus
    # Master: gentle saturation and peak normalisation to -1 dBFS.
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix = norm(mix, 10 ** (-1 / 20))
    fade = int(0.05 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)[:, None]
    mix = mix[: int(total * SR)]
    pcm = (mix * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    rms = 20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-9)
    print(f"wrote {out_path}: {total:.2f}s, {len(data['cues'])} cues, RMS {rms:.1f} dBFS")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
