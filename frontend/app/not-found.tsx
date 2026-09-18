import { ErrorState } from "@/components/ErrorState";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NAV_COMMANDS } from "@/lib/commands";

export const metadata = { title: "Not found" };

export default function NotFound() {
  // "/" redirects to the current date on every request, so this link never
  // freezes to the build date.
  return (
    <>
      <SiteHeader entries={NAV_COMMANDS} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <ErrorState
          code="404"
          title="Stop the presses: this page was never printed."
          body={
            <p>
              There&apos;s no edition or story at this address. Editions exist only for days the paper went to press,
              and nothing is printed ahead of time.
            </p>
          }
        />
      </main>
      <SiteFooter />
    </>
  );
}
