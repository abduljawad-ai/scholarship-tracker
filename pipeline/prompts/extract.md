# Extract scholarship facts from one official page

You extract facts from a single official scholarship page. Return JSON only.
Do not use outside knowledge. Never guess or infer a value.

## Rules

- If the page does not state a value, return `null`. Do not fill gaps from memory.
- Dates are ISO `YYYY-MM-DD`. If the page gives only a month or a year, return `null`.
- One cycle per intake. Use the intake label exactly as the page writes it.
  A year or year range attached to the application deadlines (for example
  "application deadlines 2027/2028") is the intake label. If the page does
  not name the intake, return `null` for `label`.
- `status` is `open`, `upcoming`, or `closed` only when the page says so in
  words (for example "Applications are closed"). Quote that sentence as
  `status` evidence. If the page gives dates, return `null` for `status` and
  let the dates decide. Never infer a status from a season or a guess.
- `pageKind` is `program` for one scholarship page, `index` for a list of links,
  `unknown` for anything else (news, about, contact).
- Every non-null date and the apply URL needs an evidence entry whose `field`
  matches and whose `quote` is an exact sentence from the page.
- Evidence fields: `opens`, `deadline`, `resultsDate`, `studyStart`, `applyUrl`,
  `status`, `guide.steps`, `guide.documents`, `guide.tips`, `guide.timeline`.
- If a guide list is non-empty, include at least one evidence entry with that
  guide field. Quote the sentence the item comes from.
- `sourceUrl` is the page URL exactly as given below.
- Do not invent eligibility, funding, or provider names. This task extracts
  cycles, dates, the apply link, and guide items only.
- Return no markdown fences, no commentary, and no extra keys.

## JSON shape

```json
{
  "pageKind": "program",
  "cycles": [
    {
      "label": "2027/28 intake",
      "status": null,
      "dates": {
        "opens": "2027-08-01",
        "deadline": "2027-11-03",
        "resultsDate": null,
        "studyStart": null
      },
      "apply": {
        "url": "https://www.example.org/apply/",
        "portalName": "Example portal",
        "fee": null
      },
      "evidence": [
        { "field": "opens", "quote": "Applications open on 1 August 2027.", "sourceUrl": "https://www.example.org/scholarships/" },
        { "field": "deadline", "quote": "Applications close on 3 November 2027.", "sourceUrl": "https://www.example.org/scholarships/" },
        { "field": "applyUrl", "quote": "Apply at https://www.example.org/apply/ before the deadline.", "sourceUrl": "https://www.example.org/scholarships/" }
      ]
    }
  ],
  "guide": {
    "steps": ["Apply online"],
    "documents": ["Two reference letters"],
    "tips": [],
    "timeline": []
  }
}
```

## Page

Provider: {{provider}}
URL: {{sourceUrl}}

Page text:

{{pageText}}
