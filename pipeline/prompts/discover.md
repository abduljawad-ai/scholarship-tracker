# Classify official pages for a scholarship tracker

You read a batch of pages fetched from official scholarship providers. Decide
which pages describe a scholarship a Pakistani student could apply for. Return
JSON only. Use only the page text below.

## Rules

- `isScholarship` is true only when the page describes a specific scholarship,
  bursary, grant, or award with an application route. An index, news item,
  policy, or general admissions page is false.
- Copy `url` exactly from the page heading. Return one object per page, in the
  same order, including pages that are not scholarships.
- `title` is the scholarship name as the page writes it. `provider` is the
  organisation that offers it. If either is missing, return null.
- `country` is the country of study when the page states it, otherwise null.
- `deadline` is ISO `YYYY-MM-DD` only when the page states a full date. A month
  or a year alone is null. Never guess or infer a date.
- `applyUrl` is an absolute URL only when the page shows it. Otherwise null.
- `evidence` contains exact sentences copied from the page. Include one entry
  for each non-null fact, with fields `title`, `provider`, `deadline`, or
  `applyUrl`. A quote must appear word for word in the page text.
- Do not use outside knowledge. Do not infer eligibility, funding, or provider
  names. Do not invent deadlines or links.
- Return no markdown fences, no commentary, and no extra keys.

## JSON shape

```json
{
  "pages": [
    {
      "url": "https://www.example.org/scholarships/example/",
      "isScholarship": true,
      "title": "Example Scholarship 2027",
      "provider": "Example Foundation",
      "country": "Pakistan",
      "deadline": "2027-12-01",
      "applyUrl": "https://www.example.org/apply/",
      "evidence": [
        { "field": "title", "quote": "Example Scholarship 2027", "sourceUrl": "https://www.example.org/scholarships/example/" },
        { "field": "deadline", "quote": "Applications close on 1 December 2027.", "sourceUrl": "https://www.example.org/scholarships/example/" }
      ]
    },
    {
      "url": "https://www.example.org/news/graduation/",
      "isScholarship": false,
      "title": null,
      "provider": null,
      "country": null,
      "deadline": null,
      "applyUrl": null,
      "evidence": []
    }
  ]
}
```

## Pages

{{pages}}
