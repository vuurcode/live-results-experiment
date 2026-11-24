/** Empties the text field next to a clear button and tells its listeners, as typing would, then puts the cursor back in it. */
export function clearSiblingField(event: Event): void {
  const input = (event.currentTarget as HTMLElement).parentElement?.querySelector('input');
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}
