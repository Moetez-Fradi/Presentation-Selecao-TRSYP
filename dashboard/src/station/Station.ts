import type { Command, StationEvent } from './protocol'

export type LinkState = 'disconnected' | 'connecting' | 'online' | 'offline'

/**
 * Transport-agnostic connection to a dosing station.
 * MockStation simulates one in the browser; MqttStation talks to the real ESP32.
 */
export interface Station {
  readonly kind: 'mock' | 'mqtt'
  connect(): void
  disconnect(): void
  send(cmd: Command): void
  onEvent(fn: (e: StationEvent) => void): () => void
  onLink(fn: (s: LinkState) => void): () => void
}

export class Emitter<T> {
  private fns = new Set<(v: T) => void>()
  on(fn: (v: T) => void) {
    this.fns.add(fn)
    return () => {
      this.fns.delete(fn)
    }
  }
  emit(v: T) {
    this.fns.forEach((fn) => fn(v))
  }
}
