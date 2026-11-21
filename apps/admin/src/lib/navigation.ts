/**
 * Admin route/role model (ADR-002 §1). The frontend only hides what a role cannot use;
 * every endpoint is still authorized by the API.
 */
export type Section = 'drivers' | 'orders' | 'maps' | 'audit';
export const STAFF_ROLES = ['admin', 'dispatcher', 'accountant'] as const;

export const sections: Record<
  Section,
  { path: string; label: string; title: string; roles: readonly string[] }
> = {
  drivers: {
    path: '/drivers',
    label: 'Hồ sơ tài xế',
    title: 'Duyệt hồ sơ tài xế',
    roles: ['admin', 'dispatcher'],
  },
  orders: { path: '/orders', label: 'Đơn hàng', title: 'Đơn hàng', roles: ['admin', 'dispatcher'] },
  maps: {
    path: '/maps',
    label: 'Bản đồ Hà Nội',
    title: 'Bản đồ Hà Nội',
    roles: ['admin', 'dispatcher'],
  },
  audit: { path: '/audit', label: 'Nhật ký thao tác', title: 'Nhật ký thao tác', roles: ['admin'] },
};
export const sectionOrder: Section[] = ['drivers', 'orders', 'maps', 'audit'];

export function sectionsFor(role: string): Section[] {
  return sectionOrder.filter((section) => sections[section].roles.includes(role));
}

export function canAccess(role: string, section: Section) {
  return sections[section].roles.includes(role);
}

/** Landing route after login or for "/"; null when the role has no Admin feature yet. */
export function homePath(role: string) {
  const first = sectionsFor(role)[0];
  return first ? sections[first].path : null;
}

export function sectionForPath(pathname: string): Section | null {
  return (
    sectionOrder.find(
      (section) =>
        pathname === sections[section].path || pathname.startsWith(`${sections[section].path}/`),
    ) ?? null
  );
}

export const roleLabels: Record<string, string> = {
  admin: 'Quản trị viên',
  dispatcher: 'Điều phối viên',
  accountant: 'Kế toán',
};

/** Reads an HTTP status from either API client's error type without importing both. */
export function errorStatus(error: unknown): number | null {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : null;
}
