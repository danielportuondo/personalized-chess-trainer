import httpx

from chess_trainer import db, ingest


def test_parse_games_extracts_and_normalizes(sample_archive):
    archive_url = "https://api.chess.com/pub/player/dportuondo/games/2023/11"
    games = ingest.parse_games(archive_url, sample_archive)
    assert len(games) == 2  # the pgn-less game is dropped

    g1, g2 = games
    assert g1.url == "https://www.chess.com/game/live/1"
    assert g1.time_class == "rapid"
    assert g1.white_username == "dportuondo"
    assert g1.result == "1-0"  # white won
    assert g2.result == "1/2-1/2"  # both agreed -> draw


def test_store_games_idempotent(conn, sample_archive):
    games = ingest.parse_games("arch", sample_archive)
    assert ingest.store_games(conn, games) == 2
    assert ingest.store_games(conn, games) == 0  # re-run stores no duplicates
    assert conn.execute("SELECT COUNT(*) FROM raw_games").fetchone()[0] == 2


def test_init_schema_idempotent():
    c = db.connect(":memory:")
    db.init_schema(c)
    db.init_schema(c)  # must not raise
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"raw_games", "http_cache", "move_evals", "puzzles", "review_state"} <= tables
    c.close()


def test_fetch_archives_sets_user_agent():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers.get("user-agent", "")
        return httpx.Response(200, json={"archives": ["https://api.chess.com/pub/x/2023/11"]})

    client = httpx.Client(
        base_url=ingest.BASE_URL,
        headers={"User-Agent": "chess-trainer/0.1 (dportuondo; me@example.com)"},
        transport=httpx.MockTransport(handler),
    )
    archives = ingest.fetch_archives(client, "dportuondo")
    assert archives == ["https://api.chess.com/pub/x/2023/11"]
    assert "chess-trainer" in seen["ua"]
    client.close()


def test_fetch_month_304_not_modified():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("if-none-match") == '"abc"'
        return httpx.Response(304)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = ingest.fetch_month(client, "https://api.chess.com/pub/x/2023/11", etag='"abc"')
    assert res.not_modified is True
    assert res.games == []
    client.close()
