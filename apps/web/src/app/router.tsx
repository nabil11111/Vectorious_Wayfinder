import { createBrowserRouter } from 'react-router';
import { AdminHome } from '@/features/admin/AdminHome';
import { HomeRedirect, RequireRole } from '@/features/auth/RequireRole';
import { LoginPage } from '@/features/auth/LoginPage';
import { DispatcherHome } from '@/features/dispatcher/DispatcherHome';
import { DriverHome } from '@/features/driver/DriverHome';
import { LoaderHome } from '@/features/loader/LoaderHome';
import { StoreHome } from '@/features/store/StoreHome';

// One route group per role. Add a role's new screens inside its group so the role check covers them.
export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { element: <RequireRole roles={['store_manager']} />, children: [{ path: '/store/*', element: <StoreHome /> }] },
  { element: <RequireRole roles={['dispatcher']} />, children: [{ path: '/dispatcher/*', element: <DispatcherHome /> }] },
  { element: <RequireRole roles={['loader']} />, children: [{ path: '/loader/*', element: <LoaderHome /> }] },
  { element: <RequireRole roles={['driver']} />, children: [{ path: '/driver/*', element: <DriverHome /> }] },
  { element: <RequireRole roles={['admin']} />, children: [{ path: '/admin/*', element: <AdminHome /> }] },
  { path: '*', element: <HomeRedirect /> },
]);
