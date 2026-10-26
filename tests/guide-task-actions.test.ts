import assert from "node:assert/strict";
import { test } from "node:test";
import { guideTaskRequestSchema, resolveUniqueTaskOption } from "../src/lib/guide-task-actions";

const requestId = "a4f7e9c1-8b02-4d35-9f61-2f3b7a6c8d10";

test("guide task requests accept only validated add and move operations", () => {
  assert.deepEqual(guideTaskRequestSchema.parse({
    action: "add",
    requestId,
    title: "Design homepage",
    stage: "Build",
  }), {
    action: "add",
    requestId,
    title: "Design homepage",
    description: "",
    stage: "Build",
  });
  assert.deepEqual(guideTaskRequestSchema.parse({
    action: "move",
    requestId,
    taskTitle: "Design homepage",
    stage: "Review",
  }), {
    action: "move",
    requestId,
    taskTitle: "Design homepage",
    stage: "Review",
  });
  assert.equal(guideTaskRequestSchema.safeParse({
    action: "add",
    requestId,
    title: "Reset workspace",
    stage: "Done",
  }).success, false);
  assert.equal(guideTaskRequestSchema.safeParse({
    action: "move",
    requestId,
    taskTitle: "Design homepage",
    stage: "Build",
    taskId: "injected-task-id",
  }).success, false);
});

test("task selection requires one exact title or LP reference match", () => {
  const options = [
    { value: "", text: "Choose a task…" },
    { value: "task-a", text: "LP-01 · Design homepage" },
    { value: "task-b", text: "LP-02 · Review homepage" },
  ];

  assert.deepEqual(resolveUniqueTaskOption(options, " design homepage "), {
    kind: "match", value: "task-a", title: "Design homepage", reference: "LP-01",
  });
  assert.deepEqual(resolveUniqueTaskOption(options, "LP-02"), {
    kind: "match", value: "task-b", title: "Review homepage", reference: "LP-02",
  });
  assert.deepEqual(resolveUniqueTaskOption(options, "missing task"), { kind: "missing" });
  assert.deepEqual(resolveUniqueTaskOption([
    ...options,
    { value: "task-c", text: "LP-03 · Design homepage" },
  ], "Design homepage"), {
    kind: "ambiguous",
    references: ["LP-01", "LP-03"],
  });
});
