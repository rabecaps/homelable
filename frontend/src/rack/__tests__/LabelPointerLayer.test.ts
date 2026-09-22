import { describe, it, expect } from 'vitest'
import {
  cablePointAtRatio,
  leaderOrigin,
  resolveTarget,
  type Box,
} from '../components/labelPointerUtils'
import type { Cable, Rack, RackDevice } from '@/types'

const rack: Rack = {
  id: 'r1',
  name: 'Main',
  uHeight: 24,
  widthStandard: '19',
  numbering: 'bottom-up',
  style: { frame: '#000', rail: '#111', interior: '#222', showNumbers: true, enclosed: false },
  position: { x: 100, y: 200 },
}

const device: RackDevice = {
  id: 'dev1',
  rackId: 'r1',
  deviceId: 'inv1',
  nodeId: null,
  label: 'sw-24',
  uStart: 10,
  uHeight: 1,
  colStart: 0,
  colSpan: 12,
  faceplateId: 'switch-24',
  status: 'online',
  ports: [
    { id: 'p1', label: '1', type: 'rj45', x: 0.5, y: 0.5 },
  ],
}

const cable: Cable = {
  id: 'c1',
  type: 'ethernet',
  color: '#39d353',
  from: { deviceId: 'dev1', portId: 'p1' },
  to: { deviceId: 'dev1', portId: 'p1' },
}

describe('resolveTarget', () => {
  const args = { racks: [rack], devices: [device], cables: [cable] }

  it('returns null for a free annotation and for logical-only kinds', () => {
    expect(resolveTarget({ ...args, target: { kind: 'none' } })).toBeNull()
    expect(resolveTarget({ ...args, target: { kind: 'edge', id: 'e1' } })).toBeNull()
  })

  it('anchors on the rack frame for a node target', () => {
    const p = resolveTarget({ ...args, target: { kind: 'node', id: 'r1' } })!
    expect(p.x).toBeGreaterThan(100)
    expect(p.y).toBeGreaterThan(200)
  })

  it('anchors at the device box centre', () => {
    const p = resolveTarget({ ...args, target: { kind: 'device', id: 'dev1' } })!
    expect(p.x).toBeGreaterThan(100)
    expect(p.y).toBeGreaterThan(200)
  })

  it('anchors at a port position', () => {
    const p = resolveTarget({
      ...args,
      target: { kind: 'port', deviceId: 'dev1', portId: 'p1' },
    })!
    expect(p.x).toBeGreaterThan(100)
  })

  it('returns null for a dangling target', () => {
    expect(resolveTarget({ ...args, target: { kind: 'node', id: 'gone' } })).toBeNull()
    expect(resolveTarget({ ...args, target: { kind: 'cable', id: 'gone' } })).toBeNull()
  })
})

describe('leaderOrigin', () => {
  const box: Box = { x: 0, y: 0, width: 100, height: 50 }

  it('picks the edge facing the anchor', () => {
    // Anchor far to the right -> right edge.
    expect(leaderOrigin(box, { x: 500, y: 0 }, 'auto')).toEqual({ x: 100, y: 25 })
    // Anchor far above -> top edge.
    expect(leaderOrigin(box, { x: 0, y: -500 }, 'auto')).toEqual({ x: 50, y: 0 })
    // Anchor far below -> bottom edge.
    expect(leaderOrigin(box, { x: 0, y: 500 }, 'auto')).toEqual({ x: 50, y: 50 })
  })

  it('honours an explicit side', () => {
    expect(leaderOrigin(box, { x: 500, y: 0 }, 'left')).toEqual({ x: 0, y: 25 })
    expect(leaderOrigin(box, { x: 0, y: 0 }, 'center')).toEqual({ x: 50, y: 25 })
  })

  it('supports the four corners of the label box', () => {
    expect(leaderOrigin(box, { x: 60, y: 60 }, 'topLeft')).toEqual({ x: 0, y: 0 })
    expect(leaderOrigin(box, { x: 60, y: 60 }, 'topRight')).toEqual({ x: 100, y: 0 })
    expect(leaderOrigin(box, { x: 60, y: 60 }, 'bottomLeft')).toEqual({ x: 0, y: 50 })
    expect(leaderOrigin(box, { x: 60, y: 60 }, 'bottomRight')).toEqual({ x: 100, y: 50 })
    // A corner side takes effect even when the anchor faces a different edge.
    expect(leaderOrigin(box, { x: 0, y: 0 }, 'bottomRight')).toEqual({ x: 100, y: 50 })
  })
})

describe('cablePointAtRatio', () => {
  it('returns the midpoint of a straight run by default', () => {
    const p = cablePointAtRatio({ x: 0, y: 0 }, undefined, { x: 100, y: 0 }, 0.5)
    expect(p).toEqual({ x: 50, y: 0 })
  })

  it('walks waypoints by cumulative length', () => {
    // 0 -> 100 along x (100), then 100 vertically (200 total). The midpoint
    // (ratio 0.5) lands exactly on the corner at {100, 0}.
    const mid = cablePointAtRatio({ x: 0, y: 0 }, [{ x: 100, y: 0 }], { x: 100, y: 100 }, 0.5)
    expect(mid.x).toBeCloseTo(100)
    expect(mid.y).toBeCloseTo(0)
    // ratio 0.75 -> 150 along: consumes the x-segment + 50 of the y-segment => {100, 50}.
    const threeQuarters = cablePointAtRatio({ x: 0, y: 0 }, [{ x: 100, y: 0 }], { x: 100, y: 100 }, 0.75)
    expect(threeQuarters.x).toBeCloseTo(100)
    expect(threeQuarters.y).toBeCloseTo(50)
  })

  it('clamps an out-of-range ratio and falls back on a zero-length run', () => {
    expect(cablePointAtRatio({ x: 0, y: 0 }, undefined, { x: 10, y: 0 }, 5).x).toBe(10)
    expect(cablePointAtRatio({ x: 5, y: 5 }, undefined, { x: 5, y: 5 }, 0.5)).toEqual({ x: 5, y: 5 })
  })
})