import fs from "node:fs";
import path from "node:path";

export type Intent =
  | "best_partnership_prospects"
  | "top_creators_by_engagement"
  | "high_reach_benchmarks"
  | "promising_content_themes"
  | "creator_video_count"
  | "creator_lookup"
  | "data_limitations"
  | "clarify"
  | "unsupported";

type VideoRow = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  author_verified: boolean;
  primary_hashtag: string;
  music_name: string;
  music_is_original: boolean;
  duration_sec: number;
  caption: string;
  upload_date: string;
  author_name: string;
  video_id: string;
  interactions: number;
  engagementRate: number;
  shareRate: number;
  commentRate: number;
  videoScore: number;
};

export type CreatorSummary = {
  rank?: number;
  name: string;
  niche: string;
  context: string;
  contextKind: "prospect" | "verified" | "benchmark";
  why: string;
  evidence: string;
  score: number;
  videos: number;
  verified: boolean;
  views: number;
  interactions: number;
  avgEngagementRate: number;
  topHashtags: string[];
};

export type QueryResult = {
  intent: Intent;
  title: string;
  answer: string;
  caveat: string;
  rows: Record<string, string | number | boolean>[];
  suggestedFollowup: string;
  usedModel: boolean;
  modelProvider: "local" | "openai" | "anthropic";
};

const csvPath = path.join(process.cwd(), "src", "data", "2026datathon_interview_data.csv");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function percentileMap(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const map = new Map<number, number>();
  const denom = Math.max(sorted.length - 1, 1);
  sorted.forEach((value, index) => {
    if (!map.has(value)) map.set(value, index / denom);
  });
  return map;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatHashtag(value: string): string {
  const hashtag = value.trim();
  if (!hashtag) return "";
  return hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
}

function getContext(creator: { verified: boolean; views: number; videos: number; avgEngagementRate: number }) {
  if (creator.verified || creator.views >= 20_000_000) {
    return {
      label: creator.verified ? "verified - reach benchmark" : "celebrity-scale benchmark",
      kind: "benchmark" as const
    };
  }

  if (creator.views >= 250_000 || creator.avgEngagementRate >= 0.16 || creator.videos >= 2) {
    return { label: "unverified - mid-tail prospect", kind: "prospect" as const };
  }

  return { label: "unverified - emerging signal", kind: "prospect" as const };
}

let cachedVideos: VideoRow[] | null = null;
let cachedCreators: CreatorSummary[] | null = null;

export function getVideos(): VideoRow[] {
  if (cachedVideos) return cachedVideos;

  const csv = fs.readFileSync(csvPath, "utf8");
  const [headers, ...records] = parseCsv(csv);
  const rows = records.map((record) => {
    const raw = Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]));
    const views = Number(raw.views);
    const likes = Number(raw.likes);
    const comments = Number(raw.comments);
    const shares = Number(raw.shares);
    const interactions = likes + comments + shares;

    return {
      views,
      likes,
      comments,
      shares,
      author_verified: raw.author_verified === "True",
      primary_hashtag: raw.primary_hashtag,
      music_name: raw.music_name,
      music_is_original: raw.music_is_original === "True",
      duration_sec: Number(raw.duration_sec),
      caption: raw.caption,
      upload_date: raw.upload_date,
      author_name: raw.author_name,
      video_id: raw.video_id,
      interactions,
      engagementRate: views ? interactions / views : 0,
      shareRate: views ? shares / views : 0,
      commentRate: views ? comments / views : 0,
      videoScore: 0
    };
  });

  const percentiles = {
    views: percentileMap(rows.map((row) => row.views)),
    interactions: percentileMap(rows.map((row) => row.interactions)),
    engagementRate: percentileMap(rows.map((row) => row.engagementRate)),
    shareRate: percentileMap(rows.map((row) => row.shareRate)),
    commentRate: percentileMap(rows.map((row) => row.commentRate))
  };

  cachedVideos = rows.map((row) => ({
    ...row,
    videoScore:
      0.3 * (percentiles.views.get(row.views) ?? 0) +
      0.25 * (percentiles.interactions.get(row.interactions) ?? 0) +
      0.25 * (percentiles.engagementRate.get(row.engagementRate) ?? 0) +
      0.12 * (percentiles.shareRate.get(row.shareRate) ?? 0) +
      0.08 * (percentiles.commentRate.get(row.commentRate) ?? 0)
  }));

  return cachedVideos;
}

export function getCreators(): CreatorSummary[] {
  if (cachedCreators) return cachedCreators;

  const grouped = new Map<string, VideoRow[]>();
  for (const row of getVideos()) {
    grouped.set(row.author_name, [...(grouped.get(row.author_name) ?? []), row]);
  }

  const summaries = [...grouped.entries()].map(([name, rows]) => {
    const views = rows.reduce((sum, row) => sum + row.views, 0);
    const interactions = rows.reduce((sum, row) => sum + row.interactions, 0);
    const avgEngagementRate = rows.reduce((sum, row) => sum + row.engagementRate, 0) / rows.length;
    const bestVideoScore = Math.max(...rows.map((row) => row.videoScore));
    const avgVideoScore = rows.reduce((sum, row) => sum + row.videoScore, 0) / rows.length;
    const consistencyBonus = Math.min(Math.log1p(rows.length) / Math.log(4), 1) * 0.1;
    const hashtags = rows
      .map((row) => row.primary_hashtag)
      .filter(Boolean)
      .filter((hashtag, index, list) => list.indexOf(hashtag) === index)
      .map(formatHashtag)
      .slice(0, 3);
    const verified = rows.some((row) => row.author_verified);
    const rawScore = bestVideoScore * 0.55 + avgVideoScore * 0.3 + consistencyBonus + avgEngagementRate * 0.05;
    const context = getContext({ verified, views, videos: rows.length, avgEngagementRate });

    return {
      name,
      niche: hashtags[0] || (rows[0]?.music_is_original ? "original audio" : "trend audio"),
      context: context.label,
      contextKind: context.kind,
      why: "",
      evidence: `${rows.length} video${rows.length === 1 ? "" : "s"}, ${formatCount(views)} total views, ${formatPercent(avgEngagementRate)} avg engagement`,
      score: Math.round(rawScore * 100),
      videos: rows.length,
      verified,
      views,
      interactions,
      avgEngagementRate,
      topHashtags: hashtags
    };
  });

  cachedCreators = summaries
    .map((creator) => {
      let why = "Strong combination of reach and audience response.";
      if (creator.videos > 1 && creator.avgEngagementRate >= 0.2) {
        why = "Repeat performer with unusually high engagement efficiency.";
      } else if (creator.videos > 1) {
        why = "Multiple clips give a stronger signal than a single viral moment.";
      } else if (creator.avgEngagementRate >= 0.2) {
        why = "High audience response per view makes this worth a closer look.";
      } else if (creator.views >= 1_000_000) {
        why = "Enough reach to matter, with response rates that clear the baseline.";
      }

      return { ...creator, why };
    })
    .sort((a, b) => b.score - a.score);

  return cachedCreators;
}

export function getDashboardData() {
  const videos = getVideos();
  const creators = getCreators();
  const prospects = creators
    .filter((creator) => creator.contextKind === "prospect" && !creator.verified && creator.views >= 100_000)
    .slice(0, 5)
    .map((creator, index) => ({ ...creator, rank: index + 1 }));
  const benchmarks = creators
    .filter((creator) => creator.contextKind === "benchmark")
    .sort((a, b) => b.views - a.views)
    .slice(0, 3);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  return {
    metrics: [
      [formatCount(new Set(videos.map((row) => row.author_name)).size), "distinct creators"],
      [formatCount(new Set(videos.filter((row) => row.author_verified).map((row) => row.author_name)).size), "verified creators"],
      [formatCount(median(videos.map((row) => row.views))), "median views per video"],
      [formatPercent(median(videos.map((row) => row.engagementRate))), "median engagement rate"]
    ],
    prospects,
    benchmarks,
    themes: ["anime/edit culture", "fitness/gym", "sports/equestrian", "tutorial/art formats", "duet/stitch formats"]
  };
}

export function classifyQuestion(question: string): Intent {
  const q = question.toLowerCase();
  if (!q.trim()) return "clarify";
  if (/\b(demographic|demographics|location|age|gender|gen z|current|available|availability|followers|brand safety)\b/.test(q)) return "unsupported";
  if (/\b(creators?|authors?|accounts?)\b/.test(q) && /\bvid\w*/.test(q) && /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/.test(q)) return "creator_video_count";
  if (/(limit|caveat|overclaim|missing|trust|honest)/.test(q)) return "data_limitations";
  if (/(engagement|engaged|interaction|comments|shares)/.test(q)) return "top_creators_by_engagement";
  if (/\b(billie|spencerx|celebrity|verified)\b|reach benchmark|high reach|why not/.test(q)) return "high_reach_benchmarks";
  if (/(hashtag|theme|content|format|niche|music|audio)/.test(q)) return "promising_content_themes";
  if (/(who|reach out|partnership|prospect|promising|priority|focus|best)/.test(q)) return "best_partnership_prospects";

  const creator = getCreators().find((item) => q.includes(item.name.toLowerCase()));
  if (creator) return "creator_lookup";
  return "clarify";
}

function numericWord(value: string) {
  return (
    {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10
    } as Record<string, number>
  )[value];
}

function extractVideoThreshold(question: string) {
  const q = question.toLowerCase();
  const rawCount = q.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/)?.[1] ?? "2";
  const count = Number(rawCount) || numericWord(rawCount) || 2;
  return /\bmore than\b/.test(q) ? count + 1 : count;
}

function compactCreator(creator: CreatorSummary) {
  return {
    creator: creator.name,
    top_hashtags: creator.topHashtags.join(", ") || "none",
    videos: creator.videos,
    views: creator.views,
    interactions: creator.interactions,
    avg_engagement_rate: Number(creator.avgEngagementRate.toFixed(4)),
    opportunity_score: creator.score
  };
}

export function runQuery(question: string): QueryResult {
  const intent = classifyQuestion(question);
  const creators = getCreators();
  const dashboard = getDashboardData();
  const caveat = "The CSV does not include follower count, audience demographics, creator availability, location, or brand-safety review.";

  if (intent === "unsupported") {
    return {
      intent,
      title: "Not answerable from this CSV",
      answer:
        "I can't answer that from this CSV because it does not include audience demographics, location, follower counts, current availability, or brand-safety review. I can still rank creators by reach, engagement, or partnership opportunity using the available fields.",
      caveat,
      rows: [],
      suggestedFollowup: "Which creators look strongest by engagement efficiency?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "clarify") {
    return {
      intent,
      title: "Clarify the priority",
      answer: "I can answer this, but I need one more choice: should I optimize for reach, engagement efficiency, or partnership opportunity?",
      caveat,
      rows: [],
      suggestedFollowup: "Who should we reach out to first?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "data_limitations") {
    return {
      intent,
      title: "What not to overclaim",
      answer:
        "Use this as a prioritization screen, not a final outreach list. It can show reach and engagement patterns, but it cannot prove follower size, audience fit, current activity, brand safety, or whether the creator is reachable.",
      caveat,
      rows: [],
      suggestedFollowup: "Which creators are strongest despite those limits?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "high_reach_benchmarks") {
    const rows = dashboard.benchmarks.map(compactCreator);
    return {
      intent,
      title: "High-reach benchmarks",
      answer:
        "The celebrity-scale creators are useful benchmarks for what massive reach looks like, but I would not make them the default outreach priority. For this strategy screen, mid-tail creators with strong response rates are more actionable partnership prospects.",
      caveat,
      rows,
      suggestedFollowup: "Which mid-tail creators should we prioritize instead?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "promising_content_themes") {
    return {
      intent,
      title: "Promising content themes",
      answer:
        "The strongest content lanes to test are anime/edit culture, fitness/gym, sports/equestrian, tutorial/art formats, and duet/stitch formats. I would treat these as briefing themes for partnership experiments, not as guarantees that every creator in the theme will fit.",
      caveat,
      rows: dashboard.themes.map((theme) => ({ theme })),
      suggestedFollowup: "Which creators represent those themes best?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "creator_video_count") {
    const threshold = extractVideoThreshold(question);
    const rows = creators
      .filter((creator) => creator.videos >= threshold)
      .sort((a, b) => b.videos - a.videos || b.views - a.views || a.name.localeCompare(b.name))
      .map(compactCreator);

    return {
      intent,
      title: `Creators with ${threshold}+ videos`,
      answer: rows.length
        ? `${rows.length} creator${rows.length === 1 ? "" : "s"} have ${threshold} or more videos in the spreadsheet. The matching creators are listed in the table.`
        : `No creators have ${threshold} or more videos in the spreadsheet.`,
      caveat,
      rows,
      suggestedFollowup: "Which of these have the strongest engagement efficiency?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  if (intent === "top_creators_by_engagement") {
    const rows = creators
      .filter((creator) => !creator.verified && creator.views >= 100_000)
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate || b.views - a.views)
      .slice(0, 5)
      .map(compactCreator);
    return {
      intent,
      title: "Top engagement-efficient creators",
      answer:
        "Among unverified creators with at least 100k total views, the strongest engagement-efficient candidates are the ones with high response per view rather than the largest raw reach. These are good first-pass prospects for manual review.",
      caveat,
      rows,
      suggestedFollowup: "Which of these are best partnership prospects overall?",
      usedModel: false,
      modelProvider: "local"
    };
  }

  const lookup = creators.find((item) => question.toLowerCase().includes(item.name.toLowerCase()));
  const rows = lookup ? [compactCreator(lookup)] : dashboard.prospects.map(compactCreator);

  return {
    intent: lookup ? "creator_lookup" : "best_partnership_prospects",
    title: lookup ? `Creator lookup: ${lookup.name}` : "Best partnership prospects",
    answer: lookup
      ? `${lookup.name} is labeled ${lookup.context}. The strongest available signal is ${lookup.evidence.toLowerCase()}, so I would use this as a prompt for closer manual review rather than a final decision.`
      : "The best first outreach list is mid-tail, unverified creators with meaningful reach, high engagement efficiency, and repeat signal where available. They are more actionable than celebrity-scale accounts because they show responsive audiences without being dominated by pure fame.",
    caveat,
    rows,
    suggestedFollowup: "Why are these ranked above higher-reach creators?",
    usedModel: false,
    modelProvider: "local"
  };
}

function promptPayload(question: string, result: QueryResult) {
  return JSON.stringify({ question, query_result: result });
}

function systemPrompt() {
  return "You answer a busy Head of Creator Partnerships. Use only the provided query result. Be concise and plain-English. Do not include a caveat; the interface displays the caveat separately. Do not invent follower counts, demographics, current creator status, or unsupported claims.";
}

function answerWithoutDuplicateCaveat(text: string) {
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => !/^\s*\*{0,2}caveat\s*:/i.test(paragraph.trim()))
    .join("\n\n")
    .trim();
}

function providerPreference() {
  return (import.meta.env.LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? "auto").toLowerCase();
}

async function summarizeWithOpenAI(question: string, result: QueryResult): Promise<QueryResult> {
  const apiKey = import.meta.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return result;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: import.meta.env.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content: systemPrompt()
        },
        {
          role: "user",
          content: promptPayload(question, result)
        }
      ]
    })
  });

  if (!response.ok) return result;
  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item: any) => item.content ?? []).map((item: any) => item.text).join("\n");
  if (!text) return result;

  return { ...result, answer: answerWithoutDuplicateCaveat(text), usedModel: true, modelProvider: "openai" };
}

async function summarizeWithAnthropic(question: string, result: QueryResult): Promise<QueryResult> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const authToken = import.meta.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) return result;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: import.meta.env.ANTHROPIC_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: systemPrompt(),
      messages: [
        {
          role: "user",
          content: promptPayload(question, result)
        }
      ]
    })
  });

  if (!response.ok) return result;
  const data = await response.json();
  const text = data.content
    ?.filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");
  if (!text) return result;

  return { ...result, answer: answerWithoutDuplicateCaveat(text), usedModel: true, modelProvider: "anthropic" };
}

export async function summarizeWithModel(question: string, result: QueryResult): Promise<QueryResult> {
  if (result.intent === "creator_video_count") return result;

  const provider = providerPreference();

  if (provider === "anthropic" || provider === "claude") {
    return summarizeWithAnthropic(question, result);
  }

  if (provider === "openai") {
    return summarizeWithOpenAI(question, result);
  }

  const openAiResult = await summarizeWithOpenAI(question, result);
  if (openAiResult.usedModel) return openAiResult;

  return summarizeWithAnthropic(question, result);
}
