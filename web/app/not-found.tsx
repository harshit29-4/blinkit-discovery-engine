import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted">There&rsquo;s nothing at this address.</p>
      <p className="mt-4 flex gap-4">
        <Link href="/" className="text-accent underline underline-offset-2">Overview</Link>
        <Link href="/evidence" className="text-accent underline underline-offset-2">Evidence</Link>
        <Link href="/health" className="text-accent underline underline-offset-2">Health</Link>
      </p>
    </div>
  );
}
