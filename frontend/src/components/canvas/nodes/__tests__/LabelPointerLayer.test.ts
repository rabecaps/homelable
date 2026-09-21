import { describe, it, expect } from 'vitest'
import {
  edgeMidpoint,
  leaderOrigin,
  resolveLogicalTarget,
  type LogicalBox,
} from '../LabelPointerLayer'
import type { Edge, Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const nodeA: Node<NodeData> = {
  id: 'n1',
  type: 'router',
  position: { x: 0, y: 0 },
  width: 100,
  height: 50,
  data: { type: 'router', label: 'Router' } as NodeData,
}

const nodeB: Node<NodeData> = {
  id: 'n2',
  type: 'switch',
  position: { x: 200, y: 0 },
  width: 100,
  height: 50,
  data: { type: 'switch', label: 'Switch' } as NodeData,
}

const edgeAB: Edge = {
  id: 'e1',
  source: 'n1',
  target: 'n2',
  data: {},
}

const bounds = (id: string): LogicalBox | undefined => {
  if (id === 'n1') return { x: 0, y: 0, width: 100, height: 50 }
  if (id === 'n2') return { x: 200, y: 0, width: 100, height: 50 }
  return undefined
}

describe('resolveLogicalTarget', () => {
  const nodes = [nodeA, nodeB]
  const edges = [edgeAB]

  it('returns null for a free annotation and for rack-only kinds', () => {
    expect(resolveLogicalTarget({ kind: 'none' }, nodes, edges, bounds)).toBeNull()
    expect(resolveLogicalTarget({ kind: 'device', id: 'd1' }, nodes, edges, bounds)).toBeNull()
    expect(resolveLogicalTarget({ kind: 'port', deviceId: 'd', portId: 'p' }, nodes, edges, bounds)).toBeNull()
    expect(resolveLogicalTarget({ kind: 'cable', id: 'c1' }, nodes, edges, bounds)).toBeNull()
  })

  it('anchors at a node centre', () => {
    const p = resolveLogicalTarget({ kind: 'node', id: 'n1' }, nodes, edges, bounds)!
    expect(p).toEqual({ x: 50, y: 25 })
  })

  it('anchors at the edge midpoint between the two node centres', () => {
    const p = resolveLogicalTarget({ kind: 'edge', id: 'e1' }, nodes, edges, bounds)!
    expect(p).toEqual({ x: 150, y: 25 })
  })

  it('returns null for a dangling node or edge target', () => {
    expect(resolveLogicalTarget({ kind: 'node', id: 'gone' }, nodes, edges, bounds)).toBeNull()
    expect(resolveLogicalTarget({ kind: 'edge', id: 'gone' }, nodes, edges, bounds)).toBeNull()
  })
})

describe('edgeMidpoint', () => {
  it('walks waypoints by cumulative length', () => {
    const edge: Edge = {
      id: 'e2',
      source: 'n1',
      target: 'n2',
      data: { waypoints: [{ x: 100, y: 25 }] },
    }
    const p = edgeMidpoint(edge, [nodeA, nodeB])!
    // from (50,25) -> waypoint (100,25) is 50 long; waypoint -> to (250,25) is
    // 150 long. Half the total (100 units) lands 50 past the waypoint => (150,25).
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(25)
  })
})

describe('leaderOrigin', () => {
  const box: LogicalBox = { x: 0, y: 0, width: 100, height: 50 }

  it('auto-picks the edge facing the anchor when no side is given', () => {
    // Anchor far right -> right edge.
    expect(leaderOrigin(box, { x: 500, y: 0 })).toEqual({ x: 100, y: 25 })
    // Anchor far above -> top edge.
    expect(leaderOrigin(box, { x: 0, y: -500 })).toEqual({ x: 50, y: 0 })
    // Explicit 'auto' behaves the same.
    expect(leaderOrigin(box, { x: 0, y: 500 }, 'auto')).toEqual({ x: 50, y: 50 })
  })

  it('honours an explicit side even when it faces away from the anchor', () => {
    expect(leaderOrigin(box, { x: 500, y: 0 }, 'left')).toEqual({ x: 0, y: 25 })
    expect(leaderOrigin(box, { x: 0, y: -500 }, 'bottom')).toEqual({ x: 50, y: 50 })
    expect(leaderOrigin(box, { x: 500, y: 0 }, 'center')).toEqual({ x: 50, y: 25 })
  })
})