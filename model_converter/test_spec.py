#!/usr/bin/env python3
# ABOUTME: Tests for spec.py — parsing, validation, and the visibility DSL evaluator.
# ABOUTME: Skipped when PyYAML is not installed so scaffold-only environments still test green.

import os
import sys
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(__file__))

try:
    import yaml as _yaml  # noqa: F401
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False

if YAML_AVAILABLE:
    from spec import (
        parse,
        SpecError,
        NodeSpec,
        evaluate_visible,
        default_config,
        validate_against_tree,
    )


@unittest.skipUnless(YAML_AVAILABLE, "PyYAML not installed")
class TestParse(unittest.TestCase):
    def test_minimal_spec(self):
        text = textwrap.dedent("""
            model:
              name: Test
              glb: foo.glb
            palette:
              Main: { color: "#ff0000" }
        """).strip()
        s = parse(text)
        self.assertEqual(s.model_name, "Test")
        self.assertEqual(s.glb_path, "foo.glb")
        self.assertEqual(s.palette["Main"]["color"], "#ff0000")

    def test_missing_model_block_raises(self):
        with self.assertRaises(SpecError):
            parse("palette: { Main: { color: '#fff' } }")

    def test_missing_glb_in_model_raises(self):
        with self.assertRaises(SpecError):
            parse("model: { name: T }\npalette: { Main: { color: '#fff' } }")

    def test_missing_palette_raises(self):
        with self.assertRaises(SpecError):
            parse("model: { name: T, glb: f.glb }")

    def test_empty_palette_raises(self):
        with self.assertRaises(SpecError):
            parse("model: { name: T, glb: f.glb }\npalette: {}")

    def test_invalid_yaml_raises(self):
        with self.assertRaises(SpecError):
            parse("not: valid: yaml: [")

    def test_auto_assign_unknown_category_raises(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            autoAssign:
              - { match: '*', category: Bogus }
        """).strip()
        with self.assertRaises(SpecError):
            parse(text)

    def test_node_unknown_category_raises(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            nodes:
              Foo: { category: Bogus }
        """).strip()
        with self.assertRaises(SpecError):
            parse(text)

    def test_node_visible_parses_when_and_unless(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            nodes:
              Foo:
                visible:
                  when: { carriage: xol }
                  unless: { hexCowl: true }
        """).strip()
        s = parse(text)
        node = s.nodes["Foo"]
        self.assertEqual(node.visible_when, {"carriage": "xol"})
        self.assertEqual(node.visible_unless, {"hexCowl": True})

    def test_node_stl_string_normalized_to_list(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            nodes:
              Foo: { stl: a/b.stl }
        """).strip()
        s = parse(text)
        self.assertEqual(s.nodes["Foo"].stl, ["a/b.stl"])

    def test_node_stl_list_preserved(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            nodes:
              Foo: { stl: [a.stl, b.stl] }
        """).strip()
        s = parse(text)
        self.assertEqual(s.nodes["Foo"].stl, ["a.stl", "b.stl"])

    def test_options_choices_parsed(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            options:
              carriage:
                label: Carriage
                choices:
                  - { id: xol, label: Xol, default: true }
                  - { id: omron, label: Omron }
        """).strip()
        s = parse(text)
        self.assertIn("carriage", s.options)
        self.assertEqual(s.options["carriage"]["label"], "Carriage")
        self.assertEqual(len(s.options["carriage"]["choices"]), 2)

    def test_bool_option_parsed(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            options:
              hexCowl: { label: Hex, type: bool, default: true }
        """).strip()
        s = parse(text)
        self.assertEqual(s.options["hexCowl"]["type"], "bool")
        self.assertIs(s.options["hexCowl"]["default"], True)


@unittest.skipUnless(YAML_AVAILABLE, "PyYAML not installed")
class TestEvaluateVisible(unittest.TestCase):
    def _n(self, **kw):
        defaults = dict(display_name=None, category=None, hidden=False,
                        visible_when=None, visible_unless=None,
                        stl=None, visual_only=False)
        defaults.update(kw)
        return NodeSpec(**defaults)

    def test_no_rules_visible(self):
        self.assertTrue(evaluate_visible(self._n(), {}))

    def test_when_equality(self):
        n = self._n(visible_when={"carriage": "xol"})
        self.assertTrue(evaluate_visible(n, {"carriage": "xol"}))
        self.assertFalse(evaluate_visible(n, {"carriage": "omron"}))

    def test_when_list_is_or(self):
        n = self._n(visible_when={"extruder": ["a", "b"]})
        self.assertTrue(evaluate_visible(n, {"extruder": "a"}))
        self.assertTrue(evaluate_visible(n, {"extruder": "b"}))
        self.assertFalse(evaluate_visible(n, {"extruder": "c"}))

    def test_when_multi_key_is_and(self):
        n = self._n(visible_when={"carriage": "xol", "hotend": "dragon"})
        self.assertTrue(evaluate_visible(n, {"carriage": "xol", "hotend": "dragon"}))
        self.assertFalse(evaluate_visible(n, {"carriage": "xol", "hotend": "rapido"}))

    def test_unless_hides_when_match(self):
        n = self._n(visible_unless={"hexCowl": True})
        self.assertFalse(evaluate_visible(n, {"hexCowl": True}))
        self.assertTrue(evaluate_visible(n, {"hexCowl": False}))

    def test_when_and_unless_combined(self):
        n = self._n(visible_when={"hotend": "dragon"}, visible_unless={"hexCowl": True})
        self.assertTrue(evaluate_visible(n, {"hotend": "dragon", "hexCowl": False}))
        self.assertFalse(evaluate_visible(n, {"hotend": "dragon", "hexCowl": True}))
        self.assertFalse(evaluate_visible(n, {"hotend": "rapido", "hexCowl": False}))

    def test_hidden_flag_overrides_visible(self):
        n = self._n(hidden=True)
        self.assertFalse(evaluate_visible(n, {}))


@unittest.skipUnless(YAML_AVAILABLE, "PyYAML not installed")
class TestDefaultConfig(unittest.TestCase):
    def test_picks_up_default_true(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            options:
              carriage:
                label: Carriage
                choices:
                  - { id: xol, label: Xol, default: true }
                  - { id: omron, label: Omron }
        """).strip()
        s = parse(text)
        self.assertEqual(default_config(s), {"carriage": "xol"})

    def test_first_choice_when_none_marked_default(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            options:
              carriage:
                label: Carriage
                choices:
                  - { id: a, label: A }
                  - { id: b, label: B }
        """).strip()
        s = parse(text)
        self.assertEqual(default_config(s), {"carriage": "a"})

    def test_bool_default(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            options:
              hexCowl: { label: Hex, type: bool, default: true }
              foo:    { label: Foo, type: bool }
        """).strip()
        s = parse(text)
        self.assertEqual(default_config(s), {"hexCowl": True, "foo": False})


@unittest.skipUnless(YAML_AVAILABLE, "PyYAML not installed")
class TestValidateAgainstTree(unittest.TestCase):
    def test_warns_on_missing_node_path(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            nodes:
              Real/Path: { displayName: A }
              Bogus/Path: { displayName: B }
        """).strip()
        s = parse(text)
        warnings = validate_against_tree(s, ["Real/Path"])
        self.assertTrue(any("Bogus/Path" in w for w in warnings))
        self.assertFalse(any("Real/Path" in w for w in warnings))

    def test_warns_on_zero_match_glob(self):
        text = textwrap.dedent("""
            model: { name: T, glb: f.glb }
            palette: { Main: { color: '#fff' } }
            autoAssign:
              - { match: 'NeverMatches*', category: Main }
              - { match: 'Real*',         category: Main }
        """).strip()
        s = parse(text)
        warnings = validate_against_tree(s, ["RealThing", "RealOther"])
        self.assertTrue(any("NeverMatches" in w for w in warnings))
        self.assertFalse(any("Real*" in w for w in warnings))


if __name__ == "__main__":
    unittest.main()
