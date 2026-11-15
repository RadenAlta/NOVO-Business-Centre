"""Create reproducible local activity-category model artifacts.

Run from ``services/ml``.  The output directory should remain local because it
contains generated artifacts, not source-controlled operational evidence.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.activity_training import DEFAULT_SEED, train_activity_models


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the synthetic F4 activity-category candidates.")
    parser.add_argument("--model-dir", type=Path, default=Path("models/activity_category_v02"))
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--final-holdout-permitted", action="store_true", help="Run the frozen final hold-out only after documented internal sign-off.")
    parser.add_argument("--internal-review-status", default="INTERNAL_REVIEW_PENDING")
    args = parser.parse_args()
    result = train_activity_models(
        args.model_dir,
        seed=args.seed,
        final_holdout_permitted=args.final_holdout_permitted,
        internal_review_status=args.internal_review_status,
    )
    print(f"Selected {result.report['selected_model']} as {result.report['model_version']}")
    print(f"Final hold-out: {result.report['final_holdout']['status']}")
    print(f"Evaluation report: {args.model_dir / 'activity_category_v02_evaluation.json'}")


if __name__ == "__main__":
    main()
