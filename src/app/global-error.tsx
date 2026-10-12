// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Last-resort error boundary (replaces the root layout, so it renders its own html and body).
"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, sans-serif", color: "#0a2540", padding: "96px 16px", textAlign: "center" }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong.</h1>
        <p>{error.digest ? `Reference: ${error.digest}` : "Try again."}</p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
