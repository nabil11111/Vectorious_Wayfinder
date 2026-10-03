import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app';

it('A1 permits authenticated photo object URLs in the served page image policy', async () => {
  const response = await request(createApp()).get('/api/v1/not-a-page');
  const policy = String(response.headers['content-security-policy']);
  const images = policy.split(';').find((directive) => directive.startsWith('img-src '))!.split(' ');
  expect(images).toContain("'self'");
  expect(images).toContain('data:');
  expect(images).toContain('blob:');
  expect(images).not.toContain('*');
});
