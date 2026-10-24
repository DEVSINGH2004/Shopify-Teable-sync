/**
 * Push every site in the Teable table to Shopify as a product.
 * One product per domain, one variant per topic ("General", "Crypto", "Finance", ...).
 *
 * Usage (Node 22+, no npm install needed):
 *   node --env-file=.env shopify_sync.mjs --setup            create the product metafield definitions (once)
 *   node --env-file=.env shopify_sync.mjs --dry-run --limit 20   build the products, send nothing
 *   node --env-file=.env shopify_sync.mjs --limit 20         push 20 sites, check them in Shopify
 *   node --env-file=.env shopify_sync.mjs                    push everything that is new or changed
 *
 * .env (see .env.example):
 *   TEABLE_URL, TEABLE_TOKEN, TEABLE_TABLE
 *   SHOPIFY_STORE (xxx.myshopify.com), SHOPIFY_ACCESS_TOKEN
 *     or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET, optional SHOPIFY_API_VERSION
 *   RATE_USD, RATE_EUR   store currency per 1 USD / 1 EUR (e.g. 88 and 96 for INR)
 *   MARKUP_PERCENT       our fee on top of the cost price (0 = sell at cost)
 *
 * Products are created as DRAFT unless --status active. A re-run only sends rows whose
 * product data changed (synced_hash) and updates products that already have a
 * shopify_product_id, so it is safe to run again after a stop or a data refresh.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, ".shopify-sync-state.json");
const OUT_DIR = join(HERE, "shopify-sync-out");

const TEABLE_PAGE = 1_000;
const WRITE_BACK_BATCH = 500;
const MAX_CHUNK_BYTES = 15 * 1024 * 1024; // keep each bulk upload file well under Shopify's limit
const VENDOR = "01Wire";
const PRODUCT_TYPE = "Guest Post";

// [variant name, Teable column with its EUR price]; "General" uses the base price
const TOPICS = [
  ["General", null],
  ["Crypto", "crypto_price_eur"],
  ["Finance", "finance_price_eur"],
  ["Gambling", "gambling_price_eur"],
  ["CBD", "cbd_price_eur"],
  ["Health", "health_price_eur"],
  ["Dating", "dating_price_eur"],
  ["Adult", "adult_price_eur"],
];

// [Teable column, Shopify metafield type, label]. Internal columns (own prices, cheaper_at,
// offer ids, review flags) are never sent to Shopify.
const METAFIELDS = [
  ["dr", "number_integer", "DR"],
  ["da", "number_integer", "DA"],
  ["authority_score", "number_integer", "Authority score"],
  ["traffic", "number_integer", "Traffic / month"],
  ["keywords", "number_integer", "Keywords"],
  ["ref_domains", "number_integer", "Referring domains"],
  ["spam", "number_integer", "Spam score"],
  ["language", "single_line_text_field", "Language"],
  ["categories", "list.single_line_text_field", "Categories"],
  ["link_type", "single_line_text_field", "Link type"],
  ["sponsored", "single_line_text_field", "Sponsored label"],
  ["site_url", "url", "Website"],
];
const NAMESPACE = "site";

const PRODUCT_SET = `mutation call($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id }
    userErrors { field message }
  }
}`;

const { values: opts } = parseArgs({
  options: {
    setup: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    chunk: { type: "string", default: "4000" },
    status: { type: "string", default: "draft" },
  },
});
const LIMIT = opts.limit ? Number(opts.limit) : Infinity;
const CHUNK = Number(opts.chunk);
const STATUS = opts.status.toUpperCase();
if (!["DRAFT", "ACTIVE"].includes(STATUS)) die("--status must be draft or active");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function env(name) {
  const v = process.env[name];
  if (!v) die(`missing ${name} in .env`);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Teable ----------

const TEABLE = () =>
  `${(process.env.TEABLE_URL || "http://46.224.66.162:3001").replace(/\/$/, "")}/api/table/${env("TEABLE_TABLE")}`;

async function teable(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(TEABLE() + path, {
      method,
      headers: { Authorization: `Bearer ${env("TEABLE_TOKEN")}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 300);
    if (res.status < 500 || attempt === 5) throw new Error(`Teable ${method} ${path.split("?")[0]}: HTTP ${res.status} ${text}`);
    await sleep(5_000 * attempt);
  }
}

async function* teableRecords() {
  for (let skip = 0; ; skip += TEABLE_PAGE) {
    const { records } = await teable("GET", `/record?fieldKeyType=name&take=${TEABLE_PAGE}&skip=${skip}`);
    yield* records;
    if (records.length < TEABLE_PAGE) return;
  }
}

async function teableUpdate(updates) {
  for (let i = 0; i < updates.length; i += WRITE_BACK_BATCH) {
    await teable("PATCH", "/record", {
      fieldKeyType: "name",
      typecast: true,
      records: updates.slice(i, i + WRITE_BACK_BATCH),
    });
  }
}

// ---------- Shopify ----------

const STORE = () => env("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/$/, "");
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
let accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

async function shopifyToken() {
  if (accessToken) return accessToken;
  // apps made in the Shopify Dev Dashboard: swap client id + secret for a short-lived token
  const res = await fetch(`https://${STORE()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env("SHOPIFY_CLIENT_ID"),
      client_secret: env("SHOPIFY_CLIENT_SECRET"),
    }),
  });
  if (!res.ok) die(`Shopify token request failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  accessToken = (await res.json()).access_token;
  return accessToken;
}

async function shopify(query, variables) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://${STORE()}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": await shopifyToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && !process.env.SHOPIFY_ACCESS_TOKEN && attempt === 1) {
      accessToken = null; // client-credentials token expired, get a new one
      continue;
    }
    const retryable = res.status === 429 || res.status >= 500;
    const json = retryable ? null : await res.json().catch(() => null);
    const throttled = json?.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if ((retryable || throttled) && attempt < 6) {
      await sleep(2_000 * attempt);
      continue;
    }
    if (!res.ok || !json) throw new Error(`Shopify HTTP ${res.status}`);
    if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 500)}`);
    return json.data;
  }
}

async function startBulk(lines) {
  const { stagedUploadsCreate: staged } = await shopify(`mutation {
    stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "products.jsonl",
                                  mimeType: "text/jsonl", httpMethod: POST }]) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }`);
  if (staged.userErrors.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(staged.userErrors)}`);
  const target = staged.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([lines.join("\n")], { type: "text/jsonl" }), "products.jsonl");
  const upload = await fetch(target.url, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`upload failed: HTTP ${upload.status} ${(await upload.text()).slice(0, 300)}`);

  const key = target.parameters.find((p) => p.name === "key").value;
  const { bulkOperationRunMutation: run } = await shopify(
    `mutation($m: String!, $p: String!) {
      bulkOperationRunMutation(mutation: $m, stagedUploadPath: $p) {
        bulkOperation { id }
        userErrors { field message }
      }
    }`,
    { m: PRODUCT_SET, p: key },
  );
  if (run.userErrors.length) throw new Error(`bulkOperationRunMutation: ${JSON.stringify(run.userErrors)}`);
  return run.bulkOperation.id;
}

async function waitBulk(id) {
  for (;;) {
    const { node } = await shopify(
      `query($id: ID!) { node(id: $id) { ... on BulkOperation { status errorCode objectCount url partialDataUrl } } }`,
      { id },
    );
    if (["COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(node.status)) {
      process.stdout.write("\n");
      return node;
    }
    process.stdout.write(`\r  Shopify is creating products: ${node.objectCount} done (${node.status})   `);
    await sleep(10_000);
  }
}

// ---------- Teable row -> Shopify product ----------

const RATE_USD = () => Number(env("RATE_USD"));
const RATE_EUR = () => Number(env("RATE_EUR"));
const MARKUP = () => 1 + Number(env("MARKUP_PERCENT")) / 100;

// whole units of the store currency, rounded up so we never sell below cost
const sellPrice = (amount, rate) => String(Math.ceil(amount * rate * MARKUP()));

// what one post costs us in USD: our own vendor when the cleaner found it cheaper, else GetReach
function costUsd(f) {
  if (f.cheaper_at === "my-vendor" && f.own_price_usd > 0) return f.own_price_usd;
  return f.price_usd;
}

const splitList = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const handleOf = (domain) => domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function describe(f) {
  const rows = [
    ["DR", f.dr],
    ["DA", f.da],
    ["Traffic / month", f.traffic?.toLocaleString("en-IN")],
    ["Language", f.language],
    ["Link type", f.link_type],
    ["Categories", splitList(f.categories).join(", ")],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  return `<p>Guest post on <strong>${esc(f.domain)}</strong>.</p><ul>${rows
    .map(([k, v]) => `<li><strong>${k}:</strong> ${esc(v)}</li>`)
    .join("")}</ul>`;
}

function metafields(f) {
  const out = [];
  for (const [key, type] of METAFIELDS) {
    const v = f[key];
    if (v === undefined || v === null || v === "") continue;
    let value;
    if (type === "number_integer") value = String(Math.round(v));
    else if (type.startsWith("list.")) value = JSON.stringify(splitList(v));
    else value = String(v);
    out.push({ namespace: NAMESPACE, key, type, value });
  }
  return out;
}

function toProductInput(f) {
  const variants = [];
  for (const [topic, column] of TOPICS) {
    const price = column ? (f[column] > 0 ? sellPrice(f[column], RATE_EUR()) : null) : sellPrice(costUsd(f), RATE_USD());
    if (!price) continue;
    variants.push({
      optionValues: [{ optionName: "Topic", name: topic }],
      price,
      sku: `${f.domain}:${topic.toLowerCase()}`,
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false, requiresShipping: false },
    });
  }
  return {
    title: f.domain,
    handle: handleOf(f.domain),
    vendor: VENDOR,
    productType: PRODUCT_TYPE,
    descriptionHtml: describe(f),
    tags: [...splitList(f.categories), f.language, f.link_type, f.sponsored && `sponsored-${f.sponsored}`].filter(Boolean),
    productOptions: [{ name: "Topic", values: variants.map((v) => ({ name: v.optionValues[0].name })) }],
    variants,
    metafields: metafields(f),
  };
}

const hashOf = (input) => createHash("sha1").update(JSON.stringify(input)).digest("hex");

// ---------- run state: lets a stopped run pick up a bulk job it already started ----------

async function finishPending() {
  if (!existsSync(STATE_FILE)) return { ok: 0, failed: 0 };
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const op = await waitBulk(state.bulkId);

  const results = new Map();
  const url = op.url || op.partialDataUrl;
  if (url) {
    const text = await (await fetch(url)).text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      results.set(r.__lineNumber, r);
    }
  }

  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;
  const updates = state.items.map((item, line) => {
    const r = results.get(line);
    const set = r?.data?.productSet;
    const errors = [
      ...(r?.errors ?? []).map((e) => e.message),
      ...(set?.userErrors ?? []).map((e) => `${(e.field ?? []).join(".")}: ${e.message}`),
    ];
    if (!r) errors.push(`no result from Shopify (bulk job ${op.status}${op.errorCode ? ", " + op.errorCode : ""})`);
    const fields = { sync_error: errors.length ? errors.join("; ").slice(0, 2_000) : null };
    if (set?.product?.id) fields.shopify_product_id = set.product.id;
    if (!errors.length) {
      fields.synced_hash = item.hash;
      fields.last_synced = now;
      ok++;
    } else failed++;
    return { id: item.recordId, fields };
  });
  await teableUpdate(updates);
  unlinkSync(STATE_FILE);
  console.log(`  saved to Teable: ${ok} ok, ${failed} with errors (see sync_error)`);
  return { ok, failed };
}

async function pushChunk(chunk) {
  const lines = chunk.map((c) => JSON.stringify({ input: c.input }));
  const bulkId = await startBulk(lines);
  writeFileSync(STATE_FILE, JSON.stringify({ bulkId, items: chunk.map(({ recordId, hash }) => ({ recordId, hash })) }));
  console.log(`  bulk job ${bulkId} started for ${chunk.length} products`);
  return finishPending();
}

// ---------- commands ----------

async function setup() {
  for (const [key, type, name] of METAFIELDS) {
    const { metafieldDefinitionCreate: r } = await shopify(
      `mutation($d: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $d) { createdDefinition { id } userErrors { code message } }
      }`,
      { d: { name, namespace: NAMESPACE, key, type, ownerType: "PRODUCT", access: { storefront: "PUBLIC_READ" } } },
    );
    const err = r.userErrors[0];
    console.log(`${NAMESPACE}.${key}: ${err ? (err.code === "TAKEN" ? "already exists" : err.message) : "created"}`);
  }
}

async function sync() {
  const dryRun = opts["dry-run"];
  if (!dryRun && existsSync(STATE_FILE)) {
    console.log("finishing the bulk job from the last run first...");
    await finishPending();
  }
  let dryFile;
  if (dryRun) {
    mkdirSync(OUT_DIR, { recursive: true });
    dryFile = join(OUT_DIR, "products.jsonl");
    writeFileSync(dryFile, "");
  }

  let seen = 0;
  let unchanged = 0;
  let queued = 0;
  let ok = 0;
  let failed = 0;
  let chunk = [];
  let chunkBytes = 0;

  const flush = async () => {
    if (!chunk.length) return;
    if (!dryRun) {
      const r = await pushChunk(chunk);
      ok += r.ok;
      failed += r.failed;
    }
    chunk = [];
    chunkBytes = 0;
  };

  for await (const rec of teableRecords()) {
    seen++;
    const f = rec.fields;
    const input = toProductInput(f);
    const hash = hashOf(input);
    if (f.shopify_product_id && f.synced_hash === hash) {
      unchanged++;
      continue;
    }
    // status only on create, so a product someone set live in Shopify is not pushed back to draft
    const full = f.shopify_product_id ? { id: f.shopify_product_id, ...input } : { ...input, status: STATUS };
    if (dryRun) appendFileSync(dryFile, JSON.stringify({ input: full }) + "\n");
    else {
      chunk.push({ recordId: rec.id, hash, input: full });
      chunkBytes += JSON.stringify(full).length;
      if (chunk.length >= CHUNK || chunkBytes >= MAX_CHUNK_BYTES) await flush();
    }
    if (++queued >= LIMIT) break;
    if (seen % 10_000 === 0) console.log(`read ${seen} rows from Teable, ${queued} to send`);
  }
  await flush();

  console.log(`\nrows read: ${seen} | unchanged (skipped): ${unchanged} | sent: ${queued}`);
  if (dryRun) console.log(`dry run, nothing sent. Products written to ${dryFile}`);
  else console.log(`Shopify ok: ${ok} | errors: ${failed}`);
}

await (opts.setup ? setup() : sync()).catch((e) => die(e.stack || String(e)));
