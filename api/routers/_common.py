"""Shared router helpers."""
from fastapi import Path

# Restrict profile names to a safe charset so path traversal is impossible by construction.
ProfileName = Path(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")

# Canonical UUID shape (any version) for job ids (graphify update jobs): malformed ids get a 422
# from FastAPI's own validation before a route body ever runs; unknown-but-valid ids are a 404.
JobId = Path(..., pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
