import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { createApi } from '@shango/api-client';
import { MapPlayground } from './map-playground';

vi.mock('./map-canvas', () => ({ MapCanvas: () => <div>Bản đồ</div> }));
const config = {
  region: {
    id: 'hanoi-pilot',
    name: 'Hà Nội',
    center: { latitude: 21.0278, longitude: 105.8342 },
    bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
  },
  geocodingConfigured: true,
  routingConfigured: false,
  searchMode: 'submit-only',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
};
const mocks = {
  mapConfig: vi.fn(),
  searchPlaces: vi.fn(),
  reversePlace: vi.fn(),
  mapRoute: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mapConfig.mockResolvedValue(config);
  mocks.searchPlaces.mockResolvedValue({ items: [] });
});
const renderPage = () =>
  render(<MapPlayground api={mocks as unknown as ReturnType<typeof createApi>} />);
describe('map playground behavior', () => {
  it('only searches on submit, never per keystroke', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Tìm địa chỉ tại Hà Nội' });
    await userEvent.setup().type(input, 'Hồ Hoàn Kiếm');
    expect(mocks.searchPlaces).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tìm địa chỉ' }));
    expect(mocks.searchPlaces).toHaveBeenCalledExactlyOnceWith('Hồ Hoàn Kiếm');
    expect(await screen.findByText(/Không tìm thấy địa chỉ/)).toBeInTheDocument();
  });
  it('disables routing without a configured service and reports out-of-region points', async () => {
    renderPage();
    await screen.findByRole('textbox', { name: 'Vĩ độ' });
    expect(screen.getByRole('button', { name: 'Tính tuyến đường' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Vĩ độ' }), {
      target: { value: '10.77' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Kinh độ' }), {
      target: { value: '106.7' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chọn tọa độ' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ngoài khung thử nghiệm Hà Nội');
    expect(mocks.mapRoute).not.toHaveBeenCalled();
  });
  it('keeps the chosen pin when reverse geocoding returns a nearby address', async () => {
    mocks.reversePlace.mockResolvedValue({
      item: {
        id: 'a',
        label: 'Địa chỉ gần nhất',
        position: { longitude: 105.85, latitude: 21.03 },
      },
      requestedPosition: { longitude: 105.8342, latitude: 21.0278 },
    });
    renderPage();
    await screen.findByRole('textbox', { name: 'Vĩ độ' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tìm địa chỉ tọa độ' }));
    await waitFor(() =>
      expect(screen.getByText('Địa chỉ gần nhất', { exact: false })).toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'Kinh độ' })).toHaveValue('105.8342');
  });
});
