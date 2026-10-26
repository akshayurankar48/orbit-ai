import assert from "node:assert/strict";
import { test } from "node:test";
import { getGuideErrorMessage } from "../src/lib/guide-errors";

test("missing microphone errors explain how to recover", () => {
  assert.match(getGuideErrorMessage(new DOMException("Requested device not found", "NotFoundError")), /No microphone was found/);
});

test("microphone permission errors direct the user to browser settings", () => {
  assert.match(getGuideErrorMessage(new DOMException("Permission denied", "NotAllowedError")), /Allow access.*browser settings/);
});

test("microphone-in-use errors explain the likely conflict", () => {
  assert.match(getGuideErrorMessage(new DOMException("Device busy", "NotReadableError")), /Close other apps/);
});

test("timeouts have a concise recovery message", () => {
  assert.equal(getGuideErrorMessage(new DOMException("Timed out", "TimeoutError")), "The connection took too long. Please try again.");
});

test("unknown setup failures remain visible without exposing non-error values", () => {
  assert.equal(getGuideErrorMessage(new Error("The room could not connect.")), "The room could not connect.");
  assert.equal(getGuideErrorMessage(null), "The guide could not start. Please try again.");
});
