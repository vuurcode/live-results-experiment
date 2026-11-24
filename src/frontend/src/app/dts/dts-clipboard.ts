/**
 * Puts text on the clipboard. The async clipboard API exists only in a secure context (https or localhost), so a page
 * opened over plain http on a local address falls back to selecting a hidden field and copying that. Resolves to
 * whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection copy
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus?.();
  }
}
