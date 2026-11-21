import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Order } from '@shango/contracts';
import { OrdersBoard, staffCancellable } from './orders-board';

const adminOrders = vi.fn();
const cancelOrder = vi.fn();
const api = { adminOrders, cancelOrder };
const stop = {
  position: { longitude: 105.852, latitude: 21.028 },
  address: 'Hồ Hoàn Kiếm',
  detail: '',
  contactName: 'An',
  contactPhone: '+84901234567',
  note: '',
};
const order = (patch: Partial<Order>): Order => ({
  id: '6cdf06f0-e000-4111-8111-000000000001',
  status: 'ASSIGNED',
  version: 2,
  vehicleType: 'motorcycle',
  stops: { pickup: stop, dropoff: { ...stop, address: 'Văn Miếu' } },
  distanceMeters: 3200,
  durationSeconds: 600,
  priceVnd: 31000,
  tariffVersion: 'pilot-unapproved',
  searchDeadline: '2026-11-21T10:05:00Z',
  cancelReason: null,
  customerId: 'c',
  driverId: 'd',
  createdAt: '2026-11-21T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
  driver: { id: 'd', displayName: 'Bình', vehiclePlate: '29A-123.45', vehicleType: 'motorcycle' },
  driverLocation: null,
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  adminOrders.mockResolvedValue({
    items: [
      order({}),
      order({
        id: 'delivered-1',
        status: 'DELIVERED',
        version: 6,
        driver: {
          id: 'e',
          displayName: 'Chi',
          vehiclePlate: '30B-888.88',
          vehicleType: 'motorcycle',
        },
      }),
    ],
  });
});

describe('admin orders board', () => {
  it('matches the server cancellation policy', () => {
    expect(
      ['SEARCHING', 'ASSIGNED', 'AT_PICKUP'].every((s) => staffCancellable(s as Order['status'])),
    ).toBe(true);
    expect(
      ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'EXPIRED'].some((s) =>
        staffCancellable(s as Order['status']),
      ),
    ).toBe(false);
  });
  it('requires a reason and sends the current version when cancelling', async () => {
    const user = userEvent.setup();
    cancelOrder.mockResolvedValue(order({ status: 'CANCELLED', version: 3 }));
    render(<OrdersBoard api={api} refreshMs={0} />);
    await screen.findByText('Bình · 29A-123.45');
    expect(screen.getAllByRole('button', { name: 'Hủy đơn' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận hủy' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Lý do hủy'), 'Khách gọi hủy');
    await user.click(confirm);
    await waitFor(() =>
      expect(cancelOrder).toHaveBeenCalledWith(
        '6cdf06f0-e000-4111-8111-000000000001',
        2,
        'Khách gọi hủy',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Đã hủy đơn');
  });
  it('filters by status and reports load failures', async () => {
    const user = userEvent.setup();
    render(<OrdersBoard api={api} refreshMs={0} />);
    await screen.findByText('Bình · 29A-123.45');
    adminOrders.mockRejectedValueOnce(new Error('503'));
    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'SEARCHING');
    await waitFor(() => expect(adminOrders).toHaveBeenLastCalledWith('SEARCHING'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
  });
  it('summarizes dispatch exceptions and filters to them', async () => {
    const user = userEvent.setup();
    render(<OrdersBoard api={api} refreshMs={0} />);
    await screen.findByText('Bình · 29A-123.45');
    expect(screen.getByText('1 đơn mất GPS tài xế')).toBeInTheDocument();
    expect(screen.getByText('⚠ Chưa có GPS tài xế')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Chỉ hiện ngoại lệ'));
    expect(screen.queryByText(/Chi · 30B-888.88/)).not.toBeInTheDocument();
    expect(screen.getByText('Bình · 29A-123.45')).toBeInTheDocument();
  });
});
