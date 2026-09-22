/**
 * Rack canvas: one React Flow node per rack, plus the cabling overlay.
 *
 * Rendered by `App` in place of `CanvasContainer` when the active design is of
 * type `rack`. It carries its OWN `ReactFlowProvider`: sharing the App-level one
 * with the logical canvas leaks that canvas' pan/zoom and pane size into the
 * rack flow when the user switches back and forth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import { Plus, Type } from 'lucide-react'
import { rackHeight, rackWidth } from '../layout'
import { useRackStore } from '../store'
import { useRackPalette } from '../rackTheme'
import { useAutoStatusRefresh } from '../useAutoStatusRefresh'
import { CableLayer } from './CableLayer'
import { LabelPointerLayer } from './LabelPointerLayer'
import { RackDeviceModal } from './RackDeviceModal'
import { RackFlowNode } from './RackFlowNode'
import { RackSettingsModal } from './RackSettingsModal'
import { TextNode } from '@/components/canvas/nodes/TextNode'
import { TextModal, type TextFormData, type TextTargetOption } from '@/components/modals/TextModal'
import type { Cable, Rack, RackDevice, RackLabel } from '@/types'

const nodeTypes = { rack: RackFlowNode, text: TextNode }

/** Map the shared TextModal form's style fields onto a rack label's style pod. */
function rackPodFromForm(data: TextFormData): NonNullable<RackLabel['custom_colors']> {
  return {
    font: data.font,
    text_color: data.text_color,
    text_size: data.text_size,
    border: data.border_color,
    border_style: data.border_style,
    border_width: data.border_width,
    background: data.background_color,
  }
}

/** Prefill the edit modal from an existing rack label. */
function rackInitialFromLabel(id: string, labels: RackLabel[]): Partial<TextFormData> | undefined {
  const label = labels.find((l) => l.id === id)
  if (!label) return undefined
  const rc = label.custom_colors ?? {}
  return {
    text: label.label,
    font: rc.font ?? 'inter',
    text_color: rc.text_color ?? '#e6edf3',
    text_size: rc.text_size ?? 14,
    border_color: rc.border ?? '#30363d',
    border_style: (rc.border_style ?? 'none') as TextFormData['border_style'],
    border_width: rc.border_width ?? 1,
    background_color: rc.background ?? '#00000000',
    target: label.target,
    anchor_side: label.anchorSide ?? 'auto',
  }
}

/** Everything on the active rack canvas that a label can point at. */
function rackTargetOptions(
  racks: Rack[],
  devices: RackDevice[],
  cables: Cable[],
): TextTargetOption[] {
  const options: TextTargetOption[] = []
  for (const rack of racks) {
    options.push({ target: { kind: 'node', id: rack.id }, label: rack.name })
  }
  for (const device of devices) {
    options.push({ target: { kind: 'device', id: device.id }, label: device.label })
    for (const port of device.ports) {
      options.push({
        target: { kind: 'port', deviceId: device.id, portId: port.id },
        label: `${device.label} · ${port.label}`,
      })
    }
  }
  for (const cable of cables) {
    options.push({
      target: { kind: 'cable', id: cable.id, anchorRatio: 0.5 },
      label: cable.label ? `Cable · ${cable.label}` : `Cable · ${cable.type}`,
    })
  }
  return options
}

function RackCanvasInner() {
  const racks = useRackStore((s) => s.racks)
  const moveRack = useRackStore((s) => s.moveRack)
  const selectDevice = useRackStore((s) => s.selectDevice)
  const cableMode = useRackStore((s) => s.cableMode)
  const loading = useRackStore((s) => s.loading)
  const loadError = useRackStore((s) => s.loadError)
  const designId = useRackStore((s) => s.designId)
  const storedViewport = useRackStore((s) => s.viewport)
  const setViewport = useRackStore((s) => s.setViewport)
  const addRack = useRackStore((s) => s.addRack)
  const loadDemo = useRackStore((s) => s.loadDemo)
  const selectCable = useRackStore((s) => s.selectCable)
  const removeSelectedCable = useRackStore((s) => s.removeSelectedCable)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const dragging = useRackStore((s) => s.cableDrag != null)
  const moveCableDrag = useRackStore((s) => s.moveCableDrag)
  const endCableDrag = useRackStore((s) => s.endCableDrag)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cancelCableDraft = useRackStore((s) => s.cancelCableDraft)
  // Labels / callout notes
  const labels = useRackStore((s) => s.labels)
  const devices = useRackStore((s) => s.devices)
  const cables = useRackStore((s) => s.cables)
  const addLabel = useRackStore((s) => s.addLabel)
  const moveLabel = useRackStore((s) => s.moveLabel)
  const updateLabel = useRackStore((s) => s.updateLabel)
  const removeLabel = useRackStore((s) => s.removeLabel)

  const [labelEditorOpen, setLabelEditorOpen] = useState(false)
  const [editingLabel, setEditingLabel] = useState<{ id: string } | null>(null)
  // Which label's NodeResizer handles are live. A label must be explicitly
  // selected before its resize handles render (`NodeResizer isVisible` is
  // driven off this), and selection is what makes Delete/Backspace reach it.
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null)

  const palette = useRackPalette()
  const { setViewport: applyViewport, screenToFlowPosition } = useReactFlow()

  // Mounts set to "check device" read their LED from the inventory's
  // `node_status`, which only a refetch moves.
  useAutoStatusRefresh()

  // Restore the saved pan/zoom once per load, not on every viewport nudge.
  //
  // Coming back from another canvas remounts this component BEFORE `App`'s
  // design effect calls `loadDesign`, so the first pass here sees the previous
  // state. Clearing the marker whenever a load starts means the viewport the
  // fetch brings back is the one that gets applied, not the pre-load leftover.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (loading) {
      restoredFor.current = null
      return
    }
    if (!designId || restoredFor.current === designId || storedViewport.zoom <= 0) return
    restoredFor.current = designId
    // A frame later: on a fresh mount React Flow has not measured its pane yet,
    // and a viewport set against a stale size lands in the wrong place.
    const frame = requestAnimationFrame(() => void applyViewport(storedViewport))
    return () => cancelAnimationFrame(frame)
  }, [designId, loading, storedViewport, applyViewport])

  // A patch dragged out of a port follows the pointer until it is released.
  // Both listeners are on the window: the drop target is often a port on
  // another rack, and a release outside the canvas must still end the drag.
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) =>
      moveCableDrag(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    // The port's own pointerup runs first and clears the drag, so reaching here
    // means the cable was released on nothing.
    const up = () => endCableDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, moveCableDrag, endCableDrag, screenToFlowPosition])

  // Delete/Backspace unplugs the selected cable; Escape deselects it, or drops
  // a half-drawn patch.
  useEffect(() => {
    if (!selectedCableId && !cableDraft) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (selectedCableId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeSelectedCable()
      } else if (e.key === 'Escape') {
        selectCable(null)
        cancelCableDraft()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedCableId, cableDraft, removeSelectedCable, selectCable, cancelCableDraft])

  const nodes: Node[] = useMemo(
    () => [
      // Racks first, then labels on top (later nodes paint above earlier ones).
      ...racks.map((rack) => ({
        id: rack.id,
        type: 'rack',
        position: rack.position,
        data: {},
        draggable: !cableMode,
        style: { width: rackWidth(rack), height: rackHeight(rack) },
      })),
      ...labels.map((label) => ({
        id: label.id,
        type: 'text',
        position: label.position,
        data: {
          type: 'text',
          label: label.label,
          custom_colors: label.custom_colors ?? {},
        },
        // A label must be selectable for `NodeResizer isVisible={selected}` to
        // flip on, and its selection is fed back through `onNodesChange` so the
        // keyboard delete and the editor know which label the user picked.
        selected: selectedLabelId === label.id,
        draggable: !cableMode,
        style: { width: label.width ?? 200, height: label.height ?? 60 },
      })),
    ],
    [racks, labels, cableMode, selectedLabelId],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select') {
          // A label picked on the canvas gets its resize handles shown and
          // becomes the target of Delete/Backspace. A rack pick (or an empty
          // click) clears the selection.
          if (change.selected) setSelectedLabelId(change.id)
          continue
        }
        if (change.type === 'position' && change.position) {
          const isLabel = labels.some((l) => l.id === change.id)
          if (isLabel) moveLabel(change.id, change.position)
          else moveRack(change.id, change.position)
          continue
        }
        if (
          change.type === 'dimensions' &&
          change.dimensions &&
          change.resizing !== false
        ) {
          // NodeResizer emits these as the user drags a handle — persist the
          // new box. The initial measure (resizing === false) is skipped so a
          // freshly-loaded label doesn't dirty the canvas as an edit.
          updateLabel(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          })
        }
      }
    },
    [moveRack, moveLabel, updateLabel, labels],
  )

  // Delete/Backspace removes the selected label before falling through to the
  // cable handler: a label is a flow node the same key handling would leave to
  // React Flow, but we branch on it explicitly so the pointer goes with it.
  // The label being edited is always a delete target; a picked-but-not-open
  // one is too (its resize handles are live and it is the obvious focus).
  useEffect(() => {
    const targetId = editingLabel?.id ?? selectedLabelId
    if (!targetId) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeLabel(targetId)
        setEditingLabel(null)
        setSelectedLabelId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingLabel, selectedLabelId, removeLabel])

  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => setViewport(viewport),
    [setViewport],
  )

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#f85149]">
        Rack canvas could not be loaded.
      </div>
    )
  }

  return (
    <>
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onMoveEnd={onMoveEnd}
      onPaneClick={() => { selectDevice(null); setEditingLabel(null); setSelectedLabelId(null) }}
      onNodeClick={(_event, node) => {
        // Clicking a label picks it up — the same gesture React Flow would use
        // to show its NodeResizer handles and arm the keyboard delete.
        if (node.type === 'text') setSelectedLabelId(node.id)
      }}
      onNodeDoubleClick={(_event, node) => {
        if (node.type === 'text' && labels.some((l) => l.id === node.id)) {
          setSelectedLabelId(node.id)
          setEditingLabel({ id: node.id })
        }
      }}
      minZoom={0.2}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      style={{ background: palette.canvas }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={palette.dot} />
      <Controls />
      <CableLayer />
      <LabelPointerLayer />
      {!loading && racks.length === 0 && (
        // z-10 clears .react-flow__renderer (z-index 4); without it the pane sits
        // on top and swallows the clicks as a canvas drag.
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-[#8b949e]">This rack canvas is empty.</p>
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              onClick={() => addRack({ style: palette.defaultRackStyle })}
              className="flex items-center gap-1.5 rounded border border-[#00d4ff] px-3 py-1.5 text-xs text-[#00d4ff] hover:bg-[#00d4ff]/10 cursor-pointer"
            >
              <Plus size={14} /> Add a rack
            </button>
            <button
              type="button"
              onClick={loadDemo}
              className="rounded border border-[#21262d] bg-[#161b22] px-3 py-1.5 text-xs text-[#8b949e] hover:border-[#30363d] hover:text-[#c9d1d9] cursor-pointer"
            >
              Load a sample rack
            </button>
          </div>
        </div>
      )}
      {/* An empty rack canvas still wants a label/note annotation. */}
      {!loading && (
        <button
          type="button"
          onClick={() => setLabelEditorOpen(true)}
          className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded border border-[#21262d] bg-[#161b22] px-2.5 py-1.5 text-xs text-[#8b949e] hover:border-[#00d4ff] hover:text-[#00d4ff] cursor-pointer"
          data-testid="add-rack-label"
        >
          <Type size={14} /> Add label
        </button>
      )}
    </ReactFlow>
    {/* Editors live outside the flow so a dialog is never clipped by it. */}
    <TextModal
      key={editingLabel?.id ?? 'rack-label-add'}
      open={labelEditorOpen || !!editingLabel}
      onClose={() => { setLabelEditorOpen(false); setEditingLabel(null) }}
      onSubmit={(data: TextFormData) => {
        if (editingLabel) {
          updateLabel(editingLabel.id, {
            label: data.text,
            custom_colors: rackPodFromForm(data),
            target: data.target,
            anchorSide: data.anchor_side,
          })
          setEditingLabel(null)
        } else {
          addLabel({
            label: data.text,
            custom_colors: rackPodFromForm(data),
            target: data.target,
            anchorSide: data.anchor_side,
            width: 200,
            height: 60,
          })
          setLabelEditorOpen(false)
        }
      }}
      onDelete={editingLabel ? () => { removeLabel(editingLabel.id); setEditingLabel(null) } : undefined}
      initial={editingLabel ? rackInitialFromLabel(editingLabel.id, labels) : undefined}
      title={editingLabel ? 'Edit Label' : 'Add Label'}
      targets={rackTargetOptions(racks, devices, cables)}
    />
    <RackDeviceModal />
    <RackSettingsModal />
    </>
  )
}

export function RackCanvas() {
  return (
    <ReactFlowProvider>
      <RackCanvasInner />
    </ReactFlowProvider>
  )
}
