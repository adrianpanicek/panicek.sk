export function renderEggCups(bits: string): string {
  const cups = [...bits].map((bit, index) => {
    const value = 2 ** (bits.length - index - 1);
    return `<button type="button" class="egg-cup" data-value="${value}" aria-label="${value}'s place" aria-pressed="${bit === '1'}"><span aria-hidden="true"></span></button>`;
  });
  return `<div class="egg-cups" data-egg-cups role="group" aria-label="Binary egg-cup calculator">${cups.join('')}<span class="egg-cups-equals" aria-hidden="true">=</span><output aria-label="Decimal value" aria-live="polite">${parseInt(bits, 2)}</output></div>\n`;
}

// Delegation handles both the initial page and articles added to the transcript.
export function setupEggCups(root: Document) {
  root.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const cup = event.target.closest<HTMLButtonElement>('[data-egg-cups] button[data-value]');
    if (!cup) return;
    const calculator = cup.closest<HTMLElement>('[data-egg-cups]')!;
    cup.setAttribute('aria-pressed', String(cup.getAttribute('aria-pressed') !== 'true'));
    const value = [
      ...calculator.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]'),
    ].reduce((sum, button) => sum + Number(button.dataset.value), 0);
    calculator.querySelector('output')!.textContent = String(value);
  });
}
