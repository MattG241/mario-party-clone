import { describe, expect, it } from 'vitest';
import { decideLite } from '../../src/game/perf';

const nav = (userAgent: string, deviceMemory?: number) => ({ userAgent, deviceMemory }) as Navigator & { deviceMemory?: number };

describe('decideLite', () => {
  it('picks Lite on TV and games-console browsers', () => {
    expect(decideLite('auto', nav('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0 TV Safari/537.36'))).toBe(true);
    expect(decideLite('auto', nav('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0 Safari/537.36 WebAppManager'))).toBe(true);
    expect(decideLite('auto', nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'))).toBe(true);
    expect(decideLite('auto', nav('Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15'))).toBe(true);
  });

  it('keeps Full on computers, and honours an explicit choice', () => {
    const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    expect(decideLite('auto', nav(desktop, 8))).toBe(false);
    expect(decideLite('auto', nav(desktop, 2))).toBe(true);
    expect(decideLite('full', nav('Mozilla/5.0 (Windows NT 10.0; Xbox; Xbox Series X) Edg/120.0'))).toBe(false);
    expect(decideLite('lite', nav(desktop, 8))).toBe(true);
  });
});
