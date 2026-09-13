import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHebrew } from "./overlay.js";

test("replaces dashes Heebo cannot draw", () => {
  assert.equal(sanitizeHebrew("נאפה ב‑5:00 – אצלכם"), "נאפה ב-5:00 - אצלכם");
});
test("pins punctuation to the preceding number", () => {
  assert.equal(sanitizeHebrew("עד 8:00. 25 ₪"), "עד 8:00.‏ 25 ₪");
});
