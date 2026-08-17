import assert from "node:assert/strict";
import test from "node:test";
import { countGroups, parseList } from "../src/parser.js";

test("parses a comma separated list", () => {
  assert.deepEqual(parseList("a, b ,c"), ["a", "b", "c"]);
});

test("returns an empty list for blank input", () => {
  assert.deepEqual(parseList("  "), []);
});

test("parses nested groups", () => {
  // countGroups counts every opening bracket; this expectation is wrong,
  // and the suite must fail because of it.
  assert.equal(countGroups("(a(b)c)"), 3);
});
