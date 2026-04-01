export const EDGE_CONDITION_OPTIONS = [
  { value: '', label: 'Always' },
  { value: 'true', label: 'True Branch' },
  { value: 'false', label: 'False Branch' },
];

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
  const edge = { from: fromId, to: toId };
  const defaultCondition = getDefaultEdgeCondition(sourceNode, edges);
  if (defaultCondition) {
    edge.condition = defaultCondition;
  }
  return edge;
}

export function edgeMatches(edge, selectedEdge) {
  if (!selectedEdge) return false;
  return edge.from === selectedEdge.from && edge.to === selectedEdge.to;
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
