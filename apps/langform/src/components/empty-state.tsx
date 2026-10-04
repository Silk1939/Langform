import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-2xl">{title}</CardTitle>
        <CardDescription className="text-base leading-relaxed">{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}
