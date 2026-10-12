"""Run baseline / augment / fd MAP-Elites on a domain and log metrics.

Example:
    python scripts/run.py --domain pointmass --seeds 0 1 2 3 4 --iterations 500
    python scripts/run.py --domain ant_omni --backend generalized --iterations 2000 \
        --batch-size 256 --reevaluate

Writes ``<out>/<variant>_seed<k>.csv`` (metrics after every iteration, against
number of evaluations) and ``<out>/<variant>_seed<k>.json`` (config, archive
reduction and, with ``--reevaluate``, metrics of the re-evaluated full archive).
"""

from __future__ import annotations

import argparse
import csv
import functools
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jax  # noqa: E402
import numpy as np  # noqa: E402
from qdax.core.emitters.standard_emitters import MixingEmitter  # noqa: E402
from qdax.utils.metrics import default_qd_metrics  # noqa: E402

from symqd.algorithm import VARIANTS, SymmetricMAPElites, reevaluate, run_scan  # noqa: E402
from symqd.cells import CellAction  # noqa: E402
from symqd.domains import make_task  # noqa: E402
from symqd.group import subgroup  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--domain", required=True, choices=["arm", "pointmass", "ant_omni"])
    p.add_argument("--variants", nargs="+", default=list(VARIANTS), choices=VARIANTS)
    p.add_argument("--seeds", nargs="+", type=int, default=[0])
    p.add_argument("--iterations", type=int, default=500)
    p.add_argument("--batch-size", type=int, default=128)
    p.add_argument("--log-every", type=int, default=50, help="iterations per jitted chunk")
    p.add_argument("--grid", type=int, default=None)
    p.add_argument("--subgroup", nargs="+", default=None,
                   help="restrict to these group elements, e.g. e r180")
    p.add_argument("--backend", default="generalized", help="Brax backend (ant_omni)")
    p.add_argument("--episode-length", type=int, default=None)
    p.add_argument("--limit", type=float, default=None, help="ant_omni descriptor bound")
    p.add_argument("--reevaluate", action="store_true",
                   help="re-score the final full archive (needed for approximate symmetries)")
    p.add_argument("--reeval-every", type=int, default=0,
                   help="also re-score the full archive every N iterations (multiple of --log-every)")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    kwargs = {}
    if args.grid is not None:
        kwargs["grid"] = args.grid
    if args.domain == "ant_omni":
        kwargs["backend"] = args.backend
    if args.episode_length is not None:
        kwargs["episode_length"] = args.episode_length
    if args.limit is not None:
        kwargs["limit"] = args.limit
    task = make_task(args.domain, **kwargs)
    if args.subgroup:
        group = subgroup(task.group, args.subgroup)
        keep = [task.group.names.index(n) for n in args.subgroup]
        base_transform = task.transform
        lookup = jax.numpy.asarray(keep)
        task.transform = lambda x, g: base_transform(x, lookup[g])
        task.group = group

    cells = CellAction.from_centroids(task.group, np.asarray(task.centroids))
    print(f"[{args.domain}] {cells.summary()}", flush=True)
    out = args.out or os.path.join("results", args.domain)
    os.makedirs(out, exist_ok=True)

    for variant in args.variants:
        for seed in args.seeds:
            run_one(task, cells, variant, seed, args, out)


def run_one(task, cells, variant, seed, args, out) -> None:
    emitter = MixingEmitter(
        mutation_fn=None,
        variation_fn=task.variation_fn,
        variation_percentage=1.0,
        batch_size=args.batch_size,
    )
    algo = SymmetricMAPElites(
        task.scoring_fn,
        emitter,
        variant=variant,
        cell_action=cells,
        centroids=task.centroids,
        genotype_transform=task.transform,
        qd_offset=task.qd_offset,
    )
    key = jax.random.PRNGKey(seed)
    key, k_init, k_algo = jax.random.split(key, 3)
    t0 = time.time()
    repertoire, emitter_state, m0 = algo.init(
        task.init_genotypes(k_init, args.batch_size), task.centroids, k_algo
    )
    chunk = jax.jit(functools.partial(run_scan, algo, num_iterations=args.log_every))

    rows = [dict(iteration=0, evaluations=args.batch_size, time=time.time() - t0,
                 **{k: float(v) for k, v in m0.items()})]
    reeval_rows = []

    def record_reeval(it):
        fresh = reevaluate(algo.expand(repertoire), task.scoring_fn,
                           jax.random.PRNGKey(10_000 + seed), batch_size=args.batch_size)
        m = {k: float(v) for k, v in default_qd_metrics(fresh, task.qd_offset).items()}
        reeval_rows.append(dict(iteration=it, evaluations=args.batch_size * (it + 1), **m))
        return m

    done = 0
    while done < args.iterations:
        repertoire, emitter_state, key, metrics = chunk(repertoire, emitter_state, key)
        jax.block_until_ready(metrics)
        elapsed = time.time() - t0
        for i in range(args.log_every):
            it = done + i + 1
            rows.append(dict(iteration=it, evaluations=args.batch_size * (it + 1), time=elapsed,
                             **{k: float(v[i]) for k, v in metrics.items()}))
        done += args.log_every
        last = rows[-1]
        print(f"  {variant:>8} seed {seed} it {done:5d} evals {last['evaluations']:8d} "
              f"qd {last['qd_score']:12.2f} cov {last['coverage']:6.2f}% "
              f"max {last['max_fitness']:9.3f} ({elapsed:.0f}s)", flush=True)
        if args.reeval_every and done % args.reeval_every == 0 and done < args.iterations:
            m = record_reeval(done)
            print(f"  {variant:>8} seed {seed} it {done:5d} re-evaluated qd {m['qd_score']:12.2f} "
                  f"cov {m['coverage']:6.2f}%", flush=True)

    name = os.path.join(out, f"{variant}_seed{seed}")
    with open(name + ".csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    summary = {
        "domain": task.name, "variant": variant, "seed": seed,
        "group": list(task.group.names), "num_cells": cells.num_cells,
        "num_orbits": cells.num_orbits, "reduction": cells.reduction,
        "batch_size": args.batch_size, "iterations": args.iterations,
        "final": {k: v for k, v in rows[-1].items()},
    }
    if args.reevaluate or args.reeval_every:
        summary["reevaluated"] = record_reeval(done)
        print(f"  {variant:>8} seed {seed} re-evaluated: {summary['reevaluated']}", flush=True)
        with open(name + "_reeval.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(reeval_rows[0]))
            w.writeheader()
            w.writerows(reeval_rows)
    with open(name + ".json", "w") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
