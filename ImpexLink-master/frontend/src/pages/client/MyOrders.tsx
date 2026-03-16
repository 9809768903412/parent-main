import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, FileText, Download, Eye, RotateCcw, Upload, Clock, CheckCircle, Truck, CreditCard } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import type { Order, OrderStatus, Project } from '@/types';
import { cn } from '@/lib/utils';
import { calcLineAmounts, calcTotalsFromItems, VAT_RATE } from '@/lib/vat';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/api/client';
import { getCache, setCache } from '@/hooks/cache';
import { Skeleton } from '@/components/ui/skeleton';
import { printHtml } from '@/utils/print';
import { useResource } from '@/hooks/use-resource';
import PaginationNav from '@/components/PaginationNav';

export default function MyOrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { orderId } = useParams();
  const [orders, setOrders] = useState<Order[]>(() => getCache<Order[]>('client-orders') || []);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize] = useState(10);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'my-orders' | 'company-orders'>('my-orders');
  const { data: projects } = useResource<Project[]>('/projects', []);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<'genuine' | 'fraud' | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [useTestVerification, setUseTestVerification] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter orders for current client's company
  const clientOrders = orders;
  const allCompanyOrders = orders;
  const projectStatusById = projects.reduce<Record<string, Project['status']>>((acc, project) => {
    acc[project.id] = project.status;
    return acc;
  }, {});
  const selectedTotals = selectedOrder
    ? calcTotalsFromItems(
        selectedOrder.items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }))
      )
    : null;
  const vatLabel = Math.round(VAT_RATE * 100);

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-warning text-warning-foreground gap-1"><Clock size={12} />Pending</Badge>;
      case 'approved':
        return <Badge className="bg-info text-info-foreground gap-1"><CheckCircle size={12} />Approved</Badge>;
      case 'processing':
        return <Badge className="bg-info text-info-foreground gap-1"><Package size={12} />Processing</Badge>;
      case 'shipped':
        return <Badge className="bg-secondary gap-1"><Truck size={12} />Shipped</Badge>;
      case 'delivered':
        return <Badge className="bg-success text-success-foreground gap-1"><CheckCircle size={12} />Delivered</Badge>;
      case 'cancelled':
        return <Badge className="bg-destructive text-destructive-foreground">Cancelled</Badge>;
    }
  };

  const getPaymentBadge = (status: Order['paymentStatus']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="border-warning text-warning">Unpaid</Badge>;
      case 'verified':
        return <Badge className="bg-success/10 text-success border-success/20" variant="outline">Verified</Badge>;
      case 'paid':
        return <Badge className="bg-success text-success-foreground gap-1"><CreditCard size={12} />Paid</Badge>;
      case 'failed':
        return <Badge className="bg-destructive text-destructive-foreground">Failed</Badge>;
    }
  };

  const getStatusProgress = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return 20;
      case 'approved': return 40;
      case 'processing': return 60;
      case 'shipped': return 80;
      case 'delivered': return 100;
      default: return 0;
    }
  };

  const handleRowClick = (order: Order) => {
    setSelectedOrder(order);
    setIsDetailOpen(true);
  };

  const handleReorder = (order: Order) => {
    toast({
      title: 'Items Added to Cart',
      description: `${order.items.length} items from ${order.orderNumber} added to your cart.`,
    });
    localStorage.setItem('reorder_cart', JSON.stringify(order.items));
    navigate('/client/order');
  };

  const handleUploadPayment = () => {
    setIsUploadOpen(true);
  };

  const simulateAIVerification = async (file?: File) => {
    if (!selectedOrder) return;
    setIsVerifying(true);
    setVerificationResult(null);
    setUploadError('');

    try {
      if (!file && !useTestVerification) {
        setUploadError('Please choose a proof of payment file.');
        toast({
          title: 'No file selected',
          description: 'Please choose a proof of payment file.',
          variant: 'destructive',
        });
        return;
      }
      const formData = new FormData();
      if (file) {
        formData.append('proof', file);
      }
      const res = await apiClient.post(`/orders/${selectedOrder.id}/payment-proof`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(useTestVerification ? { 'X-Test-Verification': 'true' } : {}),
        },
      });
      const paymentStatus = (res.data?.paymentStatus || selectedOrder.paymentStatus || '').toLowerCase();
      const chequeVerification = (res.data?.chequeVerification || selectedOrder.chequeVerification || '').toLowerCase();
      const updatedOrder = {
        ...selectedOrder,
        paymentStatus: paymentStatus || selectedOrder.paymentStatus,
        chequeVerification: chequeVerification || selectedOrder.chequeVerification,
        chequeImage: res.data?.paymentProofUrl || selectedOrder.chequeImage,
      } as Order;
      setVerificationResult(chequeVerification === 'genuine' ? 'genuine' : 'pending');
      setSelectedOrder(updatedOrder);
      setOrders((prev) => prev.map((o) => (o.id === selectedOrder.id ? updatedOrder : o)));
      setCache(
        'client-orders',
        (getCache<Order[]>('client-orders') || []).map((o) =>
          o.id === selectedOrder.id ? updatedOrder : o
        )
      );
      toast({
        title: useTestVerification ? 'Payment Verified (Test)' : 'Payment Proof Received',
        description: useTestVerification
          ? 'Your payment has been verified successfully.'
          : 'Your payment proof was received and is pending verification.',
      });
      refreshOrders();
    } catch (err) {
      const status = (err as any)?.response?.status;
      if (status === 501) {
        toast({
          title: 'Proof uploaded',
          description: 'Verification is pending manual review.',
        });
        refreshOrders();
      } else {
        setVerificationResult(null);
        toast({
          title: 'Verification Failed',
          description: 'Please try again or contact support.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDownloadInvoice = (order: Order) => {
    const totals = calcTotalsFromItems(
      order.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice }))
    );
    const vatLabel = Math.round(VAT_RATE * 100);
    const itemsHtml = order.items
      .map(
        (item) => {
          const line = calcLineAmounts(item.quantity, item.unitPrice);
          return `<tr><td>${item.itemName}</td><td>${item.unit}</td><td>${item.quantity}</td><td>₱${item.unitPrice.toFixed(2)}</td><td>₱${line.net.toFixed(2)}</td></tr>`;
        }
      )
      .join('');
    printHtml(
      `Invoice ${order.orderNumber}`,
      `<h1>Client Invoice</h1>
      <div class=\"meta meta-inline\"><span class=\"doc-label\">Invoice #:</span><span class=\"doc-code\">${order.orderNumber}</span></div>
      <div class=\"meta\">Client: ${order.clientName}</div>
      <div class=\"meta\">Status: ${order.status}</div>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class=\"total\">VATable Sales: ₱${totals.net.toFixed(2)}</div>
      <div class=\"total\">VAT (${vatLabel}%): ₱${totals.vat.toFixed(2)}</div>
      <div class=\"total\">Total Amount Due: ₱${totals.total.toFixed(2)}</div>`
    );
  };

  const handleDownloadDR = (order: Order) => {
    const itemsHtml = order.items
      .map(
        (item) =>
          `<tr><td>${item.itemName}</td><td>${item.unit}</td><td>${item.quantity}</td></tr>`
      )
      .join('');
    printHtml(
      `Delivery Receipt ${order.orderNumber}`,
      `<h1>Delivery Receipt</h1>
      <div class=\"meta meta-inline\"><span class=\"doc-label\">DR #:</span><span class=\"doc-code\">${order.orderNumber}</span></div>
      <div class=\"meta\">Client: ${order.clientName}</div>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>`
    );
  };

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page: ordersPage,
        pageSize: ordersPageSize,
      };
      if (activeTab === 'my-orders' && user?.id) {
        params.createdBy = Number(user.id);
      }
      const response = await apiClient.get('/orders', { params });
      const payload = response.data;
      if (payload?.data) {
        setOrders(payload.data);
        setOrdersTotal(payload.total || payload.data.length);
        setCache('client-orders', payload.data);
      } else {
        setOrders(payload);
        setOrdersTotal(payload.length || 0);
        setCache('client-orders', payload);
      }
    } catch (err) {
      setOrders([]);
      setOrdersTotal(0);
    } finally {
      setOrdersLoading(false);
    }
  }, [activeTab, ordersPage, ordersPageSize, user?.id, user?.clientId]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    if (!orderId || orders.length === 0) return;
    const found = orders.find((o) => o.id === orderId);
    if (found) {
      setSelectedOrder(found);
      setIsDetailOpen(true);
    }
  }, [orderId, orders]);

  const OrderTable = ({ data }: { data: Order[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order #</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Project</TableHead>
          <TableHead className="text-center">Items</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordersLoading && data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/2 mx-auto" />
                <Skeleton className="h-4 w-1/3 mx-auto" />
              </div>
            </TableCell>
          </TableRow>
        ) : data.length > 0 ? (
          data.map((order) => (
            <TableRow
              key={order.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleRowClick(order)}
            >
              <TableCell className="font-medium">{order.orderNumber}</TableCell>
              <TableCell>{new Date(order.createdAt).toLocaleDateString('en-PH')}</TableCell>
              <TableCell className="max-w-[180px]">
                <div className="flex items-center gap-2">
                  <span className="truncate">{order.projectName || '-'}</span>
                  {order.projectId && projectStatusById[order.projectId] && (
                    <Badge className="bg-muted text-foreground capitalize">
                      {projectStatusById[order.projectId]}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">{order.items.length}</TableCell>
              <TableCell className="text-right font-medium">
                ₱{order.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell>{getStatusBadge(order.status)}</TableCell>
              <TableCell>{getPaymentBadge(order.paymentStatus)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRowClick(order);
                  }}
                >
                  <Eye size={16} className="mr-1" />
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
              No orders found
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My Orders</h1>
          <p className="text-muted-foreground">Track and manage your orders</p>
        </div>
        <Button onClick={() => navigate('/client/order')} className="gap-2">
          <Package size={18} />
          Place New Order
        </Button>
      </div>

      {/* Summary Card */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{clientOrders.length}</p>
              <p className="text-sm text-muted-foreground">Total Orders</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-warning">
                {clientOrders.filter((o) => o.status === 'pending').length}
              </p>
              <p className="text-sm text-muted-foreground">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-info">
                {clientOrders.filter((o) => o.status === 'shipped' || o.status === 'processing').length}
              </p>
              <p className="text-sm text-muted-foreground">In Progress</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success">
                {clientOrders.filter((o) => o.status === 'delivered').length}
              </p>
              <p className="text-sm text-muted-foreground">Delivered</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value as typeof activeTab);
        setOrdersPage(1);
      }} className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-orders">My Orders</TabsTrigger>
          <TabsTrigger value="company-orders">All Company Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="my-orders">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Orders</CardTitle>
              <CardDescription>Orders you've personally placed</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <OrderTable data={clientOrders} />
            </CardContent>
          </Card>
        <div className="flex items-center justify-center">
          <PaginationNav
            page={ordersPage}
            totalPages={Math.max(Math.ceil(ordersTotal / ordersPageSize), 1)}
            onPageChange={setOrdersPage}
            disabled={ordersLoading}
          />
        </div>
        </TabsContent>

        <TabsContent value="company-orders">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Company-Wide Orders</CardTitle>
              <CardDescription>All orders from {user?.companyName || 'your company'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <OrderTable data={allCompanyOrders} />
            </CardContent>
          </Card>
        <div className="flex items-center justify-center">
          <PaginationNav
            page={ordersPage}
            totalPages={Math.max(Math.ceil(ordersTotal / ordersPageSize), 1)}
            onPageChange={setOrdersPage}
            disabled={ordersLoading}
          />
        </div>
        </TabsContent>

      </Tabs>

      {/* Order Detail Modal */}
      <Dialog
        open={isDetailOpen}
        onOpenChange={(open) => {
          setIsDetailOpen(open);
          if (!open && orderId) {
            navigate('/client/orders');
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader className="pr-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DialogTitle className="text-2xl">
                {selectedOrder?.orderNumber}
              </DialogTitle>
              {selectedOrder && getStatusBadge(selectedOrder.status)}
            </div>
            <DialogDescription>
              Placed on {selectedOrder && new Date(selectedOrder.createdAt).toLocaleDateString('en-PH')}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Project: {selectedOrder.projectName || 'No project assigned'}
                  </span>
                  {selectedOrder.projectId && projectStatusById[selectedOrder.projectId] && (
                    <Badge className="bg-muted text-foreground capitalize">
                      {projectStatusById[selectedOrder.projectId]}
                    </Badge>
                  )}
                </div>
                {/* Status Progress */}
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">Order Progress</span>
                  </div>
                  <div className="relative">
                    <div className="h-2 w-full rounded-full bg-muted" />
                    <div
                      className={cn(
                        'absolute left-0 top-0 h-2 rounded-full transition-all',
                        selectedOrder.status === 'pending' && 'bg-warning w-[25%]',
                        selectedOrder.status === 'approved' && 'bg-info w-[35%]',
                        selectedOrder.status === 'processing' && 'bg-info w-[50%]',
                        selectedOrder.status === 'shipped' && 'bg-secondary w-[75%]',
                        selectedOrder.status === 'delivered' && 'bg-success w-full'
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-4 text-xs text-muted-foreground">
                    <span className={selectedOrder.status === 'pending' ? 'font-medium text-foreground' : ''}>Pending</span>
                    <span className={selectedOrder.status === 'processing' ? 'font-medium text-foreground' : ''}>Processing</span>
                    <span className={selectedOrder.status === 'shipped' ? 'font-medium text-foreground' : ''}>Shipped</span>
                    <span className={selectedOrder.status === 'delivered' ? 'font-medium text-foreground' : ''}>Delivered</span>
                  </div>
                </div>

                {/* Order Items */}
                <div>
                  <h4 className="font-semibold mb-3">Order Items</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.items.map((item, idx) => {
                        const line = calcLineAmounts(item.quantity, item.unitPrice);
                        return (
                          <TableRow key={idx}>
                            <TableCell>{item.itemName}</TableCell>
                            <TableCell className="text-right">{item.quantity} {item.unit}</TableCell>
                            <TableCell className="text-right">
                              ₱{item.unitPrice.toLocaleString('en-PH')}
                            </TableCell>
                            <TableCell className="text-right">
                              ₱{line.net.toLocaleString('en-PH')}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals */}
                <div className="space-y-2 text-sm">
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VATable Sales</span>
                    <span>₱{selectedTotals?.net.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT ({vatLabel}%)</span>
                    <span>₱{selectedTotals?.vat.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total Amount Due</span>
                    <span>₱{selectedTotals?.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                {selectedOrder.status === 'cancelled' && (
                  <div className="p-3 bg-destructive/10 rounded-lg text-sm text-destructive">
                    Cancelled: {selectedOrder.cancelReason || 'No reason provided'}
                  </div>
                )}

                {/* Payment Section */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                  {(selectedOrder.paymentStatus === 'verified' || selectedOrder.paymentStatus === 'paid') ? (
                    <div className="text-sm text-muted-foreground">
                      Payment completed.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Payment Status</span>
                        {getPaymentBadge(selectedOrder.paymentStatus)}
                      </div>
                      {selectedOrder.paymentStatus === 'pending' && selectedOrder.status !== 'cancelled' && (
                        <Button onClick={handleUploadPayment} className="w-full gap-2">
                          <Upload size={18} />
                          Upload Payment (Cheque)
                        </Button>
                      )}
                    </>
                  )}
                  {selectedOrder.chequeVerification === 'genuine' && (
                    <div className="p-3 bg-success/10 rounded-lg text-sm text-success">
                      Cheque verified as genuine
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => handleDownloadInvoice(selectedOrder!)} className="gap-2">
              <Download size={16} />
              Download Invoice
            </Button>
            <Button variant="outline" onClick={() => handleDownloadDR(selectedOrder!)} className="gap-2">
              <FileText size={16} />
              Download DR
            </Button>
            {selectedOrder?.status !== 'cancelled' && (
              <Button onClick={() => handleReorder(selectedOrder!)} className="gap-2">
                <RotateCcw size={16} />
                Reorder
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Upload Modal */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload size={20} />
              Upload Payment Proof
            </DialogTitle>
            <DialogDescription>
              Upload an image of your cheque for AI verification
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!isVerifying && verificationResult === null && (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload size={40} className="mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  Drag and drop your cheque image, or click to browse
                </p>
                <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-3">
                  <input
                    type="checkbox"
                    checked={useTestVerification}
                    onChange={(e) => {
                      setUseTestVerification(e.target.checked);
                      if (uploadError) setUploadError('');
                    }}
                  />
                  Use test verification (skip upload)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setSelectedFileName(file.name);
                      if (uploadError) setUploadError('');
                      simulateAIVerification(file);
                    }
                  }}
                />
                <Button onClick={() => (useTestVerification ? simulateAIVerification() : fileInputRef.current?.click())}>
                  Select Image
                </Button>
                {selectedFileName && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected: {selectedFileName}
                  </p>
                )}
                {uploadError && (
                  <p className="mt-2 text-xs text-destructive">{uploadError}</p>
                )}
              </div>
            )}

            {isVerifying && (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="font-medium">AI Verifying...</p>
                <p className="text-sm text-muted-foreground">Analyzing cheque authenticity</p>
              </div>
            )}

            {verificationResult && (
              <div
                className={cn(
                  'p-6 rounded-lg text-center',
                  verificationResult === 'genuine' ? 'bg-success/10' : 'bg-destructive/10'
                )}
              >
                <div
                  className={cn(
                    'h-16 w-16 rounded-full mx-auto mb-4 flex items-center justify-center',
                    verificationResult === 'genuine' ? 'bg-success' : 'bg-destructive'
                  )}
                >
                  {verificationResult === 'genuine' ? (
                    <CheckCircle size={32} className="text-white" />
                  ) : (
                    <span className="text-3xl text-white">!</span>
                  )}
                </div>
                <p className={cn('text-lg font-bold', verificationResult === 'genuine' ? 'text-success' : 'text-destructive')}>
                  {verificationResult === 'genuine' ? 'Cheque Verified' : 'Potential Fraud Detected'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {verificationResult === 'genuine'
                    ? 'Your payment has been verified and processed.'
                    : 'Please contact support for manual verification.'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsUploadOpen(false);
              setVerificationResult(null);
            }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
