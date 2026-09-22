/**
 * Logical-canvas callout leaders.
 *
 * A logical-canvas `text` node with a `custom_colors.target` points at a node
 * or an edge. The pointer cannot be part of the text node itself (a node has no
 * idea where its target is), so it is drawn here in a ViewportPortal overlay —
 * the same pattern the rack's `LabelPointerLayer` uses — so it pans and zooms
 * with the flow. The overlay never intercepts pointer events, so a leader never
 * blocks selecting/dragging the label or the thing it points at.
 *
 * The pure geometry/resolution helpers live in `./labelPointerUtils` so this
 * file exports only the component (Fast Refresh contract).
 */
import { ViewportPortal } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
import { leaderOrigin, nodeBox, resolveLogicalTarget } from './labelPointerUtils'

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