export function getGuideErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error) || typeof error.name !== "string") {
    return "The guide could not start. Please try again.";
  }

  switch (error.name) {
    case "NotFoundError":
      return "No microphone was found. Connect or enable a microphone, then try again.";
    case "NotAllowedError":
      return "Microphone access is blocked. Allow access for this site in your browser settings, then try again.";
    case "NotReadableError":
      return "Your microphone is unavailable. Close other apps using it, then try again.";
    case "SecurityError":
      return "This page cannot access your microphone. Open Orbit AI in a supported browser and try again.";
    case "TimeoutError":
      return "The connection took too long. Please try again.";
    default:
      return "message" in error && typeof error.message === "string" && error.message
        ? error.message
        : "The guide could not start. Please try again.";
  }
}
