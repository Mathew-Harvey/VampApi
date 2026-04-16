import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const envSchema = z.object({
  TURN_URL: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_CREDENTIAL: z.string().default(''),
});

describe('TURN env config', () => {
  it('defaults to empty strings when TURN vars are not set', () => {
    const result = envSchema.parse({});
    expect(result.TURN_URL).toBe('');
    expect(result.TURN_USERNAME).toBe('');
    expect(result.TURN_CREDENTIAL).toBe('');
  });

  it('accepts valid TURN configuration', () => {
    const result = envSchema.parse({
      TURN_URL: 'turn:relay.example.com:3478',
      TURN_USERNAME: 'user1',
      TURN_CREDENTIAL: 'pass1',
    });
    expect(result.TURN_URL).toBe('turn:relay.example.com:3478');
    expect(result.TURN_USERNAME).toBe('user1');
    expect(result.TURN_CREDENTIAL).toBe('pass1');
  });

  it('builds correct ICE servers array when TURN is configured', () => {
    const env = envSchema.parse({
      TURN_URL: 'turn:relay.example.com:3478',
      TURN_USERNAME: 'user1',
      TURN_CREDENTIAL: 'pass1',
    });

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];
    if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: env.TURN_URL,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }

    expect(iceServers).toHaveLength(2);
    expect(iceServers[1]).toEqual({
      urls: 'turn:relay.example.com:3478',
      username: 'user1',
      credential: 'pass1',
    });
  });

  it('omits TURN server when any credential is missing', () => {
    const env = envSchema.parse({
      TURN_URL: 'turn:relay.example.com:3478',
      TURN_USERNAME: '',
      TURN_CREDENTIAL: 'pass1',
    });

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: ['stun:stun.l.google.com:19302'] },
    ];
    if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: env.TURN_URL,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }

    expect(iceServers).toHaveLength(1);
  });
});
