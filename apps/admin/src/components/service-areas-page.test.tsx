import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServiceArea } from '@shango/contracts';
import { ServiceAreasPage } from './service-areas-page';

vi.mock('./area-map', () => ({
  AreaMap: ({ draft }: { draft: unknown }) => <div>{draft ? 'Có bản nháp' : 'Không bản nháp'}</div>,
}));

const geometry = {
  type: 'MultiPolygon' as const,
  coordinates: [
    [
      [
        [105.3, 20.55],
        [106.05, 20.55],
        [106.05, 21.4],
        [105.3, 21.4],
        [105.3, 20.55],
      ],
    ],
  ],
};
const area: ServiceArea = {
  id: 'a1',
  code: 'hanoi-pilot',
  name: 'Hà Nội tạm',
  active: true,
  version: 1,
  geometry,
  areaKm2: 7400,
  vertices: 5,
  updatedAt: '2026-11-21T10:00:00Z',
  updatedBy: null,
};
const serviceAreas = vi.fn();
const serviceAreaVersions = vi.fn();
const updateServiceArea = vi.fn();
const api = { serviceAreas, serviceAreaVersions, updateServiceArea };
const small = {
  type: 'Polygon',
  coordinates: [
    [
      [105.8, 21],
      [105.9, 21],
      [105.9, 21.06],
      [105.8, 21],
    ],
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceAreas.mockResolvedValue({ items: [area] });
  serviceAreaVersions.mockResolvedValue({
    items: [
      {
        version: 1,
        name: 'Hà Nội tạm',
        active: true,
        vertices: 5,
        areaKm2: 7400,
        changedAt: '2026-11-21T10:00:00Z',
        changedBy: null,
      },
    ],
  });
});

describe('service areas page (SG-015)', () => {
  it('shows the area read-only to dispatchers', async () => {
    render(<ServiceAreasPage api={api} role="dispatcher" />);
    expect(await screen.findByText('hanoi-pilot')).toBeInTheDocument();
    expect(screen.getAllByText(/7\.400 km² · 5 đỉnh/)).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Lịch sử phiên bản vùng' })).toHaveTextContent('v1');
    expect(screen.queryByRole('button', { name: 'Lưu vùng' })).not.toBeInTheDocument();
  });

  it('previews a pasted polygon and saves it with the current version', async () => {
    const user = userEvent.setup();
    updateServiceArea.mockResolvedValue({ ...area, version: 2 });
    render(<ServiceAreasPage api={api} role="admin" />);
    const editor = await screen.findByRole('textbox', { name: 'GeoJSON' });
    const save = screen.getByRole('button', { name: 'Lưu vùng' });
    expect(save).toBeDisabled();
    fireEvent.change(editor, { target: { value: '{' } });
    expect(screen.getByText('Không đọc được JSON.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(editor, { target: { value: JSON.stringify(small) } });
    expect(screen.getByText('Có bản nháp')).toBeInTheDocument();
    expect(screen.getByText('Có thay đổi chưa lưu.')).toBeInTheDocument();
    await user.click(save);
    expect(updateServiceArea).toHaveBeenCalledWith('a1', {
      name: 'Hà Nội tạm',
      active: true,
      geometry: small,
      expectedVersion: 1,
    });
    expect(await screen.findByText(/Đã lưu phiên bản 2/)).toBeInTheDocument();
  });

  it('shows the server reason when saving fails', async () => {
    const user = userEvent.setup();
    updateServiceArea.mockRejectedValue(
      Object.assign(new Error('Polygon không hợp lệ: Self-intersection[105.85 21.03]'), {
        status: 422,
      }),
    );
    render(<ServiceAreasPage api={api} role="admin" />);
    await user.click(await screen.findByLabelText('Đang bật (nhận báo giá và đơn)'));
    await user.click(screen.getByRole('button', { name: 'Lưu vùng' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Self-intersection');
    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Đang bật (nhận báo giá và đơn)')).toBeChecked(),
    );
  });
});
