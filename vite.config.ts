import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			kit: {
				includeVersionFile: true
			},
			manifest: {
				name: 'Free OCR',
				short_name: 'Free OCR',
				description: 'Extract text from images with ease.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#09090b',
				theme_color: '#09090b',
				icons: [
					{
						src: 'src/lib/assets/favicon.svg',
						sizes: 'any',
						type: 'image/svg+xml'
					}
				]
			},
			devOptions: {
				enabled: true
			},
			workbox: {
				navigateFallback: '/' // ensure SPA navigation works offline
			}
		}),
		sveltekit()
	]
});
