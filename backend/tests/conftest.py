import os
import sys

# API tests exercise the real subsystems (decomposer, security, coordinator).
# Worker execution uses the local runtime here for speed; the Flower path is
# covered by tests/test_flower_runtime.py.
os.environ.setdefault("CONSTELLATION_RUNTIME", "local")
os.environ.setdefault("CONSTELLATION_WORKER_DELAY", "0")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
