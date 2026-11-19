/** Shows the title of the hovered or focused element in a tooltip at once; the browser's own title tooltip appears only after a delay. */
let installed = false;

export function installInstantTooltips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const tip = document.createElement('div');
  tip.setAttribute('aria-hidden', 'true');
  tip.style.cssText =
    'position:fixed;z-index:10000;display:none;pointer-events:none;max-width:min(24rem,90vw);white-space:pre-line;padding:0.35rem 0.6rem;border-radius:6px;font:0.9rem/1.3 system-ui,sans-serif;background:#111;color:#fff;border:1px solid #fff;box-shadow:0 2px 6px rgb(0 0 0 / 35%)';
  document.body.appendChild(tip);
  let current: HTMLElement | null = null;
  let text = '';

  const hide = (): void => {
    tip.style.display = 'none';
    if (current && text) current.setAttribute('title', text);
    current = null;
    text = '';
  };
  const show = (el: HTMLElement): void => {
    if (el === current) return;
    hide();
    const title = el.getAttribute('title');
    if (!title) return;
    current = el;
    text = title;
    el.removeAttribute('title');
    tip.textContent = title;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${below ? r.bottom + 6 : Math.max(0, r.top - 6 - tip.offsetHeight)}px`;
    tip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
  };
  const target = (e: Event): HTMLElement | null => (e.target instanceof Element ? e.target.closest<HTMLElement>('[title]') : null);

  document.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el) show(el);
    else if (current && !(e.target instanceof Node && current.contains(e.target))) hide();
  });
  document.addEventListener('mouseout', (e) => {
    if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', hide, true);
}
