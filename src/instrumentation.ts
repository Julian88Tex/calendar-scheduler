// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Next.js instrumentation (ARCHITECTURE section 12.3): starts the self-hosted job poller (src/lib/jobs/poller.ts) in
// the Node runtime. The literal process.env.NEXT_RUNTIME check lets Next drop the import from the Edge build (the
// poller reaches the database driver, which is Node only). The poller itself stays off on Vercel, under tests, in E2E
// mode and during `next build`.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobPoller } = await import("./lib/jobs/poller");
    startJobPoller();
  }
}
