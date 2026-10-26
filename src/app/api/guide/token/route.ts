import { randomUUID } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/config";
import { AppError, apiError, privateJson } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentName = "launchpad-onboarding-guide";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, appOrigin());
    await requireUser();

    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new AppError(
        "GUIDE_NOT_CONFIGURED",
        "The voice guide is not configured yet. Add the LiveKit credentials to the app environment.",
        503,
      );
    }

    const room = `launchpad-guide-${randomUUID()}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `launchpad-user-${randomUUID()}`,
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
    });
    token.roomConfig = new RoomConfiguration({
      syncStreams: true,
      agents: [new RoomAgentDispatch({ agentName })],
    });

    return privateJson({ url, token: await token.toJwt() });
  } catch (error) {
    return apiError(error);
  }
}
