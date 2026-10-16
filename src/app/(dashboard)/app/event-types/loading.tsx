// OWNER: event-types-editor.
//
// Loading state of the event type editor routes (ARCHITECTURE section 26 rule 7): the editor's full-page layout with
// a skeleton settings panel and preview, so the page does not jump when the editor arrives.
import { Skeleton } from "@/components/ui/skeleton";

export default function EventTypeEditorLoading() {
  return (
    <div className="fixed inset-0 z-30 flex bg-canvas" role="status" aria-busy="true" aria-label="Loading event type">
      <div className="flex h-full w-full flex-col border-line bg-white lg:w-[440px] lg:border-r">
        <div className="flex flex-col gap-3 border-b border-line px-6 pt-4 pb-4">
          <Skeleton width={112} height={24} />
          <Skeleton width={80} height={12} />
          <Skeleton width={224} height={24} />
        </div>
        <div className="flex flex-col">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line px-6 py-5">
              <Skeleton width={20} height={20} rounded="full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton width={128} height={16} />
                <Skeleton width={192} height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden flex-1 items-start justify-center p-10 lg:flex">
        <div className="w-full max-w-[800px]">
          <Skeleton height={520} />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
