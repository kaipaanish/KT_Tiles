// Pages and interactions the browser check visits. `path` is relative to the base URL; `run`
// can interact with the page and take extra screenshots with shot(label).

export const scenarios = [
  { name: 'opening-wall', path: './' },
  { name: 'sprig-joint', path: './?zoom=5&cx=1200&cy=1800&motifs=1' },
  { name: 'medallion-2450', path: './?series=demo-azure-medallion&preset=feature-wall&w=2450&x=centre-motif&motifs=1&repeat=1' },
  { name: 'medallion-joint', path: './?series=demo-azure-medallion&preset=feature-wall&w=2450&x=centre-motif&zoom=4&cx=1225&cy=1500&motifs=1' },
  { name: 'sliver-overlay', path: './?w=2450&x=left&drag=1' },
  { name: 'tiled-height-2100', path: './?w=2450&th=2100' },
  { name: 'floor-checker', path: './?surface=floor&design=floor-checker&w=1800&h=2450&x=centre-tile&y=centre-tile&repeat=1' },
];
