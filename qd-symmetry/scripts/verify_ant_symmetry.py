"""Report how well D4 holds for the Brax Ant, per backend and precision.

    python scripts/verify_ant_symmetry.py --out results/ant_symmetry.md

1. Static: derive hinge/actuator maps for every element of D4 from the
   loaded ``brax.System`` (fails loudly if the model is not symmetric).
2. Open loop: random action sequences ``a_t`` vs ``P_a(g) a_t`` from the
   symmetric start state; max error of ``P_o(g) o_t`` against the observed
   ``o'_t`` at several horizons, in float32 and float64.
3. Closed loop: random MLP controllers ``theta`` vs ``g . theta`` through the
   QDax scoring function (the transfer gap that matters for MAP-Elites).

Each configuration runs in a fresh subprocess because float64 must be enabled
before JAX initialises.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HORIZONS = (1, 10, 50, 100, 250)


def limit_for(episode_length: int) -> float:
    """Descriptor bound used in our runs: +-15 m for 100 steps, QDax's +-30 m otherwise."""
    return 15.0 if episode_length <= 100 else 30.0


def worker(backend: str, x64: bool, steps: int, episode_length: int, n_policies: int) -> dict:
    import jax

    if x64:
        jax.config.update("jax_enable_x64", True)
    sys.path.insert(0, ROOT)
    import numpy as np

    from symqd.diagnostics import transfer_gap
    from symqd.domains.ant import derive_ant_symmetry, make_ant_env, rollout_symmetry_error
    from symqd.domains import make_task
    from symqd.group import dihedral4

    group = dihedral4()
    env = make_ant_env(backend=backend)
    sym = derive_ant_symmetry(env.sys, group)
    res = rollout_symmetry_error(env, group, sym, jax.random.PRNGKey(0), num_steps=steps, num_sequences=8)
    out = {"report": sym.report, "open_loop": {
        name: {"obs": [float(o[h - 1]) for h in HORIZONS if h <= steps],
               "xy": [float(x[h - 1]) for h in HORIZONS if h <= steps]}
        for name, (o, x) in res.items()}}
    if not x64 and n_policies:
        task = make_task("ant_omni", backend=backend, episode_length=episode_length,
                         limit=limit_for(episode_length))
        gen = task.init_genotypes(jax.random.PRNGKey(1), n_policies)
        gap = transfer_gap(task, gen, jax.random.PRNGKey(2))
        out["closed_loop"] = {
            name: {"desc_median": float(np.median(gap.descriptor_error[k])),
                   "desc_p90": float(np.quantile(gap.descriptor_error[k], 0.9)),
                   "fit_median": float(np.median(gap.fitness_error[k])),
                   "same_cell": float(gap.cell_agreement[k])}
            for k, name in enumerate(gap.names)}
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--backends", nargs="+", default=["generalized", "spring"])
    p.add_argument("--steps", type=int, default=250)
    p.add_argument("--episode-lengths", nargs="+", type=int, default=[100, 250])
    p.add_argument("--policies", type=int, default=128)
    p.add_argument("--out", default=os.path.join(ROOT, "results", "ant_symmetry.md"))
    p.add_argument("--worker", nargs=5, help=argparse.SUPPRESS)
    args = p.parse_args()

    if args.worker:
        backend, x64, steps, ep, n = args.worker
        print(json.dumps(worker(backend, x64 == "1", int(steps), int(ep), int(n))))
        return

    def run(*a):
        cmd = [sys.executable, "-W", "ignore", __file__, "--worker", *map(str, a)]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(res.stdout.strip().splitlines()[-1])

    lines = ["# Brax Ant: how exact is the D4 symmetry?", ""]
    first = True
    for backend in args.backends:
        for x64 in (0, 1):
            r = run(backend, x64, args.steps, args.episode_lengths[0], 0)
            if first:
                lines += ["## Derived hinge maps (`j->±k`: hinge j maps to ±hinge k)", "",
                          "```", r["report"], "```", ""]
                first = False
            hs = [h for h in HORIZONS if h <= args.steps]
            lines += [f"## Open loop, backend `{backend}`, float{'64' if x64 else '32'}", "",
                      "Max over 8 random action sequences of the observation error "
                      "`|P_o(g) o_t - o'_t|_inf` / torso-xy error `|A_g xy_t - xy'_t|_2` (m).", "",
                      "| g | " + " | ".join(f"step {h}" for h in hs) + " |",
                      "|---|" + "---|" * len(hs)]
            for name, e in r["open_loop"].items():
                lines.append(f"| {name} | " + " | ".join(
                    f"{o:.1e} / {x:.1e}" for o, x in zip(e["obs"], e["xy"])) + " |")
            lines.append("")
        for ep in args.episode_lengths:
            r = run(backend, 0, 1, ep, args.policies)
            lines += [f"## Closed loop, backend `{backend}`, episode length {ep}, float32", "",
                      f"{args.policies} random MLP controllers through the QDax scoring function.", "",
                      f"| g | descriptor err median (m) | p90 (m) | fitness err median | "
                      f"same cell (33x33 grid on ±{limit_for(ep):g} m) |",
                      "|---|---|---|---|---|"]
            for name, e in r["closed_loop"].items():
                lines.append(f"| {name} | {e['desc_median']:.2e} | {e['desc_p90']:.2e} | "
                             f"{e['fit_median']:.2e} | {100 * e['same_cell']:.1f}% |")
            lines.append("")
        print(f"done: {backend}", flush=True)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
