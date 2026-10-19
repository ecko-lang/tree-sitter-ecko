// External scanner for tree-sitter-ecko. See the header of grammar.js for the
// three jobs it does; each mirrors a rule in core's lexer or parser, named in
// the comment on the function that does it.

#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType {
  NEWLINE,
  DQ_START,
  SQ_START,
  DQ_CONTENT,
  SQ_CONTENT,
  TQ_CONTENT,
  HOLE_OPEN,
  SQL_OPEN,
  SQL_TEXT,
  ERROR_SENTINEL,
};

// One bit of state: the last token was a string's opening quote. The lexer's
// literal-brace rule only applies to a `{` that is the first thing in a string.
typedef struct {
  bool at_string_start;
} Scanner;

void *tree_sitter_ecko_external_scanner_create(void) { return ts_calloc(1, sizeof(Scanner)); }

void tree_sitter_ecko_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_ecko_external_scanner_serialize(void *payload, char *buffer) {
  buffer[0] = (char)((Scanner *)payload)->at_string_start;
  return 1;
}

void tree_sitter_ecko_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  ((Scanner *)payload)->at_string_start = length > 0 && buffer[0];
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool is_ident_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c > 127;
}

// The lexer is just past a `{` in a string. Does a matching `}` arrive before
// the line ends, skipping string literals inside the hole? (`hole_balances`)
static bool hole_balances(TSLexer *lexer) {
  int depth = 1;
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == 0 || c == '\n') return false;
    if (c == '\\') {
      advance(lexer);
      if (lexer->lookahead == 0 || lexer->lookahead == '\n') return false;
    } else if (c == '{') {
      depth++;
    } else if (c == '}') {
      if (--depth == 0) return true;
    } else if (c == '"' || c == '\'') {
      int32_t quote = c;
      advance(lexer);
      while (lexer->lookahead != quote) {
        if (lexer->lookahead == 0 || lexer->lookahead == '\n') return false;
        if (lexer->lookahead == '\\') advance(lexer);
        advance(lexer);
      }
    }
    advance(lexer);
  }
}

// The lexer is just past a `{` that opened its string, and at the string's
// closing quote. Is the brace literal, rather than a `{"..."}` hole that more
// text follows? (`ends_in_literal_only_hole`) Any hole this rules out closes on
// this line, so "not literal" means "a hole".
static bool literal_brace_at_start(TSLexer *lexer, int32_t quote) {
  advance(lexer);  // the quote
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == 0 || c == '\n') return true;
    if (c == quote) break;
    if (c == '\\') advance(lexer);
    advance(lexer);
  }
  advance(lexer);  // the quote ending the would-be hole's own literal
  if (lexer->lookahead != '}') return true;
  advance(lexer);
  return lexer->lookahead == 0 || lexer->lookahead == quote;
}

// String text up to the next escape, hole or closing quote. A `{` is always a
// one-character token of its own: HOLE_OPEN when it opens a hole, string text
// when it is a literal brace.
static bool scan_content(TSLexer *lexer, const bool *valid, enum TokenType type, int32_t quote, bool triple,
                         bool at_start) {
  bool has_content = false;
  lexer->result_symbol = type;
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == 0 || c == '\\') return has_content;
    if (c == '{') {
      if (has_content) return true;
      advance(lexer);
      lexer->mark_end(lexer);
      if (!valid[HOLE_OPEN]) return true;
      if (at_start && !triple && lexer->lookahead == quote) {
        if (!literal_brace_at_start(lexer, quote)) lexer->result_symbol = HOLE_OPEN;
      } else if (hole_balances(lexer)) {
        lexer->result_symbol = HOLE_OPEN;
      }
      return true;
    }
    if (c == quote) {
      if (!triple) return has_content;
      // A lone `"` inside a triple-quoted string is text; `"""` ends it.
      advance(lexer);
      if (lexer->lookahead == '"') {
        advance(lexer);
        if (lexer->lookahead == '"') return has_content;
      }
      has_content = true;
      lexer->mark_end(lexer);
      continue;
    }
    advance(lexer);
    has_content = true;
    lexer->mark_end(lexer);
  }
}

// SQL text inside `sql { ... }`, up to a `{hole}` or the closing `}`. In a
// `'...'` literal a brace is a character, and `''` is an escaped quote.
// (`read_sql_body`)
static bool scan_sql_text(TSLexer *lexer, const bool *valid) {
  bool has_content = false;
  lexer->result_symbol = SQL_TEXT;
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == '{' && !has_content && valid[HOLE_OPEN]) {
      // Every brace in SQL text opens a bind hole.
      advance(lexer);
      lexer->mark_end(lexer);
      lexer->result_symbol = HOLE_OPEN;
      return true;
    }
    if (c == 0 || c == '{' || c == '}') return has_content;
    if (c == '\'') {
      advance(lexer);
      for (;;) {
        if (lexer->lookahead == 0) break;
        if (lexer->lookahead == '\'') {
          advance(lexer);
          if (lexer->lookahead != '\'') break;
        }
        advance(lexer);
      }
    } else {
      advance(lexer);
    }
    has_content = true;
    lexer->mark_end(lexer);
  }
}

// `sql`, optional spaces or tabs, then `{`. Anything else leaves `sql` an
// identifier, as in `sql.query(...)`. (`peek_sql_open`)
static bool scan_sql_open(TSLexer *lexer) {
  const char *word = "sql";
  for (const char *p = word; *p; p++) {
    if (lexer->lookahead != *p) return false;
    advance(lexer);
  }
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
  if (lexer->lookahead != '{') return false;
  advance(lexer);
  lexer->mark_end(lexer);
  lexer->result_symbol = SQL_OPEN;
  return true;
}

static bool match_word(TSLexer *lexer, const char *word) {
  for (const char *p = word; *p; p++) {
    if (lexer->lookahead != *p) return false;
    advance(lexer);
  }
  return !is_ident_char(lexer->lookahead);
}

// After a newline: does the next line carry the statement on? It does when it
// starts with `|>` or `.` (`parse_expr_inner`, `parse_postfix`), a variant `|`
// (`parse_typedef`), or `else`, `catch` or `finally`. Blank and comment lines
// in between are skipped, as the lexer drops comments before the parser.
static bool next_line_continues(TSLexer *lexer) {
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
      advance(lexer);
    } else if (c == '#') {
      while (lexer->lookahead != '\n' && lexer->lookahead != 0) advance(lexer);
    } else {
      break;
    }
  }
  switch (lexer->lookahead) {
    case '|':
      return true;
    case '.':
      advance(lexer);
      return lexer->lookahead != '.';
    case 'e':
      return match_word(lexer, "else");
    case 'c':
      return match_word(lexer, "catch");
    case 'f':
      return match_word(lexer, "finally");
    default:
      return false;
  }
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  // Error recovery asks for every token at once; let the internal lexer lead.
  if (valid[ERROR_SENTINEL]) return false;

  if (valid[DQ_CONTENT] || valid[SQ_CONTENT] || valid[TQ_CONTENT]) {
    bool at_start = scanner->at_string_start;
    if (valid[TQ_CONTENT]) return scan_content(lexer, valid, TQ_CONTENT, '"', true, at_start);
    if (valid[DQ_CONTENT]) return scan_content(lexer, valid, DQ_CONTENT, '"', false, at_start);
    return scan_content(lexer, valid, SQ_CONTENT, '\'', false, at_start);
  }

  if (valid[SQL_TEXT]) return scan_sql_text(lexer, valid);

  if (valid[NEWLINE]) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') skip(lexer);
    if (lexer->lookahead == '\n') {
      advance(lexer);
      lexer->mark_end(lexer);
      if (next_line_continues(lexer)) return false;
      lexer->result_symbol = NEWLINE;
      return true;
    }
  }

  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r' ||
         lexer->lookahead == '\n') {
    skip(lexer);
  }

  if ((lexer->lookahead == '"' && valid[DQ_START]) || (lexer->lookahead == '\'' && valid[SQ_START])) {
    int32_t quote = lexer->lookahead;
    advance(lexer);
    lexer->mark_end(lexer);
    if (quote == '"' && lexer->lookahead == '"') {
      advance(lexer);
      // `"""` opens a triple-quoted string, which the grammar lexes itself.
      if (lexer->lookahead == '"') return false;
    }
    lexer->result_symbol = quote == '"' ? DQ_START : SQ_START;
    return true;
  }

  if (valid[SQL_OPEN]) return scan_sql_open(lexer);

  return false;
}

bool tree_sitter_ecko_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid) {
  Scanner *scanner = (Scanner *)payload;
  bool found = scan(scanner, lexer, valid);
  // Only the token straight after an opening quote is "at the start".
  scanner->at_string_start = found && (lexer->result_symbol == DQ_START || lexer->result_symbol == SQ_START);
  return found;
}
