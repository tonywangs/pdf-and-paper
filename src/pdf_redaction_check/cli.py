from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from . import __version__
from .core import InputError, analyze
from .report import output_directory, prepare, write_report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline PDF region inspection. No detected text is NOT a security certificate.")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="Inspect regions and write local HTML/JSON evidence")
    check.add_argument("pdf", type=Path)
    check.add_argument("--regions", required=True, type=Path)
    check.add_argument("--out", required=True, type=Path, help="New output directory (must not exist)")
    picker = commands.add_parser("prepare", help="Create an offline visual rectangle picker")
    picker.add_argument("pdf", type=Path)
    picker.add_argument("--pages", type=int, nargs="+", help="1-based page numbers; default all")
    picker.add_argument("--out", required=True, type=Path)
    demo = commands.add_parser("demo", help="Run the bundled CC BY public-PDF controlled experiment offline")
    demo.add_argument("--out", type=Path, default=Path("demo-output"))
    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            from .demo import run_demo
            with output_directory(args.out) as directory:
                run_demo(directory)
            code = 0
        else:
            data = args.pdf.read_bytes()
            if args.command == "prepare":
                with output_directory(args.out) as directory:
                    prepare(data, directory, args.pages)
                code = 0
            else:
                spec = json.loads(args.regions.read_text(encoding="utf-8"))
                result = analyze(data, spec, args.pdf.name)
                with output_directory(args.out) as directory:
                    write_report(data, result, directory)
                code = result["exit_code"]
                print(f'{result["outcome"]}; checks_incomplete={result["checks_incomplete"]}')
        print(f"Open {(args.out.absolute() / 'index.html').as_uri()}")
        return code
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
