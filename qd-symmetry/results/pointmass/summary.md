# pointmass  (group {e, r90, r180, r270, flip_x, flip_y, flip_diag, flip_anti})

* cells N = 4225, orbits = 561, archive reduction N/#orbits = 7.53x (|G| = 8)
* coupon-collector scale for rare cells |G|·H(|G|) = 21.7x
* batch size 32, 1000 iterations, seeds per variant: baseline 5, augment 5, fd 5

| variant | final QD-score | final coverage % | evals to 50% of baseline QD | speed-up | evals to 80% of baseline QD | speed-up | evals to 95% of baseline QD | speed-up |
|---|---|---|---|---|---|---|---|---|
| Baseline | 7943.1 ± 180.9 | 94.67 ± 1.93 | 4,928 | 1.00x | 12,992 | 1.00x | 22,720 | 1.00x |
| Augment | 8431.3 ± 0.0 | 100.00 ± 0.00 | 640 | 7.70x | 1,504 | 8.64x | 2,336 | 9.73x |
| FD archive | 8431.3 ± 0.0 | 100.00 ± 0.00 | 672 | 7.33x | 1,600 | 8.12x | 2,464 | 9.22x |

Evaluations-to-target are medians over seeds; speed-up is relative to the baseline.
