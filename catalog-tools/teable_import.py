"""Load the cleaned sites-part-*.csv files into a Teable table through the API.

Usage:
  set TEABLE_TOKEN=teable_xxx          (or --token-file path)
  python teable_import.py --url http://46.224.66.162:3001 --table tblvH3Ocx8iW7zZXohe \
      --data "../data/clean/sites-part-*.csv" [--check]

--check  only compare CSV columns with the table fields and show what would be sent

Resumable: the table's row count says how many CSV rows (in file order) are already in,
so a re-run continues from there. Only for filling a table from these files; it does not
update rows that already exist, so don't point it at a table holding other data.
"""
import argparse
import csv
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request

BATCH = 1_000
RETRIES = 5

csv.field_size_limit(10**9)


class Teable:
    def __init__(self, url, table, token):
        self.base = f"{url.rstrip('/')}/api/table/{table}"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:500]}") from None

    def fields(self):
        return {f["name"]: f["type"] for f in self.call("GET", "/field")}

    def row_count(self):
        return self.call("GET", "/aggregation/row-count")["rowCount"]

    def add(self, records):
        self.call("POST", "/record", {"fieldKeyType": "name", "typecast": True, "records": records})


def read_rows(pattern):
    files = sorted(glob.glob(pattern))
    if not files:
        sys.exit(f"no files match {pattern}")
    rows, header = [], None
    for path in files:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if header and reader.fieldnames != header:
                sys.exit(f"{path}: columns differ from {files[0]}")
            header = reader.fieldnames
            rows.extend(reader)
    return rows, header, files


def to_record(row, fields):
    # blank cells are left out so Teable keeps them empty (never 0)
    return {"fields": {k: float(v) if fields[k] == "number" else v for k, v in row.items() if v != ""}}


def send(api, batch, done):
    for attempt in range(1, RETRIES + 1):
        try:
            api.add(batch)
            return
        except Exception as e:
            print(f"  batch at row {done}: attempt {attempt} failed ({e})", flush=True)
            time.sleep(10 * attempt)
            # a timed-out request may still have been saved; trust the server's count
            count = api.row_count()
            if count == done + len(batch):
                return
            if count != done:
                sys.exit(f"table has {count} rows, expected {done}; stopping to avoid duplicates")
    sys.exit(f"gave up at row {done}; re-run to continue from there")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("TEABLE_URL", "http://46.224.66.162:3001"))
    ap.add_argument("--table", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--token-file")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    token = open(args.token_file).read().strip() if args.token_file else os.environ.get("TEABLE_TOKEN")
    if not token:
        sys.exit("set TEABLE_TOKEN or pass --token-file")
    api = Teable(args.url, args.table, token)

    fields = api.fields()
    rows, header, files = read_rows(args.data)
    missing = [c for c in header if c not in fields]
    if missing:
        sys.exit(f"columns missing in the Teable table: {', '.join(missing)}")

    done = api.row_count()
    print(f"{len(files)} files, {len(rows):,} rows | already in table: {done:,}")
    if done > len(rows):
        sys.exit("table has more rows than the CSV files; wrong table?")
    if args.check:
        print("columns OK | sample record:", json.dumps(to_record(rows[done if done < len(rows) else 0], fields))[:400])
        return

    start = time.time()
    while done < len(rows):
        batch = [to_record(r, fields) for r in rows[done:done + BATCH]]
        send(api, batch, done)
        done += len(batch)
        print(f"  {done:,} / {len(rows):,}  ({time.time() - start:.0f}s)", flush=True)

    final = api.row_count()
    print(f"done | table rows: {final:,} | CSV rows: {len(rows):,} | {'OK' if final == len(rows) else 'MISMATCH'}")


if __name__ == "__main__":
    main()
