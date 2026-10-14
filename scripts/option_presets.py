"""Generate dropdown presets from the app's bundled pMARS option files."""
import json
import shlex

NUMBERS = dict(s="coreSize", c="cycles", p="tasks", l="maxLength",
               d="distance", S="pspace", r="rounds")
FLAGS = {"8": "rules88", "b": "brief", "V": "verbose", "k": "koth",
         "f": "fixedSeries", "o": "sort", "P": "permutate", "A": "assembleOnly"}
STRINGS = {"=": "formula", "F": "fixedPosition"}
# Presentation labels only: all simulation values come from the .opt files.
LABELS = {"94": "Standard ’94", "94b": "Beginners", "88": "Standard ’88",
          "94nop": "’94 No P-space", "94m": "’94 Multiwarrior",
          "94t": "’94 Tourney", "icws": "ICWS ’88 Tournament",
          "94x": "’94 Experimental", "94xm": "Multiwarrior X",
          "lp": "Limited Process", "mp": "Medium Process",
          "tiny": "Tiny", "nano": "Nano", "tinylp": "Tiny LP"}


def parse_options(path):
    lexer = shlex.shlex(path.read_text(encoding="utf-8"), posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ";"
    tokens = iter(lexer)
    values = {}
    for token in tokens:
        if len(token) != 2 or token[0] != "-":
            raise ValueError(f"{path.name}: expected an option, got {token!r}")
        flag = token[1]
        if flag in FLAGS:
            values[FLAGS[flag]] = True
        elif flag in NUMBERS or flag in STRINGS:
            value = next(tokens, None)
            if value is None:
                raise ValueError(f"{path.name}: missing value for {token}")
            if flag in NUMBERS:
                try:
                    values[NUMBERS[flag]] = int(value)
                except ValueError:
                    raise ValueError(f"{path.name}: invalid integer for {token}: {value!r}") from None
            else:
                values[STRINGS[flag]] = value
        else:
            raise ValueError(f"{path.name}: unsupported preset option {token}")
    return values


def presets(config):
    groups = {}
    for path in sorted(config.glob("*.opt"), key=lambda p: (p.stem != "94", p.name)):
        values = parse_options(path)
        signature = json.dumps(values, sort_keys=True)
        label = LABELS.get(path.stem, path.stem)
        if signature in groups:
            groups[signature]["files"].append(path.name)
            groups[signature]["name"] += " / " + label
            continue
        preset = dict(id=path.stem, name=label, values=values, files=[path.name])
        if values.get("pspace") == 1:
            preset["note"] = "Sets P-space size to 1; LDP/STP and PIN remain allowed, as in the option file."
        groups[signature] = preset
    if not groups:
        raise ValueError(f"No option files found in {config}")
    return list(groups.values())


def write_presets(config, output):
    output.write_text("// Generated from config/*.opt; edit the option files, not this module.\n"
                      + "export const presets = "
                      + json.dumps(presets(config), ensure_ascii=False, indent=2) + ";\n",
                      encoding="utf-8", newline="\n")
