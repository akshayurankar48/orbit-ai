import os
from typing import Literal
from pathlib import Path

from dotenv import dotenv_values
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RunContext,
    ToolError,
    WorkerOptions,
    cli,
    function_tool,
    get_job_context,
    inference,
)
from livekit.plugins import openai, silero, synthesia

from product_docs import format_product_doc_results
from ui_navigation import request_ui_navigation
from ui_tasks import request_task_action

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AGENT_NAME = "launchpad-onboarding-guide"
AVATAR_ID = "7572faa9-15da-400d-8227-ef1ab8932523"
CARTESIA_VOICE_ID = "a167e0f3-df7e-4d52-a9c3-f949145efdab"

for env_file in (PROJECT_ROOT / ".env.local", PROJECT_ROOT / ".env", Path(__file__).parent / ".env"):
    for key, value in dotenv_values(env_file).items():
        if value and not os.environ.get(key):
            os.environ[key] = value

INSTRUCTIONS = """\
You are Orbit AI's friendly spoken onboarding guide. Help new users understand
the setup screen and get started with their first project.

Keep spoken replies warm and brief: one to three short sentences. Do not use
lists, markdown, or read URLs aloud. The user can interrupt you.

For factual questions about Orbit AI, its product, or the fictional test
workspace and project, always call search_product_docs first. Answer only from
the passages it returns and name the cited source file in a short spoken phrase.
If it returns NO_MATCH, say the docs don't contain that information; do not
guess or fill gaps from general knowledge. The test workspace and project facts
are synthetic examples, not real customer data.

When asked to see, open, or go to part of the app, use show_app_section to click
its real navigation button. Only say you showed it after that tool confirms
success. When asked to add a task or move one, use the matching task tool and
click through its real form. Ask which task they mean if the request does not
identify exactly one. Only say an addition or move is done after the tool
confirms the saved result. Never claim a task was saved or moved after an error,
timeout, or uncertain result. Never claim to change the setup form, create a
workspace, or reset data.
"""


class LaunchpadOnboardingGuide(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INSTRUCTIONS)

    @function_tool()
    async def search_product_docs(self, context: RunContext, query: str) -> str:
        """Retrieve relevant passages from the Orbit AI product docs.

        Call before answering factual questions about the product, workspace,
        workflows, project, or test fixtures. Cite the returned source filename.
        If no relevant passage is found, say the docs do not cover the answer.

        Args:
            query: The user's product question, phrased naturally.
        """
        return format_product_doc_results(query)

    @function_tool()
    async def show_app_section(
        self,
        context: RunContext,
        section: Literal["project", "setup", "preview", "board", "list", "people", "help"],
    ) -> str:
        """Click a real Orbit AI navigation button to show a requested app view.

        Call this when the user asks to see, open, or go to part of the app.
        Supported sections: the current project, Setup, Preview, Board, List,
        People, and Help center. Do not call for explanations or for actions
        that create, save, move, or reset data.

        Args:
            section: The Orbit AI view the user asked to see.
        """
        job_context = get_job_context()
        if job_context is None:
            raise ToolError("The browser session is unavailable, so I couldn't change the view.")
        try:
            return await request_ui_navigation(job_context.room, section)
        except rtc.RpcError as error:
            raise ToolError("I couldn't change the app view. You can open it from the navigation.") from error

    @function_tool()
    async def add_task(
        self,
        context: RunContext,
        title: str,
        description: str = "",
        stage: Literal["Brief", "Build", "Review", "Handoff"] = "Brief",
    ) -> str:
        """Add and save a task using Orbit AI's New task form.

        Call this when the user asks to create or add a task to the saved project.
        Do not call for suggestions, explanations, or unsaved workspace setup.

        Args:
            title: The requested task name.
            description: Optional task details supplied by the user.
            stage: The requested starting stage, defaulting to Brief.
        """
        job_context = get_job_context()
        if job_context is None:
            raise ToolError("The browser is unavailable, so I couldn't save the task.")
        return await request_task_action(
            job_context.room,
            "add",
            {"title": title, "description": description, "stage": stage},
        )

    @function_tool()
    async def move_task(
        self,
        context: RunContext,
        task_title: str,
        stage: Literal["Brief", "Build", "Review", "Handoff"],
    ) -> str:
        """Move one existing task using Orbit AI's Move task form.

        Call this when the user asks to move a specific task to a different stage.
        Use its exact title or LP reference; ask the user to clarify if the target
        is missing or ambiguous. Do not rename, edit, delete, or reorder tasks.

        Args:
            task_title: The exact title or visible LP reference of the task.
            stage: The stage to move that task into.
        """
        job_context = get_job_context()
        if job_context is None:
            raise ToolError("The browser is unavailable, so I couldn't move the task.")
        return await request_task_action(
            job_context.room,
            "move",
            {"taskTitle": task_title, "stage": stage},
        )


def prewarm(proc) -> None:
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        stt=inference.STT(model="cartesia/ink-2"),
        llm=openai.realtime.RealtimeModel(
            model="gpt-realtime-1.5",
            modalities=["text"],
            turn_detection=None,
        ),
        tts=inference.TTS(
            model="cartesia/sonic-3.6",
            voice=CARTESIA_VOICE_ID,
        ),
        vad=ctx.proc.userdata["vad"],
        turn_handling={
            "turn_detection": "stt",
            "preemptive_generation": {"enabled": True},
            "interruption": {
                "min_duration": 0.75,
                "min_words": 1,
                "false_interruption_timeout": 2.0,
            },
        },
    )

    avatar = synthesia.AvatarSession(
        synthesia.AvatarConfig(avatar_ids=[AVATAR_ID]),
        join_timeout=60.0,
    )
    await avatar.start(session, room=ctx.room)

    await session.start(agent=LaunchpadOnboardingGuide(), room=ctx.room)
    session.generate_reply(
        instructions="Greet the user in one short sentence and offer help getting started.",
        allow_interruptions=False,
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        )
    )
