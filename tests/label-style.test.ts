import { expect, test, vi } from 'vitest';
import { createLabelStyleWriter } from '../src/label-style';

function trackedStyle() {
  const values: Record<string, string> = {};
  const write = vi.fn((property: string, value: string) => {
    // Model CSSOM serialization of fractional pixel values.
    values[property] = value.endsWith('px') ? `${Number.parseFloat(value).toFixed(4)}px` : value;
    return true;
  });
  const style = new Proxy(values, {
    set: (_target, property, value: string) => write(String(property), value),
  }) as unknown as CSSStyleDeclaration;
  return { style, write };
}

test('stationary frames perform no repeated label style writes, including fractional positions', () => {
  const setStyle = createLabelStyleWriter();
  const { style, write } = trackedStyle();
  for (let frame = 0; frame < 60; frame++) {
    setStyle(style, 'display', 'block');
    setStyle(style, 'left', '123.123456789px');
    setStyle(style, 'top', '98.987654321px');
    setStyle(style, 'zIndex', '123');
  }
  expect(write.mock.calls).toEqual([
    ['display', 'block'], ['left', '123.123456789px'],
    ['top', '98.987654321px'], ['zIndex', '123'],
  ]);
});

test('movement, layout and depth changes write only changed properties and keep labels independent', () => {
  const setStyle = createLabelStyleWriter();
  const first = trackedStyle();
  const second = trackedStyle();
  for (const { style } of [first, second]) {
    setStyle(style, 'left', '100px');
    setStyle(style, 'top', '200px');
    setStyle(style, 'zIndex', '123');
  }
  first.write.mockClear();
  setStyle(first.style, 'left', '150px');
  setStyle(first.style, 'top', '180px');
  setStyle(first.style, 'zIndex', '124');
  setStyle(first.style, 'left', '150px');
  expect(first.write.mock.calls).toEqual([
    ['left', '150px'], ['top', '180px'], ['zIndex', '124'],
  ]);
  expect(second.write).toHaveBeenCalledTimes(3);
  expect(second.style.left).toBe('100.0000px');
});

test('visibility toggles and temporary display for layout measurement remain synchronized', () => {
  const setStyle = createLabelStyleWriter();
  const { style, write } = trackedStyle();
  // Includes the temporary show used for narrow-screen label measurement
  // and the immediate hide used when reconfiguring the thermal vent.
  for (const display of ['none', 'none', 'block', 'none', 'none', 'block', 'block']) {
    setStyle(style, 'display', display);
  }
  expect(write.mock.calls).toEqual([
    ['display', 'none'], ['display', 'block'], ['display', 'none'], ['display', 'block'],
  ]);
  expect(style.display).toBe('block');
});
