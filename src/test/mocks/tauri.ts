export function invoke<T>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`Unmocked Tauri invoke call: ${_cmd}`)
}

export function isTauri(): boolean {
  return false
}
