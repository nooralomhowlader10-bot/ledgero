import { useApp } from '../../context/AppContext';
import { USER_ROLES, STAFF_RESTRICTIONS } from '../../data/constants';

export default function RoleGuard({ role, children, fallback = null, hide = true }) {
  const { state } = useApp();
  const userRole = state.userRole || USER_ROLES.OWNER;
  
  if (userRole === USER_ROLES.OWNER) return children;
  if (role === 'staff' || role === userRole) return children;
  
  return hide ? null : fallback;
}

export function useIsOwner() {
  const { state } = useApp();
  return (state.userRole || USER_ROLES.OWNER) === USER_ROLES.OWNER;
}

export function useCanPerform(action) {
  const { state } = useApp();
  const userRole = state.userRole || USER_ROLES.OWNER;
  if (userRole === USER_ROLES.OWNER) return true;
  return !STAFF_RESTRICTIONS.blockedActions.includes(action);
}
