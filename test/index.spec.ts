import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('da-sc worker', () => {
	it('returns 404 for favicon.ico', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/favicon.ico');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it('returns 204 for OPTIONS request', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
			method: 'OPTIONS',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('returns 405 for POST request', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
			method: 'POST',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
	});

	it('includes CORS headers in error response', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
			method: 'POST',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});
});
