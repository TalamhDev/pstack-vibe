#!/bin/sh
# The JSON string escaper both hooks share. Source this file, then use
# $JSON_ESCAPE_AWK as the prefix of an awk program that prints escaped lines.
JSON_ESCAPE_AWK='
BEGIN {
  ctrl = ""
  for (i = 1; i < 32; i++) ctrl = ctrl sprintf("%c", i)
  bs = sprintf("%c", 8)
  ff = sprintf("%c", 12)
  q = sprintf("%c", 34)
}
function escape(s,   out, i, c, code) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == q) out = out "\\\""
    else if (c == "\t") out = out "\\t"
    else if (c == "\r") out = out "\\r"
    else if (c == bs) out = out "\\b"
    else if (c == ff) out = out "\\f"
    else {
      code = index(ctrl, c)
      if (code > 0) out = out sprintf("\\u%04x", code)
      else out = out c
    }
  }
  return out
}
'
