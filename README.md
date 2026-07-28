# Search Engine Backend v2

A real crawler + inverted index + BM25 search engine, split into two
independently-deployable processes: a **web service** (search API + frontend)
and a **background worker** (the crawler). They share a Postgres database.

## Why this is a rewrite, not a patch

The previous version had `server.js` running its own live-crawl function on
every boot, writing a *different, incompatible* JSON schema than the one
`indexer.js`/`build_index.js` used — so the two systems were silently
overwriting each other's index format, and searches almost never actually hit
the local index. It also stored everything in a local JSON file, which
Render's free web service wipes on every redeploy. This version fixes both:
one consistent index format in Postgres, and crawling moved out of the
request path entirely.

## Architecture

```
crawl_queue (frontier) --> worker.js --> Postgres --> server.js --> /api/search
                              |             ^
                        robots.txt      documents +
                        + rate limit    postings (inverted index)
```

- **`worker.js`** — runs forever, pulls URLs off `crawl_queue`, checks
  `robots.txt`, fetches the page, parses it, writes it into `documents` +
  `postings`, and enqueues newly discovered links. Deploy this as a Render
  **Background Worker**.
- **`server.js`** — stateless web server. Only ever *reads* the index to
  answer `/api/search`. Never crawls. Deploy this as a Render **Web Service**.
- **Postgres** — the one shared source of truth. A real managed database
  service, so it survives restarts/redeploys of either the web service or the
  worker (unlike local disk on either of them).

## How search ranking works

Okapi BM25 (`src/search/bm25.js`), with a twist: a term match in the page
`<title>` is weighted like several body matches (`TITLE_BOOST = 4`), since a
title hit is a much stronger signal than a passing mention in the body. Terms
are stemmed (`stemmer` package) so "run"/"running"/"runs" all collapse to the
same index term, and stopwords are filtered before indexing and querying.

## How the crawler behaves responsibly

- **Respects `robots.txt`** per domain (cached in `robots_cache`, refetched
  daily), including `Crawl-delay` directives.
- **Identifies itself** with a real, non-spoofed `User-Agent`
  (`GoseodiBot/1.0`) that links back to the repo.
- **Per-domain politeness delay** (default 1s, or whatever the site's
  `robots.txt` requests) enforced via `domain_stats.last_fetched_at`.
- **Per-domain page cap** (`CRAWL_MAX_PAGES_PER_DOMAIN`, default 200) so a
  "broad" crawl can't spiral into re-crawling one huge site forever.
- **URL normalization + content hashing** avoid re-crawling/re-indexing the
  same page reached via different query params, or re-indexing unchanged
  pages.
- **Page budget per run** (`CRAWL_PAGE_BUDGET`) — the worker crawls in
  bounded batches, not an unbounded firehose.

You are legally and ethically responsible for what you point this at. Don't
disable the robots.txt check, don't spoof the user-agent, and don't set the
delay to 0 against sites that haven't invited heavy automated traffic.

## Local setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL for your local Postgres
npm run migrate              # creates tables
npm run dev                  # starts the web server on :3001
npm run worker:dev           # in a second terminal: starts the crawler
```

Try it:
```bash
curl "http://localhost:3001/api/search?q=javascript"
curl http://localhost:3001/api/stats
```

Add more seed URLs any time without redeploying:
```bash
curl -X POST http://localhost:3001/api/seed \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"urls": ["https://example.com"]}'
```

## Tests

```bash
node tests/crawler-utils.test.js   # offline: URL normalization + robots.txt parsing
node tests/pipeline.test.js        # needs DATABASE_URL: indexing + BM25 ranking on synthetic pages
node tests/live-crawl.test.js      # needs DATABASE_URL + internet: full fetch -> parse -> index -> search
```

## Deploying to Render

`render.yaml` defines all three pieces (web service, background worker,
Postgres database) as a Blueprint — push this repo to GitHub, then in Render
choose "New > Blueprint" and point it at the repo. It wires `DATABASE_URL`
into both services automatically and generates `ADMIN_TOKEN` for you.

Render's **free Postgres tier** is a real starting point, but it currently
expires after 30 days unless upgraded — worth knowing before you rely on the
index being there long-term. Free web services and workers also spin down
after inactivity, so the crawler won't run 24/7 unless you're on a paid plan;
it'll pick back up from wherever the queue left off the next time it wakes.

## Known follow-up: the frontend

`public/app.js` (carried over unchanged) has a lot of simulated/fake behavior
layered on top — hardcoded "tabs" for movies/YouTube/Instagram that filter on
a `source` field the real API never sets, a local fallback simulation that
kicks in on any API error, dictionary-card and "I'm feeling lucky" UI, etc.
The API contract (`{query, totalHits, results: [{id, url, title, snippet,
score}]}`) is unchanged so the existing frontend keeps working, but it's
worth a separate pass to strip the fake stuff out and build a UI that
honestly reflects what the backend does. Happy to do that next if you want.
