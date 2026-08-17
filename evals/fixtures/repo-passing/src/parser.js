/** Parses "a,b,c" into an array, collapsing empty entries. */
export function parseList(input) {
  if (typeof input !== "string" || input.trim() === "") return [];
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Counts nested groups in a bracketed expression. */
export function countGroups(input) {
  let depth = 0;
  let groups = 0;
  for (const character of input) {
    if (character === "(") {
      depth += 1;
      groups += 1;
    }
    if (character === ")") depth -= 1;
  }
  return depth === 0 ? groups : -1;
}
