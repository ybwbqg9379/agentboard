---
name: data-extraction
description: Extract structured data from web pages — tables, lists, product info, financial data, and any repeating patterns.
when_to_use: User wants to extract structured data, build datasets, pull tables from websites, or collect comparable data points.
allowed-tools:
  - mcp__firecrawl__*
  - mcp__fetch__*
  - mcp__jina-reader__*
  - mcp__tavily-search__*
  - mcp__browser__*
  - mcp__memory__*
  - mcp__filesystem__*
---

# Data Extraction Skill

You are executing a structured data extraction workflow. Your goal is to **locate → extract → validate → export** structured data from web sources.

## Orchestration Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. LOCATE   │────▶│  2. EXTRACT  │────▶│ 3. VALIDATE  │────▶│  4. EXPORT   │
│              │     │              │     │              │     │              │
│ tavily-search│     │ firecrawl    │     │ (type check, │     │ filesystem   │
│ (find pages) │     │ jina-reader  │     │  dedup, clean)│     │ (JSON/CSV)   │
│              │     │ fetch        │     │              │     │ memory       │
│              │     │ browser      │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

## Phase 1: LOCATE — Find Data Sources

If the user provides URLs directly, skip to Phase 2.

If the user describes what data they need without specific URLs:
1. Use `tavily-search` to find pages containing the target data.
2. Prefer pages with structured content (tables, APIs, databases) over prose.
3. Verify each URL actually contains extractable data before proceeding.

## Phase 2: EXTRACT — Pull Structured Data

Choose the extraction tool based on page complexity:

| Scenario | Best Tool | Strategy |
|----------|-----------|----------|
| Static page with clear tables/lists | `jina-reader` | Read page, parse markdown tables |
| Complex page needing CSS selectors | `firecrawl` | Use structured extraction mode |
| Dynamic page (JS-rendered content) | `browser` | Navigate, wait for render, extract |
| API endpoint or JSON feed | `fetch` | Direct HTTP GET + parse JSON |
| Multiple pages with same structure | `firecrawl` | Batch extraction with consistent schema |
| Page behind login/auth | `browser` | Full Playwright automation |

**Extraction Guidelines:**

1. **Define the schema first.** Before extracting, clearly define what fields you're collecting:
   ```json
   {
     "fields": ["name", "price", "rating", "url", "date"],
     "types": ["string", "number", "number", "url", "date"]
   }
   ```

2. **Extract consistently.** All items in a dataset must have the same schema.

3. **Handle missing values.** Use `null` for missing fields, never omit them.

4. **Preserve source URL.** Every extracted record must include its source URL for traceability.

## Phase 3: VALIDATE — Clean and Verify Data

After extraction, apply these checks:

### Type Validation
- Numbers should be actual numbers (strip currency symbols, commas)
- Dates should be normalised to ISO 8601 format (`YYYY-MM-DD`)
- URLs should be absolute (resolve relative URLs against the source)
- Strings should be trimmed of whitespace

### Data Quality
- **Duplicates:** Remove exact duplicates based on a primary key field.
- **Outliers:** Flag values that are > 3 standard deviations from the mean (for numeric fields).
- **Completeness:** Report the percentage of records with all fields populated.
- **Encoding:** Ensure proper UTF-8, fix garbled characters.

### Validation Report
Always produce a brief quality report:
```
Extraction Summary:
  Source URLs: 3
  Total records: 47
  Complete records: 42 (89%)
  Duplicates removed: 2
  Fields: name (100%), price (98%), rating (87%), url (100%), date (91%)
  Issues: 3 records missing 'rating', 2 records with non-numeric 'price' (fixed)
```

## Phase 4: EXPORT — Deliver Structured Output

### Output Formats

| Format | When to Use | Tool |
|--------|-------------|------|
| **JSON** | For programmatic use, API-ready data | `filesystem` → `.json` |
| **CSV** | For spreadsheet analysis, quick sharing | `filesystem` → `.csv` |
| **Markdown Table** | For inline display in chat | Direct response |
| **Memory Graph** | For persistent cross-session reference | `memory` MCP |

### Export Rules

1. **JSON** output must be valid, pretty-printed JSON with consistent schema:
   ```json
   {
     "metadata": {
       "extracted_at": "2026-03-31T22:30:00Z",
       "sources": ["https://example.com/page1", "https://example.com/page2"],
       "record_count": 47,
       "schema": { "name": "string", "price": "number" }
     },
     "data": [...]
   }
   ```

2. **CSV** output must include headers, use proper quoting, and handle commas in values.

3. **File path convention:** `workspace/data/YYYY-MM-DD-<topic>.<ext>`

4. **Memory persistence:** Create entities for key data points and relate them to the extraction topic.

## Multi-Page Extraction Pattern

When extracting the same type of data across multiple pages (e.g., product listings across pagination):

1. **Discover pages:** Use sitemap or pagination detection.
2. **Extract first page:** Establish schema from the first successful extraction.
3. **Batch remaining:** Apply the same schema to all subsequent pages.
4. **Merge:** Combine all records, dedup, and validate.
5. **Report:** Include per-page extraction stats.

## Error Recovery

| Error | Recovery |
|-------|----------|
| Page structure changed (no matching selectors) | Try `jina-reader` for raw content, then parse manually |
| Rate limited by target site | Add delays between requests, reduce batch size |
| CAPTCHA or bot detection | Use `browser` MCP for human-like navigation |
| Partial extraction (some fields missing) | Log incomplete records separately, don't discard |
| Encoding issues | Force UTF-8 decode, replace invalid characters |

## Key Principles

- **Schema first.** Always define the output schema before extracting.
- **Source traceability.** Every record must link back to its source URL.
- **Idempotent.** Running the same extraction twice should produce the same result.
- **Fail partial, not total.** If one page fails, continue with the rest.
- **Bilingual.** Match the user's language in reports and field names when requested.
