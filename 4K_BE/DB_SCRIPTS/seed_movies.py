#!/usr/bin/env python3
"""
TMDB 메타데이터를 가져와 Data Supabase(vm4) service.movies 테이블에 저장

사용법:
  pip install httpx python-dotenv
  # 4K_BE/DB_SCRIPTS/.env에 키 설정 후:
  python 4K_BE/DB_SCRIPTS/seed_movies.py
"""
import os
import time
import httpx
from dotenv import load_dotenv

# 스크립트와 같은 디렉토리의 .env 파일을 환경변수로 로드
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ── 설정 ─────────────────────────────────────────────────────────
DATA_URL        = os.getenv("DATA_SUPABASE_URL", "https://data.4kakao.kro.kr")
DATA_KEY        = os.getenv("DATA_SUPABASE_KEY", "")   # Supabase service_role JWT
DATA_BASIC_USER = os.getenv("DATA_BASIC_USER", "")     # nginx Basic Auth 유저
DATA_BASIC_PASS = os.getenv("DATA_BASIC_PASS", "")     # nginx Basic Auth 비밀번호
TMDB_KEY        = os.getenv("TMDB_API_KEY", "")
TMDB_BASE       = "https://api.themoviedb.org/3"
BATCH_SIZE      = 50    # 한 번에 Supabase에 upsert할 행 수
RATE_LIMIT_DELAY = 0.26  # TMDB 무료 플랜 제한: 40 req/10s → 요청 사이 0.26s 대기
# ─────────────────────────────────────────────────────────────────

# 저장할 영화의 TMDB ID 목록
TMDB_IDS = [
    58, 155, 285, 350, 559, 588, 591, 675, 752, 767, 810, 920, 950,
    1124, 1250, 1265, 1271, 1402, 1417, 1422, 1427, 1579, 1593, 1724,
    1726, 1735, 1865, 1930, 1949, 2062, 4588, 4977, 4982, 5559, 6477,
    6479, 6977, 7345, 7485, 8065, 8355, 8363, 8681, 8909, 8966, 9072,
    9339, 9502, 9757, 10138, 10191, 10192, 10193, 10195, 10198, 10527,
    10681, 11324, 11619, 11631, 12155, 12244, 12429, 12444, 12445, 13009,
    13078, 13183, 13576, 13971, 14160, 14161, 14574, 14836, 16869, 17654,
    17903, 18239, 18240, 18785, 19173, 19994, 19995, 20352, 22803, 22832,
    23823, 24021, 24428, 26466, 27205, 30112, 32657, 36557, 38055, 38321,
    38365, 38575, 38700, 38757, 39254, 43347, 43947, 44896, 46195, 47971,
    48650, 49013, 49026, 49051, 49444, 49519, 49521, 49529, 49530, 50014,
    50619, 50620, 50646, 50727, 51876, 57158, 57214, 57800, 59440, 62177,
    68718, 68721, 68726, 72105, 72190, 73861, 75656, 76341, 76492, 76600,
    77338, 78192, 80321, 82023, 82507, 82690, 82702, 83533, 84308, 85877,
    87827, 92060, 93456, 99861, 101299, 102382, 102651, 105864, 106646,
    107257, 109428, 109445, 120467, 122126, 122917, 135397, 137113, 138843,
    140300, 140607, 142487, 146233, 150540, 150689, 152601, 156022, 157336,
    166426, 168259, 173185, 177572, 181808, 184314, 198184, 198663, 204082,
    205596, 207703, 209112, 210577, 214756, 216015, 228150, 232672, 242582,
    244786, 245891, 249397, 253376, 257211, 258216, 259693, 260513, 260514,
    263115, 269149, 269955, 271110, 273477, 273481, 278986, 283995, 284052,
    284053, 284054, 286217, 290098, 292431, 293660, 296096, 297090, 297762,
    299534, 299536, 301528, 313369, 315162, 315635, 318256, 321258, 324552,
    324786, 324857, 329865, 330457, 331482, 333339, 334535, 335983, 335984,
    337167, 337401, 337404, 338803, 341054, 346364, 346698, 351286, 353069,
    354912, 361743, 363088, 372058, 373571, 374720, 378064, 378236, 381284,
    383498, 385687, 396535, 399566, 400535, 402431, 406997, 412117, 414419,
    414906, 419116, 419430, 420818, 424694, 425274, 429617, 436270, 436969,
    438631, 439079, 440249, 441168, 447332, 447365, 453395, 454626, 458156,
    458293, 458423, 460465, 464052, 466272, 475557, 483685, 490132, 493529,
    493922, 495764, 496243, 497698, 499191, 502356, 505642, 507086, 508442,
    508642, 508947, 510657, 514847, 516486, 519182, 524047, 530385, 530915,
    533535, 537915, 545609, 545611, 546554, 550988, 566525, 567609, 568124,
    569094, 572802, 577922, 603692, 609681, 613504, 614696, 615457, 615677,
    616037, 619979, 623983, 634649, 635302, 637649, 645710, 646380, 664413,
    664767, 677638, 693134, 713704, 737057, 744275, 755898, 764339, 766507,
    774444, 791373, 798645, 801335, 803796, 805681, 829557, 829560, 841755,
    843527, 848116, 851644, 854804, 866398, 872585, 878667, 911430, 912649,
    928241, 933720, 939243, 963261, 967998, 976573, 976912, 985939, 1002398,
    1007401, 1007757, 1010581, 1011985, 1022789, 1031774, 1038392, 1072790,
    1075175, 1084242, 1087040, 1156593, 1173476, 1173559, 1177445, 1184918,
    1196067, 1234731, 1235192, 1241752, 1241982, 1242898, 1252309, 1270125,
    1292662, 1311031, 1352874, 1357633, 1368166, 1404791, 1419406, 1426822,
]


def tmdb_get(path: str, params: dict = {}) -> dict:
    """TMDB API GET 요청. language=ko-KR로 한국어 응답 우선."""
    r = httpx.get(
        f"{TMDB_BASE}/{path}",
        params={"api_key": TMDB_KEY, "language": "ko-KR", **params},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def pick_trailer(videos: list[dict]) -> str | None:
    """YouTube 트레일러 키를 우선순위대로 선택.
    한국어 트레일러 → 영어 트레일러 → 티저 순으로 fallback.
    """
    priority = [
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer" and v.get("iso_639_1") == "ko",
        lambda v: v["site"] == "YouTube" and v["type"] == "Trailer",
        lambda v: v["site"] == "YouTube" and v["type"] == "Teaser",
    ]
    for pred in priority:
        match = next((v for v in videos if pred(v)), None)
        if match:
            return match["key"]
    return None


def fetch_movie(tmdb_id: int) -> dict | None:
    """TMDB에서 영화 1편의 메타데이터를 가져와 movies 테이블 형태로 반환.
    404 등 오류 시 None 반환 (건너뜀).
    """
    try:
        # credits: 감독·배우 정보 / videos: 트레일러 정보를 한 번에 요청
        d = tmdb_get(f"movie/{tmdb_id}", {"append_to_response": "credits,videos"})
    except httpx.HTTPStatusError as e:
        print(f"  [SKIP] {tmdb_id}: HTTP {e.response.status_code}")
        return None
    except Exception as e:
        print(f"  [WARN] {tmdb_id}: {e}")
        return None

    # crew 중 job이 "Director"인 첫 번째 사람
    crew = d.get("credits", {}).get("crew", [])
    director = next((c["name"] for c in crew if c["job"] == "Director"), None)

    # cast 상위 5명을 쉼표로 연결
    actors = ", ".join(c["name"] for c in d.get("credits", {}).get("cast", [])[:5])

    trailer_key = pick_trailer(d.get("videos", {}).get("results", []))

    release_year = None
    if d.get("release_date"):
        try:
            release_year = int(d["release_date"][:4])
        except ValueError:
            pass

    return {
        "tmdb_id":        tmdb_id,
        "imdb_id":        d.get("imdb_id"),
        "title":          d.get("title"),           # ko-KR 제목 (없으면 원제)
        "original_title": d.get("original_title"),  # 원어 제목
        "poster_path":    d.get("poster_path"),      # 포스터 경로 (TMDB CDN 상대경로)
        "director":       director,
        "release_year":   release_year,
        "runtime":        d.get("runtime") or None,
        "genre":          ", ".join(g["name"] for g in d.get("genres", [])),
        "actors":         actors or None,
        "overview":       d.get("overview") or None,
        "youtube_key":    trailer_key,               # YouTube 영상 ID
    }


def get_existing_tmdb_ids() -> set[int]:
    """Supabase에 이미 저장된 tmdb_id 목록을 조회.
    중복 TMDB API 호출을 방지하기 위해 스크립트 시작 시 1회 실행.
    """
    headers = {"apikey": DATA_KEY}
    r = httpx.get(
        f"{DATA_URL}/rest/v1/movies",
        params={"select": "tmdb_id", "limit": "10000"},
        headers=headers,
        auth=(DATA_BASIC_USER, DATA_BASIC_PASS) if DATA_BASIC_USER else None,
        verify=False,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"[WARN] 기존 데이터 조회 실패 ({r.status_code}), 전체 처리합니다")
        return set()
    ids = {row["tmdb_id"] for row in r.json()}
    print(f"이미 저장된 영화: {len(ids)}개\n")
    return ids


def verify_insert(tmdb_id: int) -> bool:
    """upsert 직후 해당 tmdb_id가 실제로 DB에 있는지 확인."""
    headers = {"apikey": DATA_KEY}
    r = httpx.get(
        f"{DATA_URL}/rest/v1/movies",
        params={"select": "tmdb_id", "tmdb_id": f"eq.{tmdb_id}"},
        headers=headers,
        auth=(DATA_BASIC_USER, DATA_BASIC_PASS) if DATA_BASIC_USER else None,
        verify=False,
        timeout=10,
    )
    return r.status_code == 200 and len(r.json()) > 0


def upsert_batch(movies: list[dict]) -> bool:
    """movies 리스트를 Supabase에 일괄 upsert. 성공 여부 반환."""
    """movies 리스트를 Supabase에 일괄 upsert.

    - apikey 헤더: Supabase PostgREST 인증 (service_role → RLS 무시)
    - auth=(user, pass): nginx Ingress Basic Auth 통과용
    - Prefer: merge-duplicates → tmdb_id 중복 시 UPDATE로 처리
    - verify=False: Let's Encrypt Staging 인증서라 SSL 검증 생략
    """
    headers = {
        "apikey":       DATA_KEY,
        "Content-Type": "application/json",
        "Prefer":       "resolution=merge-duplicates,return=minimal",
    }
    r = httpx.post(
        f"{DATA_URL}/rest/v1/movies",
        json=movies,
        headers=headers,
        auth=(DATA_BASIC_USER, DATA_BASIC_PASS),
        timeout=30,
        verify=False,   # Staging 인증서 → SSL 검증 생략 (운영 도메인 전환 시 제거)
    )
    if r.status_code not in (200, 201, 204):
        print(f"  [ERROR] upsert 실패 {r.status_code}: {r.text[:200]}")
        return False
    print(f"  → {len(movies)}개 저장 (status: {r.status_code})")
    return True


def main() -> None:
    if not TMDB_KEY:
        raise SystemExit("TMDB_API_KEY 환경변수가 설정되지 않았습니다.\n  .env 파일에 TMDB_API_KEY=<your_key> 추가")
    if not DATA_KEY:
        raise SystemExit("DATA_SUPABASE_KEY 환경변수가 설정되지 않았습니다.")

    # 이미 저장된 tmdb_id는 건너뜀
    existing = get_existing_tmdb_ids()
    targets = [tid for tid in TMDB_IDS if tid not in existing]

    total = len(targets)
    print(f"처리할 영화: {total}개 (전체 {len(TMDB_IDS)}개 중 {len(existing)}개 이미 저장됨)\n")

    # ── 테스트: 첫 번째 영화 1개 insert 후 DB 확인 ──────────────
    if targets:
        print("=== 테스트 insert (1개) ===")
        test_movie = fetch_movie(targets[0])
        if test_movie:
            ok = upsert_batch([test_movie])
            if ok:
                found = verify_insert(targets[0])
                if found:
                    print(f"  ✅ DB 확인 완료 — tmdb_id={targets[0]} 실제로 저장됨\n")
                else:
                    print(f"  ❌ DB 확인 실패 — tmdb_id={targets[0]} 가 DB에 없음. 중단합니다.")
                    return
            else:
                print("  ❌ upsert 실패. 중단합니다.")
                return
        targets = targets[1:]  # 테스트한 1개 제외
        total = len(targets)
    # ────────────────────────────────────────────────────────────

    batch: list[dict] = []
    failed: list[int] = []

    for i, tmdb_id in enumerate(targets, 1):
        print(f"[{i:>3}/{total}] tmdb_id={tmdb_id:<10}", end="")
        movie = fetch_movie(tmdb_id)

        if movie:
            batch.append(movie)
            print(f"✓ {movie['title']}")
        else:
            failed.append(tmdb_id)

        # BATCH_SIZE(50)개 모이면 즉시 upsert 후 배치 초기화
        if len(batch) >= BATCH_SIZE:
            upsert_batch(batch)
            batch.clear()

        time.sleep(RATE_LIMIT_DELAY)

    # 마지막 50개 미만 남은 배치 처리
    if batch:
        upsert_batch(batch)

    print(f"\n완료")
    print(f"  신규 저장: {total - len(failed)}개")
    print(f"  기존 스킵: {len(existing)}개")
    if failed:
        print(f"  실패 목록: {failed}")


if __name__ == "__main__":
    main()
