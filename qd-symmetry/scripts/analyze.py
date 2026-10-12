"""Summarise and plot the runs in one or more result directories.

    python scripts/analyze.py results/pointmass results/arm

For each directory writes ``summary.md`` (final metrics, evaluations needed
to reach fractions of the baseline's final QD-score, and the speed-up over
the baseline) and ``curves.png`` (QD-score and coverage against evaluations,
mean over seeds with a min-max band; re-evaluated points as markers).
"""

from __future__ import annotations

import glob
import json
import math
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

VARIANTS = ["baseline", "augment", "fd"]
LABELS = {"baseline": "Baseline", "augment": "Augment", "fd": "FD archive"}
# categorical slots 1-3 of the reference palette (validated all-pairs, light mode)
COLORS = {"baseline": "#2a78d6", "augment": "#eb6834", "fd": "#1baf7a"}
STYLES = {"baseline": "-", "augment": "--", "fd": "-."}
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
FRACTIONS = (0.5, 0.8, 0.95)


def load(directory: str):
    runs, reeval, meta = {}, {}, {}
    for v in VARIANTS:
        files = sorted(glob.glob(os.path.join(directory, f"{v}_seed*.csv")))
        files = [f for f in files if not f.endswith("_reeval.csv")]
        if files:
            runs[v] = [pd.read_csv(f) for f in files]
        rf = sorted(glob.glob(os.path.join(directory, f"{v}_seed*_reeval.csv")))
        if rf:
            reeval[v] = [pd.read_csv(f) for f in rf]
        js = sorted(glob.glob(os.path.join(directory, f"{v}_seed*.json")))
        if js:
            meta[v] = [json.load(open(f)) for f in js]
    return runs, reeval, meta


def evals_to_reach(df: pd.DataFrame, target: float, column: str = "qd_score") -> float:
    hit = df.index[df[column] >= target]
    return float(df.loc[hit[0], "evaluations"]) if len(hit) else math.inf


def harmonic(n: int) -> float:
    return sum(1.0 / k for k in range(1, n + 1))


def summarise(directory: str, runs, reeval, meta) -> str:
    m = next(iter(meta.values()))[0]
    order = len(m["group"])
    lines = [
        f"# {m['domain']}  (group {{{', '.join(m['group'])}}})",
        "",
        f"* cells N = {m['num_cells']}, orbits = {m['num_orbits']}, "
        f"archive reduction N/#orbits = {m['reduction']:.2f}x (|G| = {order})",
        f"* coupon-collector scale for rare cells |G|·H(|G|) = {order * harmonic(order):.1f}x",
        f"* batch size {m['batch_size']}, {m['iterations']} iterations, "
        f"seeds per variant: " + ", ".join(f"{v} {len(runs[v])}" for v in runs),
        "",
    ]
    base_final = np.mean([df["qd_score"].iloc[-1] for df in runs["baseline"]])
    header = "| variant | final QD-score | final coverage % |"
    sep = "|---|---|---|"
    for f in FRACTIONS:
        header += f" evals to {int(f * 100)}% of baseline QD | speed-up |"
        sep += "---|---|"
    if reeval:
        header += " re-evaluated QD | re-evaluated coverage % |"
        sep += "---|---|"
    lines += [header, sep]
    base_evals = {f: np.median([evals_to_reach(df, f * base_final) for df in runs["baseline"]])
                  for f in FRACTIONS}
    for v in VARIANTS:
        if v not in runs:
            continue
        q = np.array([df["qd_score"].iloc[-1] for df in runs[v]])
        c = np.array([df["coverage"].iloc[-1] for df in runs[v]])
        row = f"| {LABELS[v]} | {q.mean():.1f} ± {q.std():.1f} | {c.mean():.2f} ± {c.std():.2f} |"
        for f in FRACTIONS:
            e = np.median([evals_to_reach(df, f * base_final) for df in runs[v]])
            row += f" {e:,.0f} | {base_evals[f] / e:.2f}x |" if math.isfinite(e) else " not reached | – |"
        if reeval:
            if v in reeval:
                rq = np.array([df["qd_score"].iloc[-1] for df in reeval[v]])
                rc = np.array([df["coverage"].iloc[-1] for df in reeval[v]])
                row += f" {rq.mean():.1f} ± {rq.std():.1f} | {rc.mean():.2f} ± {rc.std():.2f} |"
            else:
                row += " – | – |"
        lines.append(row)
    lines += ["", "Evaluations-to-target are medians over seeds; speed-up is relative to the baseline."]
    return "\n".join(lines) + "\n"


def label_line_ends(ax, ends, min_gap: float = 0.045) -> None:
    """Direct labels at line ends; near-coincident ends share one label."""
    lo, hi = ax.get_ylim()
    gap = min_gap * (hi - lo)
    groups: list[list] = []
    for y, label, x in sorted(ends):
        if groups and y - groups[-1][-1][0] < gap:
            groups[-1].append((y, label, x))
        else:
            groups.append([(y, label, x)])
    placed = []
    for g in groups:
        y = float(np.mean([e[0] for e in g]))
        if placed and y - placed[-1] < gap:
            y = placed[-1] + gap
        placed.append(y)
        ax.annotate(" / ".join(e[1] for e in g), (g[0][2], y), xytext=(6, 0),
                    textcoords="offset points", va="center", color=INK2, fontsize=9,
                    annotation_clip=False)


def plot(directory: str, runs, reeval, meta) -> None:
    m = next(iter(meta.values()))[0]
    plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
                         "xtick.color": INK2, "ytick.color": INK2, "text.color": INK})
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.2), facecolor=SURFACE)
    fig.subplots_adjust(wspace=0.35)
    for ax, column, ylabel in [(axes[0], "qd_score", "QD-score"),
                               (axes[1], "coverage", "Coverage (% of full archive)")]:
        ax.set_facecolor(SURFACE)
        ends = []
        for v in VARIANTS:
            if v not in runs:
                continue
            x = runs[v][0]["evaluations"].to_numpy()
            ys = np.stack([df[column].to_numpy() for df in runs[v]])
            mean = ys.mean(0)
            ax.fill_between(x, ys.min(0), ys.max(0), color=COLORS[v], alpha=0.15, lw=0)
            ax.plot(x, mean, color=COLORS[v], ls=STYLES[v], lw=2, label=LABELS[v])
            ends.append((mean[-1], LABELS[v], x[-1]))
            if v in reeval and v != "baseline":
                rx = reeval[v][0]["evaluations"].to_numpy()
                ry = np.stack([df[column].to_numpy() for df in reeval[v]]).mean(0)
                ax.plot(rx, ry, ls="none", marker="o", ms=8, mfc=COLORS[v], mec=SURFACE, mew=2,
                        label=f"{LABELS[v]} (re-evaluated)")
        label_line_ends(ax, ends)
        ax.set_xscale("log")
        ax.set_xlabel("Evaluations (log scale)")
        ax.set_ylabel(ylabel)
        ax.grid(True, color=GRID, lw=0.8)
        ax.set_axisbelow(True)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        ax.margins(x=0.02)
    axes[0].legend(frameon=False, loc="upper left", fontsize=9)
    fig.suptitle(f"{m['domain']}: group of order {len(m['group'])}, archive reduction "
                 f"{m['reduction']:.2f}x", color=INK, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0, 0.94, 1))
    fig.savefig(os.path.join(directory, "curves.png"), dpi=150, facecolor=SURFACE)
    plt.close(fig)


def main() -> None:
    for directory in sys.argv[1:]:
        runs, reeval, meta = load(directory)
        if "baseline" not in runs:
            print(f"{directory}: no baseline runs, skipping")
            continue
        text = summarise(directory, runs, reeval, meta)
        with open(os.path.join(directory, "summary.md"), "w") as f:
            f.write(text)
        plot(directory, runs, reeval, meta)
        print(text)


if __name__ == "__main__":
    main()
