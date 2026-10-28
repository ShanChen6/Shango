import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { createApi } from '@shango/api-client';
import { AuditLogViewer, auditDateRange } from './audit-log-viewer';

const auditLogs = vi.fn();
const api = { auditLogs } as unknown as ReturnType<typeof createApi>;
const entry = {
  id: '101',
  actorId: '6cdf06f0-e000-4111-8111-000000000001',
  actorDisplayName: 'Nguyễn An',
  action: 'user.profile.updated',
  entityType: 'user',
  entityId: '6cdf06f0-e000-4111-8111-000000000001',
  metadata: { fields: ['displayName'], version: 1 },
  createdAt: '2026-10-28T01:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  auditLogs.mockResolvedValue({ items: [], nextCursor: null });
});
describe('audit viewer', () => {
  it('uses inclusive Vietnam dates with an exclusive next-day upper bound', () => {
    expect(auditDateRange('2026-10-28', '2026-10-28')).toEqual({
      from: '2026-10-27T17:00:00.000Z',
      to: '2026-10-28T17:00:00.000Z',
    });
    expect(auditDateRange('', '')).toEqual({});
  });
  it('uses server cursors and resets pagination when applying a filter', async () => {
    auditLogs
      .mockResolvedValueOnce({ items: [entry], nextCursor: '101' })
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<AuditLogViewer api={api} />);
    await screen.findByText('Nguyễn An');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(auditLogs).toHaveBeenLastCalledWith({}, '101'));
    expect(screen.getByText('Trang 2')).toBeInTheDocument();
    await screen.findByText('Không có thao tác phù hợp bộ lọc.');
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Loại thao tác' }), 'driver.review');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lọc nhật ký' }));
    await waitFor(() =>
      expect(auditLogs).toHaveBeenLastCalledWith({ action: 'driver.review' }, undefined),
    );
    expect(screen.getByText('Trang 1')).toBeInTheDocument();
  });
  it('rejects inverted dates before sending the filter', async () => {
    render(<AuditLogViewer api={api} />);
    await screen.findByText('Không có thao tác phù hợp bộ lọc.');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-10-29' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-10-28' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lọc nhật ký' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày bắt đầu');
    expect(auditLogs).toHaveBeenCalledTimes(1);
  });
  it('shows errors and can retry without mixing stale rows', async () => {
    auditLogs
      .mockRejectedValueOnce(new Error('Không có quyền truy cập'))
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<AuditLogViewer api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền truy cập');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có thao tác phù hợp bộ lọc.')).toBeInTheDocument();
  });
});
