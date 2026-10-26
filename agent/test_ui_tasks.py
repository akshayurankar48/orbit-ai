import json
from types import SimpleNamespace
from typing import Callable

import pytest
from livekit import rtc
from livekit.agents import ToolError

from ui_tasks import request_task_action

TASK_ID = "a4f7e9c1-8b02-4d35-9f61-2f3b7a6c8d10"


class FakeLocalParticipant:
    def __init__(
        self,
        response: Callable[[dict[str, object]], str] | str,
        error: Exception | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def perform_rpc(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        request = json.loads(str(kwargs["payload"]))
        return self.response(request) if callable(self.response) else self.response


def room_with(participant: FakeLocalParticipant) -> SimpleNamespace:
    return SimpleNamespace(
        remote_participants={"signed-in-browser": object()},
        local_participant=participant,
    )


def receipt(request: dict[str, object], **fields: object) -> str:
    return json.dumps({
        "ok": True,
        "action": request["action"],
        "requestId": request["requestId"],
        "task": {
            "id": TASK_ID,
            "title": fields.get("title", "Design homepage"),
            "description": fields.get("description", ""),
            "stage": fields.get("stage", "Build"),
        },
        **({
            "fromStage": fields["fromStage"],
            "taskReference": fields.get("taskReference", "LP-01"),
        } if "fromStage" in fields else {}),
    })


@pytest.mark.asyncio
async def test_create_returns_success_only_for_a_matching_saved_receipt() -> None:
    participant = FakeLocalParticipant(lambda request: receipt(request))

    result = await request_task_action(
        room_with(participant),
        "add",
        {"title": "Design homepage", "description": "", "stage": "Build"},
    )

    assert result == "Saved task “Design homepage” in Build."
    assert participant.calls[0]["method"] == "manageLaunchpadTask"
    request = json.loads(str(participant.calls[0]["payload"]))
    assert request == {
        "action": "add",
        "requestId": request["requestId"],
        "title": "Design homepage",
        "description": "",
        "stage": "Build",
    }


@pytest.mark.asyncio
async def test_move_returns_success_only_for_a_confirmed_stage_change() -> None:
    participant = FakeLocalParticipant(lambda request: receipt(
        request,
        title="Design homepage",
        stage="Review",
        fromStage="Build",
    ))

    result = await request_task_action(
        room_with(participant),
        "move",
        {"taskTitle": "LP-01", "stage": "Review"},
    )

    assert result == "Saved move: “Design homepage” from Build to Review."
    assert json.loads(str(participant.calls[0]["payload"]))["stage"] == "Review"


@pytest.mark.asyncio
async def test_browser_rejection_is_returned_as_a_tool_error() -> None:
    participant = FakeLocalParticipant(lambda request: json.dumps({
        "ok": False,
        "action": request["action"],
        "requestId": request["requestId"],
        "message": "The task was not saved: The title is too short.",
    }))

    with pytest.raises(ToolError, match="The task was not saved"):
        await request_task_action(room_with(participant), "add", {
            "title": "Design homepage",
            "description": "",
            "stage": "Brief",
        })


@pytest.mark.asyncio
async def test_malformed_or_mismatched_save_receipts_never_report_success() -> None:
    participant = FakeLocalParticipant("not-json")
    with pytest.raises(ToolError, match="invalid task-save confirmation"):
        await request_task_action(room_with(participant), "add", {
            "title": "Design homepage",
            "description": "",
            "stage": "Brief",
        })

    participant = FakeLocalParticipant(lambda request: json.dumps({
        "ok": True,
        "action": "add",
        "requestId": "a different request",
        "task": {"id": TASK_ID, "title": "Design homepage", "description": "", "stage": "Brief"},
    }))
    with pytest.raises(ToolError, match="invalid task-save confirmation"):
        await request_task_action(room_with(participant), "add", {
            "title": "Design homepage",
            "description": "",
            "stage": "Brief",
        })

    participant = FakeLocalParticipant(lambda request: receipt(request, stage="Brief"))
    with pytest.raises(ToolError, match="didn't match"):
        await request_task_action(room_with(participant), "add", {
            "title": "Design homepage",
            "description": "",
            "stage": "Review",
        })

    participant = FakeLocalParticipant(lambda request: receipt(
        request,
        title="A different task",
        stage="Review",
        fromStage="Build",
        taskReference="LP-01",
    ))
    with pytest.raises(ToolError, match="didn't match the requested task"):
        await request_task_action(room_with(participant), "move", {
            "taskTitle": "Design homepage",
            "stage": "Review",
        })


@pytest.mark.asyncio
async def test_missing_browser_and_rpc_errors_do_not_report_task_completion() -> None:
    participant = FakeLocalParticipant("")
    room = SimpleNamespace(remote_participants={}, local_participant=participant)
    with pytest.raises(ToolError, match="browser is unavailable"):
        await request_task_action(room, "add", {"title": "Plan launch", "description": "", "stage": "Brief"})
    assert participant.calls == []

    participant = FakeLocalParticipant("", error=rtc.RpcError(1501, "timeout"))
    with pytest.raises(ToolError, match="couldn't confirm the task save"):
        await request_task_action(
            room_with(participant),
            "move",
            {"taskTitle": "Plan launch", "stage": "Review"},
        )
