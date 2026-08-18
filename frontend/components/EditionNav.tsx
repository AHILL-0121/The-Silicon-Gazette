import Link from "next/link";

interface EditionNavProps {
  previousDate: string | null;
  nextDate: string | null;
}

export function EditionNav({ previousDate, nextDate }: EditionNavProps) {
  if (!previousDate && !nextDate) {
    return null;
  }

  return (
    <nav className="edition-nav" aria-label="Edition navigation">
      <div>
        {previousDate ? <Link href={`/gazette/${previousDate}`}>{"<- Previous Edition"}</Link> : null}
      </div>
      <div>{nextDate ? <Link href={`/gazette/${nextDate}`}>{"Next Edition ->"}</Link> : null}</div>
    </nav>
  );
}