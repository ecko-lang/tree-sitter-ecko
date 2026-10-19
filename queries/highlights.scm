; Highlight queries for Ecko.
;
; When two patterns capture the same node, the LATER one wins. That is how Zed
; and Neovim resolve it, so the general patterns come first and the specific
; ones after. (The tree-sitter CLI's own highlighter keeps the first instead;
; test/highlights.js checks these with Zed's rule.) Capture names are ones
; Zed's themes style; a dotted name falls back to its prefix.

(identifier) @variable

; A capitalised name is a type or variant: `Circle`, `Ok(x)`.
((identifier) @type
  (#match? @type "^[A-Z]"))

; SCREAMING_CASE is a constant.
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]+$"))

; --- operators and punctuation ----------------------------------------------

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," "." ":" "::" ";"] @punctuation.delimiter

[
  "=" "+=" "-=" "*=" "/=" "//=" "%="
  "+" "-" "*" "/" "//" "%"
  "==" "!=" "<" ">" "<=" ">="
  "|>" "??" ".." "..=" "->" "=>" "|" "?"
] @operator

; --- keywords ---------------------------------------------------------------

["and" "or" "not" "band" "bor" "bxor" "shl" "shr" "bnot"] @keyword.operator

[
  "fn" "let" "mut" "const" "type" "template" "async" "await" "ai" "py"
  "import" "export" "from" "as"
] @keyword

[
  "if" "unless" "else" "match" "when" "for" "in" "while" "loop"
  "break" "continue" "return" "try" "catch" "finally"
] @keyword.control

(continue_statement) @keyword.control
(ai_clause) @keyword
(sql_block "sql" @keyword)

(wildcard_pattern) @variable.special

; --- calls, fields and names ------------------------------------------------

(field_expression field: (identifier) @property)

(call_expression function: (identifier) @function)
(call_expression function: (field_expression field: (identifier) @function.method))

(named_argument name: (identifier) @property)
(map_entry key: (identifier) @property)
(field_pattern name: (identifier) @property)
(variant_field name: (identifier) @property)
(record_type (identifier) @property)

(struct_literal name: (identifier) @type)
(struct_literal name: (field_expression field: (identifier) @type))
(variant_name (identifier) @type)
(type_name (identifier) @type)
(generic_type (identifier) @type)
(type_definition name: (identifier) @type)
(variant name: (identifier) @type)

; Module names take the type colour, as std modules do in the VS Code grammar.
(import_statement source: (module_path (identifier) @type))
(import_statement alias: (identifier) @type)
(export_statement source: (module_path (identifier) @type))

(parameter name: (identifier) @variable.parameter)
(function_definition name: (identifier) @function)
(template_definition name: (identifier) @function)

(attribute "@" @attribute name: (attribute_name) @attribute)
(untrusted) @attribute

; --- literals ---------------------------------------------------------------

(integer) @number
(float) @number
(decimal) @number

[(true) (false)] @boolean
(null) @constant

[(string) (template_string) (raw_string) (byte_string) (escaped_string)] @string

(sql_text) @string.special
(escape_sequence) @string.escape

; --- interpolation ----------------------------------------------------------

(interpolation
  "{" @punctuation.special
  "}" @punctuation.special)

(template_directive
  "{" @punctuation.special
  "}" @punctuation.special)

(template_directive ["for" "in" "if" "input" "else" "end"] @keyword)

; --- comments ---------------------------------------------------------------

(comment) @comment

((comment) @comment.doc
  (#match? @comment.doc "^##"))
