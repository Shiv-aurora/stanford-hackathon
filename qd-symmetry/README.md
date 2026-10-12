# symqd: exploiting known symmetries in MAP-Elites archives

Code for the paper idea "restrict the archive to a fundamental domain of a known
symmetry group G and gain up to |G|x sample efficiency", built on
[QDax](https://github.com/adaptive-intelligent-robotics/QDax) 0.5.0.

It implements the corrected, group-theoretic version of the idea, the three
variants a reviewer will ask for, three domains with different groups, and the
diagnostics for when the symmetry only holds approximately.

## The method in one page

**Setup.** A finite group G acts on the task. Each `g` acts on descriptors
(`d -> A_g d`, an orthogonal map), observations (`P_o(g)`) and actions
(`P_a(g)`), and through them on controllers:

    (g . pi)(o) = P_a(g) pi(P_o(g)^-1 o).

If the dynamics, start state and reward are G-invariant, then `g . pi` has
descriptor `g . d(pi)` and the same fitness. One evaluation therefore gives
an elite candidate for every cell in the orbit of `pi`'s cell.

**Orbit counting (Burnside).** With a G-invariant tessellation, each `g`
permutes the N cells. The number of cells to actually search is the number
of orbits:

    #orbits = (1/|G|) * sum_g |Fix(g)|  ~ N/|G|.

`symqd.cells.CellAction` computes the permutation tables, orbits, `|Fix(g)|`,
and checks the Burnside count. Some examples (also in `tests/test_group.py`):

| archive | group | N | #orbits | reduction |
|---|---|---|---|---|
| rover slope, 2k+1 cells | mirror | 2k+1 | k+1 | ~2x |
| hexapod contact times, 5^6 | left-right | 15,625 | 7,875 | 1.98x |
| hexapod, + front-back | Z2 x Z2 | 15,625 | 4,125 | 3.79x |
| 33x33 grid on xy (Ant Omni, point-mass) | D4 | 1,089 | 153 | 7.12x |
| 65x65 grid (point-mass runs) | D4 | 4,225 | 561 | 7.53x |
| 64x64 grid (arm) | mirror | 4,096 | 2,048 | 2.00x |

**Fundamental-domain archive.** Keep one representative cell per orbit. When
a solution lands in cell `i`, apply the canonicalising element `g_i` (the
first `g` mapping `i` to its representative) to both descriptor and
controller, and insert it there. The full archive is recovered at any time by
`expand_repertoire`.

**Self-symmetric cells** (cells fixed by some `g != e`, e.g. the diagonals and
the centre under D4) form smaller orbits. The canonicalising element is the
identity for representatives, and expansion writes the same elite into the
cell once.

**Exact weight transform for MLPs.** For `pi(o) = act(... sigma(o W1 + b1) ... WL + bL)`
with an odd or absent output activation (tanh in QDax):

    W1' = P_o W1            (rows permuted / negated)
    WL' = WL P_a^T,  bL' = P_a bL   (output columns permuted / negated)

Hidden layers are untouched. `symqd.transforms.make_mlp_transform` does this
for batched flax params, with a different `g` per individual.

**Composition requirement.** `P_o`, `P_a` must be group homomorphisms:
`rep(g) rep(h) = rep(gh)`. Otherwise two flips need not equal the identity,
and canonicalisation is ill-defined for |G| > 2. `check_homomorphism`
enforces it, and `test_mlp_transform_composes_like_the_group` checks the
weight transform for every pair in D4.

**Why the evaluation speed-up can exceed N/#orbits.** Burnside bounds the
size of the space to search, not the number of evaluations. For a hard-to-reach
orbit, the baseline needs all |G| copies to be found separately, which is the
*maximum* of |G| waiting times. The symmetric variants need any one, the
*minimum*. With roughly exponential waiting times that ratio is up to
|G|·H(|G|) (≈ 3 for Z2, ≈ 21.7 for D4). The measured speed-ups below sit
between |G| and that scale, and they grow toward the hard tail.

## The three variants (`symqd.algorithm.SymmetricMAPElites`)

All three share the emitter (Iso+LineDD), the scoring function and the
evaluation budget. Metrics are always computed on the full N-cell archive.

| variant | archive | inserted per evaluation |
|---|---|---|
| `baseline` | N cells | the solution |
| `augment` | N cells | the solution and its \|G\|−1 images (duplicates in self-symmetric cells dropped) |
| `fd` | #orbits cells | the canonicalised solution |

`augment` versus `fd` separates "free extra samples" from "smaller search
space".

Insertions use the permutation table (`perm[g, cell(d)]`) rather than
re-binning `g . d`. A descriptor exactly on a cell boundary (e.g. a
do-nothing policy at the origin of an even grid) has a nearest-centroid tie
that is broken by index, and that is not G-equivariant. Use odd grids for
groups that fix the origin.

## Domains

| domain | group | symmetry | controller |
|---|---|---|---|
| `arm` (QDax planar arm, 8 DoF) | Z2 (mirror) | exact: `x -> 1-x` | angle vector |
| `pointmass` (2-D double integrator, quadratic drag, square arena) | D4 | exact | MLP (16) |
| `ant_omni` (QDax/Brax Ant, final xy) | D4 | **approximate** (see below) | MLP (64, 64) |

Rotating the arm's first joint is *not* a symmetry, because it changes the
fitness (angle variance) and leaves [0, 1].

### The Ant's symmetry, derived from the simulator

`symqd.domains.ant.derive_ant_symmetry` reads the loaded `brax.System`: hinge
anchors and axes at zero angle, joint limits, armature, damping, link masses,
actuator gears. For every element of D4 it matches hinge `j` to the hinge
`j'` at the image anchor with axis `±det(A) A n_j`. A hinge angle about `n`
maps to an angle about `det(A) A n`, because
`A exp(θ[n]x) A^T = exp(θ det(A)[A n]x)`. The free joint contributes
`quat (w, v) -> (w, det(A) A v)`, linear velocity `-> A v`, and angular
velocity `-> det(A) A ω` (a pseudovector). It raises an error if any element
is not a symmetry of the model, and checks the homomorphism property. Two
things are needed for exactness:

* **A symmetric start state.** Brax adds uniform noise to the Ant's initial
  pose, so we set `reset_noise_scale=0`. QDax's deterministic evaluation
  otherwise freezes one *asymmetric* noisy start.
* **The right backend.** See the next section.

## Results so far (CPU, this repo's `results/`)

### Exact domains: the predicted gain is realised

Evaluations needed to reach a fraction of the baseline's final QD-score
(median over 5 seeds; speed-up relative to the baseline).

| domain | N/#orbits | variant | to 50% | to 80% | to 95% | final coverage |
|---|---|---|---|---|---|---|
| point-mass, D4, 65x65, batch 32 | 7.53x | baseline | 4,928 | 12,992 | 22,720 | 94.7 ± 1.9% |
| | | augment | 640 (**7.7x**) | 1,504 (**8.6x**) | 2,336 (**9.7x**) | 100% |
| | | fd | 672 (**7.3x**) | 1,600 (**8.1x**) | 2,464 (**9.2x**) | 100% |
| arm, Z2, 64x64, batch 32 | 2.00x | baseline | 7,424 | 23,040 | 43,648 | 72.1 ± 3.0% |
| | | augment | 2,976 (**2.5x**) | 9,344 (**2.5x**) | 19,584 (**2.2x**) | 76.1 ± 1.6% |
| | | fd | 3,648 (**2.0x**) | 10,272 (**2.2x**) | 19,936 (**2.2x**) | 76.2 ± 1.3% |

Full tables: `results/*/summary.md`; curves: `results/*/curves.png`. On these
exactly symmetric tasks the expanded FD archive survives re-evaluation
unchanged (`test_expanded_archive_survives_reevaluation`). `augment` and `fd`
perform about the same: the gain comes from the symmetry, not from the
smaller archive as such. `fd` uses 1/|G| of the memory.

### Ant: how exact is the symmetry? (`results/ant_symmetry.md`)

Open loop: random actions `a_t` against `P_a(g) a_t` from the symmetric start.
Errors are observation / torso-xy at step 1:

* `generalized` backend: every element of D4 is **exact up to round-off**
  (~1e-15 in float64, ~1e-5 in float32). The dynamics are chaotic, though:
  float32 round-off grows to O(1) within 10–50 steps under random actions.
* `spring` backend (QDax's default): only `{e, r180}` holds (1e-15 in
  float64). The other six elements are off by ~1e-2 **at the first step,
  in either precision**, so this is a systematic modelling artifact of the
  backend, not noise. On spring, the usable group is Z2 = {e, r180}
  (`--subgroup e r180`).

Closed loop (what MAP-Elites sees): for random initial MLP controllers on the
generalized backend, 250 steps, 33x33 grid on ±30 m, `g . theta` lands in
the predicted cell for only **67–78%** of controllers (median descriptor error
1e-2 m, p90 ~2–3 m; on spring 40–60%). In a first 20-iteration Ant run, the
FD archive claimed 6.7% coverage, but only 1.9% survived re-evaluation.
For approximate symmetries, report **re-evaluated** metrics (`--reeval-every`,
`--reevaluate`); `run.py` does this for all variants.

### Ant Omni: the claimed gain does not survive re-evaluation

Brax `generalized` backend, 100-step episodes, descriptor clipped to ±15 m,
33x33 grid, batch 128, 300 iterations (38,528 evaluations), 2 seeds, CPU.
"Claimed" is what the archive reports during search; "re-evaluated" re-scores
every elite of the (expanded) full archive and re-bins it.

| variant | claimed QD-score | claimed coverage | re-evaluated QD-score | re-evaluated coverage |
|---|---|---|---|---|
| baseline | 59,646 ± 3,353 | 14.9 ± 0.6% | **54,461 ± 3,589** | **13.6 ± 0.6%** |
| augment | 94,263 ± 9,881 | 23.2 ± 1.1% | 38,340 ± 4,689 | 9.4 ± 0.7% |
| fd | 66,325 ± 3,795 | 16.1 ± 0.9% | 25,045 ± 1,022 | 6.1 ± 0.2% |

(`results/ant_omni_ep100/summary.md`, `curves.png`; dots in the figure are
re-evaluations at 100, 200 and 300 iterations.)

* By the claimed metrics, symmetry looks like a 4–11x speed-up. After
  re-evaluation both symmetric variants are **below the baseline** (augment
  −31%, fd −55% re-evaluated coverage). Under an approximate symmetry, predicted
  elites that are wrong occupy cells and act as parents, and they displace
  real solutions.
* `fd` is hit hardest because *every* stored elite is a transformed,
  never-evaluated controller. `augment` still stores the evaluated original
  alongside its copies. `fd`'s claimed coverage also stalls (16.99% from
  iteration 100 to 300 on seed 1). One plausible cause: its parents' stored
  descriptors are predictions, not where the controllers actually go.
* The baseline itself loses ~9% coverage on re-evaluation. Evaluation is
  deterministic for a fixed batch shape (bit-identical repeats), but a
  different batch shape changes the outcome of ~0.8% of random controllers
  (float32 round-off amplified by chaos). Elites are plausibly over-represented
  among those lucky outcomes, since they were selected for reaching their
  cells. `reevaluate` now pads to the search batch size; these runs predate
  that change, so the baseline's re-evaluation drop is partly batch-shape
  noise.

**What this means for the paper.** The method is sound and the gain is real
when the symmetry is exact (it reaches or exceeds the archive-size bound),
but on a standard chaotic locomotion benchmark the symmetry is too
approximate for blind transfer. This is a stronger, more honest paper than
"up to |G|x": a general method, a predicted bound, a demonstrated failure
mode, and a diagnostic (transfer gap / same-cell rate) that tells you in
advance which regime a task is in. Natural follow-ups:

1. **Verified transfer:** evaluate each transformed copy before insertion
   (costs evaluations, but still steers search into the other orbit cells).
2. **Shorter horizons or float64 rollouts**, where the generalized Ant is
   exact up to 1e-10 for 50 steps.
3. **Smaller groups:** `--subgroup e r180` on the spring backend, the one
   non-trivial element it preserves exactly.
4. Full-scale runs (250 steps, batch 1024, 5 seeds) on a GPU.

## Running

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"            # CPU
pip install -e ".[dev,cuda12]"     # NVIDIA GPU

pytest                              # 42 fast tests
pytest --run-slow                   # + Brax Ant symmetry test

# exact domains (minutes on CPU)
python scripts/run.py --domain pointmass --grid 65 --batch-size 32 --iterations 1000 --seeds 0 1 2 3 4
python scripts/run.py --domain arm --grid 64 --batch-size 32 --iterations 2000 --seeds 0 1 2 3 4

# Ant Omni (GPU recommended); re-evaluate the expanded archive periodically
python scripts/run.py --domain ant_omni --backend generalized --episode-length 250 \
    --grid 33 --batch-size 1024 --iterations 2000 --log-every 100 --reeval-every 500 \
    --seeds 0 1 2 3 4

# restrict to a subgroup, e.g. the part of D4 the spring backend preserves
python scripts/run.py --domain ant_omni --backend spring --subgroup e r180 ...

python scripts/analyze.py results/pointmass results/arm results/ant_omni
python scripts/verify_ant_symmetry.py      # writes results/ant_symmetry.md
```

`run.py` writes one CSV per (variant, seed) with metrics after every
iteration against evaluations, plus a JSON summary. `analyze.py` writes
`summary.md` (evaluations to reach 50/80/95% of the baseline's final
QD-score, and speed-ups) and `curves.png`.

## Layout

```
symqd/group.py        signed permutations, SymmetryGroup (Cayley table), D4, homomorphism check
symqd/cells.py        CellAction: cell permutations, orbits, Fix(g), Burnside, canonicalisation
symqd/transforms.py   MLP and vector genotype transforms
symqd/algorithm.py    SymmetricMAPElites (baseline / augment / fd), FD metrics, expand, re-evaluate
symqd/diagnostics.py  transfer gap: descriptor/fitness error and same-cell rate of g . theta
symqd/domains/        arm, pointmass, ant (with simulator-derived symmetry)
scripts/              run.py, analyze.py, verify_ant_symmetry.py
tests/                group axioms, Burnside counts, weight-transform equivariance, variants
```
