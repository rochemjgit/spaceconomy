import { decode, encode } from '@msgpack/msgpack'

export const REALTIME_PROTOCOL_VERSION = 1

export interface RealtimeEnvelope<TPayload> {
  version: number
  messageType: string
  requestId?: string
  serverTime?: number
  payload: TPayload
}

export function encodeEnvelope<TPayload>(envelope: RealtimeEnvelope<TPayload>): Uint8Array {
  return encode(envelope)
}

export function decodeEnvelope(payload: Uint8Array): RealtimeEnvelope<unknown> {
  const decoded = decode(payload)
  if (!isRealtimeEnvelope(decoded)) {
    throw new Error('Received an invalid realtime envelope.')
  }
  if (decoded.version !== REALTIME_PROTOCOL_VERSION) {
    throw new Error(`Unsupported realtime protocol version: ${decoded.version}`)
  }
  return decoded
}

function isRealtimeEnvelope(value: unknown): value is RealtimeEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.messageType === 'string' &&
    'payload' in candidate &&
    (candidate.requestId === undefined || typeof candidate.requestId === 'string') &&
    (candidate.serverTime === undefined || typeof candidate.serverTime === 'number')
  )
}
