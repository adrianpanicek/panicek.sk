// Paint one small copy from the loaded image: no second request, pixel readback,
// animation loop, or duplicate alt text. Cross-origin images may taint the canvas,
// which is fine because it is only displayed, never read or exported.
export function setupCrtImages(root: ParentNode) {
  for (const image of root.querySelectorAll<HTMLImageElement>('.markdown img')) {
    if (image.parentElement?.classList.contains('crt-image')) continue;
    const frame = document.createElement('span');
    frame.className = 'crt-image';
    frame.style.width = image.style.width;
    image.style.removeProperty('width');
    for (const alignment of ['image-left', 'image-right', 'image-center']) {
      if (image.classList.contains(alignment)) {
        frame.classList.add(alignment);
        image.classList.remove(alignment);
      }
    }
    const bloom = document.createElement('canvas');
    bloom.className = 'crt-image-bloom';
    bloom.setAttribute('aria-hidden', 'true');
    image.replaceWith(frame);
    frame.append(image, bloom);
    const paint = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const ratio = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      bloom.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      bloom.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = bloom.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, bloom.width, bloom.height);
      bloom.dataset.ready = 'true';
    };
    image.addEventListener('load', paint);
    if (image.complete) paint();
  }
}
