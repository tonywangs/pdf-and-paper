import argparse
from pathlib import Path
import sys
from .core import convert


def main():
    parser = argparse.ArgumentParser(description="Make a printable booklet and offline folding preview.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path, help="new output directory (never overwritten)")
    parser.add_argument("--paper", choices=["a4", "letter"], default="a4")
    parser.add_argument("--signature", type=int, default=16, help="maximum pages per signature, 4–64 in multiples of 4")
    parser.add_argument("--margin-mm", type=float, default=8, help="inset on every edge of each half-sheet")
    args = parser.parse_args()
    try:
        result = convert(args.source, args.output, args.paper, args.signature, args.margin_mm)
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(2, f"booklet-fold: {error}\n")
    print(f"{result['source_pages']} source pages + {result['blank_pages']} blanks → {len(result['sheets'])} sheets")
    print(f"Preview: {(args.output / 'index.html').resolve().as_uri()}")
    print("Print booklet.pdf: landscape, actual size, duplex flip on SHORT edge. Disable booklet / multiple-pages mode.")


if __name__ == "__main__":
    main()
