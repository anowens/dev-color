import type { APIRoute } from "astro";
import { runQuery, summarizeWithModel } from "../../lib/creatorData";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const question = String(body.question ?? "");
    const result = await summarizeWithModel(question, runQuery(question));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        intent: "unsupported",
        title: "Q&A error",
        answer: "I could not answer that question. Try asking about creators, engagement, reach benchmarks, content themes, or data limitations.",
        caveat: error instanceof Error ? error.message : "Unknown error",
        rows: [],
        suggestedFollowup: "Who should we reach out to first?",
        usedModel: false,
        modelProvider: "local"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
