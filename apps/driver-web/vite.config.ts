import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5175, proxy: { '/api': 'http://localhost:3000' }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.private-documents/**'] } }, preview: { port: 4175 } });
