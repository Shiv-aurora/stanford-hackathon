"""Ant Omni (QDax / Brax) and its D4 symmetry, derived from the simulator.

The Brax Ant has a spherical torso and four identical legs along the
diagonals, actuated with identical gears, so the candidate symmetry group is
D4 acting on the horizontal plane. Rather than hand-writing the observation
and action maps, :func:`derive_ant_symmetry` reads the loaded ``brax.System``:

* each hinge's world anchor and axis at zero joint angles;
* joint limits, armature, damping, link masses and actuator gears.

For every ``g`` (a 3x3 orthogonal ``A`` fixing z) it matches hinge ``j`` to the
hinge ``j'`` whose anchor is ``A p_j`` and whose axis is ``s det(A) A n_j``
(``s = +-1``). A hinge angle ``theta`` about ``n`` maps to ``theta`` about
``det(A) A n`` because ``A exp(theta [n]x) A^T = exp(theta det(A) [A n]x)``, so
joint ``j'`` gets angle ``s theta_j``. The free joint contributes
``z -> z``, ``quat (w, v) -> (w, det(A) A v)``, linear velocity ``-> A v`` and
angular velocity ``-> det(A) A w`` (a pseudovector).

Exactness also needs a G-invariant start state: Brax's Ant adds uniform noise
to the initial pose, so ``symmetric_init=True`` sets ``reset_noise_scale=0``.
:func:`rollout_symmetry_error` measures how far the simulator is from the
derived symmetry (contact solving and float round-off break it slightly).
"""

from __future__ import annotations

import functools
from dataclasses import dataclass

import jax
import jax.numpy as jnp
import numpy as np

from symqd.domains.base import Task
from symqd.group import (
    SignedPermutation,
    SymmetryGroup,
    block_diag,
    check_homomorphism,
    dihedral4,
    embed_xy,
)
from symqd.transforms import make_mlp_transform


@dataclass
class AntSymmetry:
    obs_reps: list[SignedPermutation]
    act_reps: list[SignedPermutation]
    joint_maps: list[list[tuple[int, int]]]  # per g: hinge j -> (j', sign)
    report: str


def _quat_rotate(v: np.ndarray, q: np.ndarray) -> np.ndarray:
    w, u = q[0], q[1:]
    return v + 2.0 * np.cross(u, np.cross(u, v) + w * v)


def derive_ant_symmetry(sys, group: SymmetryGroup, atol: float = 1e-4) -> AntSymmetry:
    """Derive observation/action signed permutations for each element of ``group``.

    Assumes the Brax Ant observation layout ``[q[2:], qd]`` (x, y excluded).
    Raises ``ValueError`` if some ``g`` is not a symmetry of the model.
    """
    from brax import kinematics

    hinge_q = np.asarray(sys.q_idx("1"))
    hinge_qd = np.asarray(sys.qd_idx("1"))
    dof_link = np.asarray(sys.dof_link())
    n_hinge = len(hinge_q)

    q = np.asarray(sys.init_q).copy()
    q[hinge_q] = 0.0
    x, _ = kinematics.forward(sys, jnp.asarray(q), jnp.zeros(sys.qd_size()))
    pos, rot = np.asarray(x.pos), np.asarray(x.rot)
    torso = pos[0]

    links = dof_link[hinge_qd]
    joint_pos = np.asarray(sys.link.joint.pos)
    anchors = np.stack(
        [pos[l] + _quat_rotate(joint_pos[l], rot[l]) - torso for l in links]
    )
    axes = np.stack(
        [_quat_rotate(np.asarray(sys.dof.motion.ang)[d], rot[l]) for d, l in zip(hinge_qd, links)]
    )
    lo = np.asarray(sys.dof.limit[0])[hinge_qd]
    hi = np.asarray(sys.dof.limit[1])[hinge_qd]
    armature = np.asarray(sys.dof.armature)[hinge_qd]
    damping = np.asarray(sys.dof.damping)[hinge_qd]
    mass = np.asarray(sys.link.inertia.mass)[links]

    act_dof = np.asarray(sys.actuator.qd_id)
    gear = np.asarray(sys.actuator.gear)
    hinge_of_dof = {int(d): j for j, d in enumerate(hinge_qd)}
    act_hinge = np.array([hinge_of_dof[int(d)] for d in act_dof])

    obs_reps, act_reps, joint_maps, lines = [], [], [], []
    for gi, name in enumerate(group.names):
        a = embed_xy(group.descriptor_matrices[gi])
        det = float(np.linalg.det(a))
        jmap = []
        for j in range(n_hinge):
            dist = np.linalg.norm(anchors - a @ anchors[j], axis=1)
            k = int(dist.argmin())
            if dist[k] > atol:
                raise ValueError(f"{name}: no hinge at the image of hinge {j}")
            image_axis = det * (a @ axes[j])
            s = float(np.sign(axes[k] @ image_axis))
            if not np.allclose(axes[k], s * image_axis, atol=atol):
                raise ValueError(f"{name}: hinge {j} axis does not map onto hinge {k}")
            lim = np.sort(s * np.array([lo[j], hi[j]]))
            if not np.allclose(lim, [lo[k], hi[k]], atol=atol):
                raise ValueError(f"{name}: joint limits of {j} and {k} differ")
            for label, arr in (("armature", armature), ("damping", damping), ("mass", mass)):
                if not np.isclose(arr[j], arr[k], rtol=1e-5):
                    raise ValueError(f"{name}: {label} of hinge {j} and {k} differ")
            jmap.append((k, int(s)))
        if sorted(k for k, _ in jmap) != list(range(n_hinge)):
            raise ValueError(f"{name}: hinge map is not a bijection")

        # hinge-space signed permutation: (P x)[k] = s x[j]
        perm = np.empty(n_hinge, dtype=int)
        sign = np.empty(n_hinge)
        for j, (k, s) in enumerate(jmap):
            perm[k], sign[k] = j, s
        joints = SignedPermutation(perm, sign)

        lin = SignedPermutation.from_matrix(a)
        pseudo = SignedPermutation.from_matrix(det * a)
        one = SignedPermutation.identity(1)
        obs_reps.append(block_diag(one, one, pseudo, joints, lin, pseudo, joints))

        n_act = len(act_dof)
        a_perm = np.empty(n_act, dtype=int)
        a_sign = np.empty(n_act)
        for i in range(n_act):
            k, s = jmap[act_hinge[i]]
            (i2,) = np.where(act_hinge == k)[0]
            if not np.isclose(gear[i], gear[i2]):
                raise ValueError(f"{name}: actuator gears {i} and {i2} differ")
            a_perm[i2], a_sign[i2] = i, s
        act_reps.append(SignedPermutation(a_perm, a_sign))
        joint_maps.append(jmap)
        lines.append(
            f"{name:>9}: hinges "
            + " ".join(f"{j}->{'-' if s < 0 else '+'}{k}" for j, (k, s) in enumerate(jmap))
        )

    check_homomorphism(group, obs_reps)
    check_homomorphism(group, act_reps)
    return AntSymmetry(obs_reps, act_reps, joint_maps, "\n".join(lines))


def make_ant_env(
    episode_length: int = 250,
    backend: str = "spring",
    symmetric_init: bool = True,
    limit: float = 30.0,
):
    """QDax ``ant_omni``; ``limit`` bounds (and clips) the final-xy descriptor."""
    from qdax.tasks.brax import v2 as environments

    kwargs = {"reset_noise_scale": 0.0} if symmetric_init else {}
    return environments.create(
        "ant_omni",
        episode_length=episode_length,
        backend=backend,
        qdax_wrappers_kwargs=[{"minval": [-limit, -limit], "maxval": [limit, limit]}, {}],
        **kwargs,
    )


def rollout_symmetry_error(
    env,
    group: SymmetryGroup,
    sym: AntSymmetry,
    key: jax.Array,
    num_steps: int = 250,
    num_sequences: int = 4,
):
    """Open-loop test: roll out random actions ``a_t`` and ``P_a(g) a_t``.

    Returns per-``g`` arrays of shape ``(num_steps,)``: the max over sequences
    of ``|P_o(g) o_t - o'_t|_inf`` and ``|A_g xy_t - xy'_t|_2``.
    """
    env = getattr(env, "unwrapped", env)  # no auto-reset / episode wrappers
    reset_key, act_key = jax.random.split(key)
    state0 = env.reset(reset_key)
    actions = jax.random.uniform(
        act_key, (num_sequences, num_steps, env.action_size), minval=-1.0, maxval=1.0
    )

    def run(acts):
        def step(state, a):
            state = env.step(state, a)
            return state, (state.obs, state.pipeline_state.x.pos[0, :2])

        _, out = jax.lax.scan(step, state0, acts)
        return out

    run_batch = jax.jit(jax.vmap(run))
    obs, xy = run_batch(actions)
    results = {}
    for gi, name in enumerate(group.names):
        acts_g = sym.act_reps[gi].apply(actions)
        obs_g, xy_g = run_batch(acts_g)
        obs_err = jnp.max(jnp.abs(sym.obs_reps[gi].apply(obs) - obs_g), axis=(0, 2))
        xy_pred = group.act_on_descriptors(xy.reshape(-1, 2), gi).reshape(xy.shape)
        xy_err = jnp.max(jnp.linalg.norm(xy_pred - xy_g, axis=-1), axis=0)
        results[name] = (np.asarray(obs_err), np.asarray(xy_err))
    return results


def make_ant_omni_task(
    episode_length: int = 250,
    backend: str = "spring",
    hidden: tuple[int, ...] = (64, 64),
    grid: int = 33,
    symmetric_init: bool = True,
    limit: float = 30.0,
    seed: int = 0,
    **_,
) -> Task:
    from qdax.core.containers.mapelites_repertoire import compute_euclidean_centroids
    from qdax.core.emitters.mutation_operators import isoline_variation
    from qdax.core.neuroevolution.networks.networks import MLP
    from qdax.tasks.brax import v2 as environments
    from qdax.tasks.brax.v2.env_creators import create_brax_scoring_fn

    env = make_ant_env(episode_length, backend, symmetric_init, limit)
    group = dihedral4()
    sym = derive_ant_symmetry(env.sys, group)

    policy = MLP(
        layer_sizes=tuple(hidden) + (env.action_size,),
        kernel_init=jax.nn.initializers.lecun_uniform(),
        final_activation=jnp.tanh,
    )
    scoring_fn = create_brax_scoring_fn(
        env,
        policy,
        environments.descriptor_extractor["ant_omni"],
        jax.random.PRNGKey(seed),
        episode_length=episode_length,
        deterministic=True,
    )

    def init_genotypes(key, n):
        keys = jax.random.split(key, n)
        return jax.vmap(lambda k: policy.init(k, jnp.zeros(env.observation_size)))(keys)

    lo, hi = env.descriptor_limits
    return Task(
        name="ant_omni",
        scoring_fn=scoring_fn,
        init_genotypes=init_genotypes,
        group=group,
        transform=make_mlp_transform(sym.obs_reps, sym.act_reps),
        centroids=compute_euclidean_centroids((grid, grid), list(lo), list(hi)),
        variation_fn=functools.partial(isoline_variation, iso_sigma=0.005, line_sigma=0.05),
        qd_offset=environments.reward_offset["ant_omni"] * episode_length,
        exact=False,
        info={"env": env, "policy": policy, "symmetry": sym, "grid": grid},
    )
