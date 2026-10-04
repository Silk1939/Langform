import { loadSearch } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const videos = await loadSearch(query);
    return Response.json({ videos });
  } catch {
    return Response.json({ error: "Die Suche ist gerade nicht zu erreichen." }, { status: 502 });
  }
}
