# tree-sitter-ecko

A [Tree-sitter](https://tree-sitter.github.io/) grammar for
[Ecko](https://ecko.sh). Zed highlights Ecko with it (`../zed-ecko`), and
Neovim, Helix and any other Tree-sitter editor can use it too.

It parses every `.ecko` file in core's `examples/`, the 40 packages in
`stdlib/`, the website, the packages site, the templates and code-bench, and
every ```` ```ecko ```` block in the public docs and the skill: 571 files, none
with an error node.

## Develop

```bash
npm ci
npx tree-sitter generate     # after any change to grammar.js
npm test                     # corpus tests, then the highlight assertions
npx tree-sitter parse file.ecko
npx tree-sitter build --wasm # what Zed does with it
```

`src/` is generated, and committed anyway: editors build the parser from
`src/parser.c` and never run the generator. CI regenerates it and fails if the
committed copy differs, so commit `src/` with every `grammar.js` change.

## Layout

| path | what it is |
|---|---|
| `grammar.js` | the grammar |
| `src/scanner.c` | the hand-written part (below) |
| `src/parser.c`, `src/grammar.json`, `src/node-types.json` | generated |
| `queries/highlights.scm` | highlight captures; `../zed-ecko` keeps an identical copy |
| `test/corpus/*.txt` | parse trees for the constructs that are easy to get wrong |
| `test/highlights/*.ecko`, `test/highlights.js` | highlight assertions |

## What the scanner does

Three of Ecko's rules are not context-free, so `src/scanner.c` handles them.
Each mirrors a function in core's lexer or parser, named in its comment.

- **A newline ends a statement**, except when the next line starts with `|>`,
  `.`, a variant `|`, `else`, `catch` or `finally`. Inside `( )` and `[ ]`
  newlines do not count. The scanner only emits a terminator where the grammar
  can take one, which is how the bracket rule falls out.
- **Braces in strings.** A `{` opens a hole only when a matching `}` follows on
  the same line. A `{` right before the string's closing quote is literal, so
  `"{", "}"` is two strings. The exception is a `{"..."}` hole that more text
  follows, as in `"{"}"} b"`.
- **`sql { ... }`** is a query block whose `{holes}` are bind parameters, while
  `sql.query(...)` is the module. Braces inside a SQL `'...'` literal are text.

## Highlight precedence

When two patterns capture the same node, Zed and Neovim keep the **later** one,
so `highlights.scm` lists general patterns first and specific ones after. The
tree-sitter CLI's own highlighter keeps the first instead, which is why the
highlight assertions run through `test/highlights.js` (Zed's rule) rather than
`tree-sitter test`.

## Keeping it in step with the language

Core's parser is the reference: where this grammar and it disagree, it is
right. When the language changes, update `grammar.js`, regenerate, add a
corpus case for the new syntax, and run the tests. The keyword list here is
not yet checked by core's `release-check.sh`, which only checks the TextMate
grammar.

## License

MIT. See [LICENSE](LICENSE). The grammar is open so Zed's registry, which
only takes open-source extensions, can build it; the language itself is not.
