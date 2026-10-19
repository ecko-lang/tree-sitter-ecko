/**
 * Tree-sitter grammar for Ecko - https://ecko.sh
 *
 * The reference is core's hand-written parser (crates/ecko-core/src/parser)
 * and lexer; where this file and they disagree, they are right. Three things
 * are not expressible as context-free rules and live in src/scanner.c:
 *
 * - A newline ends a statement, except when the next line starts with `|>`,
 *   `.`, a variant `|`, `else`, `catch` or `finally`. Inside `( )` and `[ ]`
 *   newlines do not count; the scanner only emits a terminator where the
 *   grammar can take one, so that falls out of the rules below.
 * - A `{` in a string opens a hole only when a matching `}` follows on the
 *   same line, and a `{` right before the string's closing quote is literal
 *   (`"{", "}"` is two strings).
 * - `sql { ... }` is a query block, while `sql.query(...)` is the module.
 */

const PREC = {
  pipe: 1,
  or: 2,
  and: 3,
  cmp: 4,
  coalesce: 5,
  bor: 6,
  bxor: 7,
  band: 8,
  shift: 9,
  range: 10,
  add: 11,
  mul: 12,
  unary: 13,
  postfix: 14,
};

// Keywords that may still be a field or key name: `x.type`, `{ type: 1 }`.
const KEYWORDS = [
  'fn', 'let', 'const', 'mut', 'if', 'unless', 'else', 'match', 'for', 'in',
  'while', 'loop', 'break', 'continue', 'return', 'import', 'export', 'from',
  'as', 'type', 'async', 'await', 'try', 'catch', 'finally', 'true', 'false',
  'null', 'and', 'or', 'not', 'band', 'bor', 'bxor', 'shl', 'shr', 'bnot',
  'when', 'ai', 'template', 'py',
];

module.exports = grammar({
  name: 'ecko',

  word: $ => $.identifier,

  extras: $ => [/[\s\uFEFF]/, $.comment],

  externals: $ => [
    $._newline,
    $._dq_start,
    $._sq_start,
    $._dq_content,
    $._sq_content,
    $._tq_content,
    $._hole_open,
    $._sql_open,
    $.sql_text,
    $._error_sentinel,
  ],

  inline: $ => [$._field_name, $._statement_end],

  conflicts: $ => [
    [$._primary, $.type_name],
    [$._primary, $.struct_literal],
    [$._primary, $.generic_type],
  ],

  supertypes: $ => [$._expression, $._statement, $._pattern, $._type],

  rules: {
    source_file: $ => optional($._statements),

    _statements: $ => seq(
      $._statement,
      repeat(seq($._statement_end, $._statement)),
      optional($._statement_end),
    ),

    _statement_end: $ => repeat1(choice($._newline, ';')),

    comment: _ => token(seq('#', /[^\n]*/)),

    _statement: $ => choice(
      $.let_declaration,
      $.const_declaration,
      $.function_definition,
      $.template_definition,
      $.type_definition,
      $.import_statement,
      $.export_statement,
      $.return_statement,
      $.break_statement,
      $.continue_statement,
      $.assignment,
      $.compound_assignment,
      $.destructuring_assignment,
      $.expression_statement,
    ),

    expression_statement: $ => $._expression,

    // --- bindings ---------------------------------------------------------

    let_declaration: $ => seq(
      optional($.untrusted),
      choice('let', 'mut', seq('let', 'mut')),
      choice(
        seq(
          field('name', $.identifier),
          optional(seq(':', field('type', $._type))),
          optional(seq('=', field('value', $._expression))),
        ),
        seq(field('names', $.destructuring_pattern), '=', field('value', $._expression)),
      ),
    ),

    // Deprecated; still parsed so old code highlights.
    const_declaration: $ => seq(
      'const',
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      '=',
      field('value', $._expression),
    ),

    untrusted: _ => seq('@', 'untrusted'),

    destructuring_pattern: $ => seq('(', $.identifier, repeat1(seq(',', $.identifier)), ')'),

    assignment: $ => seq(
      field('target', choice($.identifier, $.field_expression, $.index_expression)),
      '=',
      field('value', $._expression),
    ),

    compound_assignment: $ => seq(
      field('target', choice($.identifier, $.field_expression, $.index_expression)),
      field('operator', choice('+=', '-=', '*=', '/=', '//=', '%=')),
      field('value', $._expression),
    ),

    destructuring_assignment: $ => seq(
      field('names', $.destructuring_pattern),
      '=',
      field('value', $._expression),
    ),

    // --- functions --------------------------------------------------------

    function_definition: $ => seq(
      repeat($.attribute),
      optional('async'),
      'fn',
      field('name', $.identifier),
      field('parameters', $.parameters),
      optional(seq('->', field('return_type', $._type))),
      choice(
        seq('=', field('body', $._expression)),
        field('body', $.block),
      ),
    ),

    attribute: $ => seq(
      '@',
      field('name', alias(choice('requires', 'ensures', 'tool'), $.attribute_name)),
      '(',
      field('argument', $._expression),
      ')',
    ),

    parameters: $ => seq('(', optional(commaSep1($.parameter)), optional(','), ')'),

    parameter: $ => seq(
      optional($.untrusted),
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      optional(seq('=', field('default', $._expression))),
    ),

    template_definition: $ => seq(
      'template',
      field('name', $.identifier),
      field('parameters', $.parameters),
      '=',
      field('body', choice($.template_string, $.raw_string)),
    ),

    // --- types ------------------------------------------------------------

    type_definition: $ => seq(
      'type',
      field('name', $.identifier),
      choice(
        // `type User { name: String }`, a record.
        field('fields', $.variant_fields),
        seq('=', optional('|'), $.variant, repeat(seq('|', $.variant))),
      ),
    ),

    variant: $ => seq(field('name', $.identifier), optional(field('fields', $.variant_fields))),

    variant_fields: $ => seq('{', optional(seq(commaSep1($.variant_field), optional(','))), '}'),

    variant_field: $ => seq(
      field('name', $._field_name),
      ':',
      field('type', $._type),
      optional(seq('=', field('default', $._expression))),
    ),

    _type: $ => choice($.type_name, $.generic_type, $.record_type, $.optional_type),
    type_name: $ => $.identifier,
    generic_type: $ => seq($.identifier, '<', commaSep1($._type), '>'),
    record_type: $ => seq('{', optional(seq(commaSep1(seq($.identifier, ':', $._type)), optional(','))), '}'),
    optional_type: $ => seq($._type, choice('?', '??')),

    // --- modules ----------------------------------------------------------

    import_statement: $ => seq(
      'import',
      field('source', choice($.module_path, $.string)),
      optional(choice(
        seq('as', field('alias', $.identifier)),
        $.import_list,
      )),
    ),

    module_path: $ => seq($.identifier, repeat(seq('.', $.identifier))),

    import_list: $ => seq('{', optional(seq(commaSep1($.import_item), optional(','))), '}'),
    import_item: $ => seq(field('name', $.identifier), optional(seq('as', field('alias', $.identifier)))),

    export_statement: $ => seq('export', choice(
      seq('*', 'from', field('source', choice($.module_path, $.string))),
      seq($.import_list, 'from', field('source', choice($.module_path, $.string))),
      seq('import', field('source', choice($.module_path, $.string))),
      $.function_definition,
      $.type_definition,
      $.template_definition,
      $.let_declaration,
      $.const_declaration,
      alias($._export_binding, $.assignment),
    )),

    _export_binding: $ => seq(field('target', $.identifier), '=', field('value', $._expression)),

    // --- jumps ------------------------------------------------------------

    return_statement: $ => prec.right(seq('return', optional($._expression))),
    break_statement: $ => prec.right(seq('break', optional($._expression))),
    continue_statement: _ => 'continue',

    // --- expressions ------------------------------------------------------

    _expression: $ => choice(
      $._primary,
      $.unary_expression,
      $.binary_expression,
      $.range_expression,
      $.pipeline_expression,
      $.lambda,
      $.ai_expression,
      $.await_expression,
    ),

    _primary: $ => choice(
      $.integer,
      $.float,
      $.decimal,
      $.string,
      $.raw_string,
      $.byte_string,
      $.escaped_string,
      $.true,
      $.false,
      $.null,
      $.identifier,
      $.list,
      $.map,
      $.struct_literal,
      $.sql_block,
      $.py_call,
      $.parenthesized_expression,
      $.call_expression,
      $.field_expression,
      $.index_expression,
      $.slice_expression,
      $.if_expression,
      $.unless_expression,
      $.match_expression,
      $.for_expression,
      $.while_expression,
      $.loop_expression,
      $.try_expression,
      $.block,
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    block: $ => seq('{', optional($._statements), '}'),

    unary_expression: $ => choice(
      prec(PREC.unary, seq(field('operator', choice('-', 'bnot')), field('operand', $._expression))),
      prec.right(PREC.cmp, seq(field('operator', 'not'), field('operand', $._expression))),
    ),

    binary_expression: $ => {
      const table = [
        [PREC.or, 'or'],
        [PREC.and, 'and'],
        [PREC.cmp, choice('==', '!=', '<', '>', '<=', '>=', 'in')],
        [PREC.bor, 'bor'],
        [PREC.bxor, 'bxor'],
        [PREC.band, 'band'],
        [PREC.shift, choice('shl', 'shr')],
        [PREC.add, choice('+', '-')],
        [PREC.mul, choice('*', '/', '//', '%')],
      ];
      return choice(
        ...table.map(([p, op]) => prec.left(p, seq(
          field('left', $._expression),
          field('operator', op),
          field('right', $._expression),
        ))),
        // `??` is right-associative.
        prec.right(PREC.coalesce, seq(
          field('left', $._expression),
          field('operator', '??'),
          field('right', $._expression),
        )),
      );
    },

    range_expression: $ => prec.left(PREC.range, seq(
      field('start', $._expression),
      field('operator', choice('..', '..=')),
      field('end', $._expression),
    )),

    pipeline_expression: $ => prec.left(PREC.pipe, seq(
      field('left', $._expression),
      '|>',
      field('right', $._expression),
    )),

    await_expression: $ => prec.right(PREC.or, seq('await', $._expression)),

    call_expression: $ => prec(PREC.postfix, seq(
      field('function', $._primary),
      field('arguments', $.arguments),
    )),

    arguments: $ => seq('(', optional(seq(commaSep1($._argument), optional(','))), ')'),
    _argument: $ => choice($._expression, $.named_argument),
    named_argument: $ => seq(field('name', $._field_name), ':', field('value', $._expression)),

    field_expression: $ => prec(PREC.postfix, seq(
      field('object', $._primary),
      '.',
      field('field', $._field_name),
    )),

    index_expression: $ => prec(PREC.postfix, seq(
      field('object', $._primary),
      '[',
      field('index', $._expression),
      ']',
    )),

    slice_expression: $ => prec(PREC.postfix, seq(
      field('object', $._primary),
      '[',
      optional(field('start', $._expression)),
      choice('..', '..=', ':'),
      optional(field('end', $._expression)),
      ']',
    )),

    py_call: $ => seq('py', $.arguments),

    // The body stops before `|>`, as in the parser: `fn(x) x |> g` pipes the lambda.
    lambda: $ => prec.right(PREC.or, seq(
      optional('async'),
      choice(
        seq('fn', field('parameters', $.parameters), optional('=>')),
        // Deprecated `|x| body`; `ecko fmt` rewrites it.
        seq('|', optional(commaSep1($.parameter)), '|'),
      ),
      field('body', $._expression),
    )),

    // `ai[T] prompt votes N on img using tools with chat via m -> stream`
    ai_expression: $ => prec.right(PREC.or, seq(
      'ai',
      // `ai [` always opens the type, never a list prompt.
      optional(prec.dynamic(1, seq('[', field('type', $._type), ']'))),
      optional(field('votes', $.integer)),
      field('prompt', $._expression),
      repeat(choice(
        seq(alias('votes', $.ai_clause), $.integer),
        seq(alias(choice('on', 'using', 'with', 'via'), $.ai_clause), $._expression),
        seq('->', alias('stream', $.ai_clause)),
      )),
    )),

    if_expression: $ => prec.right(seq(
      'if',
      field('condition', $._expression),
      field('consequence', $._branch),
      optional(seq('else', field('alternative', $._branch))),
    )),

    unless_expression: $ => prec.right(seq(
      'unless',
      field('condition', $._expression),
      field('consequence', $._branch),
      optional(seq('else', field('alternative', $._branch))),
    )),

    _branch: $ => choice(seq('=>', $._expression), $._expression),

    match_expression: $ => seq(
      'match',
      field('value', $._expression),
      '{',
      optional(seq(
        $.match_arm,
        // A separator is optional: `{ Low => "low" High => "high" }` parses.
        repeat(seq(optional($._arm_separator), $.match_arm)),
        optional($._arm_separator),
      )),
      '}',
    ),

    _arm_separator: $ => repeat1(choice(',', $._newline)),

    match_arm: $ => seq(
      field('pattern', $._pattern),
      optional(seq('when', field('guard', $._expression))),
      '=>',
      field('value', $._expression),
    ),

    for_expression: $ => seq(
      'for',
      field('binding', choice($.identifier, $.destructuring_pattern)),
      'in',
      field('iterable', $._expression),
      field('body', $.block),
    ),

    while_expression: $ => seq('while', field('condition', $._expression), field('body', $.block)),

    loop_expression: $ => seq('loop', field('body', $.block)),

    try_expression: $ => prec.right(seq(
      'try',
      field('body', $.block),
      optional($.catch_clause),
      optional($.finally_clause),
    )),
    catch_clause: $ => seq('catch', optional(seq('(', field('name', $.identifier), ')')), field('body', $.block)),
    finally_clause: $ => seq('finally', field('body', $.block)),

    // --- patterns ---------------------------------------------------------

    _pattern: $ => choice(
      $.wildcard_pattern,
      $.pattern_identifier,
      $.literal_pattern,
      $.variant_pattern,
      $.record_pattern,
      $.list_pattern,
    ),

    wildcard_pattern: _ => '_',
    pattern_identifier: $ => $.identifier,

    literal_pattern: $ => choice(
      seq(optional('-'), choice($.integer, $.float, $.decimal)),
      $.string, $.raw_string, $.byte_string, $.true, $.false, $.null,
    ),

    _qualified_name: $ => seq($.identifier, repeat(seq(choice('.', '::'), $.identifier))),

    variant_pattern: $ => seq(
      field('name', alias($._qualified_name, $.variant_name)),
      '(',
      optional(seq(commaSep1($._pattern), optional(','))),
      ')',
    ),

    record_pattern: $ => seq(
      optional(field('name', alias($._qualified_name, $.variant_name))),
      '{',
      optional(seq(commaSep1(choice($.field_pattern, '..')), optional(','))),
      '}',
    ),

    field_pattern: $ => seq(field('name', $._field_name), optional(seq(':', field('pattern', $._pattern)))),

    list_pattern: $ => seq('[', optional(seq(commaSep1($._pattern), optional(','))), ']'),

    // --- collections ------------------------------------------------------

    list: $ => seq('[', optional(seq(commaSep1($._expression), optional(','))), ']'),

    map: $ => prec(1, seq('{', optional(seq(commaSep1($.map_entry), optional(','))), '}')),

    map_entry: $ => seq(
      field('key', choice($._field_name, $.string, $.raw_string)),
      ':',
      field('value', $._expression),
    ),

    // `User { name: "Ada" }`, `shapes.Circle { r: 1 }`
    // Only when a `name:` follows the brace, as in the parser: `for x in xs {`
    // opens the loop body.
    struct_literal: $ => seq(
      field('name', choice($.identifier, $.field_expression)),
      field('fields', alias($._struct_fields, $.map)),
    ),
    _struct_fields: $ => seq('{', commaSep1($.map_entry), optional(','), '}'),

    _field_name: $ => choice($.identifier, alias(choice(...KEYWORDS), $.identifier)),

    // --- sql { ... } --------------------------------------------------------

    sql_block: $ => seq(
      alias($._sql_open, 'sql'),
      repeat(choice($.sql_text, $.interpolation)),
      '}',
    ),

    // --- literals ---------------------------------------------------------

    integer: _ => /[0-9][0-9_]*/,
    float: _ => token(choice(
      /[0-9][0-9_]*\.[0-9][0-9_]*([eE][+-]?[0-9][0-9_]*)?/,
      /[0-9][0-9_]*[eE][+-]?[0-9][0-9_]*/,
    )),
    decimal: _ => /[0-9][0-9_]*(\.[0-9][0-9_]*)?m/,
    true: _ => 'true',
    false: _ => 'false',
    null: _ => 'null',

    string: $ => choice(
      seq(alias($._dq_start, '"'), repeat(choice($._dq_content, $.escape_sequence, $.interpolation)), token.immediate('"')),
      seq(alias($._sq_start, "'"), repeat(choice($._sq_content, $.escape_sequence, $.interpolation)), token.immediate("'")),
      seq('"""', repeat(choice($._tq_content, $.escape_sequence, $.interpolation)), token.immediate('"""')),
    ),

    // A template body: `{for x in xs}`, `{if c}`, `{else}`, `{end}` and holes.
    template_string: $ => choice(
      seq(alias($._dq_start, '"'), repeat(choice($._dq_content, $.escape_sequence, $._template_part)), token.immediate('"')),
      seq('"""', repeat(choice($._tq_content, $.escape_sequence, $._template_part)), token.immediate('"""')),
    ),

    _template_part: $ => choice($.interpolation, $.template_directive),

    template_directive: $ => seq(
      alias($._hole_open, '{'),
      choice(
        seq('for', $.identifier, 'in', $._expression),
        seq('if', $._expression),
        // Renders an untrusted value inside `<input>` delimiters.
        seq('input', $._expression),
        'else',
        'end',
      ),
      '}',
    ),

    interpolation: $ => seq(alias($._hole_open, '{'), $._expression, '}'),

    escape_sequence: _ => token.immediate(choice(/\\u\{[0-9A-Fa-f]{1,6}\}/, /\\x[0-9A-Fa-f]{2}/, /\\[^\n]/)),

    raw_string: _ => token(choice(
      seq('r"""', repeat(choice(/[^"]/, /"[^"]/, /""[^"]/)), '"""'),
      seq('r"', /[^"]*/, '"'),
    )),

    // Inside a hole, `\"` is a quote: "{f(\"x\")}" calls f with "x".
    escaped_string: _ => token(seq('\\"', repeat(choice(/[^"\\\n]/, /\\[^"]/)), '\\"')),

    byte_string: $ => seq('b"', repeat(choice(token.immediate(/[^"\\]+/), $.escape_sequence)), token.immediate('"')),

    identifier: _ => /[\p{L}_][\p{L}\p{N}_]*/u,
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
