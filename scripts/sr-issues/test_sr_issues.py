#!/usr/bin/env python3
# Tests of the pure parts of sr_issues.py: `python3 -m unittest discover -s scripts/sr-issues` (CI, static job).
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sr_issues as s  # noqa: E402

STAGES = ["1", "2", "3", "4", "5", "6", "querschnitt"]


def sr(identifier="SR-001", packages=("Stufe-3",), topic="Varianten"):
    return {
        "identifier": identifier,
        "shortId": "SR-abcdef",
        "properties": {"topic": topic} if topic else {},
        "relations": [{"kind": "packages", "direction": "out", "identifier": p} for p in packages]
        + [{"kind": "derives-from", "direction": "out", "identifier": "N-001"}],
    }


class Labels(unittest.TestCase):
    def test_keeps_every_label_the_script_does_not_manage(self):
        existing = ["sr", "stage:2", "thema:alt", "blocked", "agent:working", "needs-human", "querschnitt"]
        self.assertEqual(
            s.merged_labels(existing, ["sr", "thema:varianten", "stage:3"]),
            ["sr", "thema:varianten", "stage:3", "blocked", "agent:working", "needs-human"],
        )

    def test_adds_spec_geaendert_once_and_keeps_the_others(self):
        self.assertEqual(
            s.merged_labels(["sr", "blocked", "spec-geändert"], ["sr", "stage:1"], ["spec-geändert"]),
            ["sr", "stage:1", "blocked", "spec-geändert"],
        )
        self.assertEqual(s.merged_labels(["agent:working"], ["sr"], ["spec-geändert"]), ["sr", "agent:working", "spec-geändert"])

    def test_managed_labels(self):
        for label in ["sr", "querschnitt", "stage:0", "thema:varianten"]:
            self.assertTrue(s.is_managed(label), label)
        for label in ["blocked", "agent:working", "spec-geändert", "needs-human", "srx", "stages"]:
            self.assertFalse(s.is_managed(label), label)


class Validation(unittest.TestCase):
    def test_stage_from_the_one_package(self):
        self.assertEqual(s.stage_of(sr(packages=["Stufe-3"])), "3")
        self.assertEqual(s.stage_of(sr(packages=["Querschnitt"])), "querschnitt")
        self.assertIsNone(s.stage_of(sr(packages=[])))
        self.assertIsNone(s.stage_of(sr(packages=["Stufe-3", "Stufe-4"])))

    def test_reports_every_problem_before_anything_is_written(self):
        srs = [sr(), sr("SR-002", packages=[]), sr("SR-003", packages=["Release-1"]), sr("SR-004", topic=None), sr("")]
        self.assertEqual(
            s.validate(srs, STAGES),
            [
                "SR-002: needs exactly one stage package",
                "SR-003: package release-1 is no stage (1, 2, 3, 4, 5, 6, querschnitt)",
                "SR-004: no topic",
                "SR-abcdef: no spec-id",
            ],
        )


class Reopen(unittest.TestCase):
    def test_new_marker_compares_the_content_hash(self):
        old = "head\n\nSpec: `x`\n\n<!-- spec-content:abc -->\n"
        self.assertFalse(s.quoted_changed(old, "other head", "abc"))
        self.assertTrue(s.quoted_changed(old, "head", "def"))

    def test_old_marker_compares_the_quoted_part(self):
        old = "head\n\nSpec: `spec/system-requirements/SR-001.md`\n\n<!-- spec-hash:123 -->\n"
        self.assertFalse(s.quoted_changed(old, "head\n\nSpec: `spec/x.md`\n\n<!-- spec-content:9 -->\n", "9"))
        self.assertTrue(s.quoted_changed(old, "new head\n\nSpec: `spec/x.md`\n", "9"))


if __name__ == "__main__":
    unittest.main()
