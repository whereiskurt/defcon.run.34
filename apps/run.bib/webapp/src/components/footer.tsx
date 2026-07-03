/**
 * Site footer (v1.6) — mirrors run.human's minimal footer. Server component.
 */
export function Footer({ versionTooltip }: { versionTooltip?: string }) {
  return (
    <footer className="relative z-10 border-t border-divider/40 py-5 mt-10">
      <div className="container mx-auto max-w-[900px] px-6 flex items-center justify-between text-xs text-default-500">
        <span className="font-museo tracking-tight">
          defcon<span className="teal-dot">.</span>run 34
        </span>
        <span>{versionTooltip}</span>
      </div>
    </footer>
  );
}

export default Footer;
