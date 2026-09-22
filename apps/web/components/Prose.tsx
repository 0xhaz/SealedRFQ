/**
 * Renders authored text with its paragraph breaks intact.
 *
 * Terms arrive as one string with blank lines between clauses, and HTML collapses those to single
 * spaces — so nine numbered clauses became one unbroken block that nobody would read before
 * agreeing to it. Splitting on blank lines restores the structure the author wrote, and a lone
 * newline is treated as a break too, since a buyer typing their own terms will use whichever they
 * reach for.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((p) => (
        <p key={p.slice(0, 48)} className="prose-p">
          {p}
        </p>
      ))}
    </div>
  );
}
