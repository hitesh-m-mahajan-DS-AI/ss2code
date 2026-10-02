# Validation and comparison

A generated revision must pass source policy, TypeScript, lint, production build, browser rendering and blocking accessibility checks before release. Pixel agreement measures differences between equally sized reference and generated screenshots; it is not a guarantee that all interactions or unseen mobile states match.

Use Overlay, Diff and Live preview to inspect the generated interface. The Files panel contains the component source and trusted runnable configuration. The Export action downloads a complete ZIP. In an extracted React export, run npm ci --ignore-scripts and npm run dev, then open http://localhost:4173.
