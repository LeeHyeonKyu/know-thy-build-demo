// Fixture factory for notes (docs/QA.md Fixture Policy): every call returns a fresh object.
// Defaults are the smallest valid note; cases override only the fields they care about and
// assert only on those fields.
import { randomUUID } from "node:crypto";

export function makeNote(overrides = {}) {
  return { title: "pg pool leak", body: "max=10 then the pool starves", ...overrides };
}

// A value unique to one request. Integration tests scope "was a row written?" to this marker
// instead of counting the shared table, because new-test-repeat runs this file and the full
// suite concurrently against one compose database (plan dw2 / dissent d2).
export function uniqueMarker(label) {
  return "fq76-" + label + "-" + randomUUID();
}
