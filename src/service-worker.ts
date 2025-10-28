/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const ASSETS = [...build, ...files, ...prerendered];
const ASSET_URLS = ASSETS.map((path) => new URL(path, sw.location.origin).toString());
const ASSET_URL_SET = new Set(ASSET_URLS);
const CACHE_NAME = `freeocr-cache-${version}`;
const TIMEOUT_MS = 8_000;

sw.addEventListener('install', (event: ExtendableEvent) => {
	sw.skipWaiting();
	// Prime cache with build-time assets so core UI is available offline.
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSET_URLS)).catch(() => {
			// Ignore warm-up failures; runtime fetch handlers will populate the cache.
		})
	);
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			)
		)
			.finally(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event: FetchEvent) => {
	const request = event.request;

	if (request.method !== 'GET' || request.headers.has('range')) {
		return;
	}

	const url = new URL(request.url);

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return;
	}

	if (ASSET_URL_SET.has(url.href)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	if (request.mode === 'navigate' && url.origin === sw.location.origin) {
		event.respondWith(networkFirst(request));
		return;
	}

	event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	if (cached) {
		return cached;
	}

	const response = await fetch(request);
	cache.put(request, response.clone());
	return response;
}

async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE_NAME);

	try {
		const response = await fetchWithTimeout(request, TIMEOUT_MS);
		cache.put(request, response.clone());
		return response;
	} catch (error) {
		const fallback = await cache.match(request);
		if (fallback) {
			return fallback;
		}

		const offline = await cache.match(new URL('/', sw.location.origin).toString());
		if (offline) {
			return offline;
		}

		return Response.error();
	}
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	const networkPromise = fetch(request)
		.then((response) => {
			cache.put(request, response.clone());
			return response;
		})
		.catch(() => undefined);

	if (cached) {
		return cached;
	}

	const networkResponse = await networkPromise;
	if (networkResponse) {
		return networkResponse;
	}

	return fetch(request);
}

async function fetchWithTimeout(request: Request, timeout: number): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		return await fetch(request, { signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
}
