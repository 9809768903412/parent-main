import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Truck, Package, CheckCircle, Clock, MapPin, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { Delivery, DeliveryStatus, Client } from '@/types';
import { useResource } from '@/hooks/use-resource';
import { apiClient } from '@/api/client';
import { toast } from '@/hooks/use-toast';
import { printHtml } from '@/utils/print';

const statusColors: Record<DeliveryStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  'in-transit': 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  'return-pending': 'bg-orange-100 text-orange-800',
  'return-rejected': 'bg-slate-100 text-slate-700',
  returned: 'bg-red-100 text-red-800',
};

const statusIcons: Record<DeliveryStatus, React.ReactNode> = {
  pending: <Clock size={16} />,
  'in-transit': <Truck size={16} />,
  delivered: <CheckCircle size={16} />,
  'return-pending': <Package size={16} />,
  'return-rejected': <Package size={16} />,
  returned: <Package size={16} />,
};

const formatStatus = (status: DeliveryStatus) => status.replace('-', ' ');

// TODO: Replace with real data 
export default function TrackDeliveryPage() {
  const { user } = useAuth();
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [receivedBy, setReceivedBy] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const { data: clients } = useResource<Client[]>('/clients', []);
  const { data: deliveries } = useResource<Delivery[]>('/deliveries', []);
  const { data: company } = useResource('/company', {
    name: 'Impex Engineering and Industrial Supply',
    address: '6959 Washington St., Pio Del Pilar, Makati City',
    tin: '100-191-563-00000',
    phone: '+63 2 8123 4567',
    email: 'sales@impex.ph',
    website: 'www.impex.ph',
  });

  // Get client's company
  const client = clients.find((c) => c.id === user?.clientId);
  
  // Filter deliveries for this client
  const clientDeliveries = deliveries.filter((d) => d.clientId === client?.id);

  const activeDeliveries = clientDeliveries.filter(
    (d) => d.status === 'in-transit' || d.status === 'pending'
  );
  const completedDeliveries = clientDeliveries.filter(
    (d) => d.status === 'delivered' || d.status === 'return-pending' || d.status === 'return-rejected' || d.status === 'returned'
  );

  const handlePrintDelivery = (delivery: Delivery) => {
    const itemsHtml = delivery.items
      .map(
        (item) =>
          `<tr><td>${item.itemName}</td><td>${item.unit}</td><td>${item.quantity}</td></tr>`
      )
      .join('');
    printHtml(
      `Delivery Receipt ${delivery.drNumber}`,
      `<h1>Delivery Receipt</h1>
      <div class="meta meta-inline"><span class="doc-label">DR #:</span><span class="doc-code">${delivery.drNumber}</span></div>
      <div class="meta-grid">
        <div class="meta">Client: ${delivery.clientName}</div>
        <div class="meta">Project: ${delivery.projectName || 'N/A'}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>`
    );
  };

  const handleConfirmDelivery = async () => {
    if (!selectedDelivery) return;
    if (!receivedBy.trim()) {
      toast({
        title: 'Missing receiver',
        description: 'Please enter who received the delivery.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await apiClient.post(`/deliveries/${selectedDelivery.id}/confirm`, {
        receivedBy,
        notes: deliveryNotes,
      });
      const updated = {
        ...selectedDelivery,
        status: 'delivered',
        receivedBy: res.data?.receivedBy || receivedBy,
        receivedAt: res.data?.receivedAt || new Date().toISOString(),
        notes: deliveryNotes,
      } as Delivery;
      setSelectedDelivery(updated);
      setConfirmOpen(false);
      setReceivedBy('');
      setDeliveryNotes('');
      toast({ title: 'Delivery confirmed', description: 'Thank you for confirming receipt.' });
    } catch {
      toast({
        title: 'Confirmation failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleReturnDelivery = async () => {
    if (!selectedDelivery) return;
    if (!returnReason.trim()) {
      toast({
        title: 'Missing reason',
        description: 'Please provide a return reason.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await apiClient.post(`/deliveries/${selectedDelivery.id}/return`, {
        reason: returnReason,
      });
      const updated = {
        ...selectedDelivery,
        status: 'return-pending',
        notes: res.data?.notes || returnReason,
      } as Delivery;
      setSelectedDelivery(updated);
      setReturnOpen(false);
      setReturnReason('');
      toast({ title: 'Return requested', description: 'Return has been submitted.' });
    } catch {
      toast({
        title: 'Return failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">My Deliveries</h2>
        <p className="text-muted-foreground">Monitor your incoming deliveries in real-time</p>
      </div>

      {/* Active Deliveries */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="text-blue-600" />
            Active Deliveries
          </CardTitle>
          <CardDescription>Deliveries currently in transit or pending dispatch</CardDescription>
        </CardHeader>
        <CardContent>
          {activeDeliveries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package size={48} className="mx-auto mb-2 opacity-50" />
              <p>No active deliveries</p>
              <p className="text-sm">Your orders will appear here once dispatched</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeDeliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedDelivery(delivery)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{delivery.drNumber}</h4>
                        <Badge className={`${statusColors[delivery.status]} flex items-center gap-1`}>
                          {statusIcons[delivery.status]}
                          {formatStatus(delivery.status)}
                        </Badge>
                        {delivery.status === 'in-transit' && (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            On Time
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {delivery.projectName} • {delivery.items.length} items
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">ETA</p>
                      <p className="text-lg font-bold text-primary">
                        {format(new Date(delivery.eta), 'MMM dd')}
                      </p>
                    </div>
                  </div>

                  {/* Progress Tracker */}
                  <div className="mt-4 relative">
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          delivery.status !== 'pending' ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'
                        }`}>
                          <Package size={16} />
                        </div>
                        <span className="text-xs mt-1">Prepared</span>
                      </div>
                      <div className="flex-1 h-1 mx-2 bg-muted">
                        <div className={`h-full transition-all ${
                          delivery.status === 'in-transit' || delivery.status === 'delivered' 
                            ? 'bg-green-600 w-full' 
                            : 'bg-muted w-0'
                        }`} />
                      </div>
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          delivery.status === 'in-transit' ? 'bg-blue-600 text-white animate-pulse' : 
                          delivery.status === 'delivered' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground'
                        }`}>
                          <Truck size={16} />
                        </div>
                        <span className="text-xs mt-1">In Transit</span>
                      </div>
                      <div className="flex-1 h-1 mx-2 bg-muted">
                        <div className={`h-full transition-all ${
                          delivery.status === 'delivered' ? 'bg-green-600 w-full' : 'w-0'
                        }`} />
                      </div>
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          delivery.status === 'delivered' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground'
                        }`}>
                          <CheckCircle size={16} />
                        </div>
                        <span className="text-xs mt-1">Delivered</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GPS Map Mock */}
      {activeDeliveries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="text-primary" />
              Live Tracking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="aspect-video bg-muted rounded-lg relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-green-50">
                {/* Mock map grid */}
                <div className="absolute inset-0 opacity-20">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="absolute border-b border-gray-400 w-full" style={{ top: `${i * 12.5}%` }} />
                  ))}
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="absolute border-r border-gray-400 h-full" style={{ left: `${i * 12.5}%` }} />
                  ))}
                </div>
                
                {/* Delivery truck marker */}
                <div className="absolute top-[40%] left-[55%] animate-pulse">
                  <div className="bg-blue-600 text-white p-3 rounded-full shadow-lg">
                    <Truck size={20} />
                  </div>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2">
                    <div className="bg-white px-3 py-1 rounded shadow text-sm font-medium">
                      {activeDeliveries[0]?.drNumber}
                    </div>
                  </div>
                </div>

                {/* Destination marker */}
                <div className="absolute top-[30%] left-[75%]">
                  <div className="bg-primary text-primary-foreground p-2 rounded-full">
                    <MapPin size={16} />
                  </div>
                  <div className="text-xs bg-white px-2 py-1 rounded shadow mt-1">
                    Your Location
                  </div>
                </div>

                {/* Route line */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <path
                    d="M 280 200 Q 320 180 380 150"
                    stroke="#C0392B"
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray="8,4"
                  />
                </svg>
              </div>

              <div className="absolute bottom-4 left-4 bg-white p-3 rounded-lg shadow-lg">
                <p className="text-sm font-medium">Estimated Arrival</p>
                <p className="text-lg font-bold text-primary">
                  {format(new Date(activeDeliveries[0]?.eta || new Date()), 'MMM dd, h:mm a')}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center mt-4">
              * Mock GPS visualization - Real tracking coming soon
            </p>
          </CardContent>
        </Card>
      )}

      {/* Completed Deliveries */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="text-green-600" />
            Completed Deliveries
          </CardTitle>
          <CardDescription>Past deliveries</CardDescription>
        </CardHeader>
        <CardContent>
          {completedDeliveries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No completed deliveries yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DR #</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedDeliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-medium">{delivery.drNumber}</TableCell>
                    <TableCell>{delivery.projectName}</TableCell>
                    <TableCell>{delivery.items.length} items</TableCell>
                    <TableCell>
                      {delivery.receivedAt
                        ? format(new Date(delivery.receivedAt), 'MMM dd, yyyy')
                        : '-'}
                    </TableCell>
                    <TableCell>{delivery.receivedBy || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDelivery(delivery)}
                      >
                        <FileText size={16} className="mr-1" />
                        View Receipt
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delivery Detail Dialog */}
      <Dialog open={!!selectedDelivery} onOpenChange={() => setSelectedDelivery(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delivery Receipt</DialogTitle>
            <DialogDescription>{selectedDelivery?.drNumber}</DialogDescription>
          </DialogHeader>
          {selectedDelivery && (
            <div className="space-y-4">
              {/* DR Preview */}
              <div className="border rounded-lg p-6 bg-white">
                <div className="text-center border-b pb-4 mb-4">
                  <h3 className="text-xl font-bold text-sidebar">{company.name}</h3>
                  <p className="text-sm text-muted-foreground">{company.address}</p>
                </div>
                <div className="text-center mb-4">
                  <h4 className="text-lg font-bold">DELIVERY RECEIPT</h4>
                  <p className="text-primary font-medium">{selectedDelivery.drNumber}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div>
                    <p><span className="font-medium">Client:</span> {selectedDelivery.clientName}</p>
                    <p><span className="font-medium">Project:</span> {selectedDelivery.projectName || 'N/A'}</p>
                  </div>
                  <div className="text-right">
                    <p><span className="font-medium">Date:</span> {format(new Date(selectedDelivery.issuedAt), 'MMM dd, yyyy')}</p>
                    <p><span className="font-medium">Status:</span> <Badge className={statusColors[selectedDelivery.status]}>{formatStatus(selectedDelivery.status)}</Badge></p>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDelivery.items.map((item) => (
                      <TableRow key={item.itemId}>
                        <TableCell>{item.itemName}</TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(selectedDelivery.status === 'delivered' || selectedDelivery.status === 'return-pending' || selectedDelivery.status === 'return-rejected' || selectedDelivery.status === 'returned') && (
                  <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium">Issued By:</p>
                      <p>{selectedDelivery.issuedBy}</p>
                    </div>
                    <div>
                      <p className="font-medium">Received By:</p>
                      <p>{selectedDelivery.receivedBy}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedDelivery.receivedAt && format(new Date(selectedDelivery.receivedAt), 'MMM dd, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setSelectedDelivery(null)}>
                  Close
                </Button>
                <Button variant="outline" onClick={() => selectedDelivery && handlePrintDelivery(selectedDelivery)}>
                  <FileText size={16} className="mr-1" />
                  Download PDF
                </Button>
                {selectedDelivery.status === 'in-transit' && (
                  <Button onClick={() => setConfirmOpen(true)}>
                    <CheckCircle size={16} className="mr-1" />
                    Confirm Delivery
                  </Button>
                )}
                {selectedDelivery.status === 'delivered' && (
                  <Button variant="destructive" onClick={() => setReturnOpen(true)}>
                    Request Return
                  </Button>
                )}
                {selectedDelivery.status === 'return-pending' && (
                  <Badge className="bg-orange-100 text-orange-800">Return pending review</Badge>
                )}
                {selectedDelivery.status === 'return-rejected' && (
                  <Badge className="bg-slate-100 text-slate-700">Return rejected</Badge>
                )}
                {selectedDelivery.status === 'returned' && (
                  <Badge className="bg-red-100 text-red-800">Return approved</Badge>
                )}
              </div>
              {selectedDelivery.status === 'return-rejected' && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <span className="font-medium">Rejection reason:</span>{' '}
                  {selectedDelivery.returnRejectionReason || 'Not provided'}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delivery</DialogTitle>
            <DialogDescription>Enter who received the delivery.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Received By</Label>
              <Input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Name"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder="Notes"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmDelivery}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Delivery</DialogTitle>
            <DialogDescription>Please provide a reason for the return.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Return Reason</Label>
            <Textarea
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Reason for return"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReturnDelivery}>
              Submit Return
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
