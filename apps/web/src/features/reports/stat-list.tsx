/** A row of small counts (problems by resolution, tasks by status) as a named region with a description list. */
export function StatList({ label, items }: { label: string; items: readonly { label: string; value: number }[] }) {
  return (
    <section aria-label={label}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
        {items.map((i) => (
          <div key={i.label} className="bg-card shadow-card rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">{i.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
