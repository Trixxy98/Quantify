from datetime import datetime

from app.jobs.market_session import latest_session, latest_us_session_close


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", ""))


def test_today_after_new_york_close() -> None:
    assert latest_us_session_close(utc("2026-10-01T22:00:00Z")) == utc("2026-10-01T20:15:00Z")


def test_previous_session_before_close() -> None:
    assert latest_us_session_close(utc("2026-10-02T03:13:00Z")) == utc("2026-10-01T20:15:00Z")
    assert latest_us_session_close(utc("2026-10-02T14:00:00Z")) == utc("2026-10-01T20:15:00Z")


def test_skips_weekend_to_friday() -> None:
    assert latest_us_session_close(utc("2026-09-28T13:00:00Z")) == utc("2026-09-25T20:15:00Z")
    assert latest_us_session_close(utc("2026-09-27T16:00:00Z")) == utc("2026-09-25T20:15:00Z")


def test_winter_offset() -> None:
    assert latest_us_session_close(utc("2026-12-01T22:00:00Z")) == utc("2026-12-01T21:15:00Z")


def test_bursa_before_and_after_close() -> None:
    session = latest_session(utc("2026-10-02T03:21:00Z"), "BURSA")
    assert session.close == utc("2026-10-01T09:15:00Z")
    assert session.date == "2026-10-01"
    assert latest_session(utc("2026-10-02T10:00:00Z"), "BURSA").date == "2026-10-02"


def test_dates_session_in_its_own_zone() -> None:
    now = utc("2026-09-27T23:00:00Z")
    assert latest_session(now, "BURSA").date == "2026-09-25"
    assert latest_session(now, "US").date == "2026-09-25"


def test_us_close_uses_session_day_offset_across_spring_forward() -> None:
    # 2026-03-08 clocks spring forward. Monday before the NY close still points at Friday (EST).
    assert latest_us_session_close(utc("2026-03-09T14:00:00Z")) == utc("2026-03-06T21:15:00Z")


def test_us_close_uses_session_day_offset_across_fall_back() -> None:
    # 2026-11-01 clocks fall back. Monday before the NY close still points at Friday (EDT).
    assert latest_us_session_close(utc("2026-11-02T14:00:00Z")) == utc("2026-10-30T20:15:00Z")
