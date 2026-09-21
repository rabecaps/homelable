/**
 * Cabling overlay: in patch mode a click selects a cable rather than deleting
 * it outright, so a misclick costs nothing and Delete is the destructive step.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CableLayer } from '../components/CableLayer'
import { useRackStore } from '../store'

vi.mock('@xyflow/react', async () => {
  const { mockReactFlow } = await import('@/test/mocks')
  const React = await import('react')
  return mockReactFlow({
    ViewportPortal: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  })
})

/** The fat invisible click targets, one per drawn cable. */
const hitPaths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGPathElement>('path[stroke="transparent"]'))

beforeEach(() => {
  useRackStore.getState().loadDemo()
})

describe('CableLayer selection', () => {
  it('selects a cable on click outside patch mode too', () => {
    // A cable is clicked to read and edit it in the rail, not only to unplug it,
    // so the hit target is not gated on patch mode.
    useRackStore.getState().setCableVisibility('always')
    const { container } = render(<CableLayer />)
    const paths = hitPaths(container)
    expect(paths).toHaveLength(useRackStore.getState().cables.length)

    fireEvent.click(paths[0])
    expect(useRackStore.getState().cableMode).toBe(false)
    expect(useRackStore.getState().selectedCableId).toBe(useRackStore.getState().cables[0].id)
  })

  it('keeps the selected cable drawn when cables are hidden', () => {
    // Its panel is open on the right; hiding the run being edited reads as a
    // bug. The header select used to make the selection vanish under the panel.
    const store = useRackStore.getState()
    store.selectCable(store.cables[0].id)
    store.setCableVisibility('hidden')

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
  })

  it('draws nothing else when cables are hidden, even on hover', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('hidden')
    store.hoverDevice(store.cables[0].from.deviceId)
    store.selectCable(store.cables[0].id)

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
  })

  it('draws nothing when cables are hidden and none is selected', () => {
    useRackStore.getState().setCableVisibility('hidden')
    const { container } = render(<CableLayer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the selected cable drawn when visibility is hover and nothing is focused', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('hover')
    store.selectCable(store.cables[0].id)

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
  })

  it('selects a cable on click in patch mode', () => {
    useRackStore.getState().toggleCableMode()
    const { container } = render(<CableLayer />)
    const paths = hitPaths(container)
    expect(paths.length).toBe(useRackStore.getState().cables.length)

    fireEvent.click(paths[0])
    expect(useRackStore.getState().selectedCableId).toBe(useRackStore.getState().cables[0].id)
  })

  it('deselects when the selected cable is clicked again', () => {
    useRackStore.getState().toggleCableMode()
    const { container } = render(<CableLayer />)
    fireEvent.click(hitPaths(container)[0])
    fireEvent.click(hitPaths(container)[0])
    expect(useRackStore.getState().selectedCableId).toBeNull()
  })

  it('leaves the cable in place — clicking never deletes', () => {
    useRackStore.getState().toggleCableMode()
    const before = useRackStore.getState().cables.length
    const { container } = render(<CableLayer />)
    fireEvent.click(hitPaths(container)[0])
    expect(useRackStore.getState().cables).toHaveLength(before)
  })

  it('draws no rubber band until the drag moves', () => {
    const store = useRackStore.getState()
    store.toggleCableMode()
    const port = store.devices[0].ports[0]
    store.startCableDrag(store.devices[0].id, port.id)
    const { queryByTestId } = render(<CableLayer />)
    expect(queryByTestId('cable-draft')).toBeNull()
  })

  it('draws a rubber band from the armed port to the pointer', () => {
    const store = useRackStore.getState()
    store.toggleCableMode()
    const device = store.devices[0]
    store.startCableDrag(device.id, device.ports[0].id)
    store.moveCableDrag({ x: 420, y: 300 })

    const { getByTestId } = render(<CableLayer />)
    const band = getByTestId('cable-draft')
    const end = band.querySelectorAll('circle')[1]
    expect(end.getAttribute('cx')).toBe('420')
    expect(end.getAttribute('cy')).toBe('300')
    expect(band.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('5 4')
  })

  it('draws copper and fibre alike — there is no type filter any more', () => {
    useRackStore.getState().toggleCableMode()
    const { cables } = useRackStore.getState()
    expect(new Set(cables.map((c) => c.type))).toEqual(new Set(['ethernet', 'fiber']))

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(cables.length)
  })

  it('prints nothing beside a cable that has no visible annotation', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    // A label alone is not enough — it is printed only once the user asks.
    store.updateCable(store.cables[0].id, { label: 'Uplink', labelVisible: false })
    const { queryAllByTestId } = render(<CableLayer />)
    expect(queryAllByTestId('cable-annotation')).toHaveLength(0)
  })

  it('prints the label and the visible properties on the canvas', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      label: 'Uplink',
      labelVisible: true,
      properties: [
        { key: 'Length', value: '2 m', icon: null, visible: true },
        { key: 'VLAN', value: '20', icon: null, visible: false },
      ],
    })

    const { getAllByTestId } = render(<CableLayer />)
    const badges = getAllByTestId('cable-annotation')
    expect(badges).toHaveLength(1)
    const lines = Array.from(badges[0].querySelectorAll('text')).map((t) => t.textContent)
    expect(lines).toEqual(['Uplink', 'Length: 2 m'])
  })

  it('prints a value-less property as a bare label', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      labelVisible: false,
      properties: [{ key: 'Spare', value: '', icon: null, visible: true }],
    })

    const { getAllByTestId } = render(<CableLayer />)
    const lines = Array.from(getAllByTestId('cable-annotation')[0].querySelectorAll('text')).map((t) => t.textContent)
    expect(lines).toEqual(['Spare'])
  })

  it('draws the selected cable with a highlight halo', () => {
    useRackStore.getState().toggleCableMode()
    const { container, rerender } = render(<CableLayer />)
    const strokeWidths = () =>
      Array.from(container.querySelectorAll<SVGPathElement>('path')).map((p) =>
        p.getAttribute('stroke-width'),
      )
    expect(strokeWidths()).not.toContain('7')

    fireEvent.click(hitPaths(container)[0])
    rerender(<CableLayer />)
    expect(strokeWidths()).toContain('7')
  })
})

describe('CableLayer routing (waypoints + path style)', () => {
  /** Resolve every visible `d` attribute drawn for a cable, in order. */
  const pathDs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<SVGPathElement>('path')).map((p) => p.getAttribute('d'))

  it('draws a Catmull `C` cubic when a routed cable has waypoints (bezier)', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      waypoints: [{ x: 300, y: 200 }],
      pathStyle: 'bezier',
    })
    const { container } = render(<CableLayer />)
    const ds = pathDs(container).filter((d) => d && d.includes(' C '))
    expect(ds.length).toBeGreaterThan(0)
    expect(ds.every((d) => d!.startsWith('M') && d!.includes(' C '))).toBe(true)
    // Untouched cables in the same render still use the slack-loop cubic `C`.
    const legacy = pathDs(container).filter((d) => d && d.startsWith('M') && !d.includes('L') && /C .* C /.test(d))
    expect(legacy.length).toBeGreaterThan(0)
  })

  it('draws `Q`/`L` segments for a routed cable in smooth style', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      waypoints: [{ x: 300, y: 200 }],
      pathStyle: 'smooth',
    })
    const { container } = render(<CableLayer />)
    const ds = pathDs(container).filter((d) => d && d.includes(' Q '))
    expect(ds.length).toBeGreaterThan(0)
    expect(ds.some((d) => d!.includes(' L '))).toBe(true)
  })

  it('keeps the default slack-loop `C` cubic when a cable has no waypoints', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    // Explicitly ensure no waypoints are set.
    expect(store.cables[0].waypoints).toBeUndefined()
    const { container } = render(<CableLayer />)
    const ds = pathDs(container)
    const cube = ds.find((d) => d && d.startsWith('M') && !d.includes('L'))
    expect(cube).toBeDefined()
    expect(cube!.startsWith('M') && /M [\d.]+ [\d.]+ C /.test(cube!)).toBe(true)
  })

  it('renders no waypoint handles when the routed cable is not selected', () => {
    const store = useRackStore.getState()
    store.updateCable(store.cables[0].id, { waypoints: [{ x: 300, y: 200 }] })
    store.setCableVisibility('always')
    const { queryAllByTestId } = render(<CableLayer />)
    expect(queryAllByTestId(`cable-waypoint-${store.cables[0].id}-0`)).toHaveLength(0)
  })

  it('renders a drag handle per waypoint on the selected cable', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      waypoints: [{ x: 300, y: 200 }, { x: 310, y: 210 }],
    })
    store.selectCable(store.cables[0].id)
    const { getAllByTestId } = render(<CableLayer />)
    expect(getAllByTestId(`cable-waypoint-${store.cables[0].id}-0`)).toHaveLength(1)
    expect(getAllByTestId(`cable-waypoint-${store.cables[0].id}-1`)).toHaveLength(1)
  })

  it('clicking a + handle inserts a waypoint at the segment midpoint', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      pathStyle: 'bezier',
    })
    store.selectCable(store.cables[0].id)
    const cid = store.cables[0].id
    const { getAllByTestId } = render(<CableLayer />)
    const addHandle = getAllByTestId(`cable-add-${cid}-0`)[0]
    fireEvent.click(addHandle)
    // Read fresh — the store replaces the cables array on every edit, so a
    // reference captured before the click is stale.
    const after = useRackStore.getState().cables.find((c) => c.id === cid)
    expect(after?.waypoints ?? []).toHaveLength(1)
  })

  it('caps the + handles at 12 waypoints', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    const many = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 10, y: 200 }))
    store.updateCable(store.cables[0].id, { waypoints: many })
    store.selectCable(store.cables[0].id)
    const { queryAllByTestId } = render(<CableLayer />)
    // 13 waypoints → no add handles stay visible.
    expect(queryAllByTestId(`cable-add-${store.cables[0].id}-0`)).toHaveLength(0)
  })

  it('dragging a waypoint handle moves the stored waypoint', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    const cid = store.cables[0].id
    store.updateCable(cid, { waypoints: [{ x: 300, y: 200 }] })
    store.selectCable(cid)
    const { getByTestId } = render(<CableLayer />)
    const handle = getByTestId(`cable-waypoint-${cid}-0`)

    fireEvent.pointerDown(handle, { pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 350, clientY: 220 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(useRackStore.getState().cables.find((c) => c.id === cid)!.waypoints![0]).toMatchObject({ x: 350, y: 220 })
  })

  it('double-clicking a waypoint handle removes that waypoint', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    const cid = store.cables[0].id
    store.updateCable(cid, {
      waypoints: [{ x: 300, y: 200 }, { x: 310, y: 210 }],
    })
    store.selectCable(cid)
    const { getByTestId } = render(<CableLayer />)
    const handle = getByTestId(`cable-waypoint-${cid}-0`)
    fireEvent.doubleClick(handle)
    const after = useRackStore.getState().cables.find((c) => c.id === cid)!.waypoints
    expect(after!).toHaveLength(1)
    expect(after![0]).toMatchObject({ x: 310, y: 210 })
  })
})
