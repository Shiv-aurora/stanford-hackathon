"""Mission decomposition and context fragmentation.

Turns one confidential mission prompt into a handful of narrow workers.
Each worker receives only the context fragments its task needs; the rest of
the mission is listed as blocked. Decomposition is deterministic so the demo
never depends on an LLM.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

__all__ = ["WorkerSpec", "DEMO_MISSION", "decompose_mission", "extract_fragments"]


class WorkerSpec(BaseModel):
    """Worker definition produced by the decomposer.

    Field names match the shared Worker shape in CONTRACT.md. `context` maps
    each allowed context label to the text the worker may actually see.
    """

    id: str
    role: str
    task: str
    allowed_context: list[str]
    blocked_context: list[str]
    context_exposure: float = Field(ge=0.0, le=1.0)
    network_identity: str
    context: dict[str, str] = Field(default_factory=dict)


DEMO_MISSION = (
    "Confidential: we are developing Project Halcyon, a new sparse "
    "mixture-of-experts language model. "
    "Our hypothesis is that routing tokens by uncertainty instead of by top-k "
    "gating will beat dense models at equal compute. "
    "The architecture is a 2.1B parameter decoder-only transformer with 16 "
    "experts per layer and uncertainty-based routing. "
    "We train with AdamW, a peak learning rate of 3e-4, 2k warmup steps and a "
    "cosine schedule. "
    "The training corpus is 400B tokens, including a licensed proprietary code "
    "dataset from a partner. "
    "We have 256 H100 GPUs for six weeks, and throughput is currently "
    "bottlenecked by expert all-to-all communication. "
    "We will benchmark against Llama-class baselines on MMLU, GSM8K and "
    "HumanEval. "
    "The evaluation plan uses held-out perplexity, routing-entropy metrics and "
    "ablations of the router. "
    "Internal preliminary results show a 7% improvement on GSM8K over the "
    "dense baseline. "
    "Relevant prior work includes Switch Transformer, Mixtral and recent arXiv "
    "papers on expert routing."
)

# Context categories for the AI-research demo, in priority order.
# Each mission sentence goes to the single best-matching category so no
# sentence is shared between compartments.
_CATEGORIES: dict[str, tuple[str, ...]] = {
    "research_hypothesis": ("hypothesis", "confidential", "project", "we are developing", "novel", "goal"),
    "model_architecture": ("architecture", "transformer", "parameter", "layer", "expert", "decoder", "attention", "mixture"),
    "optimizer_config": ("optimizer", "adam", "learning rate", "warmup", "schedule", "gradient", "weight decay"),
    "training_data": ("corpus", "dataset", "data", "tokens", "licensed"),
    "compute_budget": ("gpu", "h100", "a100", "compute", "cluster", "throughput", "bottleneck", "weeks", "communication"),
    "benchmark_targets": ("benchmark", "mmlu", "gsm8k", "humaneval", "baseline", "leaderboard"),
    "evaluation_protocol": ("evaluation", "eval", "perplexity", "metric", "ablation", "held-out"),
    "internal_results": ("result", "preliminary", "internal", "improvement", "%"),
    "published_literature": ("prior work", "paper", "arxiv", "literature", "switch transformer", "mixtral"),
}

# Unmatched text lands here. No worker is ever granted this category, so
# anything the classifier cannot place stays with the trusted coordinator.
_FALLBACK_CATEGORY = "research_hypothesis"

# role, narrow task, allowed context categories
_DEMO_WORKERS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("literature", "Survey the listed prior work and summarise the key design choices and open problems.", ("published_literature",)),
    ("architecture", "Review the model architecture for design risks and suggest two concrete improvements.", ("model_architecture",)),
    ("optimizer", "Assess the optimizer and learning-rate schedule for stability risks at scale.", ("optimizer_config",)),
    ("data_analysis", "Audit the training data description for quality, licensing and contamination risks.", ("training_data",)),
    ("systems", "Propose ways to raise training throughput within the stated compute budget.", ("compute_budget", "model_architecture")),
    ("benchmark", "Recommend a benchmark suite and fair baselines for the stated targets.", ("benchmark_targets",)),
    ("evaluation", "Design the evaluation and ablation plan, including metrics and controls.", ("evaluation_protocol", "benchmark_targets")),
    ("reviewer", "Stress-test the reported results for statistical and methodological weaknesses.", ("internal_results", "evaluation_protocol")),
)

_AI_RESEARCH_KEYWORDS = (
    "model", "training", "transformer", "llm", "neural", "optimizer",
    "benchmark", "dataset", "gpu", "architecture", "fine-tun", "inference",
)

# role, narrow task — used for prompts that are not AI research
_GENERIC_WORKERS: tuple[tuple[str, str], ...] = (
    ("background", "Summarise the background and prior approaches relevant to your excerpt."),
    ("requirements", "Extract concrete requirements and constraints from your excerpt."),
    ("analysis", "Analyse your excerpt and identify the main technical questions."),
    ("risks", "List risks and failure modes implied by your excerpt."),
    ("options", "Propose two or three candidate approaches for your excerpt."),
    ("reviewer", "Review the other workers' outputs for gaps and inconsistencies."),
)
_GENERIC_SEGMENTS = 3

_NOT_SPECIFIED = "(not specified in mission)"


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _classify(sentence: str) -> str:
    lowered = sentence.lower()
    best, best_hits = _FALLBACK_CATEGORY, 0
    for category, keywords in _CATEGORIES.items():
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits > best_hits:
            best, best_hits = category, hits
    return best


def extract_fragments(prompt: str) -> dict[str, str]:
    """Split a mission into context fragments, one per category."""
    buckets: dict[str, list[str]] = {c: [] for c in _CATEGORIES}
    for sentence in _sentences(prompt):
        buckets[_classify(sentence)].append(sentence)
    return {c: " ".join(s) for c, s in buckets.items()}


def _is_ai_research(prompt: str) -> bool:
    lowered = prompt.lower()
    return sum(1 for kw in _AI_RESEARCH_KEYWORDS if kw in lowered) >= 2


def _worker_id(mission_id: str | None, index: int, role: str) -> str:
    prefix = f"{mission_id}-" if mission_id else ""
    return f"{prefix}w{index:02d}-{role}"


def _node(index: int) -> str:
    return f"node-{index:02d}"


def _decompose_ai_research(prompt: str, mission_id: str | None) -> list[WorkerSpec]:
    fragments = extract_fragments(prompt)
    categories = list(_CATEGORIES)
    specs = []
    for i, (role, task, allowed) in enumerate(_DEMO_WORKERS, start=1):
        specs.append(
            WorkerSpec(
                id=_worker_id(mission_id, i, role),
                role=role,
                task=task,
                allowed_context=list(allowed),
                blocked_context=[c for c in categories if c not in allowed],
                context_exposure=round(len(allowed) / len(categories), 2),
                network_identity=_node(i),
                context={c: fragments[c] or _NOT_SPECIFIED for c in allowed},
            )
        )
    return specs


def _decompose_generic(prompt: str, mission_id: str | None) -> list[WorkerSpec]:
    words = prompt.split()
    size = -(-len(words) // _GENERIC_SEGMENTS)  # ceil division
    segments = {
        f"mission_segment_{n + 1}": " ".join(words[n * size:(n + 1) * size])
        for n in range(_GENERIC_SEGMENTS)
    }
    labels = list(segments)
    specs = []
    for i, (role, task) in enumerate(_GENERIC_WORKERS, start=1):
        # The reviewer only sees other workers' outputs, never raw mission text.
        allowed = [] if role == "reviewer" else [labels[(i - 1) % len(labels)]]
        specs.append(
            WorkerSpec(
                id=_worker_id(mission_id, i, role),
                role=role,
                task=task,
                allowed_context=allowed,
                blocked_context=[l for l in labels if l not in allowed],
                context_exposure=round(len(allowed) / len(labels), 2),
                network_identity=_node(i),
                context={l: segments[l] or _NOT_SPECIFIED for l in allowed},
            )
        )
    return specs


def decompose_mission(prompt: str, mission_id: str | None = None) -> list[WorkerSpec]:
    """Break a mission into narrow, compartmentalised worker specs.

    AI-research prompts get the 8-worker demo decomposition; anything else gets
    a small generic split. No worker receives the complete mission.
    """
    if not prompt or not prompt.strip():
        raise ValueError("mission prompt must not be empty")
    if _is_ai_research(prompt):
        return _decompose_ai_research(prompt, mission_id)
    return _decompose_generic(prompt, mission_id)
