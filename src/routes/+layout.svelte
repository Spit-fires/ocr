<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	const themeColor = '#09090b';

	let { children } = $props();

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;

		const register = async () => {
			try {
				await navigator.serviceWorker.register('/service-worker.js');
			} catch (error) {
				console.error('Failed to register service worker', error);
			}
		};

		register();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content={themeColor} />
</svelte:head>

{@render children?.()}
