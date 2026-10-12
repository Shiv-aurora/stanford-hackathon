import itertools

import numpy as np
import pytest
from qdax.core.containers.mapelites_repertoire import compute_euclidean_centroids

from symqd.cells import CellAction, burnside_square_d4, burnside_square_mirror
from symqd.group import (
    SignedPermutation,
    block_diag,
    check_homomorphism,
    dihedral4,
    mirror2,
    subgroup,
)


def random_signed_perm(rng, n):
    return SignedPermutation(rng.permutation(n), rng.choice([-1.0, 1.0], n))


def test_signed_permutation_algebra():
    rng = np.random.default_rng(0)
    for _ in range(20):
        p, q = random_signed_perm(rng, 6), random_signed_perm(rng, 6)
        x = rng.normal(size=6)
        np.testing.assert_allclose(p.apply(x), p.matrix() @ x)
        np.testing.assert_allclose(p.compose(q).matrix(), p.matrix() @ q.matrix())
        assert p.compose(p.inverse()) == SignedPermutation.identity(6)
        assert SignedPermutation.from_matrix(p.matrix()) == p


def test_d4_group_axioms():
    g = dihedral4()
    assert g.order == 8
    n = g.order
    for a, b, c in itertools.product(range(n), repeat=3):
        assert g.cayley[g.cayley[a, b], c] == g.cayley[a, g.cayley[b, c]]
    assert all(g.cayley[a, g.inverses[a]] == 0 for a in range(n))
    # every row of the Cayley table is a permutation (Latin square)
    assert all(sorted(row) == list(range(n)) for row in g.cayley)


def test_descriptor_representation_is_homomorphism():
    g = dihedral4()
    reps = [SignedPermutation.from_matrix(m) for m in g.descriptor_matrices]
    check_homomorphism(g, reps)
    check_homomorphism(g, [block_diag(r, r, r) for r in reps])


def test_check_homomorphism_rejects_bad_rep():
    g = dihedral4()
    reps = [SignedPermutation.from_matrix(m) for m in g.descriptor_matrices]
    reps[1] = reps[3]  # r90 <-> r270 swapped on one element only
    with pytest.raises(ValueError):
        check_homomorphism(g, reps)


def test_non_closed_set_rejected():
    with pytest.raises(ValueError):
        subgroup(dihedral4(), ["e", "r90"])  # r90 alone does not close


@pytest.mark.parametrize("n", range(1, 10))
def test_burnside_d4_grid(n):
    cells = CellAction.from_centroids(
        dihedral4(), np.asarray(compute_euclidean_centroids((n, n), -1.0, 1.0))
    )
    assert cells.num_orbits == burnside_square_d4(n) == cells.burnside_count()
    assert cells.orbit_sizes.sum() == n * n
    assert cells.reduction <= 8


@pytest.mark.parametrize("n", range(1, 10))
def test_burnside_mirror_grid(n):
    cells = CellAction.from_centroids(
        mirror2("flip_x", center=(0.5, 0.5)),
        np.asarray(compute_euclidean_centroids((n, n), 0.0, 1.0)),
    )
    assert cells.num_orbits == burnside_square_mirror(n) == cells.burnside_count()


def test_canonical_maps_to_representative():
    cells = CellAction.from_centroids(
        dihedral4(), np.asarray(compute_euclidean_centroids((7, 7), -1.0, 1.0))
    )
    for i in range(cells.num_cells):
        g = cells.canonical[i]
        assert cells.perm[g, i] == cells.reps[cells.orbit_id[i]]
    assert np.all(cells.canonical[cells.reps] == 0)


def test_hexapod_numbers_from_the_review():
    # 5^6 contact-time cells; left-right swap (a,b,c,d,e,f) -> (d,e,f,a,b,c)
    lr = (15625 + 125) / 2
    assert lr == 7875
    # adding front-back: identity, LR, FB (fixes 5^4), rotation (fixes 5^3)
    assert (15625 + 125 + 625 + 125) / 4 == 4125


def test_non_invariant_tessellation_rejected():
    rng = np.random.default_rng(0)
    with pytest.raises(ValueError):
        CellAction.from_centroids(dihedral4(), rng.uniform(-1, 1, size=(50, 2)))
