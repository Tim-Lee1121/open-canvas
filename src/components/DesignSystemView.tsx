import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Code2, FolderKanban, LayoutGrid, Moon, Sparkles, Sun, X } from "./huge-icons";
import { DGA_MANIFEST, validateHtmlDesign } from "../design-system/dgaProvider";
import type { DesignSystemComponentSummary, DesignSystemManifest } from "../design-system/types";
import type { PageDesignSystemBinding } from "../domain/model";

type DesignSystemSection = "overview" | "tokens" | "components" | "patterns" | "validation";

const sectionIcons = {
  overview: Sparkles,
  tokens: Code2,
  components: LayoutGrid,
  patterns: FolderKanban,
  validation: CheckCircle2,
} as const;

const tokenColorSwatches = [
  ["Primary", "#1B8354"],
  ["Primary light", "#54C08A"],
  ["Secondary", "#DBA102"],
  ["Tertiary", "#80519F"],
  ["Info", "#1570EF"],
  ["Error", "#D92D20"],
] as const;

const tokenSpacingScale = [2, 8, 16, 24, 40, 64];
const tokenRadiusScale = [0, 4, 8, 16, 24, 9999];
const tokenTypeScale = [12, 16, 20, 24, 32];

export interface DesignSystemViewProps {
  manifest?: DesignSystemManifest;
  pages?: Array<{ id: string; title: string; source: { type: "html" | "url"; value: string }; designSystemBinding?: PageDesignSystemBinding }>;
}

export function DesignSystemView({ manifest = DGA_MANIFEST, pages = [] }: DesignSystemViewProps) {
  const [section, setSection] = useState<DesignSystemSection>("overview");
  const [theme, setTheme] = useState(manifest.theme);
  const htmlPages = useMemo(() => pages.filter((page) => page.source.type === "html"), [pages]);
  return (
    <section className="design-system-workspace" aria-label="Design System workspace">
      <header className="design-system-header">
        <div>
          <h1>{manifest.name}</h1>
          <p>{manifest.source.entrypoint} · v{manifest.version} · {manifest.status}</p>
        </div>
        <div className="design-system-theme">
          <span>Theme</span>
          <button
            type="button"
            className="design-system-theme-toggle"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            aria-pressed={theme === "dark"}
          >
            {theme === "light" ? <Sun size={19} strokeWidth={2} aria-hidden="true" /> : <Moon size={19} strokeWidth={2} aria-hidden="true" />}
            <span className="sr-only">{theme}</span>
          </button>
        </div>
      </header>
      <nav className="design-system-tabs" aria-label="Design System sections" role="tablist">
        {(["overview", "tokens", "components", "patterns", "validation"] as const).map((item) => (
          <button key={item} id={`design-system-tab-${item}`} type="button" role="tab" className={section === item ? "is-active" : ""} onClick={() => setSection(item)} aria-selected={section === item} aria-controls={`design-system-panel-${item}`}>
            {(() => { const Icon = sectionIcons[item]; return <Icon size={16} strokeWidth={2} aria-hidden="true" />; })()}
            <span>{item[0].toUpperCase() + item.slice(1)}</span>
          </button>
        ))}
      </nav>
      <div role="tabpanel" id={`design-system-panel-${section}`} aria-labelledby={`design-system-tab-${section}`} tabIndex={0}>
        {section === "overview" ? <Overview manifest={manifest} theme={theme} pages={pages} /> : null}
        {section === "tokens" ? <TokenCatalog manifest={manifest} theme={theme} /> : null}
        {section === "components" ? <ComponentCatalog manifest={manifest} theme={theme} /> : null}
        {section === "patterns" ? <PatternCatalog manifest={manifest} /> : null}
        {section === "validation" ? <ValidationCatalog pages={htmlPages} /> : null}
      </div>
    </section>
  );
}

function Overview({ manifest, theme, pages }: { manifest: DesignSystemManifest; theme: string; pages: DesignSystemViewProps["pages"] }) {
  return <div className="design-system-content">
    <div className="design-system-cards">
      <article><Sparkles size={20} /><strong>Active system</strong><span>{manifest.id}@{manifest.version}</span></article>
      <article><Code2 size={20} /><strong>Theme</strong><span>{theme}</span></article>
      <article><CheckCircle2 size={20} /><strong>Readiness</strong><span>{manifest.readiness.levelA}/{manifest.readiness.total} A-ready</span></article>
      <article><FolderKanban size={20} /><strong>Pages</strong><span>{pages?.length ?? 0} tracked</span></article>
    </div>
    <div className="design-system-panel"><h2>Execution contract</h2><ul>{manifest.hardStops.map((item) => <li key={item}>{item}</li>)}</ul></div>
    <div className="design-system-panel"><h2>Provenance</h2><p>Source digest: <code>{manifest.source.digest}</code></p><p>{manifest.provenance.length} source records are available to the provider.</p></div>
  </div>;
}

function TokenCatalog({ manifest, theme }: { manifest: DesignSystemManifest; theme: string }) {
  const themeLabel = theme === "dark" ? "Dark theme" : "Light theme";
  return <div className="design-system-content">
    <div className="design-system-section-heading design-system-section-heading--flush">
      <div><h2>Tokens</h2><p>Visual scales resolved from the DGA foundation and {themeLabel.toLowerCase()} semantics.</p></div>
      <span>{themeLabel} selected</span>
    </div>
    <div className="design-system-token-overview">
      <article className="design-system-token-visual design-system-token-visual--colors">
        <div className="design-system-token-visual__header"><div><strong>Color system</strong><small>138 foundation values</small></div><span className="design-system-token-kind">Color</span></div>
        <div className="design-system-color-ramp">{tokenColorSwatches.map(([label, color]) => <div key={label} className="design-system-color-swatch" style={{ backgroundColor: color }} title={`${label} ${color}`}><span>{label}</span></div>)}</div>
        <small className="design-system-token-footnote">Primary, secondary, tertiary and status ramps</small>
      </article>
      <article className="design-system-token-visual">
        <div className="design-system-token-visual__header"><div><strong>Spacing scale</strong><small>32 foundation values</small></div><span className="design-system-token-kind">Layout</span></div>
        <div className="design-system-spacing-scale">{tokenSpacingScale.map((value) => <div key={value} className="design-system-spacing-row"><code>{value}px</code><span className="design-system-spacing-bar" style={{ width: `${Math.min(value * 2, 128)}px` }} /></div>)}</div>
        <small className="design-system-token-footnote">Base rhythm from 2px to 64px</small>
      </article>
      <article className="design-system-token-visual">
        <div className="design-system-token-visual__header"><div><strong>Radius scale</strong><small>7 corner values</small></div><span className="design-system-token-kind">Shape</span></div>
        <div className="design-system-radius-scale">{tokenRadiusScale.map((value) => <div key={value} className="design-system-radius-sample" style={{ borderRadius: value }}><code>{value === 9999 ? "full" : `${value}px`}</code></div>)}</div>
        <small className="design-system-token-footnote">Component geometry uses radius-sm through radius-xl</small>
      </article>
      <article className="design-system-token-visual">
        <div className="design-system-token-visual__header"><div><strong>Typography scale</strong><small>68 foundation values</small></div><span className="design-system-token-kind">Type</span></div>
        <div className="design-system-type-scale">{tokenTypeScale.map((value) => <div key={value} className="design-system-type-row"><code>{value}</code><span style={{ fontSize: value }}>DGA interface type</span></div>)}</div>
        <small className="design-system-token-footnote">IBM Plex Sans Arabic · size and line-height tokens</small>
      </article>
    </div>
    <div className={`design-system-theme-preview design-system-theme-preview--${theme}`}>
      <div><strong>{themeLabel} semantic preview</strong><span>Background, text and action tokens stay within one theme.</span></div>
      <div className="design-system-theme-preview__sample"><span className="design-system-theme-preview__dot" /><span>Surface</span><span className="design-system-theme-preview__action">Primary action</span></div>
    </div>
    <div className="design-system-section-heading design-system-section-heading--compact"><div><h2>Token index</h2><p>Provider records and source references.</p></div><span>{manifest.tokens.length} records</span></div>
    <div className="design-system-list">{manifest.tokens.map((token) => <article key={token.id}><span className={`token-swatch token-swatch--${token.category}`} /><div><strong>{token.label}</strong><small>{token.id} · {token.value ?? "semantic contract"}</small></div></article>)}</div>
  </div>;
}

function ComponentCatalog({ manifest, theme }: { manifest: DesignSystemManifest; theme: string }) {
  const categoryCount = new Map<string, number>();
  manifest.components.forEach((component) => categoryCount.set(component.category, (categoryCount.get(component.category) ?? 0) + 1));
  return <div className="design-system-content">
    <div className="design-system-section-heading">
      <div><h2>Components</h2><p>Rendered previews for the documented DGA component contracts.</p></div>
      <span>{manifest.components.length} indexed examples</span>
    </div>
    <div className="design-system-component-summary">
      <article><strong>{manifest.components.length}</strong><span>Components</span></article>
      <article><strong>{categoryCount.size}</strong><span>Categories</span></article>
      <article><strong>{manifest.components.filter((component) => component.readiness === "A").length}</strong><span>A-ready</span></article>
      <article><strong>{manifest.components.filter((component) => component.executionContract === "Complete").length}</strong><span>Contracts complete</span></article>
    </div>
    <div className="design-system-component-grid">{manifest.components.map((component) => <article key={component.slug} className="design-system-component-card">
      <header className="design-system-component-card__header"><div><h3>{component.name}</h3><small>{component.category} · {component.slug}</small></div><span className="readiness-badge">{component.readiness} · ready</span></header>
      <div className={`design-system-component-preview design-system-component-preview--${theme}`}><ComponentPreview component={component} /></div>
      <footer className="design-system-component-card__footer"><span>{component.executionContract}</span><code>03-components/{component.slug}</code></footer>
    </article>)}</div>
  </div>;
}

function ComponentPreview({ component }: { component: DesignSystemComponentSummary }) {
  const previewId = useId().replace(/:/g, "");
  const [activeItem, setActiveItem] = useState(() => component.slug === "content-switcher" ? "List" : component.category === "UI Shell" ? "Home" : "Overview");
  const [fieldValue, setFieldValue] = useState("");
  const [switchOn, setSwitchOn] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  const [buttonStatus, setButtonStatus] = useState("");
  const [sortAscending, setSortAscending] = useState(true);
  const modalTriggerRef = useRef<HTMLButtonElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (component.slug === "modal" && overlayOpen) modalCloseRef.current?.focus();
  }, [component.slug, overlayOpen]);

  const closeModal = () => {
    setOverlayOpen(false);
    window.setTimeout(() => modalTriggerRef.current?.focus(), 0);
  };

  if (component.slug === "button") return <div className="ds-demo-stack"><div className="ds-demo-row">{["Primary", "Secondary", "Subtle"].map((label) => <button key={label} type="button" className={`ds-demo-button ds-demo-button--${label.toLowerCase()}`} onClick={() => setButtonStatus(`${label} activated`)}>{label}</button>)}</div><small className="ds-demo-live-status" role="status">{buttonStatus || "Large · Medium · Small"}</small></div>;
  if (component.slug === "text-input" || component.slug === "search-box") return <label className="ds-demo-field" htmlFor={`${previewId}-field`}><span className="ds-demo-field__label">{component.slug === "search-box" ? "Search" : "Text input"}</span><span className="ds-demo-field__control"><span className="ds-demo-field__icon" aria-hidden="true" /><input id={`${previewId}-field`} aria-label={component.slug === "search-box" ? "Search" : "Text input"} type={component.slug === "search-box" ? "search" : "text"} value={fieldValue} onChange={(event) => setFieldValue(event.target.value)} placeholder="Enter a value" /></span><small>{fieldValue ? `${fieldValue.length} characters` : "Default"}</small></label>;
  if (component.slug === "textarea") return <label className="ds-demo-field" htmlFor={`${previewId}-textarea`}><span className="ds-demo-field__label">Message</span><textarea id={`${previewId}-textarea`} aria-label="Message" value={fieldValue} onChange={(event) => setFieldValue(event.target.value)} placeholder="Add details" /><small>{fieldValue.length}/120</small></label>;
  if (component.slug === "checkbox") return <label className="ds-demo-choice"><input type="checkbox" defaultChecked /><span>Receive updates</span></label>;
  if (component.slug === "radio") return <fieldset className="ds-demo-choice-group"><legend>Priority</legend>{["Standard", "Urgent"].map((label, index) => <label key={label}><input type="radio" name={`${previewId}-priority`} defaultChecked={index === 0} /><span>{label}</span></label>)}</fieldset>;
  if (component.slug === "switch") return <div className="ds-demo-switches"><button type="button" role="switch" aria-label="Notifications" aria-checked={switchOn} data-on={switchOn ? "True" : "False"} className={`ds-demo-switch${switchOn ? " ds-demo-switch--on" : ""}`} onClick={() => setSwitchOn((current) => !current)}><span /></button><small role="status">{switchOn ? "On" : "Off"}</small></div>;
  if (component.slug === "tabs") return <div className="ds-demo-tab-example"><div className="ds-demo-tabs" role="tablist" aria-label="Component preview sections">{["Overview", "Details", "Activity"].map((label, index, labels) => <button key={label} id={`${previewId}-tab-${label}`} type="button" role="tab" tabIndex={activeItem === label ? 0 : -1} aria-selected={activeItem === label} aria-controls={`${previewId}-panel`} className={activeItem === label ? "is-active" : ""} onClick={() => setActiveItem(label)} onKeyDown={(event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + labels.length) % labels.length;
    setActiveItem(labels[nextIndex]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }}>{label}</button>)}</div><div id={`${previewId}-panel`} role="tabpanel" aria-labelledby={`${previewId}-tab-${activeItem}`}>{activeItem} panel</div></div>;
  if (component.slug === "content-switcher") return <div className="ds-demo-tab-example"><div className="ds-demo-tabs" role="group" aria-label="Content view">{["List", "Board"].map((label) => <button key={label} type="button" aria-pressed={activeItem === label} className={activeItem === label ? "is-active" : ""} onClick={() => setActiveItem(label)}>{label}</button>)}</div><small>{activeItem === "Overview" ? "Select a view" : `${activeItem} view`}</small></div>;
  if (component.slug === "metric") return <div className="ds-demo-metric"><span>Approved applications</span><strong>2,480</strong><small>+12.4% this month</small><i><b /><b /><b /><b /><b /></i></div>;
  if (component.slug === "card") return <div className="ds-demo-card"><span className="ds-demo-card__eyebrow">DGA surface</span><strong>Workspace card</strong><small>Radius, padding and elevation stay tokenized.</small></div>;
  if (component.slug === "charts") return <div className="ds-demo-structure ds-demo-structure--interactive" aria-label="Interactive chart preview"><span /><span /><span /><span /></div>;
  if (component.slug === "table") return <table className="ds-demo-table"><thead><tr><th><button type="button" onClick={() => setSortAscending((current) => !current)}>Status <span aria-hidden="true">{sortAscending ? "↑" : "↓"}</span></button></th><th>Count</th></tr></thead><tbody>{(sortAscending ? [["Approved", 128], ["Review", 42]] : [["Review", 42], ["Approved", 128]]).map(([label, count]) => <tr key={label}><td>{label}</td><td>{count}</td></tr>)}</tbody></table>;
  if (component.slug === "tag") return feedbackVisible ? <span className="ds-demo-tag">Ready<button type="button" aria-label="Remove Ready tag" onClick={() => setFeedbackVisible(false)}><X size={12} aria-hidden="true" /></button></span> : <button type="button" className="ds-demo-restore" onClick={() => setFeedbackVisible(true)}>Restore tag</button>;
  if (component.slug === "breadcrumb") return <nav className="ds-demo-breadcrumb" aria-label="Preview breadcrumb"><a href="#workspace" onClick={(event) => event.preventDefault()}>Workspace</a><span aria-hidden="true">/</span><a href="#design-system" aria-current="page" onClick={(event) => event.preventDefault()}>Design System</a></nav>;
  if (component.slug === "nav-header" || component.slug === "nav-drawer" || component.slug === "second-level-nav-header") return <nav className="ds-demo-navigation" aria-label={`${component.name} preview`}>{["Home", "Services", "Reports"].map((label) => <a key={label} href={`#${label.toLowerCase()}`} aria-current={activeItem === label ? "page" : undefined} className={activeItem === label ? "is-active" : ""} onClick={(event) => { event.preventDefault(); setActiveItem(label); }}>{label}</a>)}</nav>;
  if (component.slug === "tooltip") return <div className="ds-demo-overlay-trigger"><button type="button" aria-describedby={overlayOpen ? `${previewId}-tooltip` : undefined} onMouseEnter={() => setOverlayOpen(true)} onMouseLeave={() => setOverlayOpen(false)} onFocus={() => setOverlayOpen(true)} onBlur={() => setOverlayOpen(false)}>?</button>{overlayOpen ? <div id={`${previewId}-tooltip`} role="tooltip" className="ds-demo-tooltip"><strong>Helpful context</strong><span>Short supporting information.</span></div> : null}</div>;
  if (component.slug === "modal") return <div className="ds-demo-overlay-trigger"><button ref={modalTriggerRef} type="button" className="ds-demo-button ds-demo-button--primary" onClick={() => setOverlayOpen(true)}>Open modal</button>{overlayOpen ? <div className="ds-demo-modal ds-demo-modal--open" role="dialog" aria-modal="true" aria-labelledby={`${previewId}-modal-title`} onKeyDown={(event) => { if (event.key === "Escape") closeModal(); }}><button ref={modalCloseRef} type="button" className="ds-demo-modal__close" aria-label="Close modal" onClick={closeModal}><X size={14} aria-hidden="true" /></button><strong id={`${previewId}-modal-title`}>Overlay surface</strong><span>Modal content remains inside this preview.</span></div> : null}</div>;
  if (component.slug === "inline-alert") return feedbackVisible ? <div className="ds-demo-alert" role="status"><span className="ds-demo-alert__icon">!</span><div><strong>Review required</strong><small>Feedback state and status token</small></div><button type="button" aria-label="Dismiss alert" onClick={() => setFeedbackVisible(false)}><X size={13} aria-hidden="true" /></button></div> : <button type="button" className="ds-demo-restore" onClick={() => setFeedbackVisible(true)}>Restore alert</button>;
  if (component.category === "Actions") return <span className="ds-demo-button ds-demo-button--primary">Action</span>;
  if (component.category === "Inputs") return <label className="ds-demo-field__control ds-demo-field__control--standalone"><span className="sr-only">Input value</span><input value={fieldValue} onChange={(event) => setFieldValue(event.target.value)} placeholder="Input value" /></label>;
  if (component.category === "Navigation") return <div className="ds-demo-tabs"><button type="button" className="is-active">Current</button><button type="button">Next</button></div>;
  if (component.category === "Feedback") return <div className="ds-demo-alert"><span className="ds-demo-alert__icon">!</span><div><strong>Review required</strong><small>Feedback state and status token</small></div></div>;
  if (component.category === "Overlays") return <div className="ds-demo-modal"><strong>Overlay surface</strong><span>Modal or tooltip content</span></div>;
  if (component.category === "UI Shell") return <div className="ds-demo-shell"><span /><span /><span /></div>;
  return <div className="ds-demo-structure"><span /><span /><span /><span /></div>;
}

function PatternCatalog({ manifest }: { manifest: DesignSystemManifest }) {
  return <div className="design-system-content"><div className="design-system-section-heading"><h2>Patterns</h2><span>Page composition rules</span></div><div className="design-system-list">{manifest.patterns.map((pattern) => <article key={pattern.slug}><FolderKanban size={19} /><div><strong>{pattern.name}</strong><small>{pattern.slug}</small></div></article>)}</div></div>;
}

function ValidationCatalog({ pages }: { pages: NonNullable<DesignSystemViewProps["pages"]> }) {
  return <div className="design-system-content"><div className="design-system-section-heading"><h2>Validation</h2><span>Static binding status</span></div>{pages.length === 0 ? <div className="design-system-empty"><AlertTriangle size={20} /><p>No HTML pages are available for Design System validation.</p></div> : <div className="design-system-list design-system-list--dense">{pages.map((page) => {
    const result = page.source.type === "html" ? validateHtmlDesign(page.source.value, page.designSystemBinding?.theme ?? DGA_MANIFEST.theme) : { status: "unbound" as const, issues: [] };
    const binding = page.designSystemBinding;
    const label = result.status === "passed" ? "Passed" : result.status === "passed-with-warning" ? "Review" : result.status === "blocked" ? "Blocked" : "Unbound";
    const detail = binding ? `${binding.id}@${binding.version} · ${binding.theme} · ${binding.digest.slice(0, 12)}` : result.issues[0]?.message ?? (page.source.type === "url" ? "URL page requires external capture" : "No validation issues");
    return <article key={page.id}><div><strong>{page.title}</strong><small>{detail}</small></div><span className={`status-badge status-badge--${result.status === "passed" ? "success" : result.status === "blocked" ? "danger" : "warning"}`}>{label}</span></article>;
  })}</div>}</div>;
}
