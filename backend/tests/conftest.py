import os
import sys

os.environ.setdefault("CONSTELLATION_FALLBACK", "1")
os.environ.setdefault("CONSTELLATION_WORKER_DELAY", "0")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
