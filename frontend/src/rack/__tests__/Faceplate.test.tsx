/**
 * The renderer places the name band and the status LED; a template can move
 * both off mid-height, which is what makes a desktop NAS look like one.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Faceplate } from '../components/Faceplate'
import { getFaceplate } from '../faceplates'

const HEIGHT = 100

function draw(faceplateId: string) {
  const plate = getFaceplate(faceplateId)
  const { container } = render(
    <Faceplate
      faceplateId={faceplateId}
      label="nas-01"
      status="online"
      ports={plate.ports.map((p, i) => ({ ...p, id: `p${i}` }))}
      width={200}
      height={HEIGHT}
      revealed
    />,
  )
  return {
    led: container.querySelector('circle'),
    text: container.querySelector('text'),
  }
}

/** Every RJ45 silhouette drawn on a plate, as its path `d`. */
function rj45Paths(faceplateId: string, height: number) {
  const plate = getFaceplate(faceplateId)
  const ports = plate.ports.map((p, i) => ({ ...p, id: `p${i}` }))
  const { container } = render(
    <Faceplate
      faceplateId={faceplateId}
      label="gear"
      status="online"
      ports={ports}
      width={400}
      height={height}
      revealed
    />,
  )
  return Array.from(container.querySelectorAll('g'))
    .filter((g) => g.querySelector('title')?.textContent?.endsWith('· rj45'))
    .map((g) => g.querySelector('path')?.getAttribute('d'))
    .filter(Boolean)
}

describe('Faceplate — port artwork', () => {
  it('draws every RJ45 at the same size, whatever the plate', () => {
    // A 1U switch, a 1U patch panel and a 4U NAS: same socket on all three.
    const reference = rj45Paths('switch-24', 24)[0]
    expect(reference).toBeTruthy()
    for (const [id, height] of [
      ['patch-24', 24],
      ['server-1u', 24],
      ['nas-2u', 48],
      ['server-4u-storage', 96],
    ] as const) {
      const paths = rj45Paths(id, height)
      expect(paths.length).toBeGreaterThan(0)
      for (const d of paths) expect(d).toBe(reference)
    }
  })

  it('keeps the socket the same size on a plate stretched to 4U', () => {
    expect(rj45Paths('switch-24', 96)[0]).toBe(rj45Paths('switch-24', 24)[0])
  })
})

describe('Faceplate — custom plate builder wiring', () => {
  const ports = [
    { id: 'a', label: 'p1', type: 'rj45' as const, x: 0.3, y: 0.5, color: '#ff0000' },
    { id: 'b', label: 'p2', type: 'power' as const, x: 0.5, y: 0.5 },
    { id: 'c', label: 'p3', type: 'sfp' as const, x: 0.7, y: 0.5, color: '#00ff00' },
  ]

  it('renders a per-port colour as the jack fill', () => {
    const { container } = render(
      <Faceplate
        faceplateId="blank-black"
        label="gear"
        status="online"
        ports={ports}
        width={200}
        height={24}
        revealed
      />,
    )
    const byTitle = (label: string) =>
      Array.from(container.querySelectorAll('g')).find(
        (g) => g.querySelector('title')?.textContent?.split(' ·')[0] === label,
      )
    // RJ45 is a path; its fill is the port colour.
    const rj45 = byTitle('p1')!.querySelector('path')
    expect(rj45).toHaveAttribute('fill', '#ff0000')
    // SFP is a rect; the first (recess) rect carries the fill.
    const sfp = byTitle('p3')!
    const rects = Array.from(sfp.querySelectorAll('rect'))
    expect(rects[0]).toHaveAttribute('fill', '#00ff00')
  })

  it('leaves a port without a colour on the theme fill', () => {
    const { container } = render(
      <Faceplate
        faceplateId="blank-black"
        label="gear"
        status="online"
        ports={[{ id: 'z', label: 'p9', type: 'rj45' as const, x: 0.4, y: 0.5 }]}
        width={200}
        height={24}
        revealed
      />,
    )
    const g = Array.from(container.querySelectorAll('g')).find(
      (g) => g.querySelector('title')?.textContent?.split(' ·')[0] === 'p9',
    )!
    expect(g.querySelector('path')).toHaveAttribute('fill', '#0b0e13')
  })

  it('draws a power jack that is unmistakably not an ethernet/fibre port', () => {
    const { container } = render(
      <Faceplate
        faceplateId="blank-black"
        label="gear"
        status="online"
        ports={ports}
        width={200}
        height={24}
        revealed
      />,
    )
    const power = Array.from(container.querySelectorAll('g')).find(
      (g) => g.querySelector('title')?.textContent?.startsWith('p2 · power'),
    )!
    // The power shape is a pair of pins on a recessed rect — not a path (rj45)
    // and not the single-rect SFP aperture.
    expect(power.querySelector('path')).toBeNull()
    expect(power.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3)
  })
})

describe('Faceplate — label colour and size', () => {
  it('renders a plate-labelled text with its own colour and size', () => {
    const { container } = render(
      <Faceplate
        faceplateId="blank-black"
        label="genesis"
        status="online"
        ports={[]}
        width={200}
        height={100}
        labelColor="#ff00ff"
        labelSize={13}
        revealed
      />,
    )
    const text = container.querySelector('text')
    expect(text).toHaveAttribute('fill', '#ff00ff')
    expect(text).toHaveAttribute('font-size', '13')
  })

  it('falls back to the plate template colour when no override is given', () => {
    const { container } = render(
      <Faceplate
        faceplateId="blank-black"
        label="genesis"
        status="online"
        ports={[]}
        width={200}
        height={100}
        revealed
      />,
    )
    // Light silk on the dark blank plate.
    expect(container.querySelector('text')).toHaveAttribute('fill', '#e6e6e6')
  })
})

describe('Faceplate — name band', () => {
  it('keeps rack gear labelled across the middle', () => {
    const { led, text } = draw('server-1u')
    expect(led).toHaveAttribute('cy', String(HEIGHT / 2))
    expect(text).toHaveAttribute('y', String(HEIGHT / 2))
  })

  it('drops the badge and the LED to the bottom strip of a desktop NAS', () => {
    const band = getFaceplate('nas-desktop-2').labelBox.y!
    const { led, text } = draw('nas-desktop-2')
    // Drive trays own the height; the badge belongs under them, not across them.
    expect(led).toHaveAttribute('cy', String(band * HEIGHT))
    expect(text).toHaveAttribute('y', String(band * HEIGHT))
  })
})

/** Ids of the ports the plate actually drew. */
function drawnPortIds(props: Partial<Parameters<typeof Faceplate>[0]>) {
  const ports = [
    { id: 'a', label: 'p1', type: 'rj45' as const, x: 0.3, y: 0.5 },
    { id: 'b', label: 'p2', type: 'rj45' as const, x: 0.5, y: 0.5 },
  ]
  const { container } = render(
    <Faceplate
      faceplateId="server-1u"
      label="box"
      status="online"
      ports={ports}
      width={200}
      height={24}
      {...props}
    />,
  )
  return Array.from(container.querySelectorAll('title'))
    .map((t) => t.textContent?.split(' ·')[0])
    .filter(Boolean)
}

describe('Faceplate — when ports are drawn', () => {
  it('hides the ports of non-patch gear until it is focused', () => {
    expect(drawnPortIds({})).toEqual([])
    expect(drawnPortIds({ revealed: true })).toEqual(['p1', 'p2'])
  })

  it('always draws a port a visible cable ends on, focused or not', () => {
    // The far end of a hovered device's run lands on a plate that is not
    // hovered — a cable must never end on an invisible socket.
    expect(drawnPortIds({ revealedPortIds: new Set(['b']) })).toEqual(['p2'])
  })

  it('honours an `always` override on gear the plate would hide', () => {
    expect(drawnPortIds({ portVisibility: 'always' })).toEqual(['p1', 'p2'])
  })

  it('honours a `hover` override on a switch the plate would always show', () => {
    const asSwitch = { faceplateId: 'switch-24' as const }
    expect(drawnPortIds({ ...asSwitch })).toEqual(['p1', 'p2'])
    expect(drawnPortIds({ ...asSwitch, portVisibility: 'hover' })).toEqual([])
    expect(drawnPortIds({ ...asSwitch, portVisibility: 'hover', revealed: true })).toEqual([
      'p1',
      'p2',
    ])
  })

  it('leaves `auto` on the faceplate to decide', () => {
    expect(drawnPortIds({ portVisibility: 'auto' })).toEqual([])
    expect(drawnPortIds({ portVisibility: 'auto', faceplateId: 'switch-24' })).toEqual([
      'p1',
      'p2',
    ])
  })
})
