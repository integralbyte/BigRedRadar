"""Build a complete SP27 snapshot before replacing the planner's current data."""

import argparse
import fcntl
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


WEB = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = WEB.parents[1] / "bigredradarinfo"
ROSTER = re.compile(r"(?:WI|SP|SU|FA)\d{2}\.json")


def refresh(source, existing_sp27):
    with tempfile.TemporaryDirectory(prefix="brr-academics-") as directory:
        staging = Path(directory)
        programs = staging / "programs"
        programs.mkdir()
        shutil.copy2(source / "programs/coverage.json", programs)
        for rules in ("reviewed", "requirements"):
            shutil.copytree(source / "programs" / rules, programs / rules)

        for path in source.iterdir():
            if ROSTER.fullmatch(path.name) and path.name != "SP27.json":
                shutil.copy2(path, staging / path.name)
        if existing_sp27:
            shutil.copy2(existing_sp27, staging / "SP27.json")
        else:
            subprocess.run(["python3", str(source / "scripts/update_rosters.py"), "--terms", "SP27",
                            "--output-dir", str(staging)], check=True)

        subprocess.run(["python3", str(source / "scripts/export_json.py"), "--courses-only",
                        "--roster-dir", str(staging), "--output-dir", str(staging)], check=True)
        subprocess.run(["npm", "run", "academics:package", "--", str(staging)], cwd=WEB, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="path to the academic data checkout")
    parser.add_argument("--roster", type=Path, help="rebuild using a saved SP27 snapshot instead of requesting the Cornell API")
    args = parser.parse_args()
    out = WEB / "academic-data"
    out.mkdir(exist_ok=True)
    with (out / ".refresh.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        refresh(args.source.resolve(), args.roster)


if __name__ == "__main__":
    main()
