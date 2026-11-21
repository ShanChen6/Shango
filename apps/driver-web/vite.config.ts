import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5175, proxy: { '/api': 'http://localhost:3000', '/socket.io': { target: 'http://localhost:3000', ws: true } }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.private-documents/**'] } }, preview: { port: 4175 } });
