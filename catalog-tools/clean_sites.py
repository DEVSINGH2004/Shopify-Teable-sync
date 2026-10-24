"""Clean the GetReach vendor export (+ own-vendor comparison) into Teable-ready files.

Usage:
  python clean_sites.py --master "../data/GetReach Vendors *.csv" \
      --common "<Common sites.csv>" --new "<New from GetReach.csv>" --out ../data/clean

--master  the 19 "GetReach Vendors NN" part files (glob); one row per website, the base record
--common  optional: "Common sites" tab, adds own-vendor price, writing price, own DR/DA, cheaper_at
--new     optional: "New from GetReach" tab, marks those sites as quality_pick

Never modifies the input files. Writes:
  sites-part-N.csv       cleaned rows, max 20,000 per file
  rejected.csv           rows that could not be used, with the reason
  categories-review.csv  category values outside the 24-tag taxonomy
  report.md / report.json
"""
import argparse
import collections
import csv
import glob
import json
import os
import re
from datetime import date

CHUNK = 20_000
PRICE_FLOOR_USD = 5.0
DR_CONFLICT = 20

TAXONOMY = [
    "adult", "automotive", "business", "crypto", "education-career", "entertainment-culture",
    "family-parenting", "fashion-beauty", "finance", "food-drink", "gambling-betting", "gaming",
    "general-interest", "health-wellness", "home-garden", "law-politics", "lifestyle",
    "marketing-seo", "news-media", "pets-animals", "real-estate", "sports", "technology", "travel",
]
SPECIAL_TOPICS = ["adult", "cbd", "crypto", "dating", "finance", "gambling", "health"]
WARNINGS = {
    "no organic traffic": "no-organic-traffic",
    "high spam score": "high-spam",
    "traffic high but very few keywords": "high-traffic-few-keywords",
}
SPONSORED = {"no": "no", "yes": "yes", "mixed / optional": "mixed"}
CHEAPER_AT = {"my vendor": "my-vendor", "getreach": "getreach", "check my price": "check-price",
              "no price": "no-price"}
LANGUAGE_FIX = {"slovene": "Slovenian"}

COLUMNS = [
    "domain", "source", "quality_pick", "status", "getreach_rank",
    "dr", "da", "authority_score", "dr_own", "da_own",
    "traffic", "keywords", "ref_domains", "spam",
    "language", "languages_all", "categories", "link_type", "sponsored", "warnings",
    "price_eur", "price_usd",
    "crypto_price_eur", "finance_price_eur", "gambling_price_eur", "cbd_price_eur",
    "health_price_eur", "dating_price_eur", "adult_price_eur", "special_topics_accepted",
    "own_price_usd", "own_writing_price_usd", "cheaper_at", "own_source_ref",
    "location", "content_topics", "tags", "site_url",
    "offer_variants", "all_offers", "cheapest_offer_id", "publisher_id",
    "review_flags",
    "shopify_product_id", "synced_hash", "sync_error", "last_synced",
]


def clean_domain(value):
    d = value.strip().lower()
    d = re.sub(r"^[a-z]+://", "", d)
    d = d.split("/")[0].split("?")[0].split("#")[0]
    d = re.sub(r"^www\.", "", d).strip(".")
    if not d or " " in d or "." not in d or not re.fullmatch(r"[a-z0-9.\-]+", d):
        return None
    return d


def num(value):
    s = re.sub(r"[^0-9.\-]", "", value or "")
    if s in ("", "-", ".", "-."):
        return None
    n = float(s)
    return int(n) if n.is_integer() else round(n, 2)


def fmt(n):
    return "" if n is None else str(n)


def split_list(value, sep=","):
    return [p.strip() for p in (value or "").split(sep) if p.strip()]


def map_language(raw):
    langs = [LANGUAGE_FIX.get(l.lower(), l[:1].upper() + l[1:]) for l in split_list(raw)]
    return (langs[0] if langs else ""), langs


def map_warnings(raw):
    return [WARNINGS.get(p.lower(), "other:" + p.lower()) for p in split_list(raw, ";")]


def load_by_domain(path):
    with open(path, newline="", encoding="utf-8") as f:
        return {clean_domain(r["Website"]): r for r in csv.DictReader(f) if clean_domain(r["Website"])}


def convert(r, own, unknown_categories):
    flags = []
    cats = [c.lower() for c in split_list(r["Categories"])]
    for c in cats:
        if c not in TAXONOMY:
            unknown_categories[c] += 1
    cats = [t for t in TAXONOMY if t in cats]
    lang, langs = map_language(r["Language"])
    price_usd = num(r["Price $ (USD)"])
    dr = num(r["DR"])
    row = {c: "" for c in COLUMNS}
    row.update(
        status="Draft", getreach_rank=fmt(num(r["#"])),
        dr=fmt(dr), da=fmt(num(r["DA"])), authority_score=fmt(num(r["AS"])),
        traffic=fmt(num(r["Traffic / month"])), keywords=fmt(num(r["Keywords"])),
        ref_domains=fmt(num(r["Ref. domains"])), spam=fmt(num(r["Spam score"])),
        language=lang, languages_all=", ".join(langs) if len(langs) > 1 else "",
        categories=", ".join(cats), link_type=r["Link"].strip().lower(),
        sponsored=SPONSORED.get(r["Sponsored tag?"].strip().lower(), r["Sponsored tag?"].strip()),
        warnings=", ".join(map_warnings(r["Warning"])),
        price_eur=fmt(num(r["Price € (EUR)"])), price_usd=fmt(price_usd),
        crypto_price_eur=fmt(num(r["Crypto article €"])),
        finance_price_eur=fmt(num(r["Finance article €"])),
        gambling_price_eur=fmt(num(r["Gambling article €"])),
        cbd_price_eur=fmt(num(r["CBD article €"])),
        health_price_eur=fmt(num(r["Health article €"])),
        dating_price_eur=fmt(num(r["Dating article €"])),
        adult_price_eur=fmt(num(r["Adult article €"])),
        special_topics_accepted=", ".join(t for t in SPECIAL_TOPICS
                                          if t in [s.lower() for s in split_list(r["Special topics accepted"])]),
        location=r["Location"].strip(), content_topics=r["Content topics"].strip(), tags=r["Tags"].strip(),
        site_url=r["Link to site"].strip(), offer_variants=fmt(num(r["Offer variants"])),
        all_offers=r["All offers"].strip(), cheapest_offer_id=r["Cheapest offer ID"].strip(),
        publisher_id=r["GetReach publisher ID"].strip(),
    )
    if own:
        own_price = num(own["Your vendor price $"])
        dr_own = num(own["DR (your sheet)"])
        row.update(
            dr_own=fmt(dr_own), da_own=fmt(num(own["DA (your sheet)"])),
            own_price_usd=fmt(own_price), own_writing_price_usd=fmt(num(own["Your writing price $"])),
            cheaper_at=CHEAPER_AT.get(own["Cheaper at"].strip().lower(),
                                      "same" if own["Cheaper at"].lower().startswith("same") else own["Cheaper at"].strip()),
            own_source_ref=own["Your source sheet"].strip(),
        )
        if own_price is None:
            flags.append("own-price-missing")
        elif own_price < PRICE_FLOOR_USD:
            flags.append("own-price-below-floor")
        if dr is not None and dr_own is not None and abs(dr - dr_own) > DR_CONFLICT:
            flags.append("dr-conflict")
    if price_usd is None:
        flags.append("price-missing")
    elif price_usd < PRICE_FLOOR_USD:
        flags.append("price-below-floor")
    if dr is None:
        flags.append("dr-missing")
    if not row["traffic"]:
        flags.append("traffic-missing")
    if not row["spam"]:
        flags.append("spam-missing")
    if not cats:
        flags.append("category-missing")
    if not lang:
        flags.append("language-missing")
    row["review_flags"] = ", ".join(flags)
    return row, flags


def write_csv(path, fieldnames, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True, help="glob for the GetReach Vendors part files")
    ap.add_argument("--common")
    ap.add_argument("--new")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for old in glob.glob(os.path.join(args.out, "sites-part-*.csv")):
        os.remove(old)

    master_files = sorted(glob.glob(args.master))
    if not master_files:
        raise SystemExit(f"no files match {args.master}")
    common = load_by_domain(args.common) if args.common else {}
    picks = set(load_by_domain(args.new)) if args.new else set()

    rows, rejected, seen = [], [], {}
    unknown_categories, flag_counts, per_file = collections.Counter(), collections.Counter(), {}
    for path in master_files:
        name = os.path.basename(path)
        per_file[name] = 0
        with open(path, newline="", encoding="utf-8") as f:
            for line_no, r in enumerate(csv.DictReader(f), start=2):
                per_file[name] += 1
                domain = clean_domain(r.get("Website", ""))
                if not domain:
                    rejected.append({"file": name, "line": line_no, "website": r.get("Website", ""),
                                     "reason": "no usable domain"})
                    continue
                if domain in seen:
                    rejected.append({"file": name, "line": line_no, "website": r.get("Website", ""),
                                     "reason": f"duplicate of {seen[domain]}"})
                    continue
                seen[domain] = f"{name} line {line_no}"
                row, flags = convert(r, common.get(domain), unknown_categories)
                row["domain"] = domain
                row["source"] = "both" if domain in common else "getreach-only"
                row["quality_pick"] = "yes" if domain in picks else ""
                rows.append(row)
                flag_counts.update(flags)

    parts = []
    for i in range(0, len(rows), CHUNK):
        name = f"sites-part-{i // CHUNK + 1:02d}.csv"
        write_csv(os.path.join(args.out, name), COLUMNS, rows[i:i + CHUNK])
        parts.append((name, len(rows[i:i + CHUNK])))
    write_csv(os.path.join(args.out, "rejected.csv"), ["file", "line", "website", "reason"], rejected)
    write_csv(os.path.join(args.out, "categories-review.csv"), ["category", "rows"],
              [{"category": k, "rows": v} for k, v in unknown_categories.most_common()])

    source_counts = collections.Counter(r["source"] for r in rows)
    missing = {c: sum(1 for r in rows if not r[c]) for c in
               ("dr", "traffic", "spam", "language", "categories", "price_usd")}
    report = {
        "date": date.today().isoformat(),
        "master_files": per_file,
        "rows_in": sum(per_file.values()),
        "clean_rows": len(rows),
        "rejected": len(rejected),
        "source": dict(source_counts),
        "quality_pick": sum(1 for r in rows if r["quality_pick"]),
        "common_sites_matched": sum(1 for d in common if d in seen),
        "common_sites_not_in_master": sum(1 for d in common if d not in seen),
        "flags": dict(flag_counts),
        "missing_values": missing,
        "unknown_categories": len(unknown_categories),
        "output_files": dict(parts),
    }
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    lines = [
        f"# Cleaning report — {report['date']}", "",
        f"**Rows read:** {report['rows_in']:,} from {len(per_file)} files · "
        f"**Clean rows:** {len(rows):,} · **Rejected:** {len(rejected):,} (see `rejected.csv`)", "",
        "| `source` | Sites |", "|---|---|",
        *[f"| {k} | {v:,} |" for k, v in source_counts.most_common()], "",
        f"- `quality_pick = yes` (the pre-filtered \"New from GetReach\" sites): {report['quality_pick']:,}",
        f"- Common sites matched to the master list: {report['common_sites_matched']:,} "
        f"(not found: {report['common_sites_not_in_master']:,})", "",
        "## Review flags (rows are kept, marked in `review_flags`)", "",
        "| Flag | Rows |", "|---|---|",
        *[f"| {k} | {v:,} |" for k, v in sorted(flag_counts.items())], "",
        "## Missing values (left blank, never 0)", "", "| Column | Blank rows |", "|---|---|",
        *[f"| {c} | {n:,} |" for c, n in missing.items()], "",
        f"Category values outside the 24 tags: {len(unknown_categories)} (see `categories-review.csv`)", "",
        "## Output files", "", "| File | Rows |", "|---|---|",
        *[f"| {n} | {c:,} |" for n, c in parts],
    ]
    with open(os.path.join(args.out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
