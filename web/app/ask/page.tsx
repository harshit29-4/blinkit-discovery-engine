import type { Metadata } from "next";
import { Suspense } from "react";
import { AskChat } from "@/components/ask-chat";
import { PageHeader, Skeleton } from "@/components/ui";
import { RESEARCH_QUESTIONS } from "@/lib/research";

export const metadata: Metadata = { title: "Ask" };

export default function AskPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Ask the engine"
        subtitle="Answers come only from collected feedback, cite their sources and are checked automatically."
        learn="ask" />
      {/* The chat reads ?q= (a question sent from the header or a tile), so it renders on the client. */}
      <Suspense fallback={<Skeleton h="h-64" />}>
        <AskChat suggestions={Object.values(RESEARCH_QUESTIONS)} />
      </Suspense>
    </div>
  );
}
