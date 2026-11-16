export type RoleCode = 'LEADER' | 'DEPUTY_LEADER' | 'MEMBER';

export interface Credentials {
  username: string;
  password: string;
}

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  role: RoleCode;
  projectIds: string[];
}

export interface AuthPort {
  authenticate(input: Credentials): Promise<Principal>;
  verifySession(token: string): Promise<Principal | null>;
  revokeAll(userId: string): Promise<void>;
}
