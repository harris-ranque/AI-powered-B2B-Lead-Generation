"""Shared QA gate thresholds and retry policy (single source of truth)."""

# Tier approval thresholds (batch gate in main.py must match)
APPROVAL_THRESHOLDS = {
    "A": 0.55,
    "B": 0.45,
}

# Scores in [RETRY_FLOOR, threshold) → retry email generation with QA feedback
RETRY_FLOOR = 0.30

# Below this → reject immediately without retry
INSTANT_REJECT_FLOOR = 0.25

# Hyphens are penalized, not hard-vetoed (sender fabrication still vetoes)
HYPHEN_PENALTY = 0.15

# Hard veto clamp for critical failures (e.g. sender fabrication)
VETO_SCORE = 0.34

# 1 initial attempt + MAX_QA_RETRIES retries
MAX_QA_RETRIES = 4
