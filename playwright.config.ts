import { defineConfig, devices } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://music.megabyte.space';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list']],
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: PROD_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 45000,
    actionTimeout: 30000,
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
    }
  },
  projects: [
    { name: 'mobile-375', use: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'tablet-768', use: { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1024', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } }
  ]
});
