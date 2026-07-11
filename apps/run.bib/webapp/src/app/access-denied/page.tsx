import { loadCopy, t } from "@/lib/copy";

export default async function AccessDenied() {
  const copy = await loadCopy("default");
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
      <h1 style={{ color: "#ef4444", marginBottom: "1rem" }}>
        {t(copy, "bib.accessDenied.title")}
      </h1>
      <p style={{ color: "#a1a1aa", marginBottom: "1.5rem", maxWidth: "400px" }}>
        {t(copy, "bib.accessDenied.body")}
      </p>
      <p style={{ color: "#a1a1aa", marginBottom: "2rem" }}>
        {t(copy, "bib.accessDenied.contact")}
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
        {t(copy, "bib.accessDenied.cta")}
      </a>
    </div>
  );
}
