/**
 * Pure geometry/resolution helpers for logical-canvas callout leaders.
 *
 * Extracted from `LabelPointerLayer.tsx` so that file only exports the
 * component (Fast Refresh contract — `react-refresh/only-export-components`).
 */
import type { Edge, Node } from '@xyflow/react'
import type { AnchorSide, LabelTarget, NodeData } from '@/types'

export interface LogicalBox {
  x: number
  y: number
  width: number
  height: number
}

export function nodeBox(node: Node<NodeData>, measured: { width?: number; height?: number }): LogicalBox {
  return {
    x: node.position.x,
    y: node.position.y,
    width: measured.width ?? node.measured?.width ?? node.width ?? 200,
    height: measured.height ?? node.measured?.height ?? node.height ?? 60,
  }
}

/** Halfway point of a logical edge, walking its waypoints when present. */
export function edgeMidpoint(edge: Edge, nodes: Node<NodeData>[]): { x: number; y: number } | null {
  const source = nodes.find((n) => n.id === edge.source)
  const target = nodes.find((n) => n.id === edge.target)
  if (!source || !target) return null
  const from = {
    x: source.position.x + (source.width ?? source.measured?.width ?? 360) / 2,
    y: source.position.y + (source.height ?? source.measured?.height ?? 240) / 2,
  }
  const to = {
    x: target.position.x + (target.width ?? target.measured?.width ?? 360) / 2,
    y: target.position.y + (target.height ?? target.measured?.height ?? 240) / 2,
  }
  const wps = Array.isArray(edge.data?.waypoints) && edge.data.waypoints.length
    ? edge.data.waypoints
    : null
  if (!wps) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const pts = [from, ...wps, to]
  let total = 0
  const lengths: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    lengths.push(len)
    total += len
  }
  if (total <= 0) return pts[Math.floor(pts.length / 2)]
  let remaining = total / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i]
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      }
    }
    remaining -= lengths[i]
  }
  return to
}

/** Resolve a logical-canvas target to an anchor point, or null to skip. */
export function resolveLogicalTarget(
  target: LabelTarget,
  nodes: Node<NodeData>[],
  edges: Edge[],
  bounds: (id: string) => LogicalBox | undefined,
): { x: number; y: number } | null {
  switch (target.kind) {
    case 'none':
    case 'device':
    case 'port':
    case 'cable':
      // Rack-only target kinds never appear on the logical canvas.
      return null
    case 'edge': {
      const edge = edges.find((e) => e.id === target.id)
      if (!edge) return null
      return edgeMidpoint(edge, nodes)
    }
    case 'node': {
      const box = bounds(target.id)
      if (!box) return null
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
  }
}

/**
 * Which label-box point the leader leaves from, given the anchor.
 * `auto` picks the edge facing the anchor (largest |delta|); an explicit
 * `AnchorSide` overrides (matching the rack layer's contract), including the
 * four corners; `center` draws from the box centre.
 */
export function leaderOrigin(box: LogicalBox, anchor: { x: number; y: number }, side?: AnchorSide): { x: number; y: number } {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = anchor.x - cx
  const dy = anchor.y - cy
  const sideToUse =
    side === undefined || side === 'auto'
      ? Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
      : side
  switch (sideToUse) {
    case 'top':
      return { x: cx, y: box.y }
    case 'topRight':
      return { x: box.x + box.width, y: box.y }
    case 'right':
      return { x: box.x + box.width, y: cy }
    case 'bottomRight':
      return { x: box.x + box.width, y: box.y + box.height }
    case 'bottom':
      return { x: cx, y: box.y + box.height }
    case 'bottomLeft':
      return { x: box.x, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: cy }
    case 'topLeft':
      return { x: box.x, y: box.y }
    case 'center':
    default:
      return { x: cx, y: cy }
  }
}