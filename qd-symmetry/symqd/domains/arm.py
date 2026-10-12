"""QDax planar arm with its mirror symmetry (|G| = 2).

Genotype ``x`` in [0, 1]^n maps to joint angles ``2 pi x - pi``. Negating every
angle mirrors the end effector across the horizontal line through the base:
``x -> 1 - x`` and ``(dx, dy) -> (dx, 1 - dy)``. Fitness (minus the std of the
angles) is unchanged, so the task is exactly Z2-symmetric. Rotating the first
joint is *not* a symmetry: it changes the fitness and leaves [0, 1].
"""

from __future__ import annotations

import functools

import jax
import numpy as np
from qdax.core.containers.mapelites_repertoire import compute_euclidean_centroids
from qdax.core.emitters.mutation_operators import isoline_variation
from qdax.tasks.arm import arm_scoring_function

from symqd.domains.base import Task
from symqd.group import SignedPermutation, mirror2
from symqd.transforms import make_vector_transform


def make_arm_task(num_dofs: int = 8, grid: int = 32, **_) -> Task:
    group = mirror2("flip_x", center=(0.5, 0.5))
    reps = [SignedPermutation.identity(num_dofs), SignedPermutation(np.arange(num_dofs), -np.ones(num_dofs))]

    def init_genotypes(key, n):
        return jax.random.uniform(key, (n, num_dofs))

    return Task(
        name="arm",
        scoring_fn=arm_scoring_function,
        init_genotypes=init_genotypes,
        group=group,
        transform=make_vector_transform(reps, center=0.5),
        centroids=compute_euclidean_centroids((grid, grid), 0.0, 1.0),
        variation_fn=functools.partial(
            isoline_variation, iso_sigma=0.005, line_sigma=0.05, minval=0.0, maxval=1.0
        ),
        qd_offset=1.0,
        info={"num_dofs": num_dofs, "grid": grid},
    )
