import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "./router.js";

test("new job from caption", () => {
  const c = parseCommand("לקוח: מאפיית ניר\nלחם מחמצת 25 ₪, משלוח עד הבית\nסגנון: חם");
  assert.equal(c.type, "new_job");
  if (c.type === "new_job") {
    assert.equal(c.client, "מאפיית ניר");
    assert.equal(c.brief, "לחם מחמצת 25 ₪, משלוח עד הבית\nסגנון: חם");
    assert.equal(c.style, "חם");
  }
});

test("copy edits", () => {
  assert.deepEqual(parseCommand("כותרת: לחם חם מהתנור"), { type: "set_copy", field: "headline", value: "לחם חם מהתנור" });
  assert.deepEqual(parseCommand("כפתור: להזמנה"), { type: "set_copy", field: "cta", value: "להזמנה" });
});

test("short commands", () => {
  assert.equal(parseCommand("אישור").type, "approve");
  assert.equal(parseCommand("אישור!").type, "approve");
  assert.deepEqual(parseCommand("בחר 2"), { type: "choose", index: 1 });
  assert.deepEqual(parseCommand("3"), { type: "choose", index: 2 });
  assert.equal(parseCommand("עוד גרסה").type, "more_variant");
  assert.deepEqual(parseCommand("סרטון"), { type: "video", seconds: 5 });
  assert.deepEqual(parseCommand("סרטון 10"), { type: "video", seconds: 10 });
  assert.equal(parseCommand("סיום").type, "finish");
  assert.equal(parseCommand("עלויות").type, "costs");
  assert.equal(parseCommand("עזרה").type, "help");
  assert.equal(parseCommand("מה קורה").type, "unknown");
});
