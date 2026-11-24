import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

describe('buttonVariants', () => {
  it('gives icon buttons a 40px minimum tap target on narrow screens, 32px from sm up', () => {
    const cls = buttonVariants({ size: 'icon' });
    expect(cls).toContain('h-10');
    expect(cls).toContain('w-10');
    expect(cls).toContain('sm:h-8');
    expect(cls).toContain('sm:w-8');
  });
  it('leaves the default size unchanged', () => {
    expect(buttonVariants({ size: 'default' })).toContain('h-9');
  });
});
