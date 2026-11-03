// View operations only traverse recorded edges; no inferred edge is added here.
export function neighborhood(id, edges, hops = 1, direction = 'both') {
  const found = new Set([id]);
  let frontier = new Set([id]);
  for (let step = 0; step < hops; step++) {
    const next = new Set();
    for (const edge of edges) {
      if (direction !== 'in' && frontier.has(edge.source) && !found.has(edge.target)) next.add(edge.target);
      if (direction !== 'out' && frontier.has(edge.target) && !found.has(edge.source)) next.add(edge.source);
    }
    for (const key of next) found.add(key);
    frontier = next;
  }
  return found;
}

export function graphSlice(data, options = {}) {
  const { mode = 'all', context = '', type = '', relation = '', evidence = '', focus = '', hops = 1, direction = 'both' } = options;
  let nodes = data.nodes.filter(n => mode === 'domains' ? n.model === 'CTX' : mode === 'objects' ? ['CTX', 'M1'].includes(n.model) : true);
  if (context) {
    const domain = new Set(nodes.filter(n => n.context === context).map(n => n.id));
    const visible = new Set(domain);
    for (const e of data.edges) if (domain.has(e.source) || domain.has(e.target)) { visible.add(e.source); visible.add(e.target); }
    nodes = nodes.filter(n => visible.has(n.id));
  }
  if (type) nodes = nodes.filter(n => n.model === type || n.model === 'CTX');
  const ids = new Set(nodes.map(n => n.id));
  let edges = data.edges.filter(e => ids.has(e.source) && ids.has(e.target) && (!relation || e.label === relation)
    && (!evidence || (evidence === 'mapped' ? e.status === 'MAPPED' : e.status !== 'MAPPED')));
  if (focus && ids.has(focus)) {
    const visible = neighborhood(focus, edges, hops, direction);
    const preceding = neighborhood(focus, edges, Math.max(0, hops - 1), direction);
    nodes = nodes.filter(n => visible.has(n.id));
    edges = edges.filter(e => visible.has(e.source) && visible.has(e.target)
      && (direction === 'out' ? preceding.has(e.source) : direction === 'in' ? preceding.has(e.target) : true));
  }
  return { nodes, edges };
}

export function directedCurve(a, b, sourceRadius = 12, targetRadius = 12, bend = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < 1) return `M${a.x},${a.y} C${a.x + 65},${a.y - 80} ${a.x - 65},${a.y - 80} ${a.x},${a.y - targetRadius}`;
  const ux = dx / length, uy = dy / length;
  const x1 = a.x + ux * sourceRadius, y1 = a.y + uy * sourceRadius;
  const x2 = b.x - ux * targetRadius, y2 = b.y - uy * targetRadius;
  return `M${x1},${y1} Q${(x1 + x2) / 2 - uy * bend},${(y1 + y2) / 2 + ux * bend} ${x2},${y2}`;
}
