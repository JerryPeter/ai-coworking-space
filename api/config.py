"""Configuration loaded from .env via python-dotenv."""
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

MISSION_CONTROL_V2_API_TOKEN: str = os.getenv("MISSION_CONTROL_V2_API_TOKEN", "")
BIND_HOST: str = os.getenv("BIND_HOST", "127.0.0.1")
BIND_PORT: int = int(os.getenv("BIND_PORT", "8742"))
VITE_DEV_PORT: int = 5173

if not MISSION_CONTROL_V2_API_TOKEN or MISSION_CONTROL_V2_API_TOKEN == "change-me":
    raise RuntimeError(
        "MISSION_CONTROL_V2_API_TOKEN is missing or still the placeholder; set it in .env"
    )
if BIND_HOST != "127.0.0.1":
    raise RuntimeError(f"BIND_HOST must be 127.0.0.1 (got {BIND_HOST!r}); this app is local-only")

# Read-only Hermes data root (never written to). Deliberately NOT read from $HERMES_HOME: Hermes
# exports HERMES_HOME=<that profile's dir> into every process it spawns, so a server started from
# inside an agent session would treat one profile as the root and see only "default".
HERMES_HOME: Path = Path(os.getenv("MISSION_CONTROL_V2_HERMES_ROOT", str(Path.home() / ".hermes")))

# Production frontend (Vite build output). Served at / only if it exists.
FRONTEND_DIST: Path = PROJECT_ROOT / "dist"
