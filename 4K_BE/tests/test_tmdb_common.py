from app import tmdb_common as tc


def test_pick_trailer_prefers_korean_youtube_trailer():
    videos = [
        {"site": "YouTube", "type": "Teaser", "iso_639_1": "en", "key": "teaser"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "en", "key": "en_trailer"},
        {"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "ko_trailer"},
    ]
    assert tc.pick_trailer(videos) == "ko_trailer"


def test_pick_trailer_returns_none_when_no_match():
    assert tc.pick_trailer([{"site": "Vimeo", "type": "Trailer", "key": "x"}]) is None


def test_build_movie_maps_fields():
    detail = {
        "imdb_id": "tt001",
        "title": "기생충",
        "original_title": "Parasite",
        "poster_path": "/p.jpg",
        "release_date": "2019-05-30",
        "runtime": 132,
        "genres": [{"name": "Drama"}, {"name": "Thriller"}],
        "overview": "줄거리",
        "credits": {
            "crew": [{"job": "Director", "name": "봉준호"}],
            "cast": [{"name": f"배우{i}"} for i in range(7)],
        },
        "videos": {"results": [{"site": "YouTube", "type": "Trailer", "iso_639_1": "ko", "key": "K"}]},
    }
    row = tc.build_movie(detail, 496243)
    assert row["tmdb_id"] == 496243
    assert row["title"] == "기생충"
    assert row["director"] == "봉준호"
    assert row["release_year"] == 2019
    assert row["genre"] == "Drama, Thriller"
    assert row["actors"] == "배우0, 배우1, 배우2, 배우3, 배우4"
    assert row["youtube_key"] == "K"


def test_build_movie_handles_missing_fields():
    row = tc.build_movie({"credits": {}, "videos": {}}, 1)
    assert row["tmdb_id"] == 1
    assert row["director"] is None
    assert row["release_year"] is None
    assert row["actors"] is None
    assert row["youtube_key"] is None
