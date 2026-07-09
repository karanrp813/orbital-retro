// Projected DOM labels that track 3D objects (Theme A bracket designations).
// DOM instead of sprites: free glow via text-shadow, crisp at any zoom.

export function createLabelLayer(rootId = 'label-layer') {
  const root = document.getElementById(rootId);
  const items = new Map();
  return {
    add(id, text, color = 'var(--c-green)') {
      const el = document.createElement('div');
      el.className = 'obj-label';
      el.textContent = text;
      el.style.color = color;
      root.appendChild(el);
      items.set(id, el);
    },
    setText(id, text) {
      const el = items.get(id);
      if (el) el.textContent = text;
    },
    place(id, screen) {
      const el = items.get(id);
      if (!el) return;
      if (!screen) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.transform = `translate(${screen[0]}px, ${screen[1]}px) translate(-50%, -150%)`;
    },
    hideAll() {
      for (const el of items.values()) el.style.display = 'none';
    },
    clear() {
      for (const el of items.values()) el.remove();
      items.clear();
    },
  };
}
