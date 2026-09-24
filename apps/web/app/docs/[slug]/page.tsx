import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { listDocs, readDoc } from "@/lib/docs";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

export function generateStaticParams() {
  return listDocs().map((d) => ({ slug: d.slug }));
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = readDoc(slug);
  if (!doc) notFound();
  const all = listDocs();

  return (
    <div className="shell">
      <Header />
      <div className="grid">
        <div className="col">
          <article className="panel doc">
            <div className="head">{doc.title}</div>
            {/*
              The content is a file from this repository, read at build time — not anything a
              visitor supplied — so rendering it as markup is rendering our own prose. Nothing here
              is fetched at runtime, which is what keeps that true.
            */}
            <div
              className="doc-body"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time repo content
              dangerouslySetInnerHTML={{ __html: doc.html }}
            />
          </article>
        </div>
        <div className="right">
          <nav className="panel">
            <div className="head">
              Documentation<span className="hint">from the repository</span>
            </div>
            {all.map((d) => (
              <Link
                className={d.slug === slug ? "doc-link current" : "doc-link"}
                href={`/docs/${d.slug}`}
                key={d.slug}
              >
                {d.title}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <Footer />
    </div>
  );
}
