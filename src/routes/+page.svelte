<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Camera, Upload, FileText, Loader2, Copy, Check } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { onDestroy, tick } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';

	let selectedFile: File | null = null;
	let imagePreviewUrl: string | null = null;
	let extractedText = '';
	let isStreaming = false;
	let error: string | null = null;
	let showCamera = false;
	let videoStream: MediaStream | null = null;
	let videoElement: HTMLVideoElement | null = null;
	let isCameraLoading = false;
	let isDragActive = false;
	let copyState: 'idle' | 'copied' | 'error' = 'idle';
	let copyError: string | null = null;
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

	function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(new Error('Unable to read the selected image.'));
			reader.readAsDataURL(file);
		});
	}

	async function updateSelectedImage(file: File) {
		if (!file.type.startsWith('image/')) {
			error = 'Please select a valid image file.';
			selectedFile = null;
			imagePreviewUrl = null;
			return;
		}

		try {
			selectedFile = file;
			imagePreviewUrl = await readFileAsDataUrl(file);
			error = null;
		} catch (err) {
			selectedFile = null;
			imagePreviewUrl = null;
			error = err instanceof Error ? err.message : 'Unable to read the selected image.';
		}
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			await updateSelectedImage(target.files[0]);
			target.value = '';
		}
	}

	function isFileDrag(event: DragEvent): boolean {
		const types = event.dataTransfer?.types;
		if (types && Array.from(types as unknown as ArrayLike<string>).includes('Files')) {
			return true;
		}

		return getFileFromItems(event.dataTransfer?.items) !== null;
	}

	function handleDragEnter(event: DragEvent) {
		event.preventDefault();
		if (!isFileDrag(event)) return;
		isDragActive = true;
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (!isFileDrag(event)) return;
		if (!isDragActive) {
			isDragActive = true;
		}
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	}

	function handleDragLeave(event: DragEvent) {
		if (!isDragActive) return;
		const related = event.relatedTarget as Node | null;
		const current = event.currentTarget as HTMLElement | null;
		if (!current || (related && current.contains(related))) {
			return;
		}

		isDragActive = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragActive = false;

		const file = event.dataTransfer?.files?.[0] ?? getFileFromItems(event.dataTransfer?.items);
		if (file) {
			await updateSelectedImage(file);
		}
	}

	function getFileFromItems(items: DataTransferItemList | undefined | null): File | null {
		if (!items) return null;
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			if (item.kind === 'file') {
				const file = item.getAsFile();
				if (file) {
					return file;
				}
			}
		}
		return null;
	}

	async function handlePaste(event: ClipboardEvent) {
		const dataTransferItems = event.clipboardData?.items;
		if (dataTransferItems) {
			for (let index = 0; index < dataTransferItems.length; index++) {
				const item = dataTransferItems[index];
				if (item.kind === 'file' && item.type.startsWith('image/')) {
					const file = item.getAsFile();
					if (file) {
						event.preventDefault();
						await updateSelectedImage(file);
						return;
					}
				}
			}
		}

		const files = event.clipboardData?.files;
		if (files && files.length > 0) {
			event.preventDefault();
			await updateSelectedImage(files[0]);
		}
	}

	async function handleSubmit() {
		if (!selectedFile) return;

		isStreaming = true;
		extractedText = '';
		error = null;

		try {
			// Read file as base64
			const dataUrl = imagePreviewUrl ?? (await readFileAsDataUrl(selectedFile));
			const base64 = dataUrl.split(',')[1] || dataUrl;

			// get the file type [png or jpeg or jpg or webp]
			const fileType = selectedFile.type;

			// Stream response from server
			const response = await fetch('/api/ocr', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ base64: base64, filetype: fileType })
			});

			if (!response.ok || !response.body) {
				throw new Error('Failed to get OCR result.');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let done = false;
			extractedText = '';

			while (!done) {
				const { value, done: streamDone } = await reader.read();
				if (value) {
					extractedText += decoder.decode(value);
				}
				done = streamDone;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error occurred.';
		} finally {
			isStreaming = false;
		}
	}

	async function handleTakePhoto() {
		if (isCameraLoading) return;

		try {
			await startCamera();
		} catch (err) {
			if (!error) {
				error = formatCameraError(err);
			}
			stopCamera();
		}
	}

	async function startCamera() {
		if (!browser || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			error = 'Camera is not supported on this device.';
			return;
		}

		if (typeof window !== 'undefined' && !window.isSecureContext) {
			error = 'Camera access requires HTTPS or localhost. Please switch to a secure connection.';
			return;
		}

		error = null;
		isCameraLoading = true;
		showCamera = true;
		await tick();

		const constraintOptions: MediaStreamConstraints[] = [
			{ video: { facingMode: { ideal: 'environment' } }, audio: false },
			{ video: { facingMode: 'environment' }, audio: false },
			{ video: true, audio: false }
		];

		let lastError: unknown = null;

		for (const constraints of constraintOptions) {
			try {
				videoStream = await navigator.mediaDevices.getUserMedia(constraints);
				break;
			} catch (err) {
				lastError = err;
			}
		}

		if (!videoStream) {
			showCamera = false;
			isCameraLoading = false;
			error = formatCameraError(lastError);
			throw lastError instanceof Error ? lastError : new Error('Unable to access camera');
		}

		if (videoElement) {
			videoElement.srcObject = videoStream;
			await videoElement.play();
		}

		isCameraLoading = false;
	}

	function stopCamera() {
		if (videoStream) {
			videoStream.getTracks().forEach((track) => track.stop());
		}

		if (videoElement) {
			videoElement.srcObject = null;
		}

		videoStream = null;
		showCamera = false;
		isCameraLoading = false;
	}

	async function capturePhoto() {
		if (!videoElement) return;

		const canvas = document.createElement('canvas');
		const { videoWidth, videoHeight } = videoElement;

		if (!videoWidth || !videoHeight) return;
		canvas.width = videoWidth;
		canvas.height = videoHeight;
		const context = canvas.getContext('2d');

		if (!context) return;

		context.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
		const dataUrl = canvas.toDataURL('image/png');
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		const capturedFile = new File([blob], `capture-${Date.now()}.png`, {
			type: 'image/png'
		});

		await updateSelectedImage(capturedFile);

		stopCamera();
	}

	function scheduleCopyReset() {
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}

		copyResetTimer = setTimeout(() => {
			copyState = 'idle';
			copyError = null;
		}, 2000);
	}

	async function copyExtractedText() {
		if (!browser) {
			copyState = 'error';
			copyError = 'Clipboard is not available in this environment.';
			scheduleCopyReset();
			return;
		}

		if (!extractedText.trim()) {
			copyState = 'error';
			copyError = 'There is no text to copy yet.';
			scheduleCopyReset();
			return;
		}

		if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
			copyState = 'error';
			copyError = 'Clipboard is not supported in this browser.';
			scheduleCopyReset();
			return;
		}

		try {
			await navigator.clipboard.writeText(extractedText);
			copyState = 'copied';
			copyError = null;
		} catch (err) {
			copyState = 'error';
			copyError = 'Failed to copy text. Please try again.';
		} finally {
			scheduleCopyReset();
		}
	}

	function formatCameraError(err: unknown): string {
		const cameraError = err as DOMException | undefined;

		if (!cameraError) {
			return 'Unable to access the camera. Please try again or use the upload option.';
		}

		switch (cameraError.name) {
			case 'NotAllowedError':
			case 'PermissionDeniedError':
				return 'Camera permission was denied. Please allow access in your browser settings.';
			case 'NotFoundError':
			case 'OverconstrainedError':
				return 'No suitable camera was found. Try switching devices or adjusting camera settings.';
			case 'NotReadableError':
			case 'TrackStartError':
				return 'Camera is already in use by another application. Close it and try again.';
			case 'SecurityError':
				return 'Camera access is blocked by security settings. Ensure you are on HTTPS and try again.';
			default:
				return cameraError.message || 'Unable to access the camera. Please try again later.';
		}
	}

	onDestroy(() => {
		// Ensure we clean up any active camera streams when the component unmounts.
		stopCamera();
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
			copyResetTimer = null;
		}
	});
</script>

<div class="min-h-screen bg-background text-foreground p-4 sm:p-6 lg:p-8" onpaste={handlePaste}>
	<div class="max-w-6xl mx-auto">
		<header class="text-center mb-10">
			<h1 class="text-4xl font-bold tracking-tight">Free OCR</h1>
			<p class="text-muted-foreground mt-2">Extract text from images with ease.</p>
		</header>

		<main class="grid md:grid-cols-2 gap-8">
			<!-- Input Card -->
			<Card.Root class="w-full">
				<Card.Header>
					<Card.Title class="flex items-center">
						<FileText class="mr-2" />
						Image Source
					</Card.Title>
					<Card.Description>Upload an image or use your camera.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div
						class={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
							isDragActive ? 'border-primary bg-primary/10' : 'border-muted bg-transparent'
						}`}
						role="presentation"
						ondragenter={handleDragEnter}
						ondragover={handleDragOver}
						ondragleave={handleDragLeave}
						ondrop={handleDrop}
					>
						{#if imagePreviewUrl}
							<div
								class="relative"
								in:fly={{ y: -20, duration: 300, easing: quintOut }}
							>
								<img
									src={imagePreviewUrl}
									alt="Selected preview"
									class="rounded-md max-h-64 mx-auto"
								/>
							</div>
						{:else}
							<div class="flex flex-col items-center space-y-2 text-muted-foreground">
								<Upload class="h-12 w-12" />
								<span>Drag, drop, paste, or select an image</span>
							</div>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-4">
						<Label
							for="file-upload"
							class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 cursor-pointer"
						>
							<Upload class="mr-2 h-4 w-4" />
							Upload Image
						</Label>
						<Input
							id="file-upload"
							type="file"
							class="hidden"
							onchange={handleFileSelect}
							accept="image/*"
						/>
						<Button variant="secondary" onclick={handleTakePhoto}>
							<Camera class="mr-2 h-4 w-4" />
							Take Photo
						</Button>
					</div>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
				</Card.Content>
				<Card.Footer>
					<Button onclick={handleSubmit} disabled={!selectedFile || isStreaming} class="w-full">
						{#if isStreaming}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Processing...
						{:else}
							Submit
						{/if}
					</Button>
				</Card.Footer>
			</Card.Root>

			<!-- Output Card -->
			<Card.Root class="w-full">
				<Card.Header>
					<Card.Title>Extracted Text</Card.Title>
					<Card.Description>The text from your image will appear below.</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
						<Button
							variant="outline"
							onclick={copyExtractedText}
							disabled={!extractedText}
							class="w-full sm:w-auto"
						>
							{#if copyState === 'copied'}
								<Check class="mr-2 h-4 w-4" />
								Copied
							{:else if copyState === 'error'}
								<Copy class="mr-2 h-4 w-4" />
								Try Again
							{:else}
								<Copy class="mr-2 h-4 w-4" />
								Copy Text
							{/if}
						</Button>
						{#if copyState === 'copied'}
							<span class="text-xs font-medium text-green-600 dark:text-green-400">Copied to clipboard</span>
						{:else if copyState === 'error' && copyError}
							<span class="text-xs text-destructive sm:ml-2">{copyError}</span>
						{/if}
					</div>
					<div
						class="prose prose-sm dark:prose-invert max-w-full h-96 overflow-y-auto bg-muted/50 rounded-md p-4"
					>
						<pre class="whitespace-pre-wrap break-words"><code>{extractedText}</code>{#if isStreaming}<span class="animate-pulse">▋</span>{/if}</pre>
					</div>
				</Card.Content>
			</Card.Root>
		</main>

		<footer class="mt-12 text-center text-xs text-muted-foreground">
			MADE BY FAHAD HOSSAIN <span aria-hidden="true">&bull;</span> <a href="https://pollinations.ai/">POWERED BY POLLINATIONS AI</a>
		</footer>

		{#if showCamera}
			<div class="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur">
				<div class="flex-1 flex flex-col items-center justify-center gap-4 p-4">
					<div class="relative w-full max-w-sm aspect-[3/4] overflow-hidden rounded-2xl bg-black">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video bind:this={videoElement} autoplay playsinline class="h-full w-full object-cover"></video>
						{#if isCameraLoading}
							<div class="absolute inset-0 flex items-center justify-center bg-black/60">
								<Loader2 class="h-10 w-10 animate-spin text-white" />
							</div>
						{/if}
					</div>
				</div>
				<div class="flex items-center justify-center gap-4 border-t border-border p-4">
					<Button onclick={capturePhoto} disabled={isCameraLoading} class="w-32">Capture</Button>
					<Button variant="secondary" onclick={stopCamera} class="w-32">Cancel</Button>
				</div>
			</div>
		{/if}
	</div>
</div>
