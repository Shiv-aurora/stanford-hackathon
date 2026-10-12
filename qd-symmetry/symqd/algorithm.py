"""MAP-Elites with symmetry exploitation.

Three variants share the emitter, scoring function and evaluation budget and
differ only in what is inserted into the archive after each evaluation:

``baseline``
    Standard MAP-Elites on the full archive of N cells.
``augment``
    Full archive; every evaluated solution is inserted together with its
    |G| - 1 transformed copies (free extra samples, no change of search space).
``fd``
    Fundamental-domain archive with one cell per orbit. Every evaluated
    solution is canonicalised (transformed into the fundamental domain) before
    insertion; the full archive is recovered at any time by
    :func:`expand_repertoire`.

Comparing ``augment`` and ``fd`` separates "free extra samples" from
"smaller search space". All metrics are reported on the full N-cell archive.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Tuple

import jax
import jax.numpy as jnp
from qdax.core.containers.mapelites_repertoire import (
    MapElitesRepertoire,
    get_cells_indices,
)
from qdax.core.emitters.emitter import Emitter, EmitterState
from qdax.core.map_elites import MAPElites
from qdax.custom_types import Centroid, Descriptor, ExtraScores, Fitness, Genotype, Metrics
from qdax.utils.metrics import default_qd_metrics

from symqd.cells import CellAction
from symqd.transforms import GenotypeTransform, apply_all

VARIANTS = ("baseline", "augment", "fd")


def full_archive_metrics(qd_offset: float) -> Callable[[MapElitesRepertoire], Metrics]:
    return lambda repertoire: default_qd_metrics(repertoire, qd_offset)


def fd_archive_metrics(
    cell_action: CellAction, qd_offset: float
) -> Callable[[MapElitesRepertoire], Metrics]:
    """QD metrics of the expanded full archive, computed from the FD archive.

    Each representative stands for ``orbit_size`` cells with the same fitness.
    """
    sizes = jnp.asarray(cell_action.orbit_sizes, dtype=jnp.float32)
    num_cells = float(cell_action.num_cells)

    def metrics(repertoire: MapElitesRepertoire) -> Metrics:
        fitnesses = jnp.reshape(repertoire.fitnesses, (-1,))
        filled = fitnesses != -jnp.inf
        fit = jnp.where(filled, fitnesses, 0.0)
        qd_score = jnp.sum(sizes * (fit + qd_offset) * filled)
        coverage = 100.0 * jnp.sum(sizes * filled) / num_cells
        return {
            "qd_score": qd_score,
            "max_fitness": jnp.max(fitnesses),
            "coverage": coverage,
        }

    return metrics


class SymmetricMAPElites(MAPElites):
    """MAP-Elites whose archive insertions exploit a known symmetry group."""

    def __init__(
        self,
        scoring_function: Optional[
            Callable[[Genotype, jax.Array], Tuple[Fitness, Descriptor, ExtraScores]]
        ],
        emitter: Emitter,
        *,
        variant: str,
        cell_action: CellAction,
        centroids: Centroid,
        genotype_transform: Optional[GenotypeTransform],
        qd_offset: float,
    ) -> None:
        if variant not in VARIANTS:
            raise ValueError(f"variant must be one of {VARIANTS}")
        if variant != "baseline" and genotype_transform is None:
            raise ValueError(f"variant {variant!r} needs a genotype transform")
        metrics_function = (
            fd_archive_metrics(cell_action, qd_offset)
            if variant == "fd"
            else full_archive_metrics(qd_offset)
        )
        super().__init__(scoring_function, emitter, metrics_function)
        self.variant = variant
        self.cell_action = cell_action
        self.group = cell_action.group
        self.full_centroids = jnp.asarray(centroids)
        self.transform = genotype_transform
        self._perm = jnp.asarray(cell_action.perm)
        self._canonical = jnp.asarray(cell_action.canonical)
        self._first = jnp.asarray(cell_action.first_occurrence)
        self._orbit_id = jnp.asarray(cell_action.orbit_id)

    # -- what goes into the archive ------------------------------------------

    def archive_centroids(self) -> Centroid:
        if self.variant == "fd":
            return self.full_centroids[jnp.asarray(self.cell_action.reps)]
        return self.full_centroids

    def symmetrize(
        self, genotypes: Genotype, fitnesses: Fitness, descriptors: Descriptor
    ) -> Tuple[Genotype, Fitness, Descriptor, jnp.ndarray]:
        """Return the insertions (and their archive indices) for an evaluated batch.

        Target cells come from the permutation table, ``perm[g, cell(d)]``, not
        from re-binning ``g . d``: a descriptor on a cell boundary (e.g. exactly
        at the origin of a centred grid) has a nearest-centroid tie that is
        broken by index, which is not G-equivariant.
        """
        fitnesses = jnp.reshape(fitnesses, (-1,))
        cells = get_cells_indices(descriptors, self.full_centroids)
        if self.variant == "baseline":
            return genotypes, fitnesses, descriptors, cells

        if self.variant == "fd":
            g = self._canonical[cells]
            return (
                self.transform(genotypes, g),
                fitnesses,
                self.group.act_on_descriptors(descriptors, g),
                self._orbit_id[cells],
            )

        # augment: all |G| images; duplicates that land in the same
        # (self-symmetric) cell are dropped so each cell gets one candidate.
        order = self.group.order
        new_genotypes, g = apply_all(self.transform, genotypes, order)
        tiled_cells = jnp.tile(cells, order)
        new_descriptors = self.group.act_on_descriptors(jnp.tile(descriptors, (order, 1)), g)
        keep = self._first[g, tiled_cells]
        new_fitnesses = jnp.where(keep, jnp.tile(fitnesses, order), -jnp.inf)
        return new_genotypes, new_fitnesses, new_descriptors, self._perm[g, tiled_cells]

    # -- MAPElites hooks ------------------------------------------------------

    def init_ask_tell(
        self,
        genotypes: Genotype,
        fitnesses: Fitness,
        descriptors: Descriptor,
        centroids: Centroid,
        key: jax.Array,
        extra_scores: Optional[ExtraScores] = None,
    ):
        repertoire = MapElitesRepertoire.init_default(
            jax.tree.map(lambda x: x[0], genotypes), self.archive_centroids()
        )
        inserted = self.symmetrize(genotypes, fitnesses, descriptors)
        repertoire = add_at_indices(repertoire, *inserted)
        key, subkey = jax.random.split(key)
        emitter_state = self._emitter.init(
            key=subkey,
            repertoire=repertoire,
            genotypes=genotypes,
            fitnesses=fitnesses,
            descriptors=descriptors,
            extra_scores=extra_scores or {},
        )
        return repertoire, emitter_state, self._metrics_function(repertoire)

    def tell(
        self,
        genotypes: Genotype,
        fitnesses: Fitness,
        descriptors: Descriptor,
        repertoire: MapElitesRepertoire,
        emitter_state: Optional[EmitterState],
        extra_scores: Optional[ExtraScores] = None,
        extra_info: Optional[ExtraScores] = None,
    ):
        inserted = self.symmetrize(genotypes, fitnesses, descriptors)
        repertoire = add_at_indices(repertoire, *inserted)
        # the emitter sees what was actually evaluated
        emitter_state = self._emitter.state_update(
            emitter_state=emitter_state,
            repertoire=repertoire,
            genotypes=genotypes,
            fitnesses=fitnesses,
            descriptors=descriptors,
            extra_scores={**(extra_scores or {}), **(extra_info or {})},
        )
        return repertoire, emitter_state, self._metrics_function(repertoire)

    # -- recovering the full archive -----------------------------------------

    def expand(self, repertoire: MapElitesRepertoire) -> MapElitesRepertoire:
        if self.variant != "fd":
            return repertoire
        return expand_repertoire(
            repertoire, self.cell_action, self.full_centroids, self.transform
        )


def add_at_indices(
    repertoire: MapElitesRepertoire,
    genotypes: Genotype,
    fitnesses: Fitness,
    descriptors: Descriptor,
    indices: jnp.ndarray,
) -> MapElitesRepertoire:
    """``MapElitesRepertoire.add`` with explicitly given target cells.

    Same semantics as QDax: per cell, the best candidate of the batch replaces
    the incumbent if strictly better.
    """
    num_cells = repertoire.centroids.shape[0]
    fitnesses = jnp.reshape(fitnesses, (-1,))
    indices = indices.astype(jnp.int32)
    best = jax.ops.segment_max(fitnesses, indices, num_segments=num_cells)
    is_best = fitnesses == best[indices]
    current = jnp.reshape(repertoire.fitnesses, (-1,))[indices]
    accept = is_best & (fitnesses > current)
    # among tied best candidates of a cell keep exactly one (the first)
    order = jnp.arange(fitnesses.shape[0])
    first = jax.ops.segment_min(jnp.where(accept, order, fitnesses.shape[0]), indices, num_segments=num_cells)
    accept = accept & (order == first[indices])
    target = jnp.where(accept, indices, num_cells)  # out of bounds -> dropped

    shape = repertoire.fitnesses.shape[1:]
    return repertoire.replace(
        genotypes=jax.tree.map(
            lambda old, new: old.at[target].set(new, mode="drop"), repertoire.genotypes, genotypes
        ),
        fitnesses=repertoire.fitnesses.at[target].set(
            jnp.reshape(fitnesses, (-1,) + shape), mode="drop"
        ),
        descriptors=repertoire.descriptors.at[target].set(descriptors, mode="drop"),
    )


def expand_repertoire(
    fd_repertoire: MapElitesRepertoire,
    cell_action: CellAction,
    full_centroids: Centroid,
    transform: GenotypeTransform,
) -> MapElitesRepertoire:
    """Materialise the full N-cell archive from a fundamental-domain archive.

    Cell ``i`` receives ``h . elite(rep(i))`` where ``h`` maps the
    representative to ``i`` (the inverse of the canonicalising element).
    """
    orbit = jnp.asarray(cell_action.orbit_id)
    h = jnp.asarray(cell_action.group.inverses)[jnp.asarray(cell_action.canonical)]
    source = jax.tree.map(lambda x: x[orbit], fd_repertoire.genotypes)
    fitnesses = fd_repertoire.fitnesses[orbit]
    descriptors = cell_action.group.act_on_descriptors(fd_repertoire.descriptors[orbit], h)
    filled = jnp.reshape(fitnesses, (-1,)) != -jnp.inf
    descriptors = jnp.where(filled[:, None], descriptors, -jnp.inf)
    return MapElitesRepertoire(
        genotypes=transform(source, h),
        fitnesses=fitnesses,
        descriptors=descriptors,
        centroids=jnp.asarray(full_centroids),
        extra_scores={},
        keys_extra_scores=(),
    )


def run_scan(
    algo: MAPElites,
    repertoire: MapElitesRepertoire,
    emitter_state: Any,
    key: jax.Array,
    num_iterations: int,
):
    """Run ``num_iterations`` updates under ``jax.lax.scan``; returns metrics history."""
    (repertoire, emitter_state, key), metrics = jax.lax.scan(
        algo.scan_update, (repertoire, emitter_state, key), (), length=num_iterations
    )
    return repertoire, emitter_state, key, metrics


def reevaluate(
    repertoire: MapElitesRepertoire,
    scoring_fn: Callable,
    key: jax.Array,
    batch_size: int = 128,
) -> MapElitesRepertoire:
    """Re-score every elite and re-insert it into a fresh archive.

    For approximately symmetric tasks the transformed elites inserted by the
    ``augment`` and ``fd`` variants were never evaluated, so honest metrics come
    from this re-evaluated archive. Use the same treatment for the baseline.
    Re-binning uses QDax's nearest-centroid rule, so a descriptor lying exactly
    on a cell boundary can move to a neighbouring cell (use odd grids for
    groups that fix the origin, so the origin is a cell centre, not a vertex).

    Pass the batch size used during search: XLA results can depend on the
    batch shape at float32 round-off level, which chaotic tasks (the Ant)
    amplify. Every chunk, including the last, is padded to ``batch_size``.
    """
    filled = jnp.nonzero(repertoire.fitnesses != -jnp.inf)[0]
    genotypes = jax.tree.map(lambda x: x[filled], repertoire.genotypes)
    n = int(filled.shape[0])
    fits, descs = [], []
    for start in range(0, n, batch_size):
        idx = jnp.minimum(jnp.arange(start, start + batch_size), n - 1)
        chunk = jax.tree.map(lambda x: x[idx], genotypes)
        f, d, _ = scoring_fn(chunk, key)
        keep = min(batch_size, n - start)
        fits.append(jnp.reshape(f, (-1,))[:keep])
        descs.append(d[:keep])
    fresh = MapElitesRepertoire.init_default(
        jax.tree.map(lambda x: x[0], repertoire.genotypes), repertoire.centroids
    )
    if n == 0:
        return fresh
    return fresh.add(genotypes, jnp.concatenate(descs), jnp.concatenate(fits))
