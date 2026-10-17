import type { SVGProps } from 'react'

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, strokeWidth: 2.5, ...p })}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)
export const X = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, strokeWidth: 2.5, ...p })}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 5l12 7-12 7V5z" fill="currentColor" /></svg>
)
export const Square = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" /></svg>
)
export const Scale = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h16M6 20l2-9h8l2 9M12 11V5M9 5h6" /></svg>
)
export const Download = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" /></svg>
)
export const Sun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const Moon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>
)
export const Activity = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
)
export const List = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
)
export const Chart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
)
export const Terminal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 17l6-5-6-5M12 19h8" /></svg>
)
export const Sliders = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
)
export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const Trash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
)

/** Station mark: hopper over a cup. */
export const Mark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" {...p}>
    <path d="M4 3h16l-6 8v3h-4v-3L4 3z" fill="currentColor" />
    <path d="M7 17h10l-1 5H8l-1-5z" fill="currentColor" opacity=".55" />
  </svg>
)
