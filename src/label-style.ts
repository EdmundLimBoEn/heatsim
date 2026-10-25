type LabelStyleProperty = 'display' | 'left' | 'top' | 'zIndex';

export function createLabelStyleWriter() {
  const previous = new WeakMap<CSSStyleDeclaration, Partial<Record<LabelStyleProperty, string>>>();
  // Cache requested values: CSSOM can round fractional coordinates when read back.
  // All writes to these properties after label creation must use this writer.
  return (style: CSSStyleDeclaration, property: LabelStyleProperty, value: string): void => {
    let values = previous.get(style);
    if (!values) {
      values = {};
      previous.set(style, values);
    }
    if (values[property] === value) return;
    style[property] = value;
    values[property] = value;
  };
}
