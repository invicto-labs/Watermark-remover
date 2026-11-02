"""Consistent SQLite backup. Run on the seller server; output stays private."""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    if args.destination.exists():
        parser.error('Choose a new backup filename; backups are never overwritten.')
    if not args.source.is_file():
        parser.error('Source database does not exist.')
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(f'file:{args.source.resolve().as_posix()}?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(args.destination)) as target:
            source.backup(target)
