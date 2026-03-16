import { ReactNode, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  FolderKanban,
  Bell,
  User,
  LogOut,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResource } from '@/hooks/use-resource';
import type { Notification } from '@/types';

interface ClientLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/client', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/client/order', icon: ShoppingCart, label: 'Place Order' },
  { path: '/client/orders', icon: Package, label: 'My Orders' },
  { path: '/client/deliveries', icon: Truck, label: 'My Deliveries' },
  { path: '/client/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/client/notifications', icon: Bell, label: 'Notifications' },
];

export default function ClientLayout({ children }: ClientLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const { data: notificationsRaw } = useResource<any>(
    '/notifications',
    [],
    [user?.id],
    15_000,
    { viewer: user?.id ?? 'anonymous' }
  );
  const notifications: Notification[] = Array.isArray(notificationsRaw)
    ? notificationsRaw
    : Array.isArray(notificationsRaw?.data)
      ? notificationsRaw.data
      : [];
  const { data: companyInfo } = useResource('/company', {
    name: 'Impex Engineering and Industrial Supply',
    address: '6959 Washington St., Pio Del Pilar, Makati City',
    tin: '100-191-563-00000',
    phone: '+63 2 8123 4567',
    email: 'sales@impex.ph',
    website: 'www.impex.ph',
  });
  const unreadNotifications = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!companyInfo) return;
    try {
      localStorage.setItem('company_info', JSON.stringify(companyInfo));
    } catch {
      // ignore
    }
  }, [companyInfo]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Navigation */}
      <header className="h-16 bg-card border-b border-border sticky top-0 z-50">
        <div className="container mx-auto h-full flex items-center justify-between px-4">
          {/* Logo */}
          <Logo size="md" />

          {/* Desktop Navigation */}
          <nav className="hidden xl:flex items-center gap-2 flex-wrap">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.label === 'Notifications' && unreadNotifications > 0 && (
                  <Badge className="ml-1 bg-secondary text-secondary-foreground text-xs px-1.5 py-0">
                    {unreadNotifications}
                  </Badge>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Right side - User & Mobile menu */}
          <div className="flex items-center gap-2">
            {/* User dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2">
                  <Avatar className="h-8 w-8">
                    {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name || 'User'} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {user?.avatar || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="text-xs text-muted-foreground">{user?.companyName}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div>
                    <p className="font-medium">{user?.name}</p>
                    <p className="text-xs text-muted-foreground">{user?.companyName}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <NavLink to="/client/profile">
                    <User size={16} className="mr-2" />
                    Profile
                  </NavLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut size={16} className="mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="xl:hidden">
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <div className="flex flex-col gap-4 mt-8">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.exact}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground/80 hover:bg-muted'
                        )
                      }
                    >
                      <item.icon size={20} />
                      <span>{item.label}</span>
                      {item.label === 'Notifications' && unreadNotifications > 0 && (
                        <Badge className="ml-auto">{unreadNotifications}</Badge>
                      )}
                    </NavLink>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <div className="container mx-auto p-4 lg:p-6">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-4">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© 2025 Impex Engineering and Industrial Supply. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
