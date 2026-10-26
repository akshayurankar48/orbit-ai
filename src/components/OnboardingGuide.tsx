"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Mic, X } from "lucide-react";
import { createLocalAudioTrack, Room, RoomEvent, Track, type LocalAudioTrack } from "livekit-client";
import { getGuideErrorMessage } from "@/lib/guide-errors";
import { handleGuideNavigationRequest } from "@/lib/guide-navigation";
import { handleGuideTaskActionRequest } from "@/lib/guide-task-actions";
import styles from "./OnboardingGuide.module.css";

type GuideStatus = "idle" | "connecting" | "connected" | "error";

function responseError(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return undefined;
}

export function OnboardingGuide() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GuideStatus>("idle");
  const [error, setError] = useState("");
  const [hasVideo, setHasVideo] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      void room.disconnect().catch((cause: unknown) => {
        console.error("Could not disconnect the onboarding guide room.", cause);
      });
    }
  }, []);

  const startGuide = async () => {
    if (roomRef.current || status === "connecting") return;
    setStatus("connecting");
    setError("");
    setHasVideo(false);

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let microphone: LocalAudioTrack | undefined;
    room.registerRpcMethod("showAppSection", async ({ payload }) =>
      handleGuideNavigationRequest(payload, document),
    );
    room.registerRpcMethod("manageLaunchpadTask", async ({ payload }) =>
      handleGuideTaskActionRequest(payload, document),
    );
    room.on(RoomEvent.TrackSubscribed, (track) => {
      const element = track.attach();
      if (track.kind === Track.Kind.Video) {
        element.classList.add(styles.avatarVideo);
        if (element instanceof HTMLVideoElement) {
          element.autoplay = true;
          element.playsInline = true;
          element.muted = true;
        }
        setHasVideo(true);
      } else {
        element.classList.add(styles.remoteAudio);
      }
      mediaRef.current?.append(element);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
      if (track.kind === Track.Kind.Video) setHasVideo(false);
    });
    room.on(RoomEvent.TrackSubscriptionFailed, () => {
      if (roomRef.current === room) {
        roomRef.current = null;
        void room.disconnect().catch(() => {
          console.error("Could not close the failed onboarding guide connection.");
        });
      }
      mediaRef.current?.replaceChildren();
      setHasVideo(false);
      setError("The guide's audio or video could not connect. Start a new session to try again.");
      setStatus("error");
    });
    room.on(RoomEvent.Disconnected, () => {
      if (roomRef.current !== room) return;
      roomRef.current = null;
      mediaRef.current?.replaceChildren();
      setHasVideo(false);
      setStatus("error");
      setError("The guide connection ended. Start a new session to try again.");
    });

    try {
      await room.startAudio();
      microphone = await createLocalAudioTrack();
      const response = await fetch("/api/guide/token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(20000),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseError(payload) || "The guide could not start. Please try again.");
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("url" in payload) ||
        typeof payload.url !== "string" ||
        !("token" in payload) ||
        typeof payload.token !== "string"
      ) {
        throw new Error("The guide returned an invalid connection response. Please try again.");
      }

      await room.connect(payload.url, payload.token);
      await room.localParticipant.publishTrack(microphone);
      microphone = undefined;
      setStatus("connected");
    } catch (cause) {
      if (roomRef.current === room) roomRef.current = null;
      try {
        await room.disconnect();
      } catch {
        console.error("Could not close the failed onboarding guide connection.");
      }
      microphone?.stop();
      mediaRef.current?.replaceChildren();
      setHasVideo(false);
      setStatus("error");
      setError(getGuideErrorMessage(cause));
    }
  };

  const endGuide = async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect();
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "The guide could not disconnect cleanly.");
        return false;
      }
    }
    mediaRef.current?.replaceChildren();
    setHasVideo(false);
    setStatus("idle");
    setError("");
    return true;
  };

  const closeGuide = async () => {
    if (await endGuide()) setOpen(false);
  };

  return (
    <div className={styles.widget}>
      {open ? (
        <section className={styles.panel} role="dialog" aria-labelledby="guide-title">
          <header className={styles.header}>
            <div>
              <h2 id="guide-title">Your Orbit AI guide</h2>
              <p>Talk through your workspace setup.</p>
            </div>
            <button className={styles.close} type="button" onClick={closeGuide} aria-label="Close guide">
              <X size={17} />
            </button>
          </header>
          <div className={styles.avatar} aria-label="Onboarding guide video">
            <div className={styles.media} ref={mediaRef}>
              {status === "connected" && !hasVideo && <p className={styles.waiting}>Your guide is joining…</p>}
              {status !== "connected" && <div className={styles.placeholder}><MessageCircle size={28} /></div>}
            </div>
          </div>
          <p className={styles.status} aria-live="polite">
            {status === "connecting" && "Connecting to your guide…"}
            {status === "connected" && "Listening · your microphone is on"}
            {status === "idle" && "Start a conversation when you're ready"}
            {status === "error" && error}
          </p>
          {status === "connected" ? (
            <button className={styles.action} type="button" onClick={endGuide}>
              End conversation
            </button>
          ) : (
            <button className={styles.action} type="button" onClick={startGuide} disabled={status === "connecting"}>
              {status === "connecting" ? <LoaderCircle className={styles.spinner} size={16} /> : <Mic size={16} />}
              {status === "connecting" ? "Connecting…" : status === "error" ? "Try again" : "Start voice guide"}
            </button>
          )}
          {status === "idle" && <p className={styles.privacy}>Your microphone is used only after you start.</p>}
        </section>
      ) : (
        <button className={styles.launcher} type="button" onClick={() => setOpen(true)}>
          <MessageCircle size={17} />
          <span>Need a hand?</span>
        </button>
      )}
    </div>
  );
}
