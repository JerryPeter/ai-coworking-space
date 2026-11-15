"""Shared router helpers."""
from fastapi import Path

# Restrict profile names to a safe charset so path traversal is impossible by construction.
ProfileName = Path(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")
