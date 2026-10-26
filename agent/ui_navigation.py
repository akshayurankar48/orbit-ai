import json
from typing import Literal

from livekit import rtc
from livekit.agents import ToolError

GuideSection = Literal["project", "setup", "preview", "board", "list", "people", "help"]

SECTION_LABELS: dict[GuideSection, str] = {
    "project": "project",
    "setup": "Setup",
    "preview": "Preview",
    "board": "Board",
    "list": "List",
    "people": "People",
    "help": "Help center",
}


async def request_ui_navigation(room: rtc.Room, section: GuideSection) -> str:
    participant_identity = next(iter(room.remote_participants), None)
    if participant_identity is None:
        return "No browser is connected, so I couldn't change the app view."

    try:
        response = await room.local_participant.perform_rpc(
            destination_identity=participant_identity,
            method="showAppSection",
            payload=json.dumps({"action": section}),
            response_timeout=8.0,
        )
    except rtc.RpcError as error:
        raise ToolError("The browser couldn't change the app view. Please try again.") from error

    try:
        result = json.loads(response)
    except json.JSONDecodeError as error:
        raise ToolError("The browser returned an invalid response to the navigation request.") from error

    if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
        raise ToolError("The browser returned an invalid response to the navigation request.")
    if not result["ok"]:
        message = result.get("message")
        return message if isinstance(message, str) else "That view isn't available on this page."
    if result.get("action") != section:
        raise ToolError("The browser confirmed a different view than the one requested.")

    return f"Successfully showed the {SECTION_LABELS[section]} view by clicking its navigation button."
