// The signed-in user that the mocked auth() returns in integration tests.
export const session: { current: Record<string, unknown> | null } = { current: null };

export const mockAuth = async () => (session.current ? { user: session.current } : null);
