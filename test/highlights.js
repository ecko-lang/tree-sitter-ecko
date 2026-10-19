// Checks queries/highlights.scm against the assertions in test/highlights/,
// resolving overlaps the way Zed and Neovim do: the innermost node wins, and
// for the same node the LATER pattern wins. (`tree-sitter test` keeps the
// first pattern instead, so it cannot check queries written for Zed.)
//
// Assertions use tree-sitter's comment syntax:
//   # <- name   the first column of the line above
//   #   ^ name  the column of the caret, on the line above
//
// Run from the grammar root: node test/highlights.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "highlights");
let failed = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ecko"))) {
  const full = path.join(dir, file);
  const out = execFileSync("npx", ["tree-sitter", "query", "queries/highlights.scm", full], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const captures = [];
  let pattern = -1;
  for (const line of out.split("\n")) {
    const p = line.match(/^\s+pattern: (\d+)/);
    if (p) pattern = Number(p[1]);
    const c = line.match(/capture: \d+ - ([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)/);
    if (c) {
      captures.push({ name: c[1], pattern, start: [+c[2], +c[3]], end: [+c[4], +c[5]] });
    }
  }

  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const size = (c) => (c.end[0] - c.start[0]) * 1e6 + (c.end[1] - c.start[1]);
  const highlightAt = (row, col) => {
    const covering = captures.filter(
      (c) => before(c.start, [row, col]) && before([row, col + 1], c.end),
    );
    covering.sort((a, b) => size(a) - size(b) || b.pattern - a.pattern);
    return covering.length ? covering[0].name : null;
  };

  const lines = fs.readFileSync(full, "utf8").split("\n");
  let target = -1;
  lines.forEach((line, row) => {
    const a = line.match(/^(\s*)#(\s*)(<-|\^)\s+([\w.]+)\s*$/);
    if (!a) {
      target = row;
      return;
    }
    const col = a[3] === "<-" ? a[1].length : line.indexOf("^");
    const got = highlightAt(target, col);
    if (got !== a[4]) {
      failed++;
      console.error(`FAIL ${file}:${target + 1}:${col + 1} expected ${a[4]}, got ${got}`);
    }
  });
}

if (failed) process.exit(1);
console.log("highlight tests ok");
