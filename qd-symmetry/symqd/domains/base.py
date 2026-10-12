"""Common task container."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

import jax

from symqd.group import SymmetryGroup
from symqd.transforms import GenotypeTransform


@dataclass
class Task:
    """Everything needed to run (symmetric) MAP-Elites on a domain.

    Attributes:
        scoring_fn: ``(genotypes, key) -> (fitnesses, descriptors, extra)``.
        init_genotypes: ``key, n -> genotypes`` sampling an initial population.
        group: the symmetry group of the task.
        transform: genotype transform implementing the group action.
        centroids: a G-invariant tessellation of the descriptor space.
        variation_fn: ``(x1, x2, key) -> offspring`` used by the emitter.
        qd_offset: added to fitnesses so QD-score is positive.
        exact: whether the symmetry holds exactly (up to float round-off).
    """

    name: str
    scoring_fn: Callable
    init_genotypes: Callable[[jax.Array, int], Any]
    group: SymmetryGroup
    transform: GenotypeTransform
    centroids: jax.Array
    variation_fn: Callable
    qd_offset: float
    exact: bool = True
    info: Optional[dict] = None
