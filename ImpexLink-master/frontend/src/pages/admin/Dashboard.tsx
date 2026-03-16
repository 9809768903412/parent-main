import { Package, AlertTriangle, FolderKanban, ClipboardList, Truck, TrendingUp, TrendingDown, ShoppingCart } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useResource } from '@/hooks/use-resource';
import type { InventoryItem, StockTransaction, Delivery } from '@/types';
import { cn } from '@/lib/utils';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useNavigate } from 'react-router-dom';

type DashboardStats = {
  totalItems: number;
  lowStockCount: number;
  activeProjects: number;
  pendingRequests: number;
  ongoingDeliveries: number;
  totalItemsDelta: number;
  totalItemsPercent: number | null;
  lowStockDelta: number;
  lowStockPercent: number | null;
  activeProjectsDelta: number;
  activeProjectsPercent: number | null;
  pendingRequestsDelta: number;
  pendingRequestsPercent: number | null;
  ongoingDeliveriesDelta: number;
  ongoingDeliveriesPercent: number | null;
  rangeDays: number;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { data: inventory, lastUpdated } = useResource<InventoryItem[]>('/inventory', []);
  const { data: transactions } = useResource<StockTransaction[]>('/transactions', []);
  const { data: deliveries } = useResource<Delivery[]>('/deliveries', []);
  const { data: stats } = useResource<DashboardStats>('/dashboard/stats', {
    totalItems: 0,
    lowStockCount: 0,
    activeProjects: 0,
    pendingRequests: 0,
    ongoingDeliveries: 0,
    totalItemsDelta: 0,
    totalItemsPercent: 0,
    lowStockDelta: 0,
    lowStockPercent: 0,
    activeProjectsDelta: 0,
    activeProjectsPercent: 0,
    pendingRequestsDelta: 0,
    pendingRequestsPercent: 0,
    ongoingDeliveriesDelta: 0,
    ongoingDeliveriesPercent: 0,
    rangeDays: 30,
  });
  const totalItems = stats.totalItems || inventory.reduce((acc, item) => acc + item.qtyOnHand, 0);
  const lowStockItemsCount =
    stats.lowStockCount ||
    inventory.filter((item) => item.status === 'low-stock' || item.status === 'out-of-stock').length;
  const lowStockItems = inventory
    .filter((item) => item.qtyOnHand <= item.minStock)
    .sort((a, b) => {
      const aRatio = a.minStock ? a.qtyOnHand / a.minStock : 1;
      const bRatio = b.minStock ? b.qtyOnHand / b.minStock : 1;
      return aRatio - bRatio;
    })
    .slice(0, 10);
  const lowStockValue = lowStockItems.reduce((sum, item) => sum + item.qtyOnHand * item.unitPrice, 0);
  const outOfStockCount = inventory.filter((item) => item.qtyOnHand === 0).length;
  const criticalCount = inventory.filter((item) => item.minStock > 0 && item.qtyOnHand <= Math.floor(item.minStock * 0.2)).length;

  const now = new Date();
  const last30 = new Date(now);
  last30.setDate(now.getDate() - 30);
  const usageByItem = new Map<string, number>();
  transactions.forEach((txn) => {
    if (!txn.itemId) return;
    const date = new Date(txn.date);
    if (Number.isNaN(date.getTime()) || date < last30) return;
    if (txn.type !== 'issue') return;
    const prev = usageByItem.get(txn.itemId) || 0;
    usageByItem.set(txn.itemId, prev + Math.abs(txn.qtyChange));
  });

  const movers = inventory.map((item) => ({
    item,
    usage: usageByItem.get(item.id) || 0,
  }));
  const fastMovers = [...movers].sort((a, b) => b.usage - a.usage).slice(0, 5);
  const slowMovers = [...movers].sort((a, b) => a.usage - b.usage).slice(0, 5);

  const overdueDeliveries = deliveries
    .filter((d) => (d.status === 'pending' || d.status === 'in-transit') && d.eta)
    .filter((d) => new Date(d.eta) < now)
    .sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime())
    .slice(0, 5)
    .map((d) => ({
      ...d,
      daysLate: Math.max(0, Math.floor((now.getTime() - new Date(d.eta).getTime()) / (1000 * 60 * 60 * 24))),
    }));

  const etaSoon = deliveries.filter((d) => d.eta).filter((d) => {
    const eta = new Date(d.eta);
    const diff = (eta.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 2;
  });

  const returns = deliveries.filter((d) => d.status === 'returned');
  const returnReasons = returns
    .map((d) => d.notes || 'Unspecified reason')
    .reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
  const topReturnReasons = Object.entries(returnReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const handleAddToPO = (item: InventoryItem) => {
    try {
      const raw = localStorage.getItem('po_suggestions');
      const list = raw ? JSON.parse(raw) : [];
      const suggestedQty = Math.max(item.minStock * 2 - item.qtyOnHand, item.minStock);
      list.push({ itemId: item.id, itemName: item.name, suggestedQty });
      localStorage.setItem('po_suggestions', JSON.stringify(list));
      navigate('/admin/purchase-orders');
    } catch {
      navigate('/admin/purchase-orders');
    }
  };

  const handleCreatePO = () => {
    try {
      const items = lowStockItems.map((item) => ({
        itemId: item.id,
        itemName: item.name,
        suggestedQty: Math.max(item.minStock * 2 - item.qtyOnHand, item.minStock),
      }));
      localStorage.setItem('po_suggestions', JSON.stringify(items));
    } catch {
      // ignore
    }
    navigate('/admin/purchase-orders');
  };

  const statCards = [
    {
      title: 'Total Items',
      value: totalItems.toLocaleString(),
      icon: Package,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      delta: stats.totalItemsDelta,
      percent: stats.totalItemsPercent,
      showChange: stats.totalItemsPercent !== null && stats.totalItemsPercent !== 0,
    },
    {
      title: 'Low Stock Alerts',
      value: lowStockItemsCount.toString(),
      icon: AlertTriangle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
      delta: stats.lowStockDelta,
      percent: stats.lowStockPercent,
      showChange: stats.lowStockPercent !== null && stats.lowStockPercent !== 0,
    },
    {
      title: 'Active Projects',
      value: stats.activeProjects.toString(),
      icon: FolderKanban,
      color: 'text-info',
      bgColor: 'bg-info/10',
      delta: stats.activeProjectsDelta,
      percent: stats.activeProjectsPercent,
      showChange: stats.activeProjectsPercent !== null && stats.activeProjectsPercent !== 0,
    },
    {
      title: 'Pending Requests',
      value: stats.pendingRequests.toString(),
      icon: ClipboardList,
      color: 'text-secondary',
      bgColor: 'bg-secondary/10',
      delta: stats.pendingRequestsDelta,
      percent: stats.pendingRequestsPercent,
      showChange: stats.pendingRequestsPercent !== null && stats.pendingRequestsPercent !== 0,
    },
    {
      title: 'Ongoing Deliveries',
      value: stats.ongoingDeliveries.toString(),
      icon: Truck,
      color: 'text-success',
      bgColor: 'bg-success/10',
      delta: stats.ongoingDeliveriesDelta,
      percent: stats.ongoingDeliveriesPercent,
      showChange: stats.ongoingDeliveriesPercent !== null && stats.ongoingDeliveriesPercent !== 0,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {lastUpdated && (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(lastUpdated).toLocaleTimeString()}
        </p>
      )}
      {/* Stat Cards */}
      <TooltipProvider>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {statCards.map((stat) => (
          <Card key={stat.title} className="relative overflow-hidden rounded-lg shadow-md border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm text-muted-foreground cursor-help">{stat.title}</p>
                    </TooltipTrigger>
                    <TooltipContent>{`Comparison window: last ${stats.rangeDays} days`}</TooltipContent>
                  </UITooltip>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  {stat.showChange && (
                    <div className="flex items-center gap-1 mt-2">
                      {stat.delta >= 0 ? (
                        <TrendingUp size={14} className="text-success" />
                      ) : (
                        <TrendingDown size={14} className="text-destructive" />
                      )}
                      <span
                        className={cn(
                          'text-xs font-medium',
                          stat.delta >= 0 ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {stat.percent === null ? 'new' : `${stat.delta >= 0 ? '+' : ''}${stat.percent}%`}
                      </span>
                      <span className="text-xs text-muted-foreground">vs last {stats.rangeDays} days</span>
                    </div>
                  )}
                </div>
                <div className={cn('p-2 rounded-lg shadow-sm', stat.bgColor)}>
                  <stat.icon size={20} className={stat.color} />
                </div>
              </div>
            </CardContent>
          </Card>
          ))}
        </div>
      </TooltipProvider>

      {/* Inventory Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Low-Stock Risk</CardTitle>
            <CardDescription>Top items needing immediate action</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleCreatePO} className="gap-2 bg-red-500 hover:bg-red-600 hover:scale-[1.02] transition">
                <ShoppingCart size={14} />
                Create PO
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Suggested PO</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No low-stock items
                    </TableCell>
                  </TableRow>
                ) : (
                  lowStockItems.map((item) => {
                    const suggested = Math.max(item.minStock * 2 - item.qtyOnHand, item.minStock);
                    const ratio = item.minStock ? Math.min(1, item.qtyOnHand / item.minStock) : 1;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={14} className="text-orange-500" />
                            {item.name}
                          </div>
                          <div className="mt-2 h-2 w-full rounded-full bg-muted">
                            <div
                              className={cn('h-2 rounded-full', ratio < 0.2 ? 'bg-red-500' : ratio < 0.5 ? 'bg-orange-500' : 'bg-amber-500')}
                              style={{ width: `${Math.max(5, ratio * 100)}%` }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.qtyOnHand}</TableCell>
                        <TableCell className="text-right">{item.minStock}</TableCell>
                        <TableCell className="text-right">{suggested}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" className="hover:bg-red-50 hover:text-red-600" onClick={() => handleAddToPO(item)}>
                            Add to PO
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Value at Risk</CardTitle>
            <CardDescription>Critical inventory exposure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg border shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Low-stock value</p>
                <p className={cn('text-3xl font-bold', lowStockValue > 50000 ? 'text-red-600' : 'text-foreground')}>
                  ₱{lowStockValue.toLocaleString()}
                </p>
              </div>
              <Badge variant="outline">Value</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border shadow-sm">
                <p className="text-sm text-muted-foreground">Out of stock</p>
                <p className="text-xl font-bold">{outOfStockCount}</p>
              </div>
              <div className="p-3 rounded-lg border shadow-sm">
                <p className="text-sm text-muted-foreground">Critical SKUs</p>
                <p className="text-xl font-bold">{criticalCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Fast Movers (30 days)</CardTitle>
            <CardDescription>Most issued items</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Issued Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fastMovers.map((row) => (
                  <TableRow key={row.item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-green-600" />
                        {row.item.name}
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-green-500"
                          style={{ width: `${Math.min(100, row.usage * 5)}%` }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-700">{row.usage}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Slow Movers (30 days)</CardTitle>
            <CardDescription>Low turnover items</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Issued Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slowMovers.map((row) => (
                  <TableRow key={row.item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <TrendingDown size={14} className="text-amber-600" />
                        {row.item.name}
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-amber-500"
                          style={{ width: `${Math.min(100, Math.max(5, row.usage * 5))}%` }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-amber-700">{row.usage}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Overdue Deliveries</CardTitle>
            <CardDescription>Action needed</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DR #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Days Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueDeliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No overdue deliveries
                    </TableCell>
                  </TableRow>
                ) : (
                  overdueDeliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium text-red-700">{d.drNumber}</TableCell>
                      <TableCell>{d.clientName}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600">{d.daysLate}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">ETA Today + Tomorrow</CardTitle>
            <CardDescription>Incoming deliveries</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DR #</TableHead>
                  <TableHead>ETA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {etaSoon.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                      No upcoming deliveries
                    </TableCell>
                  </TableRow>
                ) : (
                  etaSoon.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.drNumber}</TableCell>
                      <TableCell>{d.eta ? new Date(d.eta).toLocaleDateString('en-PH') : '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-md border">
          <CardHeader>
            <CardTitle className="text-lg">Return / Incident Alerts</CardTitle>
            <CardDescription>Recent returns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg border">
              <p className="text-sm text-muted-foreground">Returns</p>
              <p className="text-2xl font-bold">{returns.length}</p>
            </div>
            <div className="space-y-2">
              {topReturnReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No return reasons logged</p>
              ) : (
                topReturnReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{reason}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
