import { describe, expect, it } from 'vitest';
import { canAccess, errorStatus, homePath, sectionForPath, sectionsFor } from './navigation';

describe('admin navigation by role', () => {
  it('shows audit only to admins and mirrors server roles', () => {
    expect(sectionsFor('admin')).toEqual(['drivers', 'orders', 'areas', 'maps', 'audit']);
    expect(sectionsFor('dispatcher')).toEqual(['drivers', 'orders', 'areas', 'maps']);
    expect(canAccess('dispatcher', 'audit')).toBe(false);
  });
  it('gives accountants and public roles no Admin section yet', () => {
    expect(sectionsFor('accountant')).toEqual([]);
    expect(homePath('accountant')).toBeNull();
    expect(sectionsFor('customer')).toEqual([]);
    expect(homePath('dispatcher')).toBe('/drivers');
  });
  it('maps deep links to sections without prefix confusion', () => {
    expect(sectionForPath('/drivers/6cdf06f0')).toBe('drivers');
    expect(sectionForPath('/orders')).toBe('orders');
    expect(sectionForPath('/ordersx')).toBeNull();
    expect(sectionForPath('/')).toBeNull();
  });
  it('reads statuses from both API error types', () => {
    expect(errorStatus({ status: 409, message: 'x' })).toBe(409);
    expect(errorStatus(new Error('x'))).toBeNull();
    expect(errorStatus(null)).toBeNull();
  });
});
