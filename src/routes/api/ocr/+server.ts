import type { RequestHandler } from '@sveltejs/kit';
import { API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const { base64 } = await request.json();
    const stream = true;

	if (!base64 || typeof base64 !== 'string') {
		return new Response(JSON.stringify({ error: 'Missing or invalid base64 string.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const messages = [
        {
            role: 'system',
            content: [
                { type: "text", text: "You are an expert OCR model that extracts text from images accurately. You only return the text found in the image without any additional commentary."}
            ]
        },
		{
			role: 'user',
			content: [
				{ type: 'text', text: "OCR This." },
				{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
			]
		}
	];

	const apiResponse = await fetch('https://text.pollinations.ai/openai', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${API_KEY}`
		},
		body: JSON.stringify({
			model: 'openai-large',
			messages,
			stream
		})
	});

	if (!apiResponse.ok || !apiResponse.body) {
		const fallback = await safeJson(apiResponse);
		return new Response(JSON.stringify(fallback ?? { error: 'Upstream request failed.' }), {
			status: apiResponse.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (stream) {
		const encoder = new TextEncoder();
		const reader = apiResponse.body.getReader();
		const decoder = new TextDecoder();

		const transformed = new ReadableStream<Uint8Array>({
			async start(controller) {
				let buffer = '';
				let streamDone = false;
				try {
					while (!streamDone) {
						const { value, done } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						const result = processBuffer(buffer);
						buffer = result.buffer;
						for (const chunk of result.chunks) {
							controller.enqueue(encoder.encode(chunk));
						}
						streamDone = result.done;
					}
					if (!streamDone && buffer.trim().length) {
						const result = processBuffer(buffer, true);
						for (const chunk of result.chunks) {
							controller.enqueue(encoder.encode(chunk));
						}
					}
				} finally {
					controller.close();
				}
			}
		});

		return new Response(transformed, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	}

	const payload = await apiResponse.json();
	const text = extractText(payload);

	return new Response(JSON.stringify({ text }), {
		headers: { 'Content-Type': 'application/json' }
	});
};

function processBuffer(buffer: string, flush = false): {
	buffer: string;
	chunks: string[];
	done: boolean;
} {
	const lines = buffer.split(/\r?\n/);
	const chunks: string[] = [];
	let done = false;
	let remainder = '';

	if (!flush) {
		remainder = lines.pop() ?? '';
	}

	for (const line of flush ? lines : lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed === 'data: [DONE]') {
			done = true;
			continue;
		}
		if (!trimmed.startsWith('data:')) continue;
		const payload = trimmed.slice(5).trim();
		try {
			const json = JSON.parse(payload);
			const delta = json?.choices?.[0]?.delta?.content ?? '';
			if (delta) {
				chunks.push(delta);
			}
		} catch (error) {
			// Ignore malformed chunks
		}
	}

	return {
		buffer: flush ? '' : remainder,
		chunks,
		done
	};
}

function extractText(payload: unknown): string {
	const choices = (payload as { choices?: Array<{ message?: { content?: string }; text?: string }> }).choices;
	if (!choices || choices.length === 0) {
		return '';
	}

	const contents: string[] = [];
	for (const choice of choices) {
		if (choice?.message?.content) {
			contents.push(choice.message.content);
		} else if (choice?.text) {
			contents.push(choice.text);
		}
	}

	return contents.join('');
}

async function safeJson(response: Response): Promise<unknown | null> {
	try {
		return await response.clone().json();
	} catch (error) {
		return null;
	}
}
