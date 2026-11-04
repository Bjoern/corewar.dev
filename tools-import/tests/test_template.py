import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cwopt.hills import get_hill  # noqa: E402
from cwopt.template import TemplateError, parse_template, signed  # noqa: E402

NANO = get_hill("nano").constants()
STD = get_hill("standard").constants()


def parse(text, c=NANO):
    return parse_template(text, c)


class TestMarkers(unittest.TestCase):
    def test_bare_marker_is_whole_core_signed(self):
        t = parse("dat !, 0\n")
        v = t.variables[0]
        self.assertEqual(v.size, 80)
        self.assertEqual(v.values[0], "-40")
        self.assertEqual(v.values[-1], "39")
        self.assertEqual(v.name, "1:5")

    def test_range_inclusive_and_step(self):
        self.assertEqual(parse("dat !(1..10), 0").variables[0].values, [str(i) for i in range(1, 11)])
        self.assertEqual(parse("dat !(1..10, 3), 0").variables[0].values, ["1", "4", "7", "10"])
        self.assertEqual(parse("dat !( 2 .. 8 , 2 ), 0").variables[0].values, ["2", "4", "6", "8"])

    def test_values_rendered_in_smallest_absolute_form(self):
        v = parse("dat !(75..79), 0").variables[0]
        self.assertEqual(v.values, ["-5", "-4", "-3", "-2", "-1"])
        self.assertEqual(signed(77, 80), -3)
        self.assertEqual(signed(40, 80), -40)
        self.assertEqual(signed(39, 80), 39)

    def test_token_list(self):
        t = parse("spl.![a,b,f] ![#,$]!(1..10), ![<,{]5")
        self.assertEqual([v.values for v in t.variables],
                         [["a", "b", "f"], ["#", "$"], [str(i) for i in range(1, 11)], ["<", "{"]])
        self.assertEqual(t.render([2, 1, 0, 1]), "spl.f $1, {5")
        self.assertEqual(parse("![mov, djn] 0, 1").variables[0].values, ["mov", "djn"])

    def test_filters(self):
        self.assertEqual(len(parse("dat !(1..79)?coprime, 0").variables[0].values), 32)
        self.assertEqual(parse("dat !(1..9)?odd, 0").variables[0].values, ["1", "3", "5", "7", "9"])
        self.assertEqual(parse("dat !(1..9)?even, 0").variables[0].values, ["2", "4", "6", "8"])
        self.assertEqual(parse("dat !(1..20)?odd?coprime, 0").variables[0].values,
                         ["1", "3", "7", "9", "11", "13", "17", "19"])
        # coprime uses value mod C: -3 = 77, gcd(77, 80) = 1
        self.assertIn("-3", parse("dat !(-5..-1)?coprime, 0").variables[0].values)
        with self.assertRaises(TemplateError):
            parse("![mov,djn]?odd 0, 1")

    def test_start_values(self):
        t = parse("step equ !(1..79)?coprime:37\ndat ![<,{]:{, !:-3\n")
        self.assertEqual([v.values[v.start] for v in t.variables], ["37", "{", "-3"])
        # start value matches mod CORESIZE: 77 is -3
        self.assertEqual(parse("dat !:77, 0").variables[0].values[parse("dat !:77, 0").variables[0].start], "-3")
        with self.assertRaises(TemplateError) as e:
            parse("step equ !(1..79)?coprime:38")
        self.assertIn("not in the domain", e.exception.message)
        self.assertIsNone(parse("dat !(1..5), 0").variables[0].start)

    def test_expressions_with_hill_constants(self):
        v = parse_template("dat !(MINDISTANCE..CORESIZE/2 - 1, (2+1)*1), 0", STD).variables[0]
        self.assertEqual(v.values[0], "100")
        self.assertEqual(v.values[1], "103")
        self.assertEqual(v.values[-1], "3997")
        v = parse("dat !(-CORESIZE/4..PSPACESIZE % 3), 0").variables[0]
        self.assertEqual((v.values[0], v.values[-1]), ("-20", "2"))

    def test_equ_names_and_positions(self):
        t = parse("step  equ !(1..79)\ngap EQU !(1..3)+!(1..2)\n  dat !, 0\n")
        self.assertEqual([v.name for v in t.variables], ["step", "gap", "gap#2", "3:7"])

    def test_comments_and_not_equal(self):
        t = parse(";name Wow!\n;assert CORESIZE != 80 || 1\nx equ 5 ; tune! later\n"
                  "for x != 3\ndat !, 0\nrof\n")
        self.assertEqual(len(t.variables), 1)
        self.assertEqual(t.variables[0].line, 5)
        t = parse("  if (CORESIZE!=80)\n  dat !=0\n  endif\n")
        self.assertEqual(t.variables, [])

    def test_errors_report_line_and_column(self):
        cases = {
            "dat 0, 0\ndat !(1..5, 0\n": (2, 5),
            "dat !(5..1), 0": (1, 6),
            "dat !(1..100), 0": (1, 6),          # wider than the core
            "dat !(0..80, 80), 0": (1, 5),       # 0 and 80 equal mod C
            "dat !?prime, 0": (1, 6),
            "dat !(1..FOO), 0": (1, 7),
            "dat ![mov,,djn], 0": (1, 6),
            "dat !:, 0": (1, 6),
        }
        for text, (line, col) in cases.items():
            with self.subTest(text=text):
                with self.assertRaises(TemplateError) as e:
                    parse(text)
                self.assertEqual((e.exception.line, e.exception.col), (line, col), e.exception.message)

    def test_negative_value_after_operator_is_parenthesised(self):
        t = parse("dat 0-!(-3..-1), 1+ !(-2..2)")
        self.assertEqual(t.render([0, 0]), "dat 0-(-3), 1+ (-2)")

    def test_round_trip(self):
        text = (";redcode-nano\n;name t!\nstep equ !(1..79)?coprime:37\ngap equ !(-10..10)\n"
                "spl #0, ![<,{]gap\nmov.![i,f] 0, @1\n![jmp,djn] -1, !\n")
        t = parse(text)
        idx = [5, 3, 1, 0, 1, 70]
        back = t.write_back(idx)
        t2 = parse(back)
        self.assertEqual([v.values for v in t2.variables], [v.values for v in t.variables])
        self.assertEqual([v.name for v in t2.variables], [v.name for v in t.variables])
        self.assertEqual(t2.start_indices(), idx)
        self.assertEqual(t2.render(idx), t.render(idx))
        self.assertIn("!(1..79)?coprime:", back)
        self.assertEqual(parse(t2.write_back(idx)).write_back(idx), back)

    def test_render_segments(self):
        t = parse("a equ !(1..5):2\ndat ![#,$]:$a, 0\n")
        segs = t.render_segments(t.start_indices())
        self.assertEqual("".join(s["text"] for s in segs), t.render(t.start_indices()))
        self.assertEqual([s["text"] for s in segs if "var" in s], ["2", "$"])


if __name__ == "__main__":
    unittest.main()
