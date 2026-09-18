import { Bar, LoadingShell } from "@/components/Skeleton";

/**
 * Shown while an edition page renders (a navigation from the archive, or a
 * cold cache). Mirrors the real layout, so nothing jumps when it arrives.
 * Today's paper being generated shows the printing-press screen instead.
 */
export default function EditionLoading() {
  return (
    <LoadingShell label="Loading edition…">
      <div aria-hidden="true" className="page-x pt-6 sm:pt-10">
        <div className="flex justify-between pb-3">
          <Bar className="h-3 w-28" />
          <Bar className="hidden h-3 w-48 sm:block" />
          <Bar className="h-3 w-32" />
        </div>
        <div className="h-px bg-rule" />
        <Bar className="mx-auto my-6 h-[clamp(3rem,12vw,10rem)] w-11/12 rounded-3xl" />
        <div className="border-t-[3px] border-double border-rule" />
      </div>
      <div aria-hidden="true" className="mt-6 h-12 border-y border-rule" />
      <div aria-hidden="true" className="page-x grid gap-10 py-12 lg:grid-cols-12 lg:gap-12">
        <div className="space-y-4 lg:col-span-8">
          <Bar className="h-6 w-40" />
          <Bar className="h-14 w-full rounded-2xl" />
          <Bar className="h-14 w-4/5 rounded-2xl" />
          <Bar className="mt-6 h-5 w-3/4" />
          <div className="grid gap-3 pt-6 md:grid-cols-2 md:gap-10">
            {[0, 1].map((column) => (
              <div key={column} className="space-y-3">
                {[100, 96, 98, 90, 94, 70].map((width, index) => (
                  <Bar key={index} className="h-4" style={{ width: `${width}%` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6 lg:col-span-4 lg:border-l lg:border-rule lg:pl-10">
          <Bar className="h-3 w-24" />
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex gap-4">
              <Bar className="h-9 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3 w-16" />
                <Bar className="h-5 w-full" />
                <Bar className="h-5 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingShell>
  );
}
