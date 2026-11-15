"""Skills listing for a profile (read-only).

Definition used everywhere: a "skill" is any directory under <profile>/skills/ that directly
contains a SKILL.md file. Dot-directories (.curator_state etc.) are skipped and symlinks are
not followed. category = the skill dir's parent path relative to skills/ (None if top-level).
name/description come from SKILL.md YAML frontmatter when present, else None.
"""
import os
from pathlib import Path

import yaml

MAX_FRONTMATTER_BYTES = 64 * 1024


def _frontmatter(skill_md: Path) -> dict:
    try:
        with skill_md.open("r", encoding="utf-8", errors="strict") as fh:
            head = fh.read(MAX_FRONTMATTER_BYTES)
    except (OSError, UnicodeDecodeError):
        return {}
    if not head.startswith("---"):
        return {}
    end = head.find("\n---", 3)
    if end == -1:
        return {}
    try:
        data = yaml.safe_load(head[3:end])
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def list_skills(pdir: Path) -> dict:
    root = pdir / "skills"
    if not root.is_dir():
        return {"skills_dir_present": False, "skills": []}
    skills = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        d = Path(dirpath)
        if d == root or "SKILL.md" not in filenames:
            continue
        rel = d.relative_to(root)
        fm = _frontmatter(d / "SKILL.md")
        name, desc = fm.get("name"), fm.get("description")
        skills.append({
            "dir": rel.as_posix(),
            "folder": d.name,
            "category": rel.parent.as_posix() if rel.parent != Path(".") else None,
            "name": name if isinstance(name, str) else None,
            "description": desc if isinstance(desc, str) else None,
        })
    skills.sort(key=lambda s: s["dir"])
    return {"skills_dir_present": True, "skills": skills}
