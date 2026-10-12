// OWNER: foundation-ui.
//
// Last-resort error boundary (SPEC GEN-12): replaces the root layout, so it renders its own html and body with inline
// styles in the classic tokens (the stylesheet may not have loaded). Never shows internals.
"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#fafafa",
          color: "#0a2540",
          fontFamily: '"Figtree Variable", "Proxima Nova", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "66px 16px 30px",
          boxSizing: "border-box",
        }}
      >
        <main
          id="main"
          style={{
            width: "100%",
            maxWidth: 560,
            background: "#ffffff",
            border: "1px solid #d4e0ed",
            borderRadius: 8,
            boxShadow: "0 1px 8px 0 rgb(0 0 0 / 8%)",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 22, lineHeight: "28px", fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 16, lineHeight: 1.4, color: "#476788", margin: "12px 0 0" }}>We couldn&apos;t load this page. Try again in a moment.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#476788", margin: "8px 0 0" }}>Reference: {error.digest}</p>}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 24,
              minHeight: 40,
              padding: "8px 16px",
              border: "none",
              borderRadius: 9999,
              background: "#006bff",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
