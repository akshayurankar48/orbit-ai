export const guideActions = [
  "project",
  "setup",
  "preview",
  "board",
  "list",
  "people",
  "help",
] as const;

export type GuideAction = (typeof guideActions)[number];

type GuideButton = {
  disabled: boolean;
  click: () => void;
};

type GuideDocument = {
  querySelector: (selectors: string) => GuideButton | null;
};

export function handleGuideNavigationRequest(payload: string, root: GuideDocument): string {
  let request: unknown;
  try {
    request = JSON.parse(payload);
  } catch {
    return JSON.stringify({ ok: false, message: "The guide sent an invalid navigation request." });
  }

  if (
    !request ||
    typeof request !== "object" ||
    !("action" in request) ||
    typeof request.action !== "string" ||
    !guideActions.includes(request.action as GuideAction)
  ) {
    return JSON.stringify({ ok: false, message: "That part of the app isn't available to show." });
  }

  const action = request.action as GuideAction;
  const button = root.querySelector(`button[data-guide-action="${action}"]`);
  if (!button || button.disabled) {
    return JSON.stringify({
      ok: false,
      message: `The ${action} view isn't available on this page.`,
    });
  }

  button.click();
  return JSON.stringify({ ok: true, action });
}
