import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AppShell, Button, InlineAlert, TextField } from '../src';

afterEach(cleanup);

it('exposes accessible primitive semantics', () => {
  render(<><Button disabled>Tiếp tục</Button><TextField label="Số điện thoại" name="phone" error="Không hợp lệ"/><InlineAlert>Thử lại</InlineAlert></>);
  expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  expect(screen.getByLabelText('Số điện thoại')).toHaveAccessibleDescription('Không hợp lệ');
  expect(screen.getByRole('alert')).toHaveTextContent('Thử lại');
});

it('provides one labelled navigation and a focusable main landmark', () => {
  render(<AppShell appName="Khách hàng" navigation={<a href="/">Trang chủ</a>}><h1>Xin chào</h1></AppShell>);
  expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
});
