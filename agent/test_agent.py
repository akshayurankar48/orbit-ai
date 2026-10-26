import pytest
from livekit.agents import AgentSession, inference

from agent import LaunchpadOnboardingGuide


@pytest.mark.asyncio
async def test_onboarding_guide_explains_first_setup_step() -> None:
    async with (
        inference.LLM(model="google/gemma-4-31b-it") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(LaunchpadOnboardingGuide())
        result = await session.run(
            user_input="I just signed up and I'm a bit lost. Where do I start?"
        )

        await result.expect.next_event().is_message(role="assistant").judge(
            llm,
            intent="Briefly explains the workspace and first-project setup and offers help.",
        )
        result.expect.no_more_events()
