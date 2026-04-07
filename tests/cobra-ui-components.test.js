/**
 * COBRA v5.2 — UI Component System Tests
 * Comprehensive test suite for cobra-ui-components.js
 */

describe('CobraUI', () => {
  let CobraUI;

  // Setup mock DOM environment
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Mock chrome global
    global.chrome = {
      runtime: {
        sendMessage: jest.fn()
      }
    };

    // Mock window
    global.window = {
      CobraUI: undefined
    };

    // Load the module
    require('../cobra-ui-components.js');
    CobraUI = window.CobraUI;

    // Reset component state
    CobraUI._components = {};
    CobraUI._activeView = null;
    CobraUI._viewComponents = {};
  });

  describe('register()', () => {
    it('should register a new component', () => {
      const component = {
        mount: jest.fn(),
        unmount: jest.fn(),
        update: jest.fn()
      };

      CobraUI.register('test-component', component);

      expect(CobraUI._components['test-component']).toBeDefined();
      expect(CobraUI._components['test-component']._mounted).toBe(false);
    });

    it('should warn when registering duplicate component', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const component1 = { mount: jest.fn() };
      const component2 = { mount: jest.fn() };

      CobraUI.register('test', component1);
      CobraUI.register('test', component2);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Component 'test' already registered")
      );
      consoleSpy.mockRestore();
    });

    it('should allow overwriting duplicate component', () => {
      const component1 = { mount: jest.fn(), id: 1 };
      const component2 = { mount: jest.fn(), id: 2 };

      CobraUI.register('test', component1);
      CobraUI.register('test', component2);

      expect(CobraUI._components['test'].id).toBe(2);
    });

    it('should auto-associate component to view if specified', () => {
      const component = {
        view: 'settings',
        mount: jest.fn()
      };

      CobraUI.register('audit-dashboard', component);

      expect(CobraUI._viewComponents['settings']).toContain('audit-dashboard');
    });

    it('should add multiple components to same view', () => {
      const comp1 = { view: 'settings', mount: jest.fn() };
      const comp2 = { view: 'settings', mount: jest.fn() };

      CobraUI.register('comp1', comp1);
      CobraUI.register('comp2', comp2);

      expect(CobraUI._viewComponents['settings']).toContain('comp1');
      expect(CobraUI._viewComponents['settings']).toContain('comp2');
      expect(CobraUI._viewComponents['settings'].length).toBe(2);
    });

    it('should preserve component methods', () => {
      const mount = jest.fn();
      const unmount = jest.fn();
      const update = jest.fn();

      CobraUI.register('test', { mount, unmount, update });

      const registered = CobraUI._components['test'];
      expect(registered.mount).toBe(mount);
      expect(registered.unmount).toBe(unmount);
      expect(registered.update).toBe(update);
    });
  });

  describe('mount()', () => {
    beforeEach(() => {
      // Create test container
      const container = document.createElement('div');
      container.id = 'test-container';
      document.body.appendChild(container);
    });

    it('should mount component to container by ID string', () => {
      const mount = jest.fn();
      CobraUI.register('test', { mount });

      CobraUI.mount('test', 'test-container');

      expect(mount).toHaveBeenCalled();
      expect(CobraUI._components['test']._mounted).toBe(true);
    });

    it('should mount component to container by DOM element', () => {
      const mount = jest.fn();
      const container = document.getElementById('test-container');
      CobraUI.register('test', { mount });

      CobraUI.mount('test', container);

      expect(mount).toHaveBeenCalledWith(container);
      expect(CobraUI._components['test']._mounted).toBe(true);
    });

    it('should not remount already mounted component', () => {
      const mount = jest.fn();
      CobraUI.register('test', { mount });

      CobraUI.mount('test', 'test-container');
      CobraUI.mount('test', 'test-container');

      expect(mount).toHaveBeenCalledTimes(1);
    });

    it('should warn when component not found', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      CobraUI.mount('nonexistent', 'test-container');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Component 'nonexistent' not found")
      );
      consoleSpy.mockRestore();
    });

    it('should warn when container not found', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      CobraUI.register('test', { mount: jest.fn() });

      CobraUI.mount('test', 'nonexistent-container');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Container 'nonexistent-container' not found")
      );
      consoleSpy.mockRestore();
    });

    it('should store container reference in component', () => {
      CobraUI.register('test', { mount: jest.fn() });
      const container = document.getElementById('test-container');

      CobraUI.mount('test', 'test-container');

      expect(CobraUI._components['test']._container).toBe(container);
    });

    it('should pass container to mount function', () => {
      const mount = jest.fn();
      const container = document.getElementById('test-container');
      CobraUI.register('test', { mount });

      CobraUI.mount('test', 'test-container');

      expect(mount).toHaveBeenCalledWith(container);
    });
  });

  describe('unmount()', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.id = 'test-container';
      document.body.appendChild(container);
    });

    it('should unmount mounted component', () => {
      const unmount = jest.fn();
      CobraUI.register('test', { mount: jest.fn(), unmount });

      CobraUI.mount('test', 'test-container');
      CobraUI.unmount('test');

      expect(unmount).toHaveBeenCalled();
      expect(CobraUI._components['test']._mounted).toBe(false);
    });

    it('should clear container reference', () => {
      CobraUI.register('test', { mount: jest.fn() });
      CobraUI.mount('test', 'test-container');

      CobraUI.unmount('test');

      expect(CobraUI._components['test']._container).toBe(null);
    });

    it('should not fail when unmounting non-existent component', () => {
      expect(() => CobraUI.unmount('nonexistent')).not.toThrow();
    });

    it('should not fail when unmounting already unmounted component', () => {
      CobraUI.register('test', { mount: jest.fn() });
      CobraUI.unmount('test');

      expect(() => CobraUI.unmount('test')).not.toThrow();
    });

    it('should call unmount function if provided', () => {
      const unmount = jest.fn();
      CobraUI.register('test', { mount: jest.fn(), unmount });

      CobraUI.mount('test', 'test-container');
      CobraUI.unmount('test');

      expect(unmount).toHaveBeenCalled();
    });

    it('should handle missing unmount function gracefully', () => {
      CobraUI.register('test', { mount: jest.fn() });
      CobraUI.mount('test', 'test-container');

      expect(() => CobraUI.unmount('test')).not.toThrow();
      expect(CobraUI._components['test']._mounted).toBe(false);
    });
  });

  describe('update()', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.id = 'test-container';
      document.body.appendChild(container);
    });

    it('should update mounted component with data', () => {
      const update = jest.fn();
      CobraUI.register('test', { mount: jest.fn(), update });

      CobraUI.mount('test', 'test-container');
      CobraUI.update('test', { key: 'value' });

      expect(update).toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({ key: 'value' }, expect.any(Object));
    });

    it('should pass container to update function', () => {
      const update = jest.fn();
      const container = document.getElementById('test-container');
      CobraUI.register('test', { mount: jest.fn(), update });

      CobraUI.mount('test', 'test-container');
      CobraUI.update('test', { key: 'value' });

      expect(update).toHaveBeenCalledWith({ key: 'value' }, container);
    });

    it('should not update unmounted component', () => {
      const update = jest.fn();
      CobraUI.register('test', { mount: jest.fn(), update });

      CobraUI.update('test', { key: 'value' });

      expect(update).not.toHaveBeenCalled();
    });

    it('should not update non-existent component', () => {
      expect(() => CobraUI.update('nonexistent', {})).not.toThrow();
    });

    it('should handle missing update function gracefully', () => {
      CobraUI.register('test', { mount: jest.fn() });
      CobraUI.mount('test', 'test-container');

      expect(() => CobraUI.update('test', {})).not.toThrow();
    });
  });

  describe('el() helper', () => {
    it('should create element with tag name', () => {
      const el = CobraUI.el('div');
      expect(el.tagName).toBe('DIV');
    });

    it('should set className attribute', () => {
      const el = CobraUI.el('div', { className: 'my-class' });
      expect(el.className).toBe('my-class');
    });

    it('should set multiple classes', () => {
      const el = CobraUI.el('div', { className: 'class1 class2' });
      expect(el.className).toBe('class1 class2');
    });

    it('should set style object', () => {
      const el = CobraUI.el('div', { style: { color: 'red', fontSize: '14px' } });
      expect(el.style.color).toBe('red');
      expect(el.style.fontSize).toBe('14px');
    });

    it('should set innerHTML', () => {
      const el = CobraUI.el('div', { innerHTML: '<span>Hello</span>' });
      expect(el.innerHTML).toBe('<span>Hello</span>');
    });

    it('should set textContent', () => {
      const el = CobraUI.el('div', { textContent: 'Hello' });
      expect(el.textContent).toBe('Hello');
    });

    it('should add event listeners with on* attributes', () => {
      const clickHandler = jest.fn();
      const el = CobraUI.el('button', { onClick: clickHandler });

      el.click();

      expect(clickHandler).toHaveBeenCalled();
    });

    it('should set arbitrary HTML attributes', () => {
      const el = CobraUI.el('input', { type: 'text', placeholder: 'Enter text' });
      expect(el.getAttribute('type')).toBe('text');
      expect(el.getAttribute('placeholder')).toBe('Enter text');
    });

    it('should append string children as text nodes', () => {
      const el = CobraUI.el('div', {}, 'Hello', ' ', 'World');
      expect(el.textContent).toBe('Hello World');
    });

    it('should append DOM element children', () => {
      const child = document.createElement('span');
      child.textContent = 'Child';
      const el = CobraUI.el('div', {}, child);

      expect(el.children.length).toBe(1);
      expect(el.children[0]).toBe(child);
    });

    it('should handle mixed children (text and elements)', () => {
      const child = document.createElement('b');
      child.textContent = 'bold';
      const el = CobraUI.el('div', {}, 'Start ', child, ' End');

      expect(el.textContent).toBe('Start bold End');
    });

    it.skip('should handle event listener with different event types', () => {
      const handlers = {
        click: jest.fn(),
        focus: jest.fn(),
        blur: jest.fn()
      };

      const el = CobraUI.el('input', {
        onClick: handlers.click,
        onFocus: handlers.focus,
        onBlur: handlers.blur
      });

      el.click();
      el.focus();
      el.blur();

      expect(handlers.click).toHaveBeenCalled();
      expect(handlers.focus).toHaveBeenCalled();
      expect(handlers.blur).toHaveBeenCalled();
    });

    it('should create nested structures', () => {
      const el = CobraUI.el('div', { className: 'container' },
        CobraUI.el('h1', {}, 'Title'),
        CobraUI.el('p', {}, 'Content')
      );

      expect(el.children.length).toBe(2);
      expect(el.children[0].tagName).toBe('H1');
      expect(el.children[1].tagName).toBe('P');
    });
  });

  describe('sanitize() XSS prevention', () => {
    it('should escape HTML tags', () => {
      const result = CobraUI.sanitize('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;');
    });

    it('should escape HTML entities', () => {
      const result = CobraUI.sanitize('<img src=x onerror="alert(1)">');
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;');
    });

    it('should escape quotes', () => {
      const result = CobraUI.sanitize('"><script>alert(1)</script>');
      expect(result).not.toContain('"><script>');
    });

    it('should preserve safe text', () => {
      const result = CobraUI.sanitize('Hello World & Friends');
      expect(result).toContain('Hello World');
      expect(result).toContain('Friends');
    });

    it('should escape event handlers', () => {
      const result = CobraUI.sanitize('<div onclick="alert(1)">Click</div>');
      // HTML should be escaped, so < becomes &lt;
      expect(result).not.toContain('<div');
      expect(result).toContain('&lt;div');
      // The onclick attribute is still there but it's inside the escaped HTML, so it won't execute
      expect(result).toContain('onclick=');
    });

    it('should handle multiple XSS attempts', () => {
      const result = CobraUI.sanitize('<script>1</script><img src=x>');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('<img');
    });

    it('should convert HTML to safe text representation', () => {
      const result = CobraUI.sanitize('<b>Bold</b>');
      expect(result).toContain('&lt;b&gt;');
      expect(result).toContain('&lt;/b&gt;');
    });
  });

  describe('Component Lifecycle', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.id = 'lifecycle-container';
      document.body.appendChild(container);
    });

    it('should follow mount → update → unmount lifecycle', () => {
      const calls = [];

      const component = {
        mount: jest.fn(() => calls.push('mount')),
        update: jest.fn(() => calls.push('update')),
        unmount: jest.fn(() => calls.push('unmount'))
      };

      CobraUI.register('lifecycle', component);
      CobraUI.mount('lifecycle', 'lifecycle-container');
      CobraUI.update('lifecycle', { data: 'test' });
      CobraUI.unmount('lifecycle');

      expect(calls).toEqual(['mount', 'update', 'unmount']);
    });

    it('should be remountable after unmount', () => {
      const mount = jest.fn();
      CobraUI.register('test', { mount, unmount: jest.fn() });

      CobraUI.mount('test', 'lifecycle-container');
      expect(mount).toHaveBeenCalledTimes(1);

      CobraUI.unmount('test');
      expect(CobraUI._components['test']._mounted).toBe(false);

      CobraUI.mount('test', 'lifecycle-container');
      expect(mount).toHaveBeenCalledTimes(2);
    });

    it('should maintain state through mount/unmount cycle', () => {
      let internalState = 0;

      const component = {
        mount: () => { internalState = 1; },
        update: (data) => { internalState = data.value; },
        unmount: () => { internalState = 0; }
      };

      CobraUI.register('stateful', component);

      CobraUI.mount('stateful', 'lifecycle-container');
      expect(internalState).toBe(1);

      CobraUI.update('stateful', { value: 42 });
      expect(internalState).toBe(42);

      CobraUI.unmount('stateful');
      expect(internalState).toBe(0);
    });
  });

  describe('mountView() and unmountView()', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.id = 'view-container';
      document.body.appendChild(container);
    });

    it('should mount all components in a view', () => {
      const mount1 = jest.fn();
      const mount2 = jest.fn();

      CobraUI.register('comp1', {
        view: 'settings',
        containerId: 'view-container',
        mount: mount1
      });

      CobraUI.register('comp2', {
        view: 'settings',
        containerId: 'view-container',
        mount: mount2
      });

      CobraUI.mountView('settings');

      expect(mount1).toHaveBeenCalled();
      expect(mount2).toHaveBeenCalled();
    });

    it('should set active view', () => {
      CobraUI.register('comp1', {
        view: 'dashboard',
        containerId: 'view-container',
        mount: jest.fn()
      });

      CobraUI.mountView('dashboard');

      expect(CobraUI._activeView).toBe('dashboard');
    });

    it('should unmount all components in a view', () => {
      const unmount1 = jest.fn();
      const unmount2 = jest.fn();

      CobraUI.register('comp1', {
        view: 'settings',
        containerId: 'view-container',
        mount: jest.fn(),
        unmount: unmount1
      });

      CobraUI.register('comp2', {
        view: 'settings',
        containerId: 'view-container',
        mount: jest.fn(),
        unmount: unmount2
      });

      CobraUI.mountView('settings');
      CobraUI.unmountView('settings');

      expect(unmount1).toHaveBeenCalled();
      expect(unmount2).toHaveBeenCalled();
    });

    it('should handle non-existent view gracefully', () => {
      expect(() => CobraUI.mountView('nonexistent')).not.toThrow();
      expect(() => CobraUI.unmountView('nonexistent')).not.toThrow();
    });
  });

  describe('list()', () => {
    it('should list all registered components', () => {
      CobraUI.register('comp1', { mount: jest.fn() });
      CobraUI.register('comp2', { mount: jest.fn() });

      const list = CobraUI.list();

      expect(list.length).toBe(2);
      expect(list.some(c => c.name === 'comp1')).toBe(true);
      expect(list.some(c => c.name === 'comp2')).toBe(true);
    });

    it('should indicate mount state', () => {
      const container = document.createElement('div');
      container.id = 'list-container';
      document.body.appendChild(container);

      CobraUI.register('comp1', { mount: jest.fn() });
      CobraUI.mount('comp1', 'list-container');

      const list = CobraUI.list();
      const comp1 = list.find(c => c.name === 'comp1');

      expect(comp1.mounted).toBe(true);
    });

    it('should show component view association', () => {
      CobraUI.register('comp1', { view: 'settings', mount: jest.fn() });
      CobraUI.register('comp2', { mount: jest.fn() });

      const list = CobraUI.list();

      expect(list.find(c => c.name === 'comp1').view).toBe('settings');
      expect(list.find(c => c.name === 'comp2').view).toBe(null);
    });

    it('should return empty list for no components', () => {
      expect(CobraUI.list()).toEqual([]);
    });
  });
});
