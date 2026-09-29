"""Keep pyproject.toml a valid, publishable Flower App."""

import tomllib
from pathlib import Path

from flwr.common.config import validate_config

ROOT = Path(__file__).resolve().parents[1]


def test_pyproject_is_valid_flower_app():
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    ok, errors, warnings = validate_config(config, check_module=True, project_dir=ROOT)
    assert ok, errors
    assert not warnings, warnings
    assert (ROOT / config["project"]["license"]["file"]).is_file()
    assert len(config["project"]["description"]) < 200
