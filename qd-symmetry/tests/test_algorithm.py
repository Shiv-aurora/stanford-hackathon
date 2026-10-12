import functools

import jax
import jax.numpy as jnp
import numpy as np
import pytest
from qdax.core.emitters.standard_emitters import MixingEmitter
from qdax.utils.metrics import default_qd_metrics

from symqd.algorithm import SymmetricMAPElites, reevaluate, run_scan
from symqd.cells import CellAction
from symqd.domains import make_task


def build(task_name, variant, batch=64, **kw):
    task = make_task(task_name, **kw)
    cells = CellAction.from_centroids(task.group, np.asarray(task.centroids))
    emitter = MixingEmitter(
        mutation_fn=None, variation_fn=task.variation_fn, variation_percentage=1.0, batch_size=batch
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
    key = jax.random.PRNGKey(0)
    rep, es, _ = algo.init(task.init_genotypes(key, batch), task.centroids, key)
    rep, es, key, metrics = jax.jit(functools.partial(run_scan, algo, num_iterations=10))(rep, es, key)
    return task, cells, algo, rep, metrics


@pytest.mark.parametrize("task_name", ["arm", "pointmass"])
@pytest.mark.parametrize("variant", ["baseline", "augment", "fd"])
def test_variants_run(task_name, variant):
    task, cells, algo, rep, metrics = build(task_name, variant, grid=9)
    assert np.all(np.diff(np.asarray(metrics["qd_score"])) >= -1e-3)
    assert rep.centroids.shape[0] == (cells.num_orbits if variant == "fd" else cells.num_cells)


@pytest.mark.parametrize("task_name", ["arm", "pointmass"])
def test_fd_metrics_match_expanded_archive(task_name):
    task, cells, algo, rep, metrics = build(task_name, "fd", grid=9)
    full = algo.expand(rep)
    expected = default_qd_metrics(full, task.qd_offset)
    got = algo._metrics_function(rep)
    for k in ("qd_score", "coverage", "max_fitness"):
        np.testing.assert_allclose(got[k], expected[k], rtol=1e-5)
    # the archive is G-invariant: every cell in an orbit has the same fitness
    f = np.asarray(full.fitnesses)
    for g in range(task.group.order):
        np.testing.assert_array_equal(f[cells.perm[g]], f)


@pytest.mark.parametrize("task_name", ["arm", "pointmass"])
def test_expanded_archive_survives_reevaluation(task_name):
    """On exactly symmetric tasks transformed elites really are elites."""
    task, cells, algo, rep, _ = build(task_name, "fd", grid=9)
    full = algo.expand(rep)
    fresh = reevaluate(full, task.scoring_fn, jax.random.PRNGKey(0))
    filled = np.asarray(full.fitnesses) != -np.inf
    assert np.array_equal(filled, np.asarray(fresh.fitnesses) != -np.inf)
    np.testing.assert_allclose(fresh.fitnesses[filled], full.fitnesses[filled], atol=1e-5)


def test_augment_archive_is_invariant():
    task, cells, algo, rep, _ = build("pointmass", "augment", grid=9)
    f = np.asarray(rep.fitnesses)
    for g in range(task.group.order):
        np.testing.assert_array_equal(f[cells.perm[g]], f)
