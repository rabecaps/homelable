/**
 * Maps between the rack API payloads (snake_case, flat) and the domain shapes
 * the rack store works with (camelCase, nested position/endpoints).
 *
 * Mirrors what `canvasSerializer` does for nodes and edges.
 */
import { DEFAULT_RACK_STYLE, PORT_CABLE_TYPE, CABLE_COLORS } from '@/rack/rackDefaults'
import { suggestFaceplate } from '@/rack/faceplates'
import { RACK_COLUMNS } from '@/types'
import type {
  Cable,
  CableProperty,
  CableType,
  DeviceStatus,
  InventoryDevice,
  InventoryService,
  LabelTarget,
  LinkedNodeInfo,
  MountStatus,
  Port,
  PortType,
  PortVisibility,
  Rack,
  RackDevice,
  RackLabel,
  RackModel,
  RackNumbering,
  RackStyle,
  RackWidthStandard,
} from '@/types'

// ── API shapes ───────────────────────────────────────────────────────────────

export interface ApiRack {
  id: string
  design_id: string
  name: string
  u_height: number
  width_standard: string
  numbering: string
  location: string | null
  style: Record<string, unknown>
  pos_x: number
  pos_y: number
}

export interface ApiRackDevice {
  id: string
  design_id: string
  rack_id: string
  device_id: string | null
  node_id: string | null
  label: string
  u_start: number
  u_height: number
  col_start: number
  col_span: number
  faceplate_id: string
  color: string | null
  status: string
  /** 'auto' | 'always' | 'hover'. Rows written before the column read NULL. */
  port_visibility?: string | null
  ports: unknown[]
}

export interface ApiRackCable {
  id: string
  design_id: string
  from_device_id: string
  from_port_id: string
  to_device_id: string
  to_port_id: string
  type: string
  color: string
  label: string | null
  label_visible: boolean
  /** [{key, value, icon, visible}] — same records the logical canvas uses. */
  properties: CableProperty[]
  /** How a routed run curves through its waypoints. Absent = straight bulge. */
  path_style?: string | null
  /** Ordered points the run passes through, in flow coordinates. */
  waypoints?: { x: number; y: number }[] | null
}

export interface ApiRackLabel {
  id: string
  design_id: string
  label: string
  /** Same opaque style blob the logical canvas' TextNode reads. */
  custom_colors: Record<string, unknown>
  /** The `LabelTarget` union — none/node/device/port/cable + anchor. */
  target: Record<string, unknown>
  anchor_side: string | null
  pos_x: number
  pos_y: number
  width: number | null
  height: number | null
}

export interface ApiRackState {
  racks: ApiRack[]
  devices: ApiRackDevice[]
  cables: ApiRackCable[]
  labels: ApiRackLabel[]
  viewport: { x?: number; y?: number; zoom?: number }
}

export interface ApiInventoryItem {
  id: string
  label: string
  suggested_type: string | null
  ip: string | null
  status: string
  discovery_source: string | null
  node_id: string | null
  node_status: string | null
  racked: boolean
  // Technical detail, added after the first release of the endpoint — optional
  // so an older backend (or a fixture) still deserializes.
  mac?: string | null
  hostname?: string | null
  os?: string | null
  services?: { port?: number | null; name?: string | null }[] | null
  node_label?: string | null
  node_type?: string | null
  node_ip?: string | null
  node_mac?: string | null
  node_hostname?: string | null
  node_os?: string | null
  node_check_method?: string | null
  node_design_id?: string | null
  node_design_name?: string | null
  node_last_seen?: string | null
  // Rack modelisation the inventory row owns. Absent on an older backend, and
  // null on a device that has never been racked.
  rack_faceplate_id?: string | null
  rack_u_height?: number | null
  rack_col_span?: number | null
  rack_color?: string | null
  rack_ports?: unknown[] | null
}

export interface RackSavePayload {
  design_id: string
  racks: Omit<ApiRack, 'design_id'>[]
  devices: Omit<ApiRackDevice, 'design_id'>[]
  cables: Omit<ApiRackCable, 'design_id'>[]
  labels: Omit<ApiRackLabel, 'design_id'>[]
  viewport: { x: number; y: number; zoom: number }
}

// ── Narrowing ────────────────────────────────────────────────────────────────

const WIDTH_STANDARDS: RackWidthStandard[] = ['19', '10']
const NUMBERINGS: RackNumbering[] = ['bottom-up', 'top-down']
const PORT_TYPES: PortType[] = ['rj45', 'sfp', 'sfp+', 'power']
const DEVICE_STATUSES: DeviceStatus[] = ['online', 'offline', 'unknown']
const ANCHOR_SIDES: ('auto' | 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left' | 'topLeft' | 'center')[] = [
  'auto',
  'top',
  'topRight',
  'right',
  'bottomRight',
  'bottom',
  'bottomLeft',
  'left',
  'topLeft',
  'center',
]

function asWidthStandard(v: string): RackWidthStandard {
  return (WIDTH_STANDARDS as string[]).includes(v) ? (v as RackWidthStandard) : '19'
}

function asNumbering(v: string): RackNumbering {
  return (NUMBERINGS as string[]).includes(v) ? (v as RackNumbering) : 'bottom-up'
}

function asStatus(v: string | null): DeviceStatus {
  return (DEVICE_STATUSES as (string | null)[]).includes(v) ? (v as DeviceStatus) : 'unknown'
}

/** A mount may also store `auto` — it follows the linked node's check. */
function asMountStatus(v: string | null): MountStatus {
  return v === 'auto' ? 'auto' : asStatus(v)
}

/** Absent, NULL or unknown all mean `auto`: let the faceplate decide. */
function asPortVisibility(v: string | null | undefined): PortVisibility | undefined {
  return v === 'always' || v === 'hover' ? v : undefined
}

/** Style is free-form JSON on the wire; fill any key the server never wrote. */
function asStyle(raw: Record<string, unknown>): RackStyle {
  const pick = (key: keyof RackStyle) => raw[key]
  return {
    frame: typeof pick('frame') === 'string' ? (raw.frame as string) : DEFAULT_RACK_STYLE.frame,
    rail: typeof pick('rail') === 'string' ? (raw.rail as string) : DEFAULT_RACK_STYLE.rail,
    interior:
      typeof pick('interior') === 'string' ? (raw.interior as string) : DEFAULT_RACK_STYLE.interior,
    showNumbers:
      typeof pick('showNumbers') === 'boolean'
        ? (raw.showNumbers as boolean)
        : DEFAULT_RACK_STYLE.showNumbers,
    enclosed:
      typeof pick('enclosed') === 'boolean' ? (raw.enclosed as boolean) : DEFAULT_RACK_STYLE.enclosed,
  }
}

/** Ports round-trip as opaque JSON; drop anything that is not a usable port. */
function asPorts(raw: unknown[]): Port[] {
  const ports: Port[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    if (typeof p.id !== 'string') continue
    const type = typeof p.type === 'string' && (PORT_TYPES as string[]).includes(p.type)
      ? (p.type as PortType)
      : 'rj45'
    ports.push({
      id: p.id,
      label: typeof p.label === 'string' ? p.label : p.id,
      type,
      x: typeof p.x === 'number' ? p.x : 0.5,
      y: typeof p.y === 'number' ? p.y : 0.5,
      // The custom plate builder's per-port colour is optional; a blank/absent
      // value leaves the plate's theme artwork in charge.
      color: typeof p.color === 'string' ? p.color : undefined,
    })
  }
  return ports
}

/**
 * Cable properties are opaque JSON on the wire. Anything missing a usable
 * key/value pair is dropped rather than rendered as an empty annotation.
 */
function asCableProperties(raw: unknown): CableProperty[] {
  if (!Array.isArray(raw)) return []
  const props: CableProperty[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    if (typeof p.key !== 'string' || !p.key.trim()) continue
    props.push({
      key: p.key,
      value: typeof p.value === 'string' ? p.value : String(p.value ?? ''),
      icon: typeof p.icon === 'string' ? p.icon : null,
      visible: p.visible !== false,
    })
  }
  return props
}

// ── API → domain ─────────────────────────────────────────────────────────────

/**
 * The `custom_colors`/`target` blobs survive as opaque JSON. `target` must
 * still be a sane `LabelTarget` (a `kind` is required) so the pointer layer can
 * discriminate on it without guarding every field.
 */
function asTarget(raw: Record<string, unknown>): LabelTarget {
  const kind = typeof raw.kind === 'string' ? raw.kind : 'none'
  const anchorRatio = typeof raw.anchorRatio === 'number' ? raw.anchorRatio : undefined
  switch (kind) {
    case 'node':
      return typeof raw.id === 'string' ? { kind: 'node', id: raw.id } : { kind: 'none' }
    case 'device':
      return typeof raw.id === 'string' ? { kind: 'device', id: raw.id } : { kind: 'none' }
    case 'port':
      return typeof raw.deviceId === 'string' && typeof raw.portId === 'string'
        ? { kind: 'port', deviceId: raw.deviceId, portId: raw.portId }
        : { kind: 'none' }
    case 'edge':
      return typeof raw.id === 'string' ? { kind: 'edge', id: raw.id } : { kind: 'none' }
    case 'cable':
      return typeof raw.id === 'string'
        ? { kind: 'cable', id: raw.id, anchorRatio }
        : { kind: 'none' }
    default:
      return { kind: 'none' }
  }
}

export function toRackLabel(api: ApiRackLabel): RackLabel {
  const raw = api.custom_colors ?? {}
  const colors: NonNullable<RackLabel['custom_colors']> = {}
  if (typeof raw.font === 'string') colors.font = raw.font
  if (typeof raw.text_color === 'string') colors.text_color = raw.text_color
  if (typeof raw.text_size === 'number') colors.text_size = raw.text_size
  if (typeof raw.border === 'string') colors.border = raw.border
  if (
    typeof raw.border_style === 'string' &&
    ['solid', 'dashed', 'dotted', 'double', 'none'].includes(raw.border_style)
  ) {
    colors.border_style = raw.border_style as NonNullable<RackLabel['custom_colors']>['border_style']
  }
  if (typeof raw.border_width === 'number') colors.border_width = raw.border_width
  if (typeof raw.background === 'string') colors.background = raw.background
  return {
    id: api.id,
    label: api.label ?? '',
    custom_colors: colors,
    target: asTarget(api.target ?? {}),
    anchorSide:
      typeof api.anchor_side === 'string' && (ANCHOR_SIDES as string[]).includes(api.anchor_side)
        ? (api.anchor_side as NonNullable<RackLabel['anchorSide']>)
        : undefined,
    position: { x: api.pos_x ?? 0, y: api.pos_y ?? 0 },
    width: api.width ?? undefined,
    height: api.height ?? undefined,
  }
}

export function fromRackLabel(label: RackLabel): Omit<ApiRackLabel, 'design_id'> {
  return {
    id: label.id,
    label: label.label ?? '',
    custom_colors: { ...(label.custom_colors ?? {}) },
    target: { ...(label.target ?? { kind: 'none' }) },
    anchor_side: label.anchorSide ?? null,
    pos_x: label.position.x,
    pos_y: label.position.y,
    width: label.width ?? null,
    height: label.height ?? null,
  }
}

export function toRack(api: ApiRack): Rack {
  return {
    id: api.id,
    name: api.name,
    uHeight: api.u_height,
    widthStandard: asWidthStandard(api.width_standard),
    numbering: asNumbering(api.numbering),
    style: asStyle(api.style ?? {}),
    location: api.location ?? undefined,
    position: { x: api.pos_x, y: api.pos_y },
  }
}

export function toRackDevice(api: ApiRackDevice): RackDevice {
  return {
    id: api.id,
    rackId: api.rack_id,
    deviceId: api.device_id,
    nodeId: api.node_id,
    label: api.label,
    uStart: api.u_start,
    uHeight: api.u_height,
    colStart: api.col_start,
    colSpan: api.col_span,
    faceplateId: api.faceplate_id,
    color: api.color ?? undefined,
    status: asMountStatus(api.status),
    portVisibility: asPortVisibility(api.port_visibility),
    ports: asPorts(api.ports ?? []),
  }
}

export function toCable(api: ApiRackCable): Cable {
  const type: CableType = api.type === 'fiber' ? 'fiber' : 'ethernet'
  return {
    id: api.id,
    type,
    color: api.color || CABLE_COLORS[type],
    label: api.label ?? undefined,
    labelVisible: api.label_visible === true,
    properties: asCableProperties(api.properties),
    from: { deviceId: api.from_device_id, portId: api.from_port_id },
    to: { deviceId: api.to_device_id, portId: api.to_port_id },
    waypoints: Array.isArray(api.waypoints) && api.waypoints.length
      ? api.waypoints.map((w) => ({ x: w.x, y: w.y }))
      : undefined,
    pathStyle: api.path_style === 'smooth'
      ? 'smooth'
      : api.path_style === 'bezier' ? 'bezier' : undefined,
  }
}

/** Drops the records with neither a port nor a name — they print as an empty chip. */
function asServices(raw: ApiInventoryItem['services']): InventoryService[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => ({
      port: typeof s?.port === 'number' ? s.port : null,
      name: s?.name ? String(s.name) : null,
    }))
    .filter((s) => s.port !== null || s.name !== null)
}

/** The node half of an inventory row, when the backend matched one. */
function asLinkedNode(api: ApiInventoryItem): LinkedNodeInfo | null {
  if (!api.node_id) return null
  return {
    id: api.node_id,
    label: api.node_label ?? null,
    type: api.node_type ?? null,
    ip: api.node_ip ?? null,
    mac: api.node_mac ?? null,
    hostname: api.node_hostname ?? null,
    os: api.node_os ?? null,
    checkMethod: api.node_check_method ?? null,
    designId: api.node_design_id ?? null,
    designName: api.node_design_name ?? null,
    lastSeen: api.node_last_seen ?? null,
  }
}

/**
 * The device's saved front panel, or null when it has never been modelled.
 *
 * `rack_faceplate_id` is the flag the backend sets on the first save of a mount;
 * without it there is nothing to reuse and the tray falls back to the plate
 * suggested by the device type.
 */
function asRackModel(api: ApiInventoryItem): RackModel | null {
  if (!api.rack_faceplate_id) return null
  return {
    faceplateId: api.rack_faceplate_id,
    uHeight: typeof api.rack_u_height === 'number' ? api.rack_u_height : null,
    colSpan: typeof api.rack_col_span === 'number' ? api.rack_col_span : null,
    color: api.rack_color ?? null,
    ports: asPorts(Array.isArray(api.rack_ports) ? api.rack_ports : []),
  }
}

export function toInventoryDevice(api: ApiInventoryItem): InventoryDevice {
  return {
    id: api.id,
    label: api.label,
    type: api.suggested_type,
    discoverySource: api.discovery_source,
    ip: api.ip,
    mac: api.mac ?? null,
    hostname: api.hostname ?? null,
    os: api.os ?? null,
    services: asServices(api.services),
    // The inventory row itself is only pending/approved; live status comes from
    // the linked canvas node, if any.
    status: asStatus(api.node_status),
    nodeId: api.node_id,
    node: asLinkedNode(api),
    racked: api.racked,
    suggestedFaceplateId: suggestFaceplate(api.suggested_type),
    rackModel: asRackModel(api),
  }
}

// ── Domain → API ─────────────────────────────────────────────────────────────

export function fromRack(rack: Rack): Omit<ApiRack, 'design_id'> {
  return {
    id: rack.id,
    name: rack.name,
    u_height: rack.uHeight,
    width_standard: rack.widthStandard,
    numbering: rack.numbering,
    location: rack.location ?? null,
    style: { ...rack.style },
    pos_x: rack.position.x,
    pos_y: rack.position.y,
  }
}

export function fromRackDevice(device: RackDevice): Omit<ApiRackDevice, 'design_id'> {
  const colStart = Math.min(Math.max(device.colStart, 0), RACK_COLUMNS - 1)
  return {
    id: device.id,
    rack_id: device.rackId,
    device_id: device.deviceId,
    node_id: device.nodeId,
    label: device.label,
    u_start: device.uStart,
    u_height: device.uHeight,
    col_start: colStart,
    // Clamped against the start, not against the grid on its own: 11 + 12 is
    // two legal fields adding up to column 23 of 12, which the backend now
    // rejects — the whole save 422s over one device.
    col_span: Math.min(Math.max(device.colSpan, 1), RACK_COLUMNS - colStart),
    faceplate_id: device.faceplateId,
    color: device.color ?? null,
    status: device.status,
    port_visibility: device.portVisibility ?? 'auto',
    ports: device.ports,
  }
}

export function fromCable(cable: Cable): Omit<ApiRackCable, 'design_id'> {
  return {
    id: cable.id,
    from_device_id: cable.from.deviceId,
    from_port_id: cable.from.portId,
    to_device_id: cable.to.deviceId,
    to_port_id: cable.to.portId,
    type: cable.type,
    color: cable.color || CABLE_COLORS[cable.type],
    label: cable.label ?? null,
    label_visible: cable.labelVisible === true,
    properties: cable.properties ?? [],
    path_style: cable.pathStyle ?? null,
    waypoints: cable.waypoints ?? null,
  }
}

export function buildSavePayload(
  designId: string,
  racks: Rack[],
  devices: RackDevice[],
  cables: Cable[],
  viewport: { x: number; y: number; zoom: number },
  labels: RackLabel[] = [],
): RackSavePayload {
  const rackIds = new Set(racks.map((r) => r.id))
  const keptDevices = devices.filter((d) => rackIds.has(d.rackId))
  const deviceIds = new Set(keptDevices.map((d) => d.id))
  return {
    design_id: designId,
    racks: racks.map(fromRack),
    devices: keptDevices.map(fromRackDevice),
    // The backend rejects a cable whose endpoints are not in the payload, so
    // drop dangling ones here rather than failing the whole save.
    cables: cables
      .filter((c) => deviceIds.has(c.from.deviceId) && deviceIds.has(c.to.deviceId))
      .map(fromCable),
    labels: labels.map(fromRackLabel),
    viewport,
  }
}

/**
 * Cable type implied by the port a patch starts from. A `power` socket (custom
 * plate builder) has no cable type — it is visual only, never a cable endpoint.
 */
export function cableTypeForPort(type: PortType): CableType | undefined {
  return PORT_CABLE_TYPE[type]
}
