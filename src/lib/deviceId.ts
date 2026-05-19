import * as SecureStore from 'expo-secure-store';

const KEY = 'copilot.deviceId';

/**
 * Identidade anônima estável por device. Gerada na primeira chamada e
 * persistida no SecureStore (sobrevive a reinstalações em alguns casos no iOS
 * porque o SecureStore vive no keychain).
 *
 * Não é PII — é só um UUID que permite o backend distinguir pilotos sem
 * cadastro tradicional.
 */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY);
  if (id) return id;
  id = generateUUID();
  await SecureStore.setItemAsync(KEY, id);
  return id;
}

function generateUUID(): string {
  // UUID v4 simples — não precisa ser cryptographic-grade
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const s = Array.from(bytes, hex).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
