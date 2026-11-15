"""Dev helper: GET a Mission Control V2 endpoint with the token from .env and pretty-print it.

Usage: .venv/bin/python tools/apiget.py /api/office/state [--trim N]
--trim N keeps only the first N items of every list (handy for eyeballing response shapes).
The token is read from .env and never printed.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def trim(v, n):
    if isinstance(v, list):
        return [trim(x, n) for x in v[:n]] + ([f"... {len(v) - n} more"] if len(v) > n else [])
    if isinstance(v, dict):
        return {k: trim(x, n) for k, x in v.items()}
    if isinstance(v, str) and len(v) > 160:
        return v[:160] + f"... ({len(v)} chars)"
    return v


def main() -> None:
    path = sys.argv[1]
    n = int(sys.argv[sys.argv.index("--trim") + 1]) if "--trim" in sys.argv else None
    e = env()
    url = f"http://{e.get('BIND_HOST', '127.0.0.1')}:{e.get('BIND_PORT', '8742')}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {e['MISSION_CONTROL_V2_API_TOKEN']}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.load(r)
    print(json.dumps(trim(data, n) if n else data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
