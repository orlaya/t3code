/** Small coloured dot indicating hidden search matches inside a collapsed section. */
export function SearchMatchDot() {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: "oklch(0.85 0.15 85)" }}
      title="Search match in collapsed content"
    />
  );
}
