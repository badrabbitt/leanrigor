import assert from "node:assert/strict";
import test from "node:test";
import { countGroups, parseList } from "../src/parser.js";

test("parses a comma separated list", () => {
  assert.deepEqual(parseList("a, b ,c"), ["a", "b", "c"]);
});

test("returns an empty list for blank input", () => {
  assert.deepEqual(parseList("  "), []);
});

test("counts nested groups", () => {
  assert.equal(countGroups("(a(b)c)"), 2);
});

test("rejects unbalanced groups", () => {
  assert.equal(countGroups("(a"), -1);
});
