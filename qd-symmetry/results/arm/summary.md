# arm  (group {e, flip_x})

* cells N = 4096, orbits = 2048, archive reduction N/#orbits = 2.00x (|G| = 2)
* coupon-collector scale for rare cells |G|·H(|G|) = 3.0x
* batch size 32, 2000 iterations, seeds per variant: baseline 5, augment 5, fd 5

| variant | final QD-score | final coverage % | evals to 50% of baseline QD | speed-up | evals to 80% of baseline QD | speed-up | evals to 95% of baseline QD | speed-up |
|---|---|---|---|---|---|---|---|---|
| Baseline | 2773.3 ± 108.6 | 72.05 ± 3.00 | 7,424 | 1.00x | 23,040 | 1.00x | 43,648 | 1.00x |
| Augment | 3012.4 ± 57.6 | 76.06 ± 1.61 | 2,976 | 2.49x | 9,344 | 2.47x | 19,584 | 2.23x |
| FD archive | 3014.2 ± 46.1 | 76.19 ± 1.34 | 3,648 | 2.04x | 10,272 | 2.24x | 19,936 | 2.19x |

Evaluations-to-target are medians over seeds; speed-up is relative to the baseline.
