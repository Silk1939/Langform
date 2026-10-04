import { loadHome } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  try {
    const videos = await loadHome({ fresh });
    return Response.json({ videos });
  } catch {
    return Response.json({ error: "Die Liste ist gerade nicht zu erreichen." }, { status: 502 });
  }
}
