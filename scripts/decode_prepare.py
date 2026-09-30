#!/usr/bin/env python3
from pathlib import Path
import base64, re
root = Path(__file__).resolve().parent
raw = re.sub(r"\s+", "", (root / "prepare_docker_frontend.py.b64").read_text(encoding="ascii"))
(root / "prepare_docker_frontend.py").write_bytes(base64.b64decode(raw))
print("decoded prepare_docker_frontend.py", (root / "prepare_docker_frontend.py").stat().st_size)
