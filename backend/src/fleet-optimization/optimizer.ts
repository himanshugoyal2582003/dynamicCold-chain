export type Priority = 'critical' | 'high' | 'standard';

export interface Demand {
  id: string;
  priority: Priority;
  deadline: string;
}

export interface Choice {
  shipmentId: string;
  truckId: string;
  score: number;
}

const urgency: Record<Priority, number> = { critical: 0, high: 1, standard: 2 };
const MAX_SCORE = 10_000;

export function greedy<T extends Choice>(shipments: Demand[], choices: T[]): T[] {
  const taken = new Set<string>();
  return [...shipments].sort((a, b) => urgency[a.priority] - urgency[b.priority] ||
    Date.parse(a.deadline) - Date.parse(b.deadline) || a.id.localeCompare(b.id)).flatMap(shipment => {
    const candidate = choices.filter(edge => edge.shipmentId === shipment.id && !taken.has(edge.truckId))
      .sort((a, b) => a.score - b.score || a.truckId.localeCompare(b.truckId))[0];
    if (!candidate) return [];
    taken.add(candidate.truckId);
    return [candidate];
  });
}

interface Arc<T> {
  to: number;
  capacity: number;
  cost: number;
  reverse: Arc<T>;
  choice?: T;
}

/** Successive shortest augmenting paths on the residual bipartite network. */
export function optimize<T extends Choice>(shipments: Demand[], truckIds: string[], choices: T[]): T[] {
  const source = 0;
  const sink = 1 + shipments.length + truckIds.length;
  const graph: Arc<T>[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, cost: number, choice?: T) => {
    const forward = { to, cost, capacity: 1, choice } as Arc<T>;
    const backward = { to: from, cost: -cost, capacity: 0, reverse: forward };
    forward.reverse = backward;
    graph[from].push(forward);
    graph[to].push(backward);
    return forward;
  };
  const shipmentNodes = new Map(shipments.map((entry, i) => [entry.id, i + 1]));
  const truckNodes = new Map(truckIds.map((id, i) => [id, 1 + shipments.length + i]));
  const priorityUnit = shipments.length * MAX_SCORE + 1;
  for (const shipment of shipments) {
    const penalty = shipment.priority === 'critical' ? 0 :
      shipment.priority === 'high' ? priorityUnit * (shipments.length + 1) : priorityUnit * (shipments.length + 2);
    add(source, shipmentNodes.get(shipment.id)!, penalty);
  }
  for (const node of truckNodes.values()) add(node, sink, 0);
  const assignments = choices.map(choice => add(shipmentNodes.get(choice.shipmentId)!, truckNodes.get(choice.truckId)!, choice.score, choice));

  while (true) {
    const distance = graph.map(() => Infinity);
    const previous: (Arc<T> | undefined)[] = graph.map(() => undefined);
    distance[source] = 0;
    for (let pass = 0; pass < sink; pass++) {
      let changed = false;
      for (let from = 0; from <= sink; from++) {
        if (!Number.isFinite(distance[from])) continue;
        for (const arc of graph[from]) {
          if (arc.capacity && distance[from] + arc.cost < distance[arc.to]) {
            distance[arc.to] = distance[from] + arc.cost;
            previous[arc.to] = arc;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    if (!previous[sink]) break;
    for (let node = sink; node !== source;) {
      const arc = previous[node]!;
      arc.capacity = 0;
      arc.reverse.capacity = 1;
      node = arc.reverse.to;
    }
  }
  return assignments.filter(arc => arc.capacity === 0).map(arc => arc.choice!);
}
