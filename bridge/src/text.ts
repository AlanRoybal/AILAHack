import { execFile } from 'node:child_process'
import { config } from './config.ts'

let phone = config.guestPhone
export const getPhone = () => phone
export const setPhone = (p: string) => void (phone = p.trim())
export const canText = () => process.platform === 'darwin' && !!phone

// Sends through the Messages app on the Mac running the bridge, from the wearer's own iMessage.
const SCRIPT = [
  'on run argv',
  'tell application "Messages"',
  'set s to 1st account whose service type = iMessage',
  'send (item 2 of argv) to participant (item 1 of argv) of s',
  'end tell',
  'end run',
].flatMap(l => ['-e', l])

export function sendText(body: string, signal?: AbortSignal): Promise<boolean> {
  if (!canText()) return Promise.resolve(false)
  return new Promise(resolve => execFile('osascript', [...SCRIPT, phone, body], { signal, timeout: 8000 }, err => resolve(!err)))
}
