import json
import uuid
from typing import Literal

from livekit import rtc
from livekit.agents import ToolError

TaskStage = Literal["Brief", "Build", "Review", "Handoff"]
TaskAction = Literal["add", "move"]


async def request_task_action(
    room: rtc.Room,
    action: TaskAction,
    details: dict[str, str],
) -> str:
    participant_identity = next(iter(room.remote_participants), None)
    if participant_identity is None:
        raise ToolError("The browser is unavailable, so I couldn't save the task change.")

    request_id = str(uuid.uuid4())
    payload = {"action": action, "requestId": request_id, **details}
    try:
        response = await room.local_participant.perform_rpc(
            destination_identity=participant_identity,
            method="manageLaunchpadTask",
            payload=json.dumps(payload),
            response_timeout=25.0,
        )
    except rtc.RpcError as error:
        raise ToolError("I couldn't confirm the task save. Check the project before trying again.") from error

    try:
        result = json.loads(response)
    except json.JSONDecodeError as error:
        raise ToolError("The browser returned an invalid task-save confirmation.") from error

    if (
        not isinstance(result, dict)
        or not isinstance(result.get("ok"), bool)
        or result.get("action") != action
        or result.get("requestId") != request_id
    ):
        raise ToolError("The browser returned an invalid task-save confirmation.")
    if not result["ok"]:
        message = result.get("message")
        raise ToolError(message if isinstance(message, str) else "The task change was not confirmed.")

    task = result.get("task")
    if not isinstance(task, dict):
        raise ToolError("The browser did not return a saved task receipt.")
    task_id = task.get("id")
    title = task.get("title")
    stage = task.get("stage")
    try:
        uuid.UUID(task_id) if isinstance(task_id, str) else None
    except ValueError as error:
        raise ToolError("The browser returned an invalid saved task receipt.") from error
    if not isinstance(task_id, str) or not isinstance(title, str) or stage not in ("Brief", "Build", "Review", "Handoff"):
        raise ToolError("The browser returned an invalid saved task receipt.")

    if action == "add":
        if (
            title != details["title"].strip()
            or stage != details["stage"]
            or task.get("description") != details["description"].strip()
        ):
            raise ToolError("The save receipt didn't match the requested task details.")
        return f"Saved task “{title}” in {stage}."

    from_stage = result.get("fromStage")
    task_reference = result.get("taskReference")
    requested_title = details["taskTitle"].strip().casefold()
    if requested_title not in {title.casefold(), task_reference.casefold() if isinstance(task_reference, str) else ""}:
        raise ToolError("The save receipt didn't match the requested task.")
    if from_stage not in ("Brief", "Build", "Review", "Handoff") or from_stage == stage or stage != details["stage"]:
        raise ToolError("The save receipt didn't confirm the requested stage change.")
    return f"Saved move: “{title}” from {from_stage} to {stage}."
