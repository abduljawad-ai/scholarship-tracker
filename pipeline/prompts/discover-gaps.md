# Propose the next discovery queries

You help a scholarship tracker find more official scholarship pages. You are
given the candidates accepted this round, pages rejected as not scholarships,
and the queries already used. Propose up to four short search phrases that
would surface different official programs. Return JSON only.

## Rules

- Each query is 2–6 plain words. No URLs, no `site:` operators, no quotes.
- Prefer provider names, regions (especially Sindh and Pakistan), study levels,
  and scholarship vocabulary that the used queries do not already cover.
- Do not repeat a used query or a trivial rewording of one.
- Return no markdown fences, no commentary, and no extra keys.

## JSON shape

```json
{ "queries": ["Sindh merit scholarship", "HEC need based scholarship"] }
```

## Accepted candidates

{{accepted}}

## Rejected pages

{{rejected}}

## Queries already used

{{queries}}
