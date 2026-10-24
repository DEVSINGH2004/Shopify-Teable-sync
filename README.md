# 01Wire Catalog Sync

Teable mein rakhi guest-post sites (~189k) ko Shopify products banane wale scripts, aur unhe Oracle free server pe chalane ki guide.

![Setup ka naksha](docs/images/architecture.png)

## Kya hai is repo mein

| File | Kaam |
| --- | --- |
| [`docs/setup-guide.md`](docs/setup-guide.md) | Step-by-step guide: Oracle server, Teable install, Shopify app, sync, backup |
| `catalog-tools/clean_sites.py` | GetReach / vendor CSV exports ko saaf karke `sites-part-*.csv` banata hai |
| `catalog-tools/teable_import.py` | Saaf CSV files ko Teable table mein daalta hai (ruk jaaye to wahin se chalta hai) |
| `catalog-tools/shopify_sync.mjs` | Teable ki nayi / badli sites ko Shopify products banata ya update karta hai |
| `catalog-tools/.env.example` | Saari settings aur tokens ka template |

## Creds kahan rakhein

**Asli tokens is repo mein kabhi commit nahi hote.** Repo mein sirf `catalog-tools/.env.example` hai, jisme khaali naam likhe hain.

1. `catalog-tools/.env.example` ko `catalog-tools/.env` naam se copy karo.
2. Usme apne tokens bharo (kaunsa token kahan se milega: guide ka "Saare creds aur tokens ek jagah" section).
3. `.env` file `.gitignore` mein hai, isliye git use kabhi upload nahi karega.

Server pe bhi yahi: `.env` sirf server pe rehti hai (`chmod 600`), aur ek copy password manager mein.

## Jaldi chalana (server pe)

```bash
cd catalog-tools
node --env-file=.env shopify_sync.mjs --setup              # ek baar: Shopify metafield definitions
node --env-file=.env shopify_sync.mjs --dry-run --limit 20  # sirf dekho, kuch nahi bhejta
node --env-file=.env shopify_sync.mjs --limit 20            # 20 products test
node --env-file=.env shopify_sync.mjs                       # saari nayi / badli sites
```

Requirements: Node 22+, Python 3.10+. Koi `npm install` nahi chahiye.

## Abhi kya nahi karta

- Teable mein delete ki gayi site Shopify se nahi hatati.
- Products ko Online Store sales channel pe publish nahi karta (Draft banata hai).
- Teable mein khaali ki gayi value Shopify ke purane metafield ko nahi hatati.
