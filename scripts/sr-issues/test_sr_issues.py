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
                "SR-003: package release-1 is no stage (1, 2, 3, 4, 5, 6, querschnitt) or milestone (v<major>.<minor>)",
                "SR-004: no topic",
                "SR-abcdef: no spec-id",
            ],
        )


class MilestonePackages(unittest.TestCase):
    MILESTONES = [{"number": 2, "title": "v0.8 Consolidation"}, {"number": 3, "title": "v0.9 Own use and simplicity"}, {"number": 9, "title": "v0.10"}]

    def test_a_package_named_like_a_milestone_is_valid_when_its_topic_has_a_lane(self):
        srs = [sr("SR-167", packages=["v0.9"], topic="Import und Export"), sr("SR-171", packages=["v0.9"], topic="Betrieb und Leistung")]
        self.assertEqual(s.stage_of(srs[0]), "v0.9")
        self.assertEqual(s.validate(srs, STAGES), ["SR-171: topic Betrieb und Leistung has no lane epic (LANE in sr_issues.py)"])
        self.assertEqual(s.LANE["Import und Export"], "lane-data")

    def test_milestone_by_title_prefix(self):
        self.assertEqual(s.milestone_number(self.MILESTONES, "v0.9"), 3)
        self.assertEqual(s.milestone_number(self.MILESTONES, "v0.1"), None)
        self.assertEqual(s.milestone_number(self.MILESTONES, "v0.10"), 9)
        self.assertIsNone(s.milestone_number(self.MILESTONES + [{"number": 7, "title": "v0.9 again"}], "v0.9"))

    def test_no_stage_label_for_a_milestone_package(self):
        self.assertEqual(s.placement("v0.9"), ("Milestone v0.9", []))
        self.assertEqual(s.placement("3"), ("Stage 3", ["stage:3"]))
        self.assertEqual(s.placement("querschnitt"), ("Querschnitt (all stages)", ["querschnitt"]))
        self.assertFalse(s.is_milestone("6"))
        self.assertFalse(s.is_milestone(None))
        self.assertFalse(s.is_milestone("v1"))


class Reopen(unittest.TestCase):
    def test_new_marker_compares_the_content_hash(self):
        old = "head\n\nSpec: `x`\n\n<!-- spec-content:abc -->\n"
        self.assertFalse(s.quoted_changed(old, "other head", "abc"))
        self.assertTrue(s.quoted_changed(old, "head", "def"))

    def test_old_marker_compares_the_quoted_part(self):
        old = "head\n\nSpec: `spec/system-requirements/SR-001.md`\n\n<!-- spec-hash:123 -->\n"
        self.assertFalse(s.quoted_changed(old, "head\n\nSpec: `spec/x.md`\n\n<!-- spec-content:9 -->\n", "9"))
        self.assertTrue(s.quoted_changed(old, "new head\n\nSpec: `spec/x.md`\n", "9"))


class IssueProperty(unittest.TestCase):
    URL = "https://github.com/ThomasBirkmaier/ReqSeq/issues/108"

    def test_writes_the_url_of_the_issue_when_missing_or_different(self):
        self.assertEqual(s.issue_update({"properties": {}}, {"html_url": self.URL}), {"set": {"issue": self.URL}})
        other = {"properties": {"issue": "https://github.com/ThomasBirkmaier/ReqSeq-archive/issues/1"}}
        self.assertEqual(s.issue_update(other, {"html_url": self.URL}), {"set": {"issue": self.URL}})

    def test_writes_nothing_when_the_url_is_there(self):
        self.assertIsNone(s.issue_update({"properties": {"issue": self.URL}}, {"html_url": self.URL}))

    def test_the_property_is_not_quoted_so_writing_it_changes_no_issue_body(self):
        e = {"properties": {"acceptance-criteria": ["a"], "verification-method": "test"}}
        h = s.content_hash(e, "text")
        e["properties"]["issue"] = self.URL
        self.assertEqual(s.content_hash(e, "text"), h)


if __name__ == "__main__":
    unittest.main()
