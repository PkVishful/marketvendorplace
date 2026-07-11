import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Session } from '@/types/domain';
import { PermissionGate } from './PermissionGate';

// Drive the gate by mocking the session hook it reads.
let session: Session;
vi.mock('@/auth/useSession', () => ({
  useSession: () => ({ data: session }),
}));

function withPerms(permissions: string[]): Session {
  return { authenticated: true, permissions };
}

afterEach(cleanup);

describe('PermissionGate', () => {
  it('renders children when the permission is held', () => {
    session = withPerms(['vendor.approve']);
    render(<PermissionGate perm="vendor.approve">approve UI</PermissionGate>);
    expect(screen.getByText('approve UI')).toBeInTheDocument();
  });

  it('renders the fallback when the permission is not held', () => {
    session = withPerms(['order.read']);
    render(
      <PermissionGate perm="vendor.approve" fallback={<span>denied</span>}>
        approve UI
      </PermissionGate>,
    );
    expect(screen.queryByText('approve UI')).not.toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('supports any-of array semantics', () => {
    session = withPerms(['order.read']);
    render(
      <PermissionGate perm={['order.float', 'order.read']}>orders UI</PermissionGate>,
    );
    expect(screen.getByText('orders UI')).toBeInTheDocument();
  });

  it('renders nothing by default when denied', () => {
    session = withPerms([]);
    const { container } = render(
      <PermissionGate perm="vendor.approve">approve UI</PermissionGate>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
