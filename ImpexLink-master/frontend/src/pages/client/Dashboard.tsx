import { ShoppingCart, Package, Truck, RotateCcw, TrendingUp, AlertCircle, CreditCard, FolderKanban, Bell, FileText, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useResource } from '@/hooks/use-resource';
import { apiClient } from '@/api/client';
import type { Order, Delivery, InventoryItem, Project } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ClientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const { data: deliveries } = useResource<Delivery[]>('/deliveries', []);
  const { data: inventory } = useResource<InventoryItem[]>('/inventory', []);
  const { data: projects, reload: reloadProjects } = useResource<Project[]>('/projects', []);
  const { data: notificationsRaw } = useResource<any>(
    '/notifications',
    [],
    [user?.id],
    15_000,
    { viewer: user?.id ?? 'anonymous' }
  );
  const notifications = Array.isArray(notificationsRaw)
    ? notificationsRaw
    : Array.isArray(notificationsRaw?.data)
      ? notificationsRaw.data
      : [];
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitProject, setResubmitProject] = useState<Project | null>(null);
  const [resubmitName, setResubmitName] = useState('');
  const [resubmitError, setResubmitError] = useState('');

  useEffect(() => {
    if (!user) return;
    apiClient
      .get('/orders', {
        params: {},
      })
      .then((res) => {
        const payload = res.data;
        setOrders(payload?.data || payload || []);
      })
      .catch(() => setOrders([]));
  }, [user?.clientId, user?.id]);

  const clientOrders = user
    ? orders.filter(
        (o) => (user.clientId && o.clientId === user.clientId) || o.createdBy === user.id
      )
    : [];
  const totalSpend = clientOrders.reduce((acc, o) => acc + o.total, 0);
  const scopedDeliveries = user
    ? deliveries.filter(
        (d) => (user.clientId && d.clientId === user.clientId) || d.clientId === null
      )
    : [];
  const upcomingDeliveries = scopedDeliveries.filter(
    (d) => d.status === 'pending' || d.status === 'in-transit'
  );
  const recentDeliveries = scopedDeliveries.slice(0, 3);
  const inTransitDeliveries = scopedDeliveries.filter(
    (d) => d.status === 'in-transit'
  );
  const returnPending = scopedDeliveries.filter((d) => d.status === 'return-pending');
  const returnRejected = scopedDeliveries.filter((d) => d.status === 'return-rejected');
  const returnApproved = scopedDeliveries.filter((d) => d.status === 'returned');
  const pendingApprovals = clientOrders.filter((o) => o.status === 'pending');
  const unpaidOrders = clientOrders.filter((o) => o.paymentStatus === 'pending' || o.paymentStatus === 'verified');

  const frequentItems = inventory.slice(0, 6);
  const recentOrders = clientOrders.slice(0, 5);

  const now = new Date();
  const startCurrent = new Date(now);
  startCurrent.setDate(startCurrent.getDate() - 30);
  const startPrevious = new Date(startCurrent);
  startPrevious.setDate(startPrevious.getDate() - 30);

  const ordersCurrent = clientOrders.filter((o) => new Date(o.createdAt) >= startCurrent);
  const ordersPrevious = clientOrders.filter(
    (o) => new Date(o.createdAt) >= startPrevious && new Date(o.createdAt) < startCurrent
  );
  const spendCurrent = ordersCurrent.reduce((sum, o) => sum + o.total, 0);
  const spendPrevious = ordersPrevious.reduce((sum, o) => sum + o.total, 0);
  const ordersDelta = ordersCurrent.length - ordersPrevious.length;
  const spendDelta = spendCurrent - spendPrevious;
  const ordersPercent = ordersPrevious.length === 0 ? null : Math.round((ordersDelta / ordersPrevious.length) * 1000) / 10;
  const spendPercent = spendPrevious === 0 ? null : Math.round((spendDelta / spendPrevious) * 1000) / 10;

  const handleQuickReorder = () => {
    if (recentOrders.length === 0) return;
    const last = recentOrders[0];
    if (last.status === 'cancelled') return;
    try {
      localStorage.setItem('reorder_cart', JSON.stringify(last.items));
    } catch {
      // ignore
    }
    navigate('/client/order');
  };

  const openResubmit = (project: Project) => {
    setResubmitProject(project);
    setResubmitName(project.name);
    setResubmitError('');
    setResubmitOpen(true);
  };

  const handleResubmit = async () => {
    if (!resubmitProject) return;
    if (!resubmitName.trim()) {
      setResubmitError('Project name is required.');
      return;
    }
    try {
      await apiClient.post(`/projects/${resubmitProject.id}/resubmit`, {
        name: resubmitName.trim(),
      });
      setResubmitOpen(false);
      setResubmitProject(null);
      setResubmitName('');
      setResubmitError('');
      reloadProjects();
    } catch (err) {
      setResubmitError('Unable to resubmit. Please try again.');
    }
  };

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Welcome back, {user?.companyName || user?.name}!</h1>
            <p className="text-muted-foreground">Your account at a glance.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/client/order')}>
              <ShoppingCart size={16} className="mr-2" />
              Place Order
            </Button>
            <Button variant="outline" onClick={() => navigate('/client/payments')}>
              <CreditCard size={16} className="mr-2" />
              Upload Payment
            </Button>
            <Button onClick={handleQuickReorder} className="gap-2">
              <RotateCcw size={16} />
              Quick Reorder
            </Button>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Active Projects</p>
              <p className="text-2xl font-bold">{projects.filter((p) => p.status === 'active').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Pending Orders</p>
              <p className="text-2xl font-bold">{pendingApprovals.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">In Transit</p>
              <p className="text-2xl font-bold">{inTransitDeliveries.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Outstanding Balance</p>
              <p className="text-2xl font-bold">
                ₱{unpaidOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Orders</CardTitle>
                <CardDescription>Track your latest transactions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  recentOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between border rounded-md p-3">
                      <div>
                        <p className="font-medium">{order.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.projectName || 'No project'} • {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">₱{order.total.toLocaleString()}</p>
                        <Badge className="mt-1 capitalize">{order.status}</Badge>
                      </div>
                    </div>
                  ))
                )}
                <Button variant="ghost" className="w-full" onClick={() => navigate('/client/orders')}>
                  View all orders <ArrowRight size={14} className="ml-2" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Deliveries Tracker</CardTitle>
                <CardDescription>Latest delivery updates</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentDeliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deliveries yet.</p>
                ) : (
                  recentDeliveries.map((delivery) => (
                    <div key={delivery.id} className="flex items-center justify-between border rounded-md p-3">
                      <div>
                        <p className="font-medium">{delivery.drNumber}</p>
                        <p className="text-xs text-muted-foreground">{delivery.clientName}</p>
                      </div>
                      <Badge className="capitalize">{delivery.status.replace(/-/g, ' ')}</Badge>
                    </div>
                  ))
                )}
                <Button variant="ghost" className="w-full" onClick={() => navigate('/client/deliveries')}>
                  View all deliveries <ArrowRight size={14} className="ml-2" />
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><FolderKanban size={18} /> Projects</CardTitle>
                <CardDescription>View your project approvals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {projects.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">No projects yet.</p>
                    <Button size="sm" onClick={() => navigate('/client/order?requestProject=1')}>
                      Request Project
                    </Button>
                  </div>
                ) : (
                  projects.slice(0, 4).map((project) => (
                    <div key={project.id} className="flex items-center justify-between border rounded-md p-3">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{project.status}</p>
                      </div>
                      {project.status === 'rejected' && (
                        <Button size="sm" variant="outline" onClick={() => openResubmit(project)}>
                          Resubmit
                        </Button>
                      )}
                    </div>
                  ))
                )}
                {projects.length > 0 && (
                  <Button variant="outline" className="w-full" onClick={() => navigate('/client/projects')}>
                    View all projects
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Bell size={18} /> Notifications</CardTitle>
                <CardDescription>{notifications.filter((n: any) => !n.read).length} unread</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => navigate('/client/notifications')}>
                  View notifications
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><FileText size={18} /> Spend (30 days)</CardTitle>
                <CardDescription>Orders & spending trend</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Orders</span>
                  <span className="font-medium">{ordersCurrent.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Spend</span>
                  <span className="font-medium">₱{spendCurrent.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp size={14} />
                  {ordersPercent === null ? 'New activity' : `${ordersPercent}% vs prior period`}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Items</CardTitle>
                <CardDescription>Quick reorder picks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {frequentItems.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{item.name}</span>
                    <span className="font-medium">₱{item.unitPrice.toLocaleString('en-PH')}</span>
                  </div>
                ))}
                <Button className="w-full mt-2" onClick={() => navigate('/client/order')}>
                  <ShoppingCart size={16} className="mr-2" />
                  Start Shopping
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={resubmitOpen} onOpenChange={setResubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resubmit Project</DialogTitle>
            <DialogDescription>Update the project name if needed and resubmit for approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Project Name</Label>
            <Input
              value={resubmitName}
              onChange={(e) => {
                setResubmitName(e.target.value);
                if (resubmitError) setResubmitError('');
              }}
            />
            {resubmitError && <p className="text-xs text-destructive">{resubmitError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResubmitOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResubmit}>Resubmit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
