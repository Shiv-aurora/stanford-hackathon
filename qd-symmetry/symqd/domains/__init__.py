"""Benchmark domains with known symmetry groups.

Each ``make_task`` returns a :class:`symqd.domains.base.Task`.
"""

from symqd.domains.base import Task


def make_task(name: str, **kwargs) -> Task:
    if name == "arm":
        from symqd.domains.arm import make_arm_task

        return make_arm_task(**kwargs)
    if name == "pointmass":
        from symqd.domains.pointmass import make_pointmass_task

        return make_pointmass_task(**kwargs)
    if name == "ant_omni":
        from symqd.domains.ant import make_ant_omni_task

        return make_ant_omni_task(**kwargs)
    raise ValueError(f"unknown domain {name!r}")


__all__ = ["Task", "make_task"]
