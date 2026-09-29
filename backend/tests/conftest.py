import os
import sys

os.environ.setdefault("CONSTELLATION_FALLBACK", "1")
os.environ.setdefault("CONSTELLATION_WORKER_DELAY", "0")
# Tests never call the real model, even when backend/.env has a key.
os.environ["FLWR_MODEL_API_KEY"] = ""
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
