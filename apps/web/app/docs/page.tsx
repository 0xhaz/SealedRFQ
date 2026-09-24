import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { listDocs } from "@/lib/docs";
import Link from "next/link";

export const dynamic = "force-static";

/**
 * The documentation index.
 *
 * Served from the app rather than from a docs host so a reader never has to leave to find out how
 * the thing in front of them works — and read from the repository's own files, so there is one copy
 * of every sentence rather than two that drift.
 */
export default function DocsIndex() {
  const docs = listDocs();
  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">Documentation</h2>
        <p className="desk-head-sub">
          How a tender runs, what each side has to do, and how to check the result yourself. These
          pages are the repository's own documentation, rendered here so you do not have to go
          looking for them.
        </p>
      </section>

      <div className="supplier-list">
        {docs.map((d) => (
          <Link className="panel doc-card" href={`/docs/${d.slug}`} key={d.slug}>
            <div className="head">{d.title}</div>
            {d.summary && <div className="note">{d.summary}</div>}
          </Link>
        ))}
      </div>
      <Footer />
    </div>
  );
}
