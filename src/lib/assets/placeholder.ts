/**
 * Local inline SVG placeholder used when no R2 or source image is available.
 * Kept as a data URI so it never triggers a network request or 404.
 */
export const BUSINESS_IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="No image available">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e2e8f0"/>
          <stop offset="1" stop-color="#cbd5e1"/>
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#g)"/>
      <g fill="#94a3b8" transform="translate(340 240)">
        <path d="M60 0a60 60 0 1 0 0 120A60 60 0 0 0 60 0zm0 24a36 36 0 1 1 0 72 36 36 0 0 1 0-72z"/>
      </g>
      <text x="400" y="440" text-anchor="middle" fill="#64748b" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="24" font-weight="600">No image</text>
    </svg>`,
  );
