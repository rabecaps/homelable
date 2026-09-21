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
 */
import { ViewportPortal } from '@xyflow/react'
import { deviceBox, portPosition, rackHeight, rackWidth } from '../layout'
import { useRackStore } from '../store'
import { getWaypointLabelPosition } from '@/components/canvas/edges/waypointUtils'
import type { AnchorSide, Cable, LabelTarget, Rack, RackDevice, RackLabel } from '@/types'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Flow-space label box from a store label + its flow-node size. */
export function labelBox(label: RackLabel): Box {
  return {
    x: label.position.x,
    y: label.position.y,
    width: label.width ?? 200,
    height: label.height ?? 60,
  }
}

/**
 * The point on a cable's run at `ratio` (0..1, default 0.5 = midpoint).
 *
 * Walks the straight polyline through [from, ...waypoints, to] by cumulative
 * length. This is deliberately geometry-agnostic — when the spline task ships
 * curved waypoints the anchor still lands sensibly "along the run", and once
 * finer geometry is wanted it can reuse the same path builders `CableLayer`
 * uses without changing this contract.
 */
export function cablePointAtRatio(
  from: { x: number; y: number },
  waypoints: { x: number; y: number }[] | undefined,
  to: { x: number; y: number },
  ratio: number,
): { x: number; y: number } {
  const pts = [{ x: from.x, y: from.y }, ...(waypoints ?? []), { x: to.x, y: to.y }]
  if (pts.length < 2) return from

  let total = 0
  const lengths: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    const dy = pts[i + 1].y - pts[i].y
    const len = Math.hypot(dx, dy)
    lengths.push(len)
    total += len
  }
  if (total <= 0) return pts[Math.floor(pts.length / 2)]

  let target = (ratio < 0 ? 0 : ratio > 1 ? 1 : ratio) * total
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : target / lengths[i]
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      }
    }
    target -= lengths[i]
  }
  return to
}

/**
 * Resolve a rack `LabelTarget` to an anchor point in flow coordinates, or
 * return null when the target is `none`/missing so the leader is skipped.
 */
export function resolveTarget(args: {
  target: LabelTarget
  racks: Rack[]
  devices: RackDevice[]
  cables: Cable[]
}): { x: number; y: number } | null {
  const { target, racks, devices, cables } = args
  const rackById = new Map(racks.map((r) => [r.id, r]))
  const deviceById = new Map(devices.map((d) => [d.id, d]))

  switch (target.kind) {
    case 'none':
    case 'edge':
      // No leader for a free annotation; `edge` is a logical-canvas target the
      // rack never sets, resolved (nothing) rather than confusingly drawing.
      return null
    case 'node': {
      // Rack label pointing at a rack (the rack canvas' "node"). Anchor at the
      // rack frame's midpoint so the leader lands on the chassis, not a corner.
      const rack = rackById.get(target.id)
      if (!rack) return null
      return {
        x: rack.position.x + rackWidth(rack) / 2,
        y: rack.position.y + rackHeight(rack) / 2,
      }
    }
    case 'device': {
      const device = deviceById.get(target.id)
      const rack = device && rackById.get(device.rackId)
      if (!device || !rack) return null
      const box = deviceBox(rack, device)
      return {
        x: rack.position.x + box.x + box.width / 2,
        y: rack.position.y + box.y + box.height / 2,
      }
    }
    case 'port': {
      const device = deviceById.get(target.deviceId)
      const rack = device && rackById.get(device.rackId)
      const port = device?.ports.find((p) => p.id === target.portId)
      if (!device || !rack || !port) return null
      return portPosition(rack, device, port)
    }
    case 'cable': {
      const cable = cables.find((c) => c.id === target.id)
      if (!cable) return null
      const fromDevice = deviceById.get(cable.from.deviceId)
      const toDevice = deviceById.get(cable.to.deviceId)
      const fromRack = fromDevice && rackById.get(fromDevice.rackId)
      const toRack = toDevice && rackById.get(toDevice.rackId)
      const fromPort = fromDevice?.ports.find((p) => p.id === cable.from.portId)
      const toPort = toDevice?.ports.find((p) => p.id === cable.to.portId)
      if (!fromDevice || !toDevice || !fromRack || !toRack || !fromPort || !toPort) return null
      const from = portPosition(fromRack, fromDevice, fromPort)
      const to = portPosition(toRack, toDevice, toPort)
      const pathStyle = cable.pathStyle ?? 'bezier'
      const hasWaypoints = Array.isArray(cable.waypoints) && cable.waypoints.length > 0
      const ratio = typeof target.anchorRatio === 'number' ? target.anchorRatio : 0.5
      // The spline task's label position helper gives the midpoint; a custom
      // anchorRatio falls back to the polyline walk so callouts still track.
      if (ratio === 0.5) {
        const mid = hasWaypoints
          ? getWaypointLabelPosition(from.x, from.y, cable.waypoints ?? [], to.x, to.y, pathStyle)
          : null
        if (mid) return mid
      }
      return cablePointAtRatio(from, cable.waypoints, to, ratio)
    }
  }
}

/**
 * Which point on the label box edge the leader leaves from, given the anchor.
 * `auto` picks the edge facing the anchor (largest |delta|); an explicit
 * `AnchorSide` overrides; `center` returns the box centre.
 */
export function leaderOrigin(box: Box, anchor: { x: number; y: number }, side: AnchorSide): { x: number; y: number } {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = anchor.x - cx
  const dy = anchor.y - cy
  const sideToUse =
    side === 'auto'
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