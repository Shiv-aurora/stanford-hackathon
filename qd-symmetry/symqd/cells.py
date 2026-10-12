"""How a symmetry group permutes archive cells: orbits, fundamental domain, Burnside.

For a G-invariant tessellation (every ``g`` maps centroids onto centroids)
each group element is a permutation of the N cells. Searching one
representative cell per orbit (a fundamental domain) is enough: any elite
found there can be transformed into an elite for every other cell in its
orbit. The number of orbits is given by Burnside's lemma,

    #orbits = (1 / |G|) * sum_g |Fix(g)|,

so the best possible reduction in archive size is N / #orbits <= |G|.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from symqd.group import SymmetryGroup


@dataclass(frozen=True)
class CellAction:
    """The action of ``group`` on a set of centroids.

    Attributes:
        perm: ``(G, N)``; ``perm[g, i]`` is the cell that ``g`` maps cell ``i`` to.
        reps: ``(K,)`` full-archive index of each orbit representative
            (the fundamental domain), ordered by first appearance.
        orbit_id: ``(N,)`` index into ``reps`` of each cell's orbit.
        orbit_sizes: ``(K,)`` number of cells in each orbit.
        canonical: ``(N,)`` the first group element mapping each cell to its
            orbit representative (identity for representatives themselves).
        first_occurrence: ``(G, N)`` True where ``perm[g, i]`` differs from
            ``perm[h, i]`` for every ``h < g``; used to drop duplicate
            insertions into self-symmetric cells.
    """

    group: SymmetryGroup
    perm: np.ndarray
    reps: np.ndarray
    orbit_id: np.ndarray
    orbit_sizes: np.ndarray
    canonical: np.ndarray
    first_occurrence: np.ndarray

    @classmethod
    def from_centroids(
        cls, group: SymmetryGroup, centroids: np.ndarray, rtol: float = 1e-4
    ) -> "CellAction":
        c = np.asarray(centroids, dtype=np.float64)
        n = c.shape[0]
        scale = max(float(np.ptp(c, axis=0).max()), 1e-12)
        perm = np.empty((group.order, n), dtype=np.int32)
        for g in range(group.order):
            mapped = (c - group.descriptor_center) @ group.descriptor_matrices[g].T
            mapped += group.descriptor_center
            d2 = ((mapped[:, None, :] - c[None, :, :]) ** 2).sum(-1)
            nearest = d2.argmin(axis=1)
            err = np.sqrt(d2[np.arange(n), nearest]).max()
            if err > rtol * scale:
                raise ValueError(
                    f"tessellation is not invariant under {group.names[g]} "
                    f"(max centroid mismatch {err:.3g})"
                )
            if len(np.unique(nearest)) != n:
                raise ValueError(f"{group.names[g]} does not permute the centroids")
            perm[g] = nearest

        orbit_id = -np.ones(n, dtype=np.int32)
        reps = []
        for i in range(n):
            if orbit_id[i] < 0:
                orbit_id[perm[:, i]] = len(reps)
                reps.append(i)
        reps = np.array(reps, dtype=np.int32)
        orbit_sizes = np.bincount(orbit_id, minlength=len(reps)).astype(np.int32)

        target = reps[orbit_id]
        canonical = np.argmax(perm == target[None, :], axis=0).astype(np.int32)

        first = np.ones((group.order, n), dtype=bool)
        for g in range(1, group.order):
            first[g] = ~np.any(perm[:g] == perm[g][None, :], axis=0)

        return cls(group, perm, reps, orbit_id, orbit_sizes, canonical, first)

    @property
    def num_cells(self) -> int:
        return self.perm.shape[1]

    @property
    def num_orbits(self) -> int:
        return len(self.reps)

    def fixed_counts(self) -> np.ndarray:
        """``|Fix(g)|`` for every group element."""
        return (self.perm == np.arange(self.num_cells)[None, :]).sum(axis=1)

    def burnside_count(self) -> float:
        return float(self.fixed_counts().sum()) / self.group.order

    @property
    def reduction(self) -> float:
        """Archive-size reduction factor N / #orbits (at most |G|)."""
        return self.num_cells / self.num_orbits

    def summary(self) -> str:
        fixed = ", ".join(
            f"{name}:{k}" for name, k in zip(self.group.names, self.fixed_counts())
        )
        return (
            f"|G|={self.group.order}  N={self.num_cells}  orbits={self.num_orbits} "
            f"(Burnside {self.burnside_count():g})  reduction={self.reduction:.3f}x  "
            f"|Fix(g)|: {fixed}"
        )


def burnside_square_mirror(n: int) -> int:
    """Orbits of an ``n x n`` grid under one axis mirror (closed form).

    Fixed cells: identity n^2; the mirror fixes the middle row iff n is odd.
    """
    return (n * n + (n % 2) * n) // 2


def burnside_square_d4(n: int) -> int:
    """Orbits of an ``n x n`` grid centred on the origin under D4 (closed form).

    Fixed cells: identity n^2; r90, r270: n odd -> 1; r180: n odd -> 1;
    axis mirrors: n odd -> n each; diagonal mirrors: n each.
    """
    odd = n % 2
    fixed = n * n + 2 * odd + odd + 2 * odd * n + 2 * n
    assert fixed % 8 == 0
    return fixed // 8
