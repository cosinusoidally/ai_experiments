#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE=${1:-$ROOT/jsvm_self.c}

awk '
function add(kind, value) {
    if (value != "") {
        print kind " " value
    }
}

function ch(pos) {
    return substr(src, pos, 1)
}

function is_alpha(c) {
    return c ~ /^[A-Za-z_]$/
}

function is_digit(c) {
    return c ~ /^[0-9]$/
}

function is_alnum(c) {
    return c ~ /^[A-Za-z0-9_]$/
}

function skip_space(pos, c) {
    while (pos <= n) {
        c = ch(pos)
        if (c != " " && c != "\t" && c != "\n" && c != "\r" && c != "\f" && c != "\v") {
            return pos
        }
        pos++
    }
    return pos
}

function arg_count(start, pos, depth, c, count, saw) {
    pos = start
    depth = 1
    count = 0
    saw = 0
    while (pos <= n && depth > 0) {
        c = ch(pos)
        if (c == "\"") {
            pos++
            while (pos <= n) {
                c = ch(pos)
                if (c == "\\") {
                    pos += 2
                } else if (c == "\"") {
                    pos++
                    break
                } else {
                    pos++
                }
            }
            saw = 1
        } else if (c == "(") {
            depth++
            saw = 1
            pos++
        } else if (c == ")") {
            depth--
            pos++
        } else if (c == "," && depth == 1) {
            count++
            pos++
        } else {
            if (c != " " && c != "\t" && c != "\n" && c != "\r" && c != "\f" && c != "\v") {
                saw = 1
            }
            pos++
        }
    }
    if (!saw) {
        return 0
    }
    return count + 1
}

function read_ident(pos, out) {
    out = ""
    while (pos <= n && is_alnum(ch(pos))) {
        out = out ch(pos)
        pos++
    }
    ident_text = out
    return pos
}

function scan_function(pos, name, p, params, count) {
    p = skip_space(pos)
    if (!is_alpha(ch(p))) {
        return pos
    }
    p = read_ident(p)
    name = ident_text
    add("function", name)
    p = skip_space(p)
    if (ch(p) != "(") {
        return p
    }
    p++
    params = ""
    while (p <= n && ch(p) != ")") {
        params = params ch(p)
        p++
    }
    gsub(/[ \t\r\n\f\v]/, "", params)
    if (params == "") {
        count = 0
    } else {
        count = split(params, tmp_params, ",")
    }
    add("function_arity", count)
    if (count > max_function_arity) {
        max_function_arity = count
    }
    return p + 1
}

BEGIN {
    keyword["break"] = 1
    keyword["else"] = 1
    keyword["function"] = 1
    keyword["if"] = 1
    keyword["return"] = 1
    keyword["var"] = 1
    keyword["while"] = 1
}

{
    src = src $0 "\n"
}

END {
    n = length(src)
    i = 1
    depth = 0
    max_depth = 0
    while (i <= n) {
        c = ch(i)
        c2 = substr(src, i, 2)
        if (c2 == "//") {
            while (i <= n && ch(i) != "\n") {
                i++
            }
        } else if (c2 == "/*") {
            i += 2
            while (i <= n && substr(src, i, 2) != "*/") {
                i++
            }
            i += 2
        } else if (c == "\"") {
            i++
            while (i <= n) {
                c = ch(i)
                if (c == "\\") {
                    add("string_escape", "\\" ch(i + 1))
                    i += 2
                } else if (c == "\"") {
                    i++
                    break
                } else {
                    i++
                }
            }
        } else if (is_alpha(c)) {
            i = read_ident(i)
            word = ident_text
            if (keyword[word]) {
                add("reserved", word)
            }
            if (word == "function") {
                i = scan_function(i)
            } else if (!keyword[word]) {
                p = skip_space(i)
                if (ch(p) == "(") {
                    add("call", word)
                    argc = arg_count(p + 1)
                    add("call_arity", argc)
                    if (argc > max_call_arity) {
                        max_call_arity = argc
                    }
                }
            }
        } else {
            if (c == "(" || c == ")" || c == "{" || c == "}" || c == ";" || c == "," || c == "=") {
                add("punctuation", c)
            }
            if (c == "{") {
                depth++
                if (depth > max_depth) {
                    max_depth = depth
                }
            } else if (c == "}") {
                depth--
            }
            i++
        }
    }
    add("max_function_arity", max_function_arity)
    add("max_call_arity", max_call_arity)
    add("max_block_depth", max_depth)
}
' "$SOURCE" |
awk '
    $1 == "function" { functions[$2] = 1 }
    $1 == "call" { calls[$2] = 1 }
    $1 == "reserved" { reserved[$2] = 1 }
    $1 == "punctuation" { punctuation[$2] = 1 }
    $1 == "string_escape" { escapes[$2] = 1 }
    $1 == "function_arity" { function_arities[$2] = 1 }
    $1 == "call_arity" { call_arities[$2] = 1 }
    $1 == "max_function_arity" { max_function_arity = $2 }
    $1 == "max_call_arity" { max_call_arity = $2 }
    $1 == "max_block_depth" { max_block_depth = $2 }
    END {
        for (x in reserved) print "reserved " x
        for (x in punctuation) print "punctuation " x
        for (x in escapes) print "string_escape " x
        for (x in calls) if (!(x in functions)) print "builtin_or_host_call " x
        for (x in function_arities) print "function_arity " x
        for (x in call_arities) print "call_arity " x
        print "max_function_arity " max_function_arity
        print "max_call_arity " max_call_arity
        print "max_block_depth " max_block_depth
    }
' |
LC_ALL=C sort
