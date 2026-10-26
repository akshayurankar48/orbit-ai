import { z } from "zod";
import { stageSchema, taskInputSchema, type Stage, type Task } from "./contracts";

const addTaskRequestSchema = taskInputSchema.extend({
  action: z.literal("add"),
  requestId: z.uuid(),
}).strict();
const moveTaskRequestSchema = z.object({
  action: z.literal("move"),
  requestId: z.uuid(),
  taskTitle: z.string().trim().min(2).max(120),
  stage: stageSchema,
}).strict();

export const guideTaskRequestSchema = z.discriminatedUnion("action", [
  addTaskRequestSchema,
  moveTaskRequestSchema,
]);

export type GuideTaskRequest = z.infer<typeof guideTaskRequestSchema>;
export type GuideTaskSavedEvent =
  | { requestId: string; action: "add"; task: Task }
  | { requestId: string; action: "move"; task: Task; fromStage: Stage };
type GuideTaskSavedReceipt =
  | { action: "add"; task: Task }
  | { action: "move"; task: Task; fromStage: Stage };

const savedEventName = "launchpad:guide-task-saved";
let taskActionInProgress = false;

export function publishGuideTaskSaved(
  requestId: string | undefined,
  receipt: GuideTaskSavedReceipt,
): void {
  if (!requestId) return;
  const detail: GuideTaskSavedEvent = receipt.action === "add"
    ? { ...receipt, requestId }
    : { ...receipt, requestId };
  window.dispatchEvent(new CustomEvent<GuideTaskSavedEvent>(savedEventName, {
    detail,
  }));
}

type TaskOption = { value: string; text: string };

export function resolveUniqueTaskOption(
  options: readonly TaskOption[],
  requestedTitle: string,
): { kind: "match"; value: string; title: string; reference: string } | { kind: "missing" } | { kind: "ambiguous"; references: string[] } {
  const requested = requestedTitle.trim().toLowerCase();
  const matches = options.flatMap(option => {
    if (!option.value) return [];
    const match = /^(LP-\d{2}) · (.*)$/.exec(option.text.trim());
    const reference = match?.[1] ?? "";
    const title = match?.[2] ?? option.text.trim();
    return title.toLowerCase() === requested || reference.toLowerCase() === requested
      ? [{ value: option.value, reference, title }]
      : [];
  });
  if (matches.length === 1) return { kind: "match", ...matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", references: matches.map(match => match.reference) };
  return { kind: "missing" };
}

function response(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function failure(message: string, action?: GuideTaskRequest["action"], requestId?: string): string {
  return response({ ok: false, ...(action ? { action } : {}), ...(requestId ? { requestId } : {}), message });
}

function nextFrames(root: Document): Promise<void> {
  const view = root.defaultView;
  if (!view) return Promise.reject(new Error("The app page is unavailable."));
  return new Promise(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())));
}

function setControlValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
  if (!setter) throw new Error("The task form could not accept this value.");
  setter.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function waitForSave(
  root: Document,
  form: HTMLFormElement,
  requestId: string,
): Promise<{ receipt: GuideTaskSavedEvent } | { message: string }> {
  const view = root.defaultView;
  if (!view) return Promise.resolve({ message: "The browser page is unavailable." });

  return new Promise(resolve => {
    const finish = (result: { receipt: GuideTaskSavedEvent } | { message: string }) => {
      view.clearTimeout(timeout);
      observer.disconnect();
      view.removeEventListener(savedEventName, onSaved);
      resolve(result);
    };
    const onSaved: EventListener = event => {
      const detail = (event as CustomEvent<GuideTaskSavedEvent>).detail;
      if (detail?.requestId === requestId) finish({ receipt: detail });
    };
    const checkError = () => {
      const message = form.querySelector<HTMLElement>('[role="alert"]')?.textContent?.trim();
      if (message) finish({ message: `The task was not confirmed as saved: ${message}` });
    };
    const observer = new view.MutationObserver(checkError);
    const timeout = view.setTimeout(
      () => finish({ message: "The task save was not confirmed. Refresh the project to check before trying again." }),
      15_000,
    );
    view.addEventListener(savedEventName, onSaved);
    observer.observe(form, { subtree: true, childList: true, characterData: true });
    checkError();
  });
}

async function openTaskForm(root: Document, action: "add" | "move"): Promise<HTMLFormElement | string> {
  if (root.querySelector('form[aria-label="New task"], form[aria-label="Move task"]')) {
    return "Finish or cancel the task form already open before asking the guide to change a task.";
  }

  const projectButton = root.querySelector<HTMLButtonElement>('button[data-guide-action="project"]');
  if (!projectButton || projectButton.disabled) return "The saved project view is not available on this page.";
  projectButton.click();
  await nextFrames(root);

  const actionName = action === "add" ? "new-task" : "move-task";
  const actionButton = root.querySelector<HTMLButtonElement>(`button[data-guide-action="${actionName}"]`);
  if (!actionButton || actionButton.disabled) {
    return action === "add"
      ? "The New task button is not available. Make sure the workspace has been saved."
      : "The Move task button is not available on this page.";
  }
  actionButton.click();
  await nextFrames(root);

  const form = root.querySelector<HTMLFormElement>(`form[aria-label="${action === "add" ? "New task" : "Move task"}"]`);
  return form ?? "The task form did not open. Please try again.";
}

function validateReceipt(
  request: GuideTaskRequest,
  receipt: GuideTaskSavedEvent,
  taskReference?: string,
): string | undefined {
  if (request.action !== receipt.action) return "The save receipt did not match the requested task action.";
  if (request.action === "add" && receipt.action === "add") {
    if (
      receipt.task.title !== request.title ||
      receipt.task.description !== request.description ||
      receipt.task.stage !== request.stage
    ) return "The saved task did not match the requested details.";
  }
  if (request.action === "move" && receipt.action === "move") {
    const requestedTitle = request.taskTitle.toLowerCase();
    if (
      receipt.task.title.toLowerCase() !== requestedTitle &&
      taskReference?.toLowerCase() !== requestedTitle
    ) {
      return "The moved task did not match the requested task.";
    }
    if (
      !taskReference ||
      receipt.task.stage !== request.stage ||
      receipt.fromStage === receipt.task.stage
    ) {
      return "The move receipt did not confirm the requested stage change.";
    }
  }
  return undefined;
}

async function performTaskAction(root: Document, request: GuideTaskRequest): Promise<string> {
  const requestId = request.requestId;
  const form = await openTaskForm(root, request.action);
  if (typeof form === "string") return failure(form, request.action, requestId);
  form.dataset.guideRequestId = requestId;
  let matchedTaskReference: string | undefined;

  if (request.action === "add") {
    const title = form.querySelector<HTMLInputElement>('[data-guide-field="title"]');
    const stage = form.querySelector<HTMLSelectElement>('[data-guide-field="stage"]');
    const description = form.querySelector<HTMLTextAreaElement>('[data-guide-field="description"]');
    if (!title || !stage || !description) return failure("The New task form is missing a required field.", request.action, requestId);
    setControlValue(title, request.title);
    setControlValue(stage, request.stage);
    setControlValue(description, request.description);
  } else {
    const taskSelect = form.querySelector<HTMLSelectElement>('[data-guide-field="task"]');
    if (!taskSelect) return failure("The Move task form is missing its task selector.", request.action, requestId);
    const match = resolveUniqueTaskOption(
      Array.from(taskSelect.options, option => ({ value: option.value, text: option.textContent ?? "" })),
      request.taskTitle,
    );
    if (match.kind === "missing") {
      return failure(`I couldn't find a task titled “${request.taskTitle}”. Tell me its exact task name or LP reference.`, request.action, requestId);
    }
    if (match.kind === "ambiguous") {
      return failure(`More than one task matches “${request.taskTitle}” (${match.references.join(", ")}). Which one should I move?`, request.action, requestId);
    }
    matchedTaskReference = match.reference;
    setControlValue(taskSelect, match.value);
    await nextFrames(root);
    const stageButton = Array.from(form.querySelectorAll<HTMLButtonElement>("[data-guide-stage]"))
      .find(button => button.dataset.guideStage === request.stage);
    if (!stageButton || stageButton.disabled) {
      return failure(`That task is already in ${request.stage}, or the requested stage is unavailable.`, request.action, requestId);
    }
    stageButton.click();
  }

  await nextFrames(root);
  const submit = form.querySelector<HTMLButtonElement>(`button[data-guide-submit="${request.action}"]`);
  if (!submit || submit.disabled) return failure("The task form could not be submitted.", request.action, requestId);
  const saved = waitForSave(root, form, requestId);
  submit.click();
  const result = await saved;
  if ("message" in result) return failure(result.message, request.action, requestId);

  const receiptError = validateReceipt(request, result.receipt, matchedTaskReference);
  if (receiptError) return failure(receiptError, request.action, requestId);
  return response({
    ok: true,
    action: request.action,
    requestId,
    task: result.receipt.task,
    ...(result.receipt.action === "move"
      ? { fromStage: result.receipt.fromStage, taskReference: matchedTaskReference }
      : {}),
  });
}

export async function handleGuideTaskActionRequest(payload: string, root: Document): Promise<string> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return failure("The guide sent an invalid task request.");
  }
  const parsed = guideTaskRequestSchema.safeParse(decoded);
  if (!parsed.success) return failure("The task details or requested stage are invalid.");
  if (taskActionInProgress) return failure("Another task change is already in progress. Please wait before trying again.", parsed.data.action, parsed.data.requestId);
  taskActionInProgress = true;
  try {
    return await performTaskAction(root, parsed.data);
  } finally {
    taskActionInProgress = false;
  }
}
