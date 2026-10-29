# Example tests of the guide (../README.md): each test names the requirement it verifies, and the
# one `reqseq evidence enrich-junit` call of the pipeline does the rest. The requirements are in
# ../workspace. ReqSeq's own trace-check reads every test file of this repository: never write
# `[SR-` + three digits + `/AK` + a number + `]` here, it would be read as a test of ReqSeq.
import pytest


def login(password):
    return password == "correct horse"


# Names SR-a1c0de by a property: pytest writes it as <property name="logreq:element">.
def test_accepts_a_valid_password(record_property):
    record_property("logreq:element", "SR-a1c0de")
    assert login("correct horse")


# Names SR-b2c0de by a parameter ID: the test case is called test_locks_the_account[SR-b2c0de].
@pytest.mark.parametrize("passwords", [["a", "b", "c"]], ids=["SR-b2c0de"])
def test_locks_the_account(passwords):
    assert [login(p) for p in passwords] == [False, False, False]


# Names no requirement: ReqSeq passes over it.
def test_shows_the_login_form():
    assert not login("")
