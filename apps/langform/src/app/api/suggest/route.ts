import { loadSuggestions } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const suggestions = await loadSuggestions(query);
    return Response.json({ suggestions });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
