// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Loading state of the auth pages: the centered card with skeleton lines while the page renders.
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas" aria-busy="true">
      <header className="flex justify-center px-4 pt-8 pb-6 sm:pt-12">
        <Logo />
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pb-16">
        <div className="w-full max-w-[440px] rounded-[var(--radius-card)] border border-line bg-white px-5 py-8 shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
          <Skeleton height={32} width="75%" className="mx-auto" />
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton height={48} rounded="full" />
            <Skeleton height={48} rounded="full" />
            <Skeleton height={16} width="33%" className="mt-2" />
            <Skeleton height={48} />
            <Skeleton height={48} rounded="full" />
          </div>
          <span className="sr-only" role="status">
            Loading
          </span>
        </div>
      </main>
    </div>
  );
}
