---
name: web-research
description: Orchestrated web research — search the web, crawl key pages, analyse findings, and persist results.
when_to_use: User asks to research a topic, find current information, analyse web data, or investigate something online.
allowed-tools:
  - mcp__tavily-search__*
  - mcp__exa-search__*
  - mcp__brave-search__*
  - mcp__firecrawl__*
  - mcp__fetch__*
  - mcp__jina-reader__*
  - mcp__memory__*
  - mcp__sequential-thinking__*
  - mcp__filesystem__*
---

# Web Research Skill

You are executing a structured web research workflow. Your goal is to **search → crawl → analyse → persist** information from the web to answer the user's question or fulfil their data needs.

## Orchestration Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   1. SEARCH  │────▶│   2. CRAWL   │────▶│  3. ANALYSE  │────▶│  4. PERSIST  │
│              │     │              │     │              │     │              │
│ tavily-search│     │ firecrawl    │     │ sequential-  │     │ memory       │
│ exa-search   │     │ fetch        │     │ thinking     │     │ filesystem   │
│ brave-search │     │ jina-reader  │     │ (synthesis)  │     │ (export)     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

## Phase 1: SEARCH — Discover Relevant Sources

Select the best search tool based on the user's intent:

| Intent | Best Tool | Why |
|--------|-----------|-----|
| General / news / current events | `tavily-search` | AI-optimised, returns relevance-ranked results |
| Academic / documentation / deep research | `exa-search` | Neural semantic search, excellent for finding high-quality, niche content |
| Broad web search / images / video | `brave-search` | Multi-format search with privacy focus |
| Quick factual lookup | `tavily-search` | Fast, structured results |

**Strategy:**
1. Start with **one** search tool that best matches the intent.
2. If initial results are insufficient (< 3 relevant hits), try a second search tool with a rephrased query.
3. Collect the **top 5-10 URLs** from search results for the crawl phase.
4. For each URL, note the title and relevance before crawling — don't crawl blindly.

**Quality check:** Before proceeding, verify you have at least 3 promising URLs. If not, refine your search query and try again.

## Phase 2: CRAWL — Extract Content from Key Pages

Select the best crawl tool for each URL:

| Scenario | Best Tool | Why |
|----------|-----------|-----|
| Quick read of a single article/page | `jina-reader` | Best token efficiency, clean markdown |
| Need structured data (tables, lists, specific elements) | `firecrawl` | Support for structured extraction |
| Simple page fetch, no special handling needed | `fetch` | Zero API key dependency, works everywhere |
| Need to crawl an entire site or sitemap | `firecrawl` | Batch crawling + sitemap discovery |
| Page requires JavaScript rendering | Use `browser` MCP | Full Playwright browser |

**Strategy:**
1. Prioritise `jina-reader` for article/blog content — it produces the cleanest markdown with minimal tokens.
2. Use `firecrawl` when you need structured extraction or batch processing.
3. Fall back to `fetch` if the other tools are unavailable or the task is simple.
4. Crawl the **most relevant 3-5 pages** — not all URLs from search. Quality over quantity.
5. If a page fails to load or returns garbage, skip it and note why.

**Anti-pattern:** Do NOT crawl 10+ pages sequentially. This wastes tokens and time. Be selective.

## Phase 3: ANALYSE — Synthesise Findings

Use `sequential-thinking` for complex analysis, or reason directly for simpler tasks.

**For each crawled page:**
1. Extract the key facts, data points, and claims relevant to the user's question.
2. Note the source URL for citations.
3. Flag any contradictions between sources.

**Synthesis:**
1. Merge findings from all sources into a cohesive analysis.
2. Identify patterns, trends, and consensus across sources.
3. Highlight areas of uncertainty or disagreement.
4. Present findings with proper citations: `[Source Title](URL)`.

**Output format — choose based on user request:**
- **Summary report** — narrative with section headings
- **Comparison table** — when comparing options, products, technologies
- **Data table** — when extracting structured datasets
- **Bullet points** — for quick factual answers

## Phase 4: PERSIST — Save Results for Future Reference

1. **Always** store key findings in `memory` MCP as entities and relations:
   - Create entities for key concepts, companies, people discovered.
   - Create relations between entities (e.g., "CompanyA competes_with CompanyB").
   - Tag entities with the research topic and date.

2. **When the user requests it**, export results to files via `filesystem`:
   - Markdown reports → `workspace/research/YYYY-MM-DD-<topic>.md`
   - Structured data → `workspace/research/YYYY-MM-DD-<topic>.json` or `.csv`

## Key Principles

- **Citation is mandatory.** Every claim must link to its source URL.
- **Be selective.** Crawl 3-5 pages max per research task. Quality > quantity.
- **Respect rate limits.** Don't hammer the same domain with rapid requests.
- **Fail gracefully.** If a tool fails, log it and try an alternative.
- **Report confidence.** State when information is well-sourced vs. sparse.
- **Bilingual.** Match the user's language (English or Chinese) in your output.

## Error Recovery

| Error | Recovery |
|-------|----------|
| Search returns 0 results | Rephrase query, try a different search engine |
| Page returns 403/404/500 | Skip page, note in report, try cached version via search |
| Firecrawl API limit hit | Fall back to `fetch` or `jina-reader` |
| Jina returns truncated content | Use `firecrawl` for full extraction |
| All search APIs unavailable | Use `browser` MCP to manually search via Google |
