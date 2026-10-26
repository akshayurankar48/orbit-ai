import assert from "node:assert/strict";
import { test } from "node:test";
import { guideActions, handleGuideNavigationRequest } from "../src/lib/guide-navigation";

function fakeDocument(buttons: Record<string, { disabled?: boolean; click: () => void }>) {
  const selectors: string[] = [];
  return {
    selectors,
    querySelector(selector: string) {
      selectors.push(selector);
      const match = /^button\[data-guide-action="(.*)"\]$/.exec(selector);
      const button = match ? buttons[match[1]] : undefined;
      return button ? { disabled: button.disabled ?? false, click: button.click } : null;
    },
  };
}

test("guide actions are limited to existing Orbit AI views", () => {
  assert.deepEqual(guideActions, ["project", "setup", "preview", "board", "list", "people", "help"]);
});

test("navigation request clicks the matching real page button", () => {
  let clicks = 0;
  const root = fakeDocument({ board: { click: () => { clicks += 1; } } });

  assert.deepEqual(JSON.parse(handleGuideNavigationRequest('{"action":"board"}', root)), {
    ok: true,
    action: "board",
  });
  assert.equal(clicks, 1);
  assert.deepEqual(root.selectors, ['button[data-guide-action="board"]']);
});

test("unavailable or disabled navigation buttons are not reported as shown", () => {
  const missing = fakeDocument({});
  assert.equal(JSON.parse(handleGuideNavigationRequest('{"action":"preview"}', missing)).ok, false);

  let clicks = 0;
  const disabled = fakeDocument({ people: { disabled: true, click: () => { clicks += 1; } } });
  assert.equal(JSON.parse(handleGuideNavigationRequest('{"action":"people"}', disabled)).ok, false);
  assert.equal(clicks, 0);
});

test("unknown actions and malformed requests cannot invoke arbitrary UI controls", () => {
  const root = fakeDocument({ deleteEverything: { click: () => assert.fail("must not click unknown action") } });

  assert.equal(JSON.parse(handleGuideNavigationRequest('{"action":"deleteEverything"}', root)).ok, false);
  assert.equal(JSON.parse(handleGuideNavigationRequest('not-json', root)).ok, false);
  assert.deepEqual(root.selectors, []);
});
