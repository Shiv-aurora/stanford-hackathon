"""Mission decomposition and context fragmentation.

Turns one confidential mission prompt into a handful of narrow workers.
Each worker receives only the context fragments its task needs; the rest of
the mission is listed as blocked. Decomposition is deterministic so the demo
never depends on an LLM.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

__all__ = [
    "WorkerSpec",
    "DEMO_MISSION",
    "DEFENSE_DEMO_MISSION",
    "BIOTECH_DEMO_MISSION",
    "DOMAINS",
    "decompose_mission",
    "extract_fragments",
    "route_question",
]


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

# --- Defense lab -------------------------------------------------------------

DEFENSE_DEMO_MISSION = (
    "Confidential: Project Bastion is our program to protect a forward operating "
    "base from small drone attacks. "
    "The threat assessment expects adversary swarms of up to 40 low-cost drones "
    "approaching at night. "
    "The sensor suite combines two S-band radars, passive RF detection and EO/IR "
    "cameras. "
    "Effectors include RF jammers, interceptor drones and a 10 kW laser prototype. "
    "The base perimeter is 3.2 km with two hills that mask low-altitude "
    "approaches from the east. "
    "Rules of engagement require human authorization before any kinetic "
    "engagement near the civilian airfield. "
    "Procurement is capped at 18 million dollars over two years, including "
    "maintenance and spares. "
    "Field trials last month reached a 91% detection rate but missed drones "
    "flying below 30 meters. "
    "Intelligence reporting from allied liaison sources suggests the adversary is "
    "fielding fiber-optic guided drones."
)

_DEFENSE_CATEGORIES: dict[str, tuple[str, ...]] = {
    "mission_objective": ("confidential", "project", "program", "objective"),
    "threat_assessment": ("threat", "adversary", "swarm", "drone", "attack profile"),
    "sensor_suite": ("sensor", "radar", "rf detection", "eo/ir", "camera"),
    "effectors": ("effector", "jammer", "interceptor", "laser", "kinetic"),
    "site_layout": ("base", "perimeter", "hill", "terrain", "approaches"),
    "rules_of_engagement": ("rules of engagement", "authorization", "engagement", "civilian", "legal"),
    "logistics_budget": ("procurement", "budget", "million", "maintenance", "spares"),
    "test_results": ("trial", "detection rate", "%", "missed"),
    "intel_sources": ("intelligence", "reporting", "liaison", "sources"),
}

# The objective and intelligence sources never leave the coordinator.
_DEFENSE_WORKERS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("threat_analyst", "Characterise the expected drone threat and rank the most likely attack profiles.", ("threat_assessment",)),
    ("sensor_engineer", "Assess sensor coverage gaps and propose placement or tuning changes.", ("sensor_suite",)),
    ("effects_planner", "Compare the listed effectors on cost per engagement and collateral risk.", ("effectors",)),
    ("site_planner", "Map terrain-driven blind spots and where sensors should be sited.", ("site_layout", "sensor_suite")),
    ("legal_review", "Check the engagement constraints for legal and safety conflicts.", ("rules_of_engagement",)),
    ("logistics", "Estimate lifecycle cost and sustainment risk within the stated budget.", ("logistics_budget",)),
    ("test_evaluator", "Explain the trial shortfalls and design the next test campaign.", ("test_results", "sensor_suite")),
    ("red_team", "Red-team the defence: how would an adversary defeat these effectors?", ("threat_assessment", "effectors")),
)

# --- Biotech lab ------------------------------------------------------------

BIOTECH_DEMO_MISSION = (
    "Confidential: Project Meridian is our program to develop an oral KRAS G12C "
    "inhibitor for lung cancer. "
    "The target protein is mutant KRAS and we bind a cryptic pocket near switch II. "
    "Our lead series has 14 candidate molecules derived from a covalent "
    "acrylamide scaffold. "
    "Biochemical assays show an IC50 of 12 nM with 40-fold selectivity over "
    "wild-type. "
    "In mouse xenograft studies tumours shrank by 60% but two animals showed "
    "liver toxicity. "
    "Manufacturing currently yields 35% over nine steps and the process has not "
    "been scaled. "
    "We plan an IND filing with the FDA in Q3 next year. "
    "Our patent application covers the scaffold but a competitor's prior art may "
    "overlap. "
    "Relevant published literature includes sotorasib and adagrasib clinical papers."
)

_BIOTECH_CATEGORIES: dict[str, tuple[str, ...]] = {
    "program_goal": ("confidential", "project", "program", "develop"),
    "target_biology": ("target", "protein", "mutant", "bind", "pocket"),
    "compound_series": ("lead series", "candidate", "molecule", "scaffold", "covalent"),
    "assay_data": ("assay", "ic50", "nm", "selectivity"),
    "preclinical_results": ("mouse", "xenograft", "animal", "toxicity", "in vivo"),
    "manufacturing": ("manufacturing", "yield", "steps", "process", "scaled"),
    "regulatory_plan": ("ind filing", "fda", "regulatory", "filing"),
    "patent_ip": ("patent", "prior art", "competitor", "freedom-to-operate"),
    "published_literature": ("published", "literature", "papers", "clinical"),
}

# The program goal never leaves the coordinator.
_BIOTECH_WORKERS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("literature", "Summarise what the published inhibitors teach about efficacy and resistance.", ("published_literature",)),
    ("target_biologist", "Assess the binding hypothesis and the risks of targeting this pocket.", ("target_biology",)),
    ("medicinal_chemist", "Propose modifications to improve the lead series' potency and stability.", ("compound_series", "target_biology")),
    ("assay_analyst", "Check the assay results for artefacts and suggest confirmatory assays.", ("assay_data",)),
    ("toxicologist", "Interpret the in vivo findings and flag safety signals to investigate.", ("preclinical_results",)),
    ("process_engineer", "Identify the route changes most likely to improve yield at scale.", ("manufacturing",)),
    ("regulatory", "List what the planned filing still needs from the safety package.", ("regulatory_plan", "preclinical_results")),
    ("ip_counsel", "Assess freedom-to-operate risk for the lead series.", ("patent_ip", "compound_series")),
)

# domain -> (categories in priority order, fallback category, workers).
# The fallback category is never granted to a worker, so anything the
# classifier cannot place stays with the trusted coordinator.
DOMAINS: dict[str, tuple[dict[str, tuple[str, ...]], str, tuple[tuple[str, str, tuple[str, ...]], ...]]] = {
    "ai": (_CATEGORIES, _FALLBACK_CATEGORY, _DEMO_WORKERS),
    "defense": (_DEFENSE_CATEGORIES, "mission_objective", _DEFENSE_WORKERS),
    "biotech": (_BIOTECH_CATEGORIES, "program_goal", _BIOTECH_WORKERS),
}

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


def _classify(sentence: str, domain: str = "ai") -> str:
    categories, fallback, _ = DOMAINS[domain]
    lowered = sentence.lower()
    best, best_hits = fallback, 0
    for category, keywords in categories.items():
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits > best_hits:
            best, best_hits = category, hits
    return best


def extract_fragments(prompt: str, domain: str = "ai") -> dict[str, str]:
    """Split a mission into context fragments, one per category of `domain`."""
    buckets: dict[str, list[str]] = {c: [] for c in DOMAINS[domain][0]}
    for sentence in _sentences(prompt):
        buckets[_classify(sentence, domain)].append(sentence)
    return {c: " ".join(s) for c, s in buckets.items()}


def route_question(question: str, domain: str | None = None) -> set[str]:
    """Context categories a follow-up question is about (need-to-know routing).

    Uses the decomposition keywords, but unlike a mission sentence a question
    may touch several compartments, so every category with a keyword hit
    counts. The domain's fallback category is never returned: it is never
    granted to a worker, so a question that only matches it has no
    compartment to go to.
    """
    domain = domain if domain in DOMAINS else "ai"
    categories, fallback, _ = DOMAINS[domain]
    lowered = question.lower()
    found = {c for c, keywords in categories.items() if any(kw in lowered for kw in keywords)}
    return found - {fallback}


def _is_ai_research(prompt: str) -> bool:
    lowered = prompt.lower()
    return sum(1 for kw in _AI_RESEARCH_KEYWORDS if kw in lowered) >= 2


def _worker_id(mission_id: str | None, index: int, role: str) -> str:
    prefix = f"{mission_id}-" if mission_id else ""
    return f"{prefix}w{index:02d}-{role}"


def _node(index: int) -> str:
    return f"node-{index:02d}"


def _decompose_domain(prompt: str, mission_id: str | None, domain: str) -> list[WorkerSpec]:
    fragments = extract_fragments(prompt, domain)
    categories = list(DOMAINS[domain][0])
    specs = []
    for i, (role, task, allowed) in enumerate(DOMAINS[domain][2], start=1):
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


def decompose_mission(
    prompt: str, mission_id: str | None = None, domain: str | None = None
) -> list[WorkerSpec]:
    """Break a mission into narrow, compartmentalised worker specs.

    `domain` is the lab the mission belongs to. Defense and biotech missions
    always get their lab's 8-worker decomposition. AI-lab (or unspecified)
    prompts get the AI-research decomposition when they look like AI
    research, and a small generic split otherwise. No worker receives the
    complete mission.
    """
    if not prompt or not prompt.strip():
        raise ValueError("mission prompt must not be empty")
    if domain in ("defense", "biotech"):
        return _decompose_domain(prompt, mission_id, domain)
    if _is_ai_research(prompt):
        return _decompose_domain(prompt, mission_id, "ai")
    return _decompose_generic(prompt, mission_id)
