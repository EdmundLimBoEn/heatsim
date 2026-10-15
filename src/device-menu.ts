import type { DeviceAction, DeviceTarget } from './device-actions';

export function createDeviceMenu(act: (target: DeviceTarget, action: DeviceAction) => void) {
  const menu = document.createElement('div');
  menu.className = 'device-context-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Device quick controls');
  menu.hidden = true;
  document.body.append(menu);
  let target: DeviceTarget | null = null;
  let launcher: HTMLElement | null = null;
  function close(restore = false): void {
    menu.hidden = true;
    if (restore && launcher?.isConnected) launcher.focus({ preventScroll: true });
  }
  menu.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (target && button.dataset.deviceAction) act(target, button.dataset.deviceAction as DeviceAction);
    close(true);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Tab') {
      const buttons = Array.from(menu.querySelectorAll('button'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node)) close(); }, true);
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());
  return {
    close,
    open(next: DeviceTarget, name: string, on: boolean, x: number, y: number): void {
      target = next; launcher = document.activeElement as HTMLElement;
      menu.replaceChildren();
      const title = document.createElement('strong'); title.textContent = name; menu.append(title);
      for (const [action, label] of [['power', on ? 'Turn off' : 'Turn on'], ['left', 'Rotate left 45°'], ['right', 'Rotate right 45°'], ...(next.kind === 'fan' ? [['remove', 'Delete fan']] : []), ['', 'Close']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        if (action) button.dataset.deviceAction = action;
        menu.append(button);
      }
      if (next.kind === 'purifier') { const note = document.createElement('small'); note.textContent = 'Rotation changes the visual only. This model cleans equally around the purifier.'; menu.append(note); }
      menu.hidden = false;
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector('button')?.focus({ preventScroll: true });
    },
  };
}
