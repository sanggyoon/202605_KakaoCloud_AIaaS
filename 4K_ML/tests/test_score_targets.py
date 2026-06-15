from serving.db import select_score_targets


def test_select_targets_only_missing_and_parsed():
    parse_done = {100, 200, 300}          # 300은 파싱완료지만 씬 없음
    scene_to_movie = {
        10: 100, 11: 100,                 # 100: 씬 2개
        20: 200,                          # 200: 씬 1개
        40: 400,                          # 400: 파싱 미완(parse_done 아님)
    }
    scored = {10, 11, 20}                 # 100·200은 전부 점수 있음
    assert select_score_targets(parse_done, scene_to_movie, scored) == []

    # 100의 씬 11 점수 누락 → 100만 타깃
    assert select_score_targets(parse_done, scene_to_movie, {10, 20}) == [100]

    # 400은 parse_done 아님 → 점수 없어도 제외
    assert 400 not in select_score_targets(parse_done, scene_to_movie, set())
