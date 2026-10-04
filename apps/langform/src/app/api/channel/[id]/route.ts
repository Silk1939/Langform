import { CHANNEL_ID } from "@/lib/ids";
import { loadChannel } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!CHANNEL_ID.test(id)) {
    return Response.json({ error: "Unbekannter Kanal." }, { status: 404 });
  }
  try {
    const result = await loadChannel(id);
    return Response.json(result);
  } catch {
    return Response.json({ error: "Der Kanal ist gerade nicht zu erreichen." }, { status: 502 });
  }
}