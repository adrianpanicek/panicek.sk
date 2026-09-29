export function animationsEnabled() {
  return (
    document.documentElement.dataset.animations !== 'off' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
