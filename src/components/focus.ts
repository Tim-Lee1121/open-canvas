/**
 * Return controls that can actually receive focus inside a surface. Closed
 * details menus remain in the DOM but must not participate in a dialog or
 * drawer's Tab order.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href]:not([tabindex="-1"]), button:not([tabindex="-1"]), input:not([tabindex="-1"]), select:not([tabindex="-1"]), textarea:not([tabindex="-1"]), summary:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
    ),
  );

  return candidates.filter((element) => {
    if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[hidden], [inert], [aria-hidden=\"true\"]")) return false;
    if (element.closest("details:not([open])") && !element.matches("summary")) return false;
    return true;
  });
}
