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
	<script defer src="https://umami-spitfire.netlify.app/script.js" data-website-id="597e22b1-0d6c-4930-9c34-982a9dd207c1"></script>
	<script async data-cfasync="false" src="https://pl28623510.effectivegatecpm.com/f43f518d0f162ac68fd53a2b8bc46f6c/invoke.js"></script>
</svelte:head>

{@render children?.()}
