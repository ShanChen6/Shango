import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import './tokens.css';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`sg-button ${className}`} {...props} />;
}

export function TextField({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string;
}) {
  const generatedId = useId();
  const inputId = props.id ?? props.name ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  return <div className="sg-field"><label htmlFor={inputId}>{label}</label><input id={inputId} aria-invalid={Boolean(error)} aria-describedby={errorId} {...props}/>{error && <small id={errorId}>{error}</small>}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`sg-card ${className}`}>{children}</section>;
}

export function InlineAlert({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'warning' | 'success' }) {
  return <div className={`sg-alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="sg-badge">{children}</span>;
}

export function AppShell({ appName, navigation, children }: { appName: string; navigation: ReactNode; children: ReactNode }) {
  return <div className="sg-shell"><header className="sg-header"><a href="/" className="sg-brand">ShanGo <span>{appName}</span></a></header><nav className="sg-navigation" aria-label="Điều hướng chính">{navigation}</nav><main id="main-content" className="sg-main" tabIndex={-1}>{children}</main></div>;
}

export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="sg-page-header"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}
