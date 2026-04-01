export const EDGE_CONDITION_OPTIONS = [
  { value: '', label: 'Always' },
  { value: 'true', label: 'True Branch' },
  { value: 'false', label: 'False Branch' },
];

let nextEdgeId = 1;

export function genEdgeId() {
  return `edge_${nextEdgeId++}`;
}

export function syncEdgeIdCounter(edges) {
  let max = 0;
  for (const e of edges) {
    if (e.id) {
      const match = e.id.match(/^edge_(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
  }
  nextEdgeId = max + 1;
}

export function ensureEdgeIds(edges) {
  return edges.map((e) => (e.id ? e : { ...e, id: genEdgeId() }));
}

export function isConditionEdgeSource(sourceNode) {
  return sourceNode?.type === 'condition';
}

export function getDefaultEdgeCondition(sourceNode, edges) {
  if (!isConditionEdgeSource(sourceNode)) return undefined;

  const outgoingConditions = new Set(
    edges
      .filter((edge) => edge.from === sourceNode.id)
      .map((edge) => edge.condition)
      .filter(Boolean),
  );

  if (!outgoingConditions.has('true')) return 'true';
  if (!outgoingConditions.has('false')) return 'false';
  return undefined;
}

export function createEdge(fromId, toId, sourceNode, edges) {
  const edge = { id: genEdgeId(), from: fromId, to: toId };
  const defaultCondition = getDefaultEdgeCondition(sourceNode, edges);
  if (defaultCondition) {
    edge.condition = defaultCondition;
  }
  return edge;
}

export function edgeMatches(edge, selectedEdge) {
  if (!selectedEdge) return false;
  // Match by unique id when available, fall back to from+to for legacy edges
  if (edge.id && selectedEdge.id) return edge.id === selectedEdge.id;
  return edge.from === selectedEdge.from && edge.to === selectedEdge.to;
}

export function getEdgeKey(edge) {
  return edge.id || `${edge.from}-${edge.to}`;
}

export function updateEdge(edges, selectedEdge, updates) {
  return edges.map((edge) => {
    if (!edgeMatches(edge, selectedEdge)) return edge;

    const nextEdge = { ...edge };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null || value === '') {
        delete nextEdge[key];
      } else {
        nextEdge[key] = value;
      }
    }
    return nextEdge;
  });
}

export function removeEdge(edges, selectedEdge) {
  return edges.filter((edge) => !edgeMatches(edge, selectedEdge));
}
