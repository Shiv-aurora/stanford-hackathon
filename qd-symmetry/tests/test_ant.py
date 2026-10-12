"""Brax Ant checks (slow: run with ``pytest --run-slow``)."""

import jax
import numpy as np
import pytest

from symqd.group import dihedral4

pytestmark = pytest.mark.slow


def test_ant_symmetry_derivation_and_first_step():
    from symqd.domains.ant import derive_ant_symmetry, make_ant_env, rollout_symmetry_error

    group = dihedral4()
    env = make_ant_env(backend="generalized")
    sym = derive_ant_symmetry(env.sys, group)  # also checks homomorphism
    res = rollout_symmetry_error(env, group, sym, jax.random.PRNGKey(0), num_steps=3, num_sequences=2)
    for name, (obs_err, xy_err) in res.items():
        assert obs_err[0] < 1e-3, name
        assert xy_err[0] < 1e-5, name
