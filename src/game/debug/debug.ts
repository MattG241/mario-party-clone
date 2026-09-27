// Debug switches. Debug tools are available in development builds, or in production builds
// when the page is opened with ?debug in the URL. They never appear in normal menus.

function params(): URLSearchParams {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '');
  } catch {
    return new URLSearchParams();
  }
}

export const URL_PARAMS = params();

export const DEBUG_ENABLED: boolean = (import.meta.env?.DEV ?? false) || URL_PARAMS.has('debug');

/** Free-form values scenes publish for the F2 overlay. */
export const debugInfo: Record<string, string | number | boolean> = {};

export function setDebugInfo(key: string, value: string | number | boolean): void {
  debugInfo[key] = value;
}

export function clearDebugInfo(prefix: string): void {
  for (const k of Object.keys(debugInfo)) if (k.startsWith(prefix)) delete debugInfo[k];
}

/** Recent runtime errors (shown in the debug overlay). */
export const errorLog: string[] = [];

export function logError(msg: string): void {
  errorLog.push(msg);
  if (errorLog.length > 8) errorLog.shift();
}
