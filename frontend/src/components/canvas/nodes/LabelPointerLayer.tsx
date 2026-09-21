/**
 * Logical-canvas callout leaders.
 *
 * A logical-canvas `text` node with a `custom_colors.target` points at a node
 * or an edge. The pointer cannot be part of the text node itself (a node has no
 * idea where its target is), so it is drawn here in a ViewportPortal overlay —
 * the same pattern the rack's `LabelPointerLayer` uses — so it pans and zooms
 * with the flow. The overlay never intercepts pointer events, so a leader never
 * blocks selecting/dragging the label or the thing it points at.
 */
import { ViewportPortal } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Edge, Node } from '@xyflow/react'
import type { AnchorSide, LabelTarget, NodeData } from '@/types'

export interface LogicalBox {
  x: number
  y: number
  width: number
  height: number
}

function nodeBox(node: Node<NodeData>, measured: { width?: number; height?: number }): LogicalBox {
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
 * Which label-box edge the leader leaves from, given the anchor.
 * `auto` picks the edge facing the anchor (largest |delta|); an explicit
 * `AnchorSide` overrides (matching the rack layer's contract).
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
    case 'bottom':
      return { x: cx, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: cy }
    case 'right':
      return { x: box.x + box.width, y: cy }
    case 'center':
    default:
      return { x: cx, y: cy }
  }
}

export function LabelPointerLayer() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)

  const bounds = (id: string) => {
    const node = nodes.find((n) => n.id === id)
    if (!node) return undefined
    return nodeBox(node, {})
  }

  const leaders: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }[] = []
  for (const node of nodes) {
    if (node.data?.type !== 'text') continue
    const target = node.data?.custom_colors?.target
    if (!target || target.kind === 'none') continue
    const anchor = resolveLogicalTarget(target, nodes, edges, bounds)
    if (!anchor) continue
    const box = nodeBox(node, {})
    const from = leaderOrigin(box, anchor, node.data?.custom_colors?.anchor_side)
    leaders.push({ from, to: anchor, color: node.data.custom_colors?.border ?? '#8b949e' })
  }

  if (leaders.length === 0) return null

  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        {leaders.map(({ from, to, color }, i) => (
          <g key={i} style={{ pointerEvents: 'none' }} data-testid="logical-label-leader">
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#0d1117" strokeWidth={3} strokeLinecap="round" />
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
            <circle cx={to.x} cy={to.y} r={2.6} fill={color} stroke="#0d1117" strokeWidth={0.6} />
          </g>
        ))}
      </svg>
    </ViewportPortal>
  )
}