import pytest

from backend.services.decomposer import (
    DEMO_MISSION,
    WorkerSpec,
    decompose_mission,
    extract_fragments,
)

GENERIC_PROMPT = (
    "Plan the relocation of our regional office to a new city. "
    "Keep the move confidential until the lease is signed. "
    "Budget is limited and staff retention matters most."
)


def _visible_text(spec: WorkerSpec) -> str:
    return " ".join([spec.task, *spec.context.values()])


@pytest.fixture
def demo_workers():
    return decompose_mission(DEMO_MISSION, mission_id="m1")


def test_demo_returns_expected_roles(demo_workers):
    assert 6 <= len(demo_workers) <= 10
    assert [w.role for w in demo_workers] == [
        "literature", "architecture", "optimizer", "data_analysis",
        "systems", "benchmark", "evaluation", "reviewer",
    ]


def test_ids_and_network_identities_are_unique(demo_workers):
    assert len({w.id for w in demo_workers}) == len(demo_workers)
    assert len({w.network_identity for w in demo_workers}) == len(demo_workers)
    assert all(w.id.startswith("m1-") for w in demo_workers)
    assert all(w.network_identity.startswith("node-") for w in demo_workers)


def test_exposure_is_valid_and_partial(demo_workers):
    for w in demo_workers:
        assert 0.0 < w.context_exposure < 1.0


def test_allowed_and_blocked_partition_the_context(demo_workers):
    all_labels = set(extract_fragments(DEMO_MISSION))
    for w in demo_workers:
        assert w.allowed_context
        assert set(w.allowed_context).isdisjoint(w.blocked_context)
        assert set(w.allowed_context) | set(w.blocked_context) == all_labels
        assert set(w.context) == set(w.allowed_context)


def test_no_worker_sees_full_mission(demo_workers):
    for w in demo_workers:
        visible = _visible_text(w)
        assert DEMO_MISSION not in visible
        assert len(visible) < len(DEMO_MISSION) / 2


def test_core_secrets_never_leave_coordinator(demo_workers):
    for w in demo_workers:
        visible = _visible_text(w)
        assert "research_hypothesis" not in w.allowed_context
        assert "Halcyon" not in visible
        assert "uncertainty instead of by top-k" not in visible


def test_tasks_do_not_copy_mission_text(demo_workers):
    sentences = [s for s in extract_fragments(DEMO_MISSION).values() if s]
    for w in demo_workers:
        assert not any(s in w.task for s in sentences)


def test_each_fragment_goes_to_one_category():
    fragments = extract_fragments(DEMO_MISSION)
    non_empty = [f for f in fragments.values() if f]
    assert len(non_empty) == len(fragments)
    joined = " ".join(non_empty)
    assert len(joined) == len(DEMO_MISSION)


def test_is_deterministic():
    assert decompose_mission(DEMO_MISSION) == decompose_mission(DEMO_MISSION)


def test_generic_fallback_fragments_the_prompt():
    workers = decompose_mission(GENERIC_PROMPT)
    assert 6 <= len(workers) <= 10
    for w in workers:
        assert 0.0 <= w.context_exposure < 1.0
        assert GENERIC_PROMPT not in _visible_text(w)
        assert len(w.allowed_context) <= 1
    reviewer = next(w for w in workers if w.role == "reviewer")
    assert reviewer.allowed_context == []
    assert reviewer.context_exposure == 0.0


def test_empty_prompt_rejected():
    with pytest.raises(ValueError):
        decompose_mission("   ")
