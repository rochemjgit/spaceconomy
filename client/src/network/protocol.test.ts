import { describe, expect, it } from 'vitest'

import { decodeEnvelope, encodeEnvelope, REALTIME_PROTOCOL_VERSION } from './protocol'

describe('realtime MessagePack envelope', () => {
  it('round-trips a valid versioned event', () => {
    const encoded = encodeEnvelope({
      version: REALTIME_PROTOCOL_VERSION,
      messageType: 'system.bootstrap',
      requestId: 'request-1',
      serverTime: 1_725_000_000_000,
      payload: { pilotId: 'pilot-1' },
    })

    expect(decodeEnvelope(encoded)).toEqual({
      version: REALTIME_PROTOCOL_VERSION,
      messageType: 'system.bootstrap',
      requestId: 'request-1',
      serverTime: 1_725_000_000_000,
      payload: { pilotId: 'pilot-1' },
    })
  })
})
