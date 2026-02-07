describe('Config', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('loads default values', () => {
    const config = require('../src/main/config');
    expect(config.MAX_TERMINALS).toBe(8);
  });

  test('provides default shell', () => {
    const config = require('../src/main/config');
    expect(config.SHELL).toBeTruthy();
  });

  test('provides HOME_DIR', () => {
    const config = require('../src/main/config');
    expect(config.HOME_DIR).toBeTruthy();
  });

  test('provides PLATFORM', () => {
    const config = require('../src/main/config');
    expect(['win32', 'linux', 'darwin']).toContain(config.PLATFORM);
  });
});
