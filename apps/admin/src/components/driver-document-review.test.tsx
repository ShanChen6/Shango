import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { createApi } from '@shango/api-client';
import { DriverDocumentReview } from './driver-document-review';

const profile = {
  userId: 'driver-1',
  vehiclePlate: 'TEST',
  vehicleType: 'motorcycle',
  status: 'pending',
  rejectionReason: null,
  updatedAt: '2026-10-28T00:00:00.000Z',
};
const document = {
  id: 'doc-1',
  driverId: 'driver-1',
  kind: 'driver_license',
  contentType: 'image/jpeg',
  byteSize: 100,
  createdAt: '2026-10-28T00:00:00.000Z',
};
const api = { adminDriverDocuments: vi.fn(), documentContent: vi.fn() };
const callbacks = { onReady: vi.fn(), onProfileChange: vi.fn() };
const create = vi.fn(() => 'blob:private-preview');
const revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  api.adminDriverDocuments.mockResolvedValue({
    items: [document],
    profile,
    requiredKinds: ['driver_license'],
    viewedIds: [],
  });
  api.documentContent.mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
});
describe('document review UI', () => {
  it('only marks ready after authenticated content and current inspection metadata are loaded', async () => {
    api.adminDriverDocuments
      .mockResolvedValueOnce({
        items: [document],
        profile,
        requiredKinds: ['driver_license'],
        viewedIds: [],
      })
      .mockResolvedValue({
        items: [document],
        profile,
        requiredKinds: ['driver_license'],
        viewedIds: ['doc-1'],
      });
    const { unmount } = render(
      <DriverDocumentReview
        api={api as unknown as ReturnType<typeof createApi>}
        driverId="driver-1"
        {...callbacks}
      />,
    );
    await screen.findByRole('button', { name: 'Xem Giấy phép lái xe' });
    expect(callbacks.onReady).toHaveBeenLastCalledWith(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xem Giấy phép lái xe' }));
    await waitFor(() => expect(callbacks.onReady).toHaveBeenLastCalledWith(true));
    expect(api.documentContent).toHaveBeenCalledExactlyOnceWith('doc-1');
    expect(screen.getByRole('img', { name: 'Giấy phép lái xe' })).toHaveAttribute(
      'src',
      'blob:private-preview',
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:private-preview');
  });
  it('keeps approval unavailable for missing or changed documents', async () => {
    api.adminDriverDocuments.mockResolvedValue({
      items: [],
      profile,
      requiredKinds: ['identity_front'],
      viewedIds: [],
    });
    render(
      <DriverDocumentReview
        api={api as unknown as ReturnType<typeof createApi>}
        driverId="driver-1"
        {...callbacks}
      />,
    );
    expect(await screen.findByText('CCCD mặt trước · Chưa nộp')).toBeInTheDocument();
    expect(callbacks.onReady).toHaveBeenLastCalledWith(false);
  });
  it('does not create a public image URL or permit approval after a failed read', async () => {
    api.documentContent.mockRejectedValue(new Error('Không có quyền truy cập'));
    render(
      <DriverDocumentReview
        api={api as unknown as ReturnType<typeof createApi>}
        driverId="driver-1"
        {...callbacks}
      />,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Xem Giấy phép lái xe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền truy cập');
    expect(create).not.toHaveBeenCalled();
    expect(callbacks.onReady).toHaveBeenLastCalledWith(false);
  });
});
