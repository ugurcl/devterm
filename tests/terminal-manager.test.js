const TerminalManager = require('../src/main/terminal-manager');

describe('TerminalManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  afterEach(() => {
    manager.closeAll();
  });

  test('creates a terminal', () => {
    const terminal = manager.create();
    expect(terminal).toBeDefined();
    expect(terminal.id).toBeTruthy();
    expect(terminal.createdAt).toBeTruthy();
  });

  test('gets terminal by id', () => {
    const terminal = manager.create();
    const found = manager.get(terminal.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(terminal.id);
  });

  test('returns null for unknown terminal', () => {
    expect(manager.get('nonexistent')).toBeNull();
  });

  test('closes a terminal', () => {
    const terminal = manager.create();
    const result = manager.close(terminal.id);
    expect(result).toBe(true);
    expect(manager.get(terminal.id)).toBeNull();
  });

  test('close returns false for unknown terminal', () => {
    expect(manager.close('nonexistent')).toBe(false);
  });

  test('enforces max terminals', () => {
    const originalMax = require('../src/main/config').MAX_TERMINALS;
    require('../src/main/config').MAX_TERMINALS = 2;

    manager.create();
    manager.create();
    expect(() => manager.create()).toThrow('Maximum');

    require('../src/main/config').MAX_TERMINALS = originalMax;
  });

  test('returns stats', () => {
    manager.create();
    manager.create();
    const stats = manager.getStats();
    expect(stats.totalTerminals).toBe(2);
  });

  test('writes to terminal', () => {
    const terminal = manager.create();
    expect(manager.write(terminal.id, 'test')).toBe(true);
    expect(manager.write('nonexistent', 'test')).toBe(false);
  });

  test('resizes terminal', () => {
    const terminal = manager.create();
    expect(manager.resize(terminal.id, 120, 40)).toBe(true);
    expect(manager.resize('nonexistent', 120, 40)).toBe(false);
  });

  test('closeAll clears everything', () => {
    manager.create();
    manager.create();
    manager.closeAll();
    expect(manager.getStats().totalTerminals).toBe(0);
  });
});
