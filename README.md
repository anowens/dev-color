# Creator Opportunity Prototype

One-page Astro prototype for the Gates Higher Endeavor technical assessment. The app gives a busy Head of Creator Partnerships an at-a-glance recommendation from a TikTok trending CSV, plus a plain-English Q&A flow for follow-up questions.

## What The App Does

- Shows a one-screen strategy summary.
- Ranks creator partnership prospects using deterministic scoring.
- Keeps verified and celebrity-scale creators visible as reach benchmarks without letting that status automatically drive the outreach priority.
- Lets a user ask natural-language questions about creators, engagement, reach benchmarks, content themes, and data limitations.
- Uses local deterministic answers when `OPENAI_API_KEY` is not configured.
- Uses OpenAI to phrase the final answer when `OPENAI_API_KEY` is present.

## Definition Of Promising

For this prototype, "promising" means:

> A creator or content pattern with enough reach to matter, unusually strong audience response, and some evidence that performance is not purely a one-off celebrity/outlier effect.

Because the dataset has no follower count, the app uses:

- `views` as the reach proxy
- `likes + comments + shares` as total interactions
- `(likes + comments + shares) / views` as engagement efficiency
- `shares / views` and `comments / views` as stronger intent signals
- multiple videos from the same creator as a light consistency signal

## Creator Opportunity Score

The scoring uses percentile ranks so celebrity-scale outliers do not dominate.

```text
video_score =
  0.30 * views_percentile +
  0.25 * interactions_percentile +
  0.25 * engagement_rate_percentile +
  0.12 * share_rate_percentile +
  0.08 * comment_rate_percentile
```

```text
creator_score =
  0.55 * best_video_score +
  0.30 * average_video_score +
  0.10 * consistency_bonus +
  0.05 * engagement_rate
```

## Creator Context Labels

Each creator gets a visible context label:

- `unverified - mid-tail prospect`
- `unverified - emerging signal`
- `verified - reach benchmark`
- `celebrity-scale benchmark`

Verified and celebrity-scale creators are still shown, but they appear as benchmarks rather than the default outreach list. This makes it clear they were considered without allowing raw fame to answer the whole strategy question.

## Q&A Flow

```text
User question
→ classify into a supported intent
→ run a deterministic query over precomputed CSV metrics
→ optionally ask gpt-5-mini to summarize the query result
→ return a plain-English answer, caveat, supporting rows, and suggested follow-up
```

Supported intents:

- `best_partnership_prospects`
- `top_creators_by_engagement`
- `high_reach_benchmarks`
- `promising_content_themes`
- `creator_lookup`
- `data_limitations`
- `clarify`
- `unsupported`

## Trust And Limits

The model is used for language, not math. The calculations come from deterministic code, and the model only explains the result. That keeps the experience natural while reducing hallucination risk.

Unsupported questions are a first-class path. If the CSV cannot answer something, the app says what data is missing and suggests a safer follow-up.

The CSV does not include:

- follower counts
- audience demographics
- audience location
- creator availability
- current creator status
- brand-safety review

## Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4321/`.

To enable live model phrasing, copy `.env.example` to `.env` and set `OPENAI_API_KEY`.

## What I Would Improve With More Time

- Add a supporting-row table under every answer.
- Add a brand-safety/manual-review checklist.
- Add a CSV upload option.
- Add stricter structured output for model-based intent classification.
- Add tests for scoring and query intent coverage.
