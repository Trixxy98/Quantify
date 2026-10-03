import os

import pytest

pytestmark = pytest.mark.contract


@pytest.mark.skipif(not os.environ.get("QUANTIFY_EMAIL"), reason="QUANTIFY_EMAIL not set; needs both APIs running")
def test_node_and_python_agree() -> None:
    from tests.contract.diff import run

    differences = run(os.environ["QUANTIFY_EMAIL"])
    assert differences == [], "\n".join(f"{d.case.path} {d.where}: {d.node!r} != {d.py!r}" for d in differences[:20])
