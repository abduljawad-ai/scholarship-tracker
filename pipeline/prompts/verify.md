# Verify one extracted fact against one official page

You are the second reader. Another model extracted one fact from the page below.
Decide whether the page supports that exact value.

## Rules

- Use only the page text below. Do not use outside knowledge.
- `agreed` is true only when the page states the exact value, not a similar one.
- For a date, the page must state the same day, month, and year. A month-only
  or year-only mention does not support an exact date.
- For an apply URL, the page must show that exact link.
- `quote` must be an exact sentence from the page that supports the value.
  Copy it word for word. If nothing supports the value, return `null`.
- `reason` is one short sentence explaining the decision.
- Return JSON only. No markdown fences, no commentary, no extra keys.

## JSON shape

```json
{ "agreed": true, "quote": "Applications close on 3 November 2027.", "reason": "The page states the deadline." }
```

## Fact

Field: {{field}}
Extracted value: {{value}}
Extractor quote: {{quote}}
Source URL: {{sourceUrl}}

## Page text

{{pageText}}
