"""Controller (genotype) transformations induced by a symmetry.

A genotype transform has the signature ``transform(genotypes, g) -> genotypes``
where ``genotypes`` is a batched pytree (leading axis B) and ``g`` an int
array of shape ``(B,)`` holding the group element to apply to each genotype.

For a policy ``pi`` and symmetry ``g`` with observation map ``P_o`` and
action map ``P_a``, the transformed policy is

    (g . pi)(o) = P_a  pi(P_o^{-1} o).

If the dynamics, initial state and reward are G-invariant, rolling out
``g . pi`` produces exactly the ``g``-image of the trajectory of ``pi``, so its
descriptor is ``g . d`` and its fitness is unchanged.

For an MLP ``pi(o) = act(... sigma(o W_1 + b_1) ... W_L + b_L)`` with an odd
(or absent) output activation this is exact and cheap: permute/negate the
rows of ``W_1`` and the columns of ``W_L`` / entries of ``b_L``. Hidden
layers are untouched.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Sequence

import jax
import jax.numpy as jnp
import numpy as np

from symqd.group import SignedPermutation

GenotypeTransform = Callable[[Any, jnp.ndarray], Any]

_DENSE = re.compile(r"Dense_(\d+)$")


def _find_dense_layers(params: dict) -> tuple[dict, list[str]]:
    """Return the dict holding ``Dense_k`` entries and their sorted names."""
    node = params
    while True:
        names = [k for k in node if _DENSE.match(k)]
        if names:
            return node, sorted(names, key=lambda k: int(_DENSE.match(k).group(1)))
        if len(node) == 1 and isinstance(next(iter(node.values())), dict):
            node = next(iter(node.values()))
            continue
        raise ValueError("could not find flax Dense_k layers in params")


def _rebuild(params: dict, layers: dict) -> dict:
    """Copy ``params`` with the Dense-holding dict replaced by ``layers``."""
    if any(_DENSE.match(k) for k in params):
        return layers
    (key, child), = params.items()
    return {key: _rebuild(child, layers)}


def make_mlp_transform(
    obs_reps: Sequence[SignedPermutation],
    act_reps: Sequence[SignedPermutation],
) -> GenotypeTransform:
    """Transform for batched flax MLP params (e.g. ``qdax`` ``MLP``)."""
    obs_perm = jnp.asarray(np.stack([r.perm for r in obs_reps]))
    obs_sign = jnp.asarray(np.stack([r.sign for r in obs_reps]))
    # P_o^{-1} o enters the first layer, so the kernel rows transform by P_o
    # itself: (P_o^{-1} o) W = o (P_o W) for orthogonal P_o.
    act_perm = jnp.asarray(np.stack([r.perm for r in act_reps]))
    act_sign = jnp.asarray(np.stack([r.sign for r in act_reps]))

    def transform(params, g):
        g = jnp.asarray(g, dtype=jnp.int32)
        holder, names = _find_dense_layers(params)
        layers = dict(holder)

        first = dict(layers[names[0]])
        k = first["kernel"]  # (B, n_obs, h)
        p = obs_perm[g][:, :, None]
        s = obs_sign[g][:, :, None]
        first["kernel"] = s * jnp.take_along_axis(k, p, axis=1)
        layers[names[0]] = first

        last = dict(layers[names[-1]])
        k = last["kernel"]  # (B, h, n_act)
        p = act_perm[g][:, None, :]
        s = act_sign[g][:, None, :]
        last["kernel"] = s * jnp.take_along_axis(k, jnp.broadcast_to(p, k.shape), axis=2)
        if "bias" in last:
            b = last["bias"]  # (B, n_act)
            last["bias"] = act_sign[g] * jnp.take_along_axis(b, act_perm[g], axis=1)
        layers[names[-1]] = last
        return _rebuild(params, layers)

    return transform


def make_vector_transform(reps: Sequence[SignedPermutation], center: float = 0.0):
    """Transform for flat-vector genotypes: ``x -> P (x - c) + c``."""
    perm = jnp.asarray(np.stack([r.perm for r in reps]))
    sign = jnp.asarray(np.stack([r.sign for r in reps]))

    def transform(x, g):
        g = jnp.asarray(g, dtype=jnp.int32)
        return sign[g] * (jnp.take_along_axis(x, perm[g], axis=1) - center) + center

    return transform


def apply_all(transform: GenotypeTransform, genotypes, order: int):
    """Stack ``g . genotypes`` for every ``g``; leaves get shape (G*B, ...)."""
    batch = jax.tree.leaves(genotypes)[0].shape[0]
    tiled = jax.tree.map(lambda x: jnp.tile(x, (order,) + (1,) * (x.ndim - 1)), genotypes)
    g = jnp.repeat(jnp.arange(order, dtype=jnp.int32), batch)
    return transform(tiled, g), g
