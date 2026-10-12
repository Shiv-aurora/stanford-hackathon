"""Measuring how well a task's symmetry actually holds for evaluated controllers.

For controllers ``theta`` and each group element ``g`` we evaluate ``g . theta``
and compare with the prediction ``(f(theta), g . d(theta))``:

* descriptor error ``|g . d(theta) - d(g . theta)|_2``;
* fitness error ``|f(theta) - f(g . theta)|``;
* cell agreement: fraction of controllers for which both land in the same
  archive cell (what matters for MAP-Elites).
"""

from __future__ import annotations

from dataclasses import dataclass

import jax
import jax.numpy as jnp
import numpy as np
from qdax.core.containers.mapelites_repertoire import get_cells_indices

from symqd.domains.base import Task


@dataclass
class TransferGap:
    names: tuple[str, ...]
    descriptor_error: np.ndarray  # (G, B)
    fitness_error: np.ndarray  # (G, B)
    cell_agreement: np.ndarray  # (G,)

    def table(self) -> str:
        rows = [f"{'g':>9} | desc err median / p90 / max | fit err median / max | same cell"]
        for k, name in enumerate(self.names):
            d, f = self.descriptor_error[k], self.fitness_error[k]
            rows.append(
                f"{name:>9} | {np.median(d):9.2e} {np.quantile(d, 0.9):9.2e} {d.max():9.2e} |"
                f" {np.median(f):9.2e} {f.max():9.2e} | {100 * self.cell_agreement[k]:6.1f}%"
            )
        return "\n".join(rows)


def transfer_gap(task: Task, genotypes, key: jax.Array) -> TransferGap:
    batch = jax.tree.leaves(genotypes)[0].shape[0]
    score = jax.jit(task.scoring_fn)
    fit, desc, _ = score(genotypes, key)
    d_err, f_err, agree = [], [], []
    for g in range(task.group.order):
        gg = jnp.full((batch,), g, dtype=jnp.int32)
        fit_g, desc_g, _ = score(task.transform(genotypes, gg), key)
        pred = task.group.act_on_descriptors(desc, gg)
        d_err.append(np.asarray(jnp.linalg.norm(pred - desc_g, axis=-1)))
        f_err.append(np.asarray(jnp.abs(fit - fit_g)))
        cells_pred = get_cells_indices(pred, task.centroids)
        agree.append(float(jnp.mean(cells_pred == get_cells_indices(desc_g, task.centroids))))
    return TransferGap(task.group.names, np.stack(d_err), np.stack(f_err), np.array(agree))
