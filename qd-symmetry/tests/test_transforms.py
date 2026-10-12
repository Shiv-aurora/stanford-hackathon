import itertools

import jax
import jax.numpy as jnp
import numpy as np
from qdax.core.neuroevolution.networks.networks import MLP

from symqd.group import SignedPermutation, block_diag, dihedral4
from symqd.transforms import apply_all, make_mlp_transform, make_vector_transform


def d4_reps():
    g = dihedral4()
    acts = [SignedPermutation.from_matrix(m) for m in g.descriptor_matrices]
    obs = [block_diag(a, a, SignedPermutation.identity(1)) for a in acts]
    return g, obs, acts


def batch_init(policy, n, n_obs, seed=0):
    keys = jax.random.split(jax.random.PRNGKey(seed), n)
    return jax.vmap(lambda k: policy.init(k, jnp.zeros(n_obs)))(keys)


def test_mlp_transform_is_equivariant():
    g, obs, acts = d4_reps()
    policy = MLP(layer_sizes=(8, 8, 2), final_activation=jnp.tanh)
    params = batch_init(policy, 8, 5)
    transform = make_mlp_transform(obs, acts)
    o = jax.random.normal(jax.random.PRNGKey(1), (8, 5))
    for k in range(g.order):
        gk = jnp.full((8,), k)
        new = transform(params, gk)
        lhs = jax.vmap(policy.apply)(new, o)
        rhs = acts[k].apply(jax.vmap(policy.apply)(params, obs[k].inverse().apply(o)))
        np.testing.assert_allclose(lhs, rhs, atol=1e-6)


def test_mlp_transform_composes_like_the_group():
    g, obs, acts = d4_reps()
    policy = MLP(layer_sizes=(4, 2), final_activation=jnp.tanh)
    params = batch_init(policy, 3, 5)
    t = make_mlp_transform(obs, acts)
    for a, b in itertools.product(range(g.order), repeat=2):
        twice = t(t(params, jnp.full((3,), b)), jnp.full((3,), a))
        once = t(params, jnp.full((3,), g.cayley[a, b]))
        for x, y in zip(jax.tree.leaves(twice), jax.tree.leaves(once)):
            np.testing.assert_array_equal(x, y)


def test_single_layer_mlp():
    g, obs, acts = d4_reps()
    policy = MLP(layer_sizes=(2,), final_activation=jnp.tanh)
    params = batch_init(policy, 2, 5)
    new = make_mlp_transform(obs, acts)(params, jnp.array([1, 4]))
    o = jnp.ones((2, 5))
    for i, k in enumerate([1, 4]):
        p_i = jax.tree.map(lambda x: x[i], new)
        p0 = jax.tree.map(lambda x: x[i], params)
        np.testing.assert_allclose(
            policy.apply(p_i, o[i]),
            acts[k].apply(policy.apply(p0, obs[k].inverse().apply(o[i]))),
            atol=1e-6,
        )


def test_per_element_group_indices():
    g, obs, acts = d4_reps()
    policy = MLP(layer_sizes=(4, 2), final_activation=jnp.tanh)
    params = batch_init(policy, 8, 5)
    t = make_mlp_transform(obs, acts)
    mixed = t(params, jnp.arange(8))
    for k in range(8):
        single = t(jax.tree.map(lambda x: x[k : k + 1], params), jnp.array([k]))
        for x, y in zip(jax.tree.leaves(mixed), jax.tree.leaves(single)):
            np.testing.assert_array_equal(x[k], y[0])


def test_vector_transform_and_apply_all():
    reps = [SignedPermutation.identity(3), SignedPermutation(np.arange(3), -np.ones(3))]
    t = make_vector_transform(reps, center=0.5)
    x = jnp.array([[0.1, 0.2, 0.9], [0.5, 0.0, 1.0]])
    out, g = apply_all(t, x, 2)
    np.testing.assert_allclose(out[:2], x)
    np.testing.assert_allclose(out[2:], 1.0 - x)
    np.testing.assert_array_equal(g, [0, 0, 1, 1])
