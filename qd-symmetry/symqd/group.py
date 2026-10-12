"""Finite symmetry groups and their signed-permutation representations.

A symmetry ``g`` of a QD task acts on three spaces at once:

* the descriptor space, as an orthogonal (affine) map ``d -> A_g (d - c) + c``;
* the observation space, as a signed permutation ``P_o(g)``;
* the action space, as a signed permutation ``P_a(g)``.

The descriptor action is used to identify group elements (it must be
faithful), to build the Cayley table, and to compute orbits of archive cells.
The observation/action representations are used to transform controllers.
Every representation must be a group homomorphism, i.e.
``rep(g) rep(h) == rep(g h)``; :func:`check_homomorphism` verifies this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import jax.numpy as jnp
import numpy as np


@dataclass(frozen=True)
class SignedPermutation:
    """The linear map ``(P x)[i] = sign[i] * x[perm[i]]``."""

    perm: np.ndarray
    sign: np.ndarray

    def __post_init__(self) -> None:
        perm = np.asarray(self.perm, dtype=np.int32)
        sign = np.asarray(self.sign, dtype=np.float32)
        if perm.shape != sign.shape or perm.ndim != 1:
            raise ValueError("perm and sign must be 1-D arrays of equal length")
        if sorted(perm.tolist()) != list(range(len(perm))):
            raise ValueError(f"not a permutation: {perm}")
        if not np.all(np.abs(sign) == 1.0):
            raise ValueError(f"signs must be +-1: {sign}")
        object.__setattr__(self, "perm", perm)
        object.__setattr__(self, "sign", sign)

    @property
    def size(self) -> int:
        return len(self.perm)

    @classmethod
    def identity(cls, n: int) -> "SignedPermutation":
        return cls(np.arange(n), np.ones(n))

    @classmethod
    def from_matrix(cls, matrix: np.ndarray, atol: float = 1e-6) -> "SignedPermutation":
        m = np.asarray(matrix, dtype=np.float64)
        n = m.shape[0]
        perm = np.argmax(np.abs(m), axis=1)
        sign = np.sign(m[np.arange(n), perm])
        rebuilt = np.zeros_like(m)
        rebuilt[np.arange(n), perm] = sign
        if not np.allclose(rebuilt, m, atol=atol):
            raise ValueError(f"matrix is not a signed permutation:\n{m}")
        return cls(perm, sign)

    def matrix(self) -> np.ndarray:
        m = np.zeros((self.size, self.size), dtype=np.float32)
        m[np.arange(self.size), self.perm] = self.sign
        return m

    def apply(self, x):
        """Apply to the last axis of ``x`` (works for numpy and jax arrays)."""
        return self.sign * x[..., self.perm]

    def compose(self, other: "SignedPermutation") -> "SignedPermutation":
        """Return ``self @ other`` (apply ``other`` first)."""
        return SignedPermutation(other.perm[self.perm], self.sign * other.sign[self.perm])

    def inverse(self) -> "SignedPermutation":
        inv = np.argsort(self.perm)
        return SignedPermutation(inv, self.sign[inv])

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, SignedPermutation):
            return NotImplemented
        return bool(
            np.array_equal(self.perm, other.perm) and np.array_equal(self.sign, other.sign)
        )

    def __hash__(self) -> int:
        return hash((self.perm.tobytes(), self.sign.tobytes()))


def block_diag(*blocks: SignedPermutation) -> SignedPermutation:
    """Direct sum of signed permutations acting on concatenated vectors."""
    perms, signs, offset = [], [], 0
    for b in blocks:
        perms.append(b.perm + offset)
        signs.append(b.sign)
        offset += b.size
    return SignedPermutation(np.concatenate(perms), np.concatenate(signs))


@dataclass(frozen=True)
class SymmetryGroup:
    """A finite group, identified by its (faithful) action on descriptors.

    Element 0 must be the identity. ``descriptor_matrices[g]`` is the
    orthogonal matrix ``A_g`` and the action is ``A_g (d - center) + center``.
    """

    names: tuple[str, ...]
    descriptor_matrices: np.ndarray
    descriptor_center: np.ndarray
    cayley: np.ndarray = field(init=False, repr=False)
    inverses: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        mats = np.asarray(self.descriptor_matrices, dtype=np.float64)
        center = np.asarray(self.descriptor_center, dtype=np.float64)
        object.__setattr__(self, "descriptor_matrices", mats)
        object.__setattr__(self, "descriptor_center", center)
        n, d, d2 = mats.shape
        if d != d2 or center.shape != (d,):
            raise ValueError("descriptor matrices must be (G, d, d), center (d,)")
        if len(self.names) != n:
            raise ValueError("one name per group element")
        if not np.allclose(mats[0], np.eye(d)):
            raise ValueError("element 0 must be the identity")
        for g in range(n):
            if not np.allclose(mats[g] @ mats[g].T, np.eye(d), atol=1e-9):
                raise ValueError(f"descriptor matrix {self.names[g]} is not orthogonal")
            for h in range(g):
                if np.allclose(mats[g], mats[h]):
                    raise ValueError("descriptor action is not faithful")
        cayley = np.empty((n, n), dtype=np.int32)
        for g in range(n):
            for h in range(n):
                cayley[g, h] = self._find(mats[g] @ mats[h])
        inverses = np.array([int(np.where(cayley[g] == 0)[0][0]) for g in range(n)])
        object.__setattr__(self, "cayley", cayley)
        object.__setattr__(self, "inverses", inverses.astype(np.int32))

    def _find(self, mat: np.ndarray) -> int:
        for k, m in enumerate(self.descriptor_matrices):
            if np.allclose(m, mat, atol=1e-9):
                return k
        raise ValueError("set of descriptor matrices is not closed under products")

    @property
    def order(self) -> int:
        return len(self.names)

    def act_on_descriptors(self, descriptors, g):
        """Apply element(s) ``g`` to a batch of descriptors ``(B, d)``.

        ``g`` is an int or an int array of shape ``(B,)``; jit-compatible.
        """
        mats = jnp.asarray(self.descriptor_matrices, dtype=jnp.float32)
        center = jnp.asarray(self.descriptor_center, dtype=jnp.float32)
        a = mats[g]
        centered = descriptors - center
        if a.ndim == 2:
            return centered @ a.T + center
        return (a @ centered[..., None])[..., 0] + center


def check_homomorphism(group: SymmetryGroup, rep: Sequence[SignedPermutation]) -> None:
    """Raise if ``rep`` is not a homomorphism from ``group``."""
    if len(rep) != group.order:
        raise ValueError("one representation matrix per group element")
    if rep[0] != SignedPermutation.identity(rep[0].size):
        raise ValueError("rep(identity) must be the identity")
    for g in range(group.order):
        for h in range(group.order):
            if rep[g].compose(rep[h]) != rep[group.cayley[g, h]]:
                raise ValueError(
                    f"rep({group.names[g]}) rep({group.names[h]}) != "
                    f"rep({group.names[group.cayley[g, h]]})"
                )


# --- Common 2-D groups -------------------------------------------------------

_D4 = {
    "e": [[1, 0], [0, 1]],
    "r90": [[0, -1], [1, 0]],
    "r180": [[-1, 0], [0, -1]],
    "r270": [[0, 1], [-1, 0]],
    "flip_x": [[1, 0], [0, -1]],  # mirror across the x axis (y -> -y)
    "flip_y": [[-1, 0], [0, 1]],  # mirror across the y axis (x -> -x)
    "flip_diag": [[0, 1], [1, 0]],  # mirror across y = x
    "flip_anti": [[0, -1], [-1, 0]],  # mirror across y = -x
}


def dihedral4(center: Sequence[float] = (0.0, 0.0)) -> SymmetryGroup:
    """D4: the 8 symmetries of the square, acting on 2-D descriptors."""
    return SymmetryGroup(
        names=tuple(_D4),
        descriptor_matrices=np.array(list(_D4.values()), dtype=np.float64),
        descriptor_center=np.asarray(center, dtype=np.float64),
    )


def subgroup(group: SymmetryGroup, names: Sequence[str]) -> SymmetryGroup:
    """The subgroup of ``group`` given by element names (identity first)."""
    idx = [group.names.index(n) for n in names]
    return SymmetryGroup(
        names=tuple(names),
        descriptor_matrices=group.descriptor_matrices[idx],
        descriptor_center=group.descriptor_center,
    )


def mirror2(axis: str = "flip_x", center: Sequence[float] = (0.0, 0.0)) -> SymmetryGroup:
    """Z2 generated by a single mirror of a 2-D descriptor space."""
    return subgroup(dihedral4(center), ["e", axis])


def embed_xy(mat2: np.ndarray) -> np.ndarray:
    """Lift a 2x2 horizontal-plane map to 3-D, leaving z fixed."""
    m = np.eye(3)
    m[:2, :2] = mat2
    return m
