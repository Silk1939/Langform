import { VIDEO_ID } from "@/lib/ids";
import { loadWatch } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!VIDEO_ID.test(id)) {
    return Response.json({ error: "Unbekanntes Video." }, { status: 404 });
  }
  try {
    const details = await loadWatch(id);
    return Response.json(details);
  } catch {
    return Response.json({ error: "Die Angaben sind gerade nicht zu erreichen." }, { status: 502 });
  }
}
