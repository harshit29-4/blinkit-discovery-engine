import type { Metadata } from "next";
import Link from "next/link";
import { AskChat } from "@/components/ask-chat";
import { RESEARCH_QUESTIONS } from "@/lib/research";

export const metadata: Metadata = { title: "Ask" };

export default function AskPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask the engine</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Ask a question about Blinkit customers in plain language. An AI agent searches the collected feedback,
          counts the AI-tagged entries in the database and writes an answer that cites the entries it relied on.
          Every answer is then checked automatically: each citation must be an entry the agent actually read,
          each number must appear in the data it retrieved, and a second AI model judges whether the cited
          evidence supports the claims. The checks and the steps taken are shown with each answer. See{" "}
          <Link href="/how-it-works" className="text-accent underline underline-offset-2">How it works</Link> and{" "}
          <Link href="/validation" className="text-accent underline underline-offset-2">Validation</Link>.
        </p>
      </div>
      <AskChat suggestions={Object.values(RESEARCH_QUESTIONS)} />
    </div>
  );
}
