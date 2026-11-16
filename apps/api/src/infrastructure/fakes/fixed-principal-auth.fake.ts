import type { AuthPort, Credentials, Principal } from '../../application/ports/auth.port';
import { AuthFailed } from '../../domain/errors';

const FIXED_PRINCIPAL: Principal = {
  userId: '00000000-0000-4000-8000-000000000001',
  username: 'fake-leader',
  displayName: 'Fake Leader',
  role: 'LEADER',
  projectIds: [],
};

export class FixedPrincipalAuthFake implements AuthPort {
  private readonly revoked = new Set<string>();

  async authenticate(input: Credentials): Promise<Principal> {
    if (input.username.trim().length === 0 || input.password.length === 0) {
      throw new AuthFailed();
    }
    return { ...FIXED_PRINCIPAL, username: input.username };
  }

  async verifySession(token: string): Promise<Principal | null> {
    if (token.length === 0 || this.revoked.has(FIXED_PRINCIPAL.userId)) return null;
    return FIXED_PRINCIPAL;
  }

  async revokeAll(userId: string): Promise<void> {
    this.revoked.add(userId);
  }
}
