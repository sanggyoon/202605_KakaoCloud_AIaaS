"""승격 게이트 — 두 model_version 지표 비교(서빙 변경은 사람이 GitOps로)."""


def decide(current: dict, candidate: dict, mae_tol: float = 0.02) -> tuple[bool, str]:
    """candidate가 current 대비 영화내 Spearman ≥ AND MAE ≤ +tol 이면 승격."""
    cs = current.get("spearman_movie_arousal")
    ks = candidate.get("spearman_movie_arousal")
    cm = current.get("mae_arousal")
    km = candidate.get("mae_arousal")
    if None in (cs, ks, cm, km):
        return False, "HOLD: metrics 누락"
    if ks >= cs and km <= cm + mae_tol:
        return True, f"PROMOTE: spearman {ks:.4f}>={cs:.4f}, mae {km:.4f}<={cm + mae_tol:.4f}"
    return False, f"HOLD: spearman {ks:.4f} vs {cs:.4f}, mae {km:.4f} vs <= {cm + mae_tol:.4f}"


if __name__ == "__main__":
    import os
    import sys

    import httpx

    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m serving.promote <current_mv> <candidate_mv>")
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def metrics(mv):
        r = httpx.get(f"{url}/rest/v1/model_versions",
                      params={"select": "metrics", "model_version": f"eq.{mv}", "limit": "1"},
                      headers=headers, timeout=30, verify=False)
        r.raise_for_status()
        rows = r.json()
        return rows[0]["metrics"] if rows else {}

    ok, msg = decide(metrics(sys.argv[1]), metrics(sys.argv[2]))
    print(msg)
    sys.exit(0 if ok else 1)
