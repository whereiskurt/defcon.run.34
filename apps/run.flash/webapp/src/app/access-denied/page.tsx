export default function AccessDenied() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h1>
      <p style={{ color: "#a1a1aa", marginBottom: "1.5rem", maxWidth: "400px" }}>
        You don&apos;t have access to the Flash Tool. This service requires the{" "}
        <code
          style={{
            background: "#1f1f1f",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.25rem",
          }}
        >
          flash
        </code>{" "}
        service claim.
      </p>
      <p style={{ color: "#a1a1aa", marginBottom: "2rem" }}>
        Contact an administrator to request access.
      </p>
      <a
        href="/"
        style={{
          color: "#3b82f6",
          textDecoration: "none",
          padding: "0.75rem 1.5rem",
          border: "1px solid #3b82f6",
          borderRadius: "0.5rem",
        }}
      >
        Return Home
      </a>
    </div>
  );
}
