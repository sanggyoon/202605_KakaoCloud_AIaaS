"""평가 지표: MAE, Pearson, 영화내 Spearman."""
import numpy as np
from scipy.stats import pearsonr, spearmanr


def mae(pred, true) -> float:
    p = np.asarray(pred, dtype=float)
    t = np.asarray(true, dtype=float)
    return float(np.mean(np.abs(p - t)))


def pearson(pred, true) -> float:
    p = np.asarray(pred, dtype=float)
    t = np.asarray(true, dtype=float)
    if len(p) < 2 or np.std(p) == 0 or np.std(t) == 0:
        return 0.0
    return float(pearsonr(p, t)[0])


def movie_spearman(pred, true, movie_ids) -> float:
    """영화별 Spearman 상관의 평균(씬 2개 미만 또는 상수 영화는 제외)."""
    by: dict = {}
    for p, t, m in zip(pred, true, movie_ids):
        by.setdefault(m, ([], []))
        by[m][0].append(p)
        by[m][1].append(t)
    vals = []
    for ps, ts in by.values():
        if len(ps) < 2 or np.std(ps) == 0 or np.std(ts) == 0:
            continue
        rho = spearmanr(ps, ts).statistic
        if not np.isnan(rho):
            vals.append(rho)
    return float(np.mean(vals)) if vals else 0.0
