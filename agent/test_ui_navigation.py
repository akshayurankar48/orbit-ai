import json
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import ToolError

from ui_navigation import request_ui_navigation


class FakeLocalParticipant:
    def __init__(self, response: str | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def perform_rpc(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        assert self.response is not None
        return self.response


@pytest.mark.asyncio
async def test_navigation_calls_browser_rpc_and_only_reports_confirmed_click() -> None:
    participant = FakeLocalParticipant(json.dumps({"ok": True, "action": "people"}))
    room = SimpleNamespace(
        remote_participants={"signed-in-browser": object()},
        local_participant=participant,
    )

    result = await request_ui_navigation(room, "people")

    assert "Successfully showed" in result
    assert participant.calls == [{
        "destination_identity": "signed-in-browser",
        "method": "showAppSection",
        "payload": '{"action": "people"}',
        "response_timeout": 8.0,
    }]


@pytest.mark.asyncio
async def test_unavailable_browser_button_is_not_reported_as_shown() -> None:
    participant = FakeLocalParticipant(json.dumps({
        "ok": False,
        "message": "The board view isn't available on this page.",
    }))
    room = SimpleNamespace(
        remote_participants={"signed-in-browser": object()},
        local_participant=participant,
    )

    result = await request_ui_navigation(room, "board")

    assert result == "The board view isn't available on this page."


@pytest.mark.asyncio
async def test_navigation_without_a_browser_does_not_make_an_rpc_call() -> None:
    participant = FakeLocalParticipant()
    room = SimpleNamespace(remote_participants={}, local_participant=participant)

    result = await request_ui_navigation(room, "help")

    assert "No browser is connected" in result
    assert participant.calls == []


@pytest.mark.asyncio
async def test_rpc_failure_is_reported_as_a_tool_error() -> None:
    participant = FakeLocalParticipant(error=rtc.RpcError(1501, "timeout"))
    room = SimpleNamespace(
        remote_participants={"signed-in-browser": object()},
        local_participant=participant,
    )

    with pytest.raises(ToolError, match="browser couldn't change"):
        await request_ui_navigation(room, "setup")


@pytest.mark.asyncio
async def test_malformed_rpc_response_is_not_treated_as_a_success() -> None:
    participant = FakeLocalParticipant("not-json")
    room = SimpleNamespace(
        remote_participants={"signed-in-browser": object()},
        local_participant=participant,
    )

    with pytest.raises(ToolError, match="invalid response"):
        await request_ui_navigation(room, "help")
