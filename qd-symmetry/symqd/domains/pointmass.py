"""A point mass steered by an MLP policy: exactly D4-symmetric (|G| = 8).

State ``(p, v)`` in R^2 x R^2, starting at rest at the origin. Each step

    v <- v + dt * (u - c |v| v),    p <- clip(p + dt * v, -L, L),

with action ``u = tanh(MLP(p, v))``. The descriptor is the final position, the
fitness minus the mean squared action. Rotations by 90 degrees and the four
mirrors map trajectories to trajectories (the drag uses the Euclidean norm
and the arena is a square), so ``P_o = A (+) A`` and ``P_a = A`` for each
2x2 signed permutation ``A`` in D4.

It is a cheap, exactly symmetric control problem that exercises the same MLP
weight transformation as the Ant.
"""

from __future__ import annotations

import functools

import jax
import jax.numpy as jnp
from qdax.core.containers.mapelites_repertoire import compute_euclidean_centroids
from qdax.core.emitters.mutation_operators import isoline_variation
from qdax.core.neuroevolution.networks.networks import MLP

from symqd.domains.base import Task
from symqd.group import SignedPermutation, block_diag, dihedral4
from symqd.transforms import make_mlp_transform


def make_pointmass_task(
    episode_length: int = 50,
    dt: float = 0.1,
    drag: float = 0.5,
    arena: float = 1.0,
    hidden: tuple[int, ...] = (16,),
    grid: int = 33,
    **_,
) -> Task:
    group = dihedral4()
    acts = [SignedPermutation.from_matrix(m) for m in group.descriptor_matrices]
    obs = [block_diag(a, a) for a in acts]
    policy = MLP(layer_sizes=tuple(hidden) + (2,), final_activation=jnp.tanh)

    def rollout(params):
        def step(carry, _):
            p, v = carry
            u = policy.apply(params, jnp.concatenate([p, v]))
            v = v + dt * (u - drag * jnp.linalg.norm(v) * v)
            p = jnp.clip(p + dt * v, -arena, arena)
            return (p, v), jnp.sum(u**2)

        (p, _), cost = jax.lax.scan(step, (jnp.zeros(2), jnp.zeros(2)), (), length=episode_length)
        return -jnp.mean(cost), p

    def scoring_fn(genotypes, key):
        fit, desc = jax.vmap(rollout)(genotypes)
        return fit, desc, {}

    def init_genotypes(key, n):
        keys = jax.random.split(key, n)
        return jax.vmap(lambda k: policy.init(k, jnp.zeros(4)))(keys)

    return Task(
        name="pointmass",
        scoring_fn=scoring_fn,
        init_genotypes=init_genotypes,
        group=group,
        transform=make_mlp_transform(obs, acts),
        centroids=compute_euclidean_centroids((grid, grid), -arena, arena),
        variation_fn=functools.partial(isoline_variation, iso_sigma=0.05, line_sigma=0.5),
        qd_offset=2.0,
        info={"policy": policy, "obs_reps": obs, "act_reps": acts, "grid": grid},
    )
