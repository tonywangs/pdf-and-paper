"""Build first; install the wheel and all runtime dependencies into a fresh directory."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    wheel = Path("dist/pdf_redaction_check-0.1.0-py3-none-any.whl").resolve()
    if not wheel.is_file():
        raise SystemExit("Run python -m build first.")
    with tempfile.TemporaryDirectory(prefix="pdf-check-install-") as temp:
        target = Path(temp) / "packages"
        subprocess.run([sys.executable, "-m", "pip", "install", "--target", str(target), str(wheel)], check=True)
        # -S disables every site-packages directory, including the editable checkout.
        script = '''import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import pdf_redaction_check
from pdf_redaction_check.cli import main
assert Path(pdf_redaction_check.__file__).is_relative_to(Path(sys.argv[1]))
assert main(["demo", "--out", sys.argv[2]]) == 0
print("Isolated installed-wheel demo passed.")
'''
        subprocess.run([sys.executable, "-S", "-c", script, str(target), str(Path(temp) / "demo")],
                       cwd=temp, check=True, env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"})


if __name__ == "__main__":
    main()
