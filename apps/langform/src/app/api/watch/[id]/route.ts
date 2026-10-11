import { VIDEO_ID } from "@/lib/ids";
import { loadWatch, loadWatchWithRelated } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!VIDEO_ID.test(id)) {
    return Response.json({ error: "Unbekanntes Video." }, { status: 404 });
  }
  try {
    const related = new URL(request.url).searchParams.get("related") === "1";
    const details = await (related ? loadWatchWithRelated(id) : loadWatch(id));
    return Response.json(details);
  } catch {
    return Response.json({ error: "Die Angaben sind gerade nicht zu erreichen." }, { status: 502 });
  }
}
