"""Print a cwopt template as JSON, for optimizers written in other languages.

Usage: python3 tools/export_template.py --hill standard TEMPLATE.red

Output: {"segments": [...], "variables": [...]}. Segments are plain strings or
variable indices, in text order. Each variable has its name, the rendered values
of its domain, its start index (or null), its marker spec (for writing results
back as a template) and "paren": wrap negative values in parentheses because an
operator comes right before the marker. Gene i of a genome is an index into
variables[i].values.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from cwopt.hills import get_hill                 # noqa: E402
from cwopt.template import parse_template        # noqa: E402
from cwopt.bench import read_source              # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hill", required=True)
    ap.add_argument("template")
    a = ap.parse_args()
    hill = get_hill(a.hill)
    tmpl = parse_template(read_source(a.template), hill.constants())

    by_line = {}
    for k, var in enumerate(tmpl.variables):
        by_line.setdefault(var.line, []).append(k)
    segments, buf, variables = [], "", []
    for k, var in enumerate(tmpl.variables):
        variables.append({"name": var.name, "values": list(var.values), "start": var.start,
                          "spec": var.spec, "paren": False})
    for n, line in enumerate(tmpl.lines, 1):
        pos = 0
        for k in sorted(by_line.get(n, []), key=lambda k: tmpl.variables[k].col):
            var = tmpl.variables[k]
            buf += line[pos:var.col - 1]
            before = line[:var.col - 1].rstrip()
            variables[k]["paren"] = bool(before) and before[-1] in "+-*/%"
            segments += [buf, k]
            buf = ""
            pos = var.end
        buf += line[pos:]
    segments.append(buf)
    json.dump({"segments": segments, "variables": variables}, sys.stdout)


if __name__ == "__main__":
    main()
