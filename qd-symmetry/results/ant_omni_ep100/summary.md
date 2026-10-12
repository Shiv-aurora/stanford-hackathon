# ant_omni  (group {e, r90, r180, r270, flip_x, flip_y, flip_diag, flip_anti})

* cells N = 1089, orbits = 153, archive reduction N/#orbits = 7.12x (|G| = 8)
* coupon-collector scale for rare cells |G|·H(|G|) = 21.7x
* batch size 128, 300 iterations, seeds per variant: baseline 2, augment 2, fd 2

| variant | final QD-score | final coverage % | evals to 50% of baseline QD | speed-up | evals to 80% of baseline QD | speed-up | evals to 95% of baseline QD | speed-up | re-evaluated QD | re-evaluated coverage % |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | 59645.5 ± 3352.8 | 14.88 ± 0.55 | 2,816 | 1.00x | 16,192 | 1.00x | not reached | – | 54461.1 ± 3588.8 | 13.59 ± 0.64 |
| Augment | 94262.8 ± 9880.9 | 23.23 ± 1.10 | 576 | 4.89x | 1,472 | 11.00x | 3,904 | – | 38339.8 ± 4689.3 | 9.37 ± 0.73 |
| FD archive | 66325.0 ± 3794.7 | 16.07 ± 0.92 | 704 | 4.00x | 9,792 | 1.65x | 13,824 | – | 25044.5 ± 1022.2 | 6.11 ± 0.23 |

Evaluations-to-target are medians over seeds; speed-up is relative to the baseline.
Targets and speed-ups use the metrics the archive *claims* during search; for an
approximate symmetry compare the re-evaluated columns instead.
