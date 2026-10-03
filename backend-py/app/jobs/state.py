"""In-process run flags, shared by the sync job and the services that must not race it."""

import threading

_lock = threading.Lock()
_sync_running = False
_agents_running = False


def is_full_sync_running() -> bool:
    return _sync_running


def try_start_sync() -> bool:
    global _sync_running
    with _lock:
        if _sync_running:
            return False
        _sync_running = True
        return True


def finish_sync() -> None:
    global _sync_running
    with _lock:
        _sync_running = False


def try_start_agents() -> bool:
    global _agents_running
    with _lock:
        if _agents_running:
            return False
        _agents_running = True
        return True


def finish_agents() -> None:
    global _agents_running
    with _lock:
        _agents_running = False
