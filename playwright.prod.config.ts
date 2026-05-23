import { defineConfig, devices } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://music.megabyte.space';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  retries: 1,
  reporter: [['list']],
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: PROD_URL,
    trace: 'retain-on-failure',
    navigationTimeout: 60000,
    actionTimeout: 30000,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    channel: 'chrome',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
    }
  },
  projects: [
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile-390',
      // iPhone 13 dimensions emulated in Chrome (channel: 'chrome' is the only
      // browser we have installed on this machine; native WebKit channel isn't
      // available without `playwright install webkit`). Functionally identical
      // for our layout assertions — viewport + touch + UA + DPR are what matter.
      use: {
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      }
    }
  ]
});
