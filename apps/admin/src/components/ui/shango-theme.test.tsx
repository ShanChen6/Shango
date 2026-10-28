import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  InputField,
  InputLabel,
  InputGroup,
  Input,
  InputIcon,
  InputAction,
  InputDescription,
  InputError,
} from './shango-theme';

describe('Button behavior', () => {
  it('does not submit a form unless explicitly requested', async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button>Thông thường</Button>
        <Button type="submit">Gửi</Button>
      </form>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Thông thường' }));
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('blocks actions while loading and exposes busy state', async () => {
    const click = vi.fn();
    render(
      <Button loading onClick={click}>
        Đang tìm tài xế
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it('preserves link semantics when slotted and enabled', () => {
    const click = vi.fn();
    render(
      <Button asChild>
        <a href="#route" onClick={click}>
          Xem tuyến
        </a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Xem tuyến' });
    fireEvent.click(link);
    expect(click).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('href', '#route');
    expect(link).toHaveAttribute('data-slot', 'button');
  });
  it('blocks disabled slotted links including child handlers and keyboard', () => {
    const click = vi.fn();
    const capture = vi.fn();
    render(
      <Button asChild disabled>
        <a href="#route" tabIndex={0} onClick={click} onClickCapture={capture}>
          Nhận đơn
        </a>
      </Button>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('tabindex', '-1');
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
describe('Input composition', () => {
  it('connects label, hint and validation message to the actual input', () => {
    render(
      <InputField invalid controlId="destination">
        <InputLabel>Địa chỉ giao</InputLabel>
        <InputGroup>
          <InputIcon>↗</InputIcon>
          <Input />
        </InputGroup>
        <InputDescription>Ghi số nhà</InputDescription>
        <InputError>Địa chỉ chưa hợp lệ</InputError>
      </InputField>,
    );
    const input = screen.getByRole('textbox', { name: 'Địa chỉ giao' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Ghi số nhà Địa chỉ chưa hợp lệ');
    expect(input).toHaveAttribute('id', 'destination');
  });
  it('propagates disabled state to input and auxiliary action', async () => {
    const click = vi.fn();
    render(
      <InputField disabled>
        <InputLabel>Điểm lấy</InputLabel>
        <InputGroup>
          <Input />
          <InputAction onClick={click} aria-label="Xóa">
            ×
          </InputAction>
        </InputGroup>
      </InputField>,
    );
    expect(screen.getByRole('textbox', { name: 'Điểm lấy' })).toBeDisabled();
    const action = screen.getByRole('button', { name: 'Xóa' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('data-slot', 'input-action');
    await userEvent.setup().click(action);
    expect(click).not.toHaveBeenCalled();
  });
  it('removes stale error description when validation recovers', () => {
    const field = (invalid: boolean) => (
      <InputField invalid={invalid}>
        <InputLabel>Địa chỉ</InputLabel>
        <Input />
        {invalid && <InputError>Cần nhập địa chỉ</InputError>}
      </InputField>
    );
    const { rerender } = render(field(true));
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Cần nhập địa chỉ');
    rerender(field(false));
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });
});
describe('Card semantics', () => {
  it('stays informational while its nested action is interactive', () => {
    render(
      <Card status="error">
        <CardHeader>
          <CardTitle>Giao hàng thất bại</CardTitle>
        </CardHeader>
        <CardContent>
          <Button>Thử lại</Button>
        </CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Giao hàng thất bại' }).tagName).toBe('H3');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading').closest('[data-slot="card"]')).toHaveAttribute(
      'data-status',
      'error',
    );
  });
});
