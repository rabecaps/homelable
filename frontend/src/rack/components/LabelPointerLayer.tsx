/**
 * Callout leader lines for rack labels.
 *
 * Rack labels are free-floating `text` flow nodes; the pointer that points a
 * label at a target cannot live inside the node (a node has no idea where
 * another element is), so it is drawn here in a ViewportPortal SVG overlay —
 * exactly like `CableLayer` — so it pans and zooms with the racks.
 *
 * `resolveTarget` (exported for tests) turns a `LabelTarget` into a flow-space
 * anchor point using the rack layout helpers, then a straight leader is drawn
 * from the nearest edge of the label box to that anchor, with an arrowhead.
 * The overlay never intercepts pointer events so a leader never blocks
 * selecting/dragging the label or the thing it points at.
 *
 * The pure geometry/resolution helpers live in `./labelPointerUtils` so this
 * file exports only the component (Fast Refresh contract).
 */
import { ViewportPortal } from '@xyflow/react'
import { useRackStore } from '../store'
import { labelBox, leaderOrigin, resolveTarget } from './labelPointerUtils'
import type { RackLabel } from '@/types'

export function LabelPointerLayer() {
  const labels = useRackStore((s) => s.labels)
  const racks = useRackStore((s) => s.racks)
  const devices = useRackStore((s) => s.devices)
  const cables = useRackStore((s) => s.cables)

  const leaders: { label: RackLabel; from: { x: number; y: number }; to: { x: number; y: number } }[] = []
  for (const label of labels) {
    if (label.target.kind === 'none') continue
    const anchor = resolveTarget({ target: label.target, racks, devices, cables })
    if (!anchor) continue
    const box = labelBox(label)
    const from = leaderOrigin(box, anchor, label.anchorSide ?? 'auto')
    leaders.push({ label, from, to: anchor })
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
        {leaders.map(({ label, from, to }) => {
          const color = label.custom_colors?.border || '#8b949e'
          return (
            <g key={label.id} data-testid={`label-leader-${label.id}`} style={{ pointerEvents: 'none' }}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#0d1117"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={color}
                strokeWidth={1.4}
                strokeLinecap="round"
              />
              {/* Arrowhead at the anchor. */}
              <ArrowHead from={from} to={to} color={color} />
            </g>
          )
        })}
      </svg>
    </ViewportPortal>
  )
}

/** A small filled dot at the anchor pointing away from the label. */
function ArrowHead({ to, color }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }) {
  return <circle cx={to.x} cy={to.y} r={2.6} fill={color} stroke="#0d1117" strokeWidth={0.6} />
}