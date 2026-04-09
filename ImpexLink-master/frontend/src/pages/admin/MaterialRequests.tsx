import { useState } from 'react';
import { Plus, ClipboardList, CheckCircle, XCircle, Clock, AlertTriangle, FileText, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { MaterialRequest, UrgencyLevel, Project, InventoryItem } from '@/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { printHtml } from '@/utils/print';
import { useResource } from '@/hooks/use-resource';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { canApproveMaterialRequests, canCreateMaterialRequests, hasRole } from '@/lib/roles';

export default function MaterialRequestsPage() {
  const { user } = useAuth();
  const roleInput = user?.roles?.length ? user.roles : user?.role;
  const canApprove = canApproveMaterialRequests(roleInput);
  const canCreate = canCreateMaterialRequests(roleInput);
  const isPaintChemist = hasRole(roleInput, 'paint_chemist');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'createdAt' | 'status' | 'urgency'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState('pending');
  const { data: requests, setData: setRequests, loading: requestsLoading, lastUpdated } = useResource<MaterialRequest[]>(
    '/material-requests',
    [],
    [activeTab, searchTerm, sortKey, sortDir],
    15_000,
    {
      ...(activeTab === 'all' ? {} : { status: activeTab }),
      q: searchTerm || undefined,
      sortBy: sortKey,
      sortDir,
    }
  );
  const { data: projects } = useResource<Project[]>('/projects', [], [user?.id], 15_000, { picker: true });
  const { data: inventory } = useResource<InventoryItem[]>('/inventory', []);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const { toast } = useToast();

  // Form state for creating new request
  const [newRequest, setNewRequest] = useState({
    projectId: '',
    items: [{ itemId: '', quantity: 1, notes: '' }],
    purpose: '',
    urgency: 'normal' as UrgencyLevel,
  });
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});

  const normalizedRequests = requests.map((req) => ({
    ...req,
    status: String(req.status || 'pending').toLowerCase() as MaterialRequest['status'],
    urgency: String(req.urgency || 'normal').toLowerCase() as UrgencyLevel,
  }));
  const scopedInventory = isPaintChemist
    ? inventory.filter((item) => item.category === 'Paint & Consumables')
    : inventory;
  const isPaintOnlyRequest = (request: MaterialRequest) =>
    request.items.every((item) => scopedInventory.some((inv) => inv.id === item.itemId));
  const scopedRequests = isPaintChemist
    ? normalizedRequests.filter((request) =>
        request.items.some((item) => scopedInventory.some((inv) => inv.id === item.itemId))
      )
    : normalizedRequests;
  const filteredByStatus =
    statusFilter === 'all' ? scopedRequests : scopedRequests.filter((r) => r.status === statusFilter);
  const pendingRequests = filteredByStatus.filter((r) => r.status === 'pending');
  const approvedRequests = filteredByStatus.filter((r) => r.status === 'approved');
  const rejectedRequests = filteredByStatus.filter((r) => r.status === 'rejected');
  const canApproveSelected =
    Boolean(selectedRequest) &&
    canApprove &&
    (!isPaintChemist || (selectedRequest && isPaintOnlyRequest(selectedRequest)));

  const getDraftEstimatedCost = () =>
    newRequest.items.reduce((sum, item) => {
      const inv = scopedInventory.find((entry) => entry.id === item.itemId);
      return sum + (inv?.unitPrice || 0) * Number(item.quantity || 0);
    }, 0);

  const getStatusBadge = (status: MaterialRequest['status']) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-warning text-warning-foreground gap-1"><Clock size={12} />Pending</Badge>;
      case 'approved':
        return <Badge className="bg-success text-success-foreground gap-1"><CheckCircle size={12} />Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-destructive text-destructive-foreground gap-1"><XCircle size={12} />Rejected</Badge>;
      case 'fulfilled':
        return <Badge className="bg-info text-info-foreground">Fulfilled</Badge>;
    }
  };

  const handleApprove = (request: MaterialRequest) => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === request.id
          ? {
              ...r,
              status: 'approved' as const,
              approvedBy: user?.name || 'Admin',
              approvedAt: new Date().toISOString(),
              remarks: approvalRemarks,
            }
          : r
      )
    );
    toast({
      title: 'Request Approved',
      description: `${request.requestNumber} has been approved. Stock will be deducted.`,
    });
    apiClient
      .put<MaterialRequest>(`/material-requests/${request.id}`, {
        status: 'approved',
        remarks: approvalRemarks,
      })
      .then((res) => {
        const updated = res.data;
        setRequests((prev) => prev.map((r) => (r.id === request.id ? updated : r)));
      })
      .catch(() => {
        // keep optimistic state
      });
    setIsDetailOpen(false);
    setApprovalRemarks('');
  };

  const handleReject = (request: MaterialRequest) => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === request.id
          ? {
              ...r,
              status: 'rejected' as const,
              remarks: approvalRemarks,
            }
          : r
      )
    );
    toast({
      title: 'Request Rejected',
      description: `${request.requestNumber} has been rejected.`,
      variant: 'destructive',
    });
    apiClient
      .put<MaterialRequest>(`/material-requests/${request.id}`, {
        status: 'rejected',
        remarks: approvalRemarks,
      })
      .then((res) => {
        const updated = res.data;
        setRequests((prev) => prev.map((r) => (r.id === request.id ? updated : r)));
      })
      .catch(() => {
        // keep optimistic state
      });
    setIsDetailOpen(false);
    setApprovalRemarks('');
  };


  const handleSubmitNewRequest = () => {
    if (!canCreate) {
      toast({ title: 'Not allowed', description: 'You do not have permission to create requests.', variant: 'destructive' });
      return;
    }
    const errors: Record<string, string> = {};
    if (!newRequest.projectId) errors.projectId = 'Project is required.';
    if (!newRequest.purpose.trim()) errors.purpose = 'Purpose is required.';
    if (!newRequest.items.length) {
      errors.items = 'Add at least one item.';
    } else {
      newRequest.items.forEach((item, idx) => {
        if (!item.itemId) {
          errors[`item-${idx}`] = 'Select an item.';
        }
        if (Number(item.quantity) <= 0 || Number.isNaN(Number(item.quantity))) {
          errors[`qty-${idx}`] = 'Qty must be greater than 0.';
        }
      });
      if (Object.keys(errors).some((k) => k.startsWith('item-') || k.startsWith('qty-'))) {
        errors.items = 'Each item must have a valid selection and quantity.';
      }
    }
    setRequestErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({ title: 'Fix validation errors', description: 'Please review the highlighted fields.', variant: 'destructive' });
      return;
    }
    if (!newRequest.projectId) {
      toast({ title: 'Missing project', description: 'Select a project first.', variant: 'destructive' });
      return;
    }
    if (!newRequest.items.length || newRequest.items.some((item) => !item.itemId)) {
      toast({ title: 'Missing items', description: 'Add at least one item.', variant: 'destructive' });
      return;
    }
    if (newRequest.items.some((item) => Number(item.quantity) <= 0 || Number.isNaN(Number(item.quantity)))) {
      toast({ title: 'Invalid quantity', description: 'Quantity must be greater than 0.', variant: 'destructive' });
      return;
    }
    const project = projects.find((p) => p.id === newRequest.projectId);
    const tempId = `temp-${Date.now()}`;
    const created: MaterialRequest = {
      id: tempId,
      requestNumber: `REQ-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      projectId: newRequest.projectId,
      projectName: project?.name || '',
      requestedBy: user?.name || 'User',
      requestedById: user?.id || 'user-current',
      date: new Date().toISOString(),
      items: newRequest.items.map((item) => {
        const inv = scopedInventory.find((i) => i.id === item.itemId);
        return {
          itemId: item.itemId,
          itemName: inv?.name || '',
          unit: inv?.unit || '',
          quantity: item.quantity,
          unitPrice: inv?.unitPrice || 0,
          amount: (inv?.unitPrice || 0) * item.quantity,
          notes: item.notes || null,
        };
      }),
      purpose: newRequest.purpose,
      urgency: newRequest.urgency,
      status: 'pending',
      estimatedCost: newRequest.items.reduce((sum, item) => {
        const inv = scopedInventory.find((i) => i.id === item.itemId);
        return sum + (inv?.unitPrice || 0) * item.quantity;
      }, 0),
    };
    setRequests((prev) => [created, ...prev]);
    apiClient
      .post<MaterialRequest>('/material-requests', {
        projectId: newRequest.projectId,
        items: newRequest.items,
        purpose: newRequest.purpose,
        urgency: newRequest.urgency,
      })
      .then((res) => {
        setRequests((prev) => [res.data, ...prev.filter((r) => r.id !== tempId)]);
      })
      .catch(() => {
        // keep optimistic state
      });
    toast({
      title: 'Request Submitted',
      description: 'Your material request has been submitted for approval.',
    });
    // Reset form
    setNewRequest({
      projectId: '',
      items: [{ itemId: '', quantity: 1, notes: '' }],
      purpose: '',
      urgency: 'normal',
    });
    setRequestErrors({});
  };

  const handlePrintRequest = (request: MaterialRequest) => {
    const itemsHtml = request.items
      .map(
        (item) =>
          `<tr><td>${item.itemName}</td><td>${item.unit}</td><td>${item.quantity}</td><td>₱${item.unitPrice.toFixed(2)}</td><td>₱${item.amount.toFixed(2)}</td></tr>`
      )
      .join('');
    printHtml(
      `Material Request ${request.requestNumber}`,
      `<h1>Material Request</h1>
      <div class=\"meta meta-inline\"><span class=\"doc-label\">Request #:</span><span class=\"doc-code\">${request.requestNumber}</span></div>
      <div class=\"meta-grid\">
        <div class=\"meta\">Date: ${new Date(request.date).toLocaleDateString('en-PH')}</div>
        <div class=\"meta\">Project: ${request.projectName}</div>
        <div class=\"meta\">Requested By: ${request.requestedBy}</div>
        <div class=\"meta\">Status: ${request.status}</div>
        <div class=\"meta\">Urgency: ${request.urgency}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class=\"total\">Estimated Total: ₱${Number(request.estimatedCost || 0).toFixed(2)}</div>
      <div class=\"meta meta-full\">Purpose: ${request.purpose}</div>`
    );
  };

  const handleRowClick = (request: MaterialRequest) => {
    setSelectedRequest(request);
    setApprovalRemarks(request.remarks || '');
    setIsDetailOpen(true);
  };

  const RequestTable = ({ data }: { data: MaterialRequest[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Request ID</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Requested By</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requestsLoading && data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/2 mx-auto" />
                <Skeleton className="h-4 w-1/3 mx-auto" />
              </div>
            </TableCell>
          </TableRow>
        ) : data.length > 0 ? (
          data.map((request) => (
            <TableRow
              key={request.id}
              className="cursor-pointer hover:bg-muted/50"
              role="button"
              tabIndex={0}
              onClick={() => handleRowClick(request)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleRowClick(request);
                }
              }}
            >
              <TableCell className="font-medium">{request.requestNumber}</TableCell>
              <TableCell className="max-w-[200px] truncate">{request.projectName}</TableCell>
              <TableCell>{request.requestedBy}</TableCell>
              <TableCell>{new Date(request.date).toLocaleDateString('en-PH')}</TableCell>
              <TableCell>{getStatusBadge(request.status)}</TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              <div className="space-y-3">
                <p>No requests found</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('create')}
                  disabled={!canCreate}
                >
                  Create Request
                </Button>
              </div>
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
          <h1 className="text-2xl font-bold">Material Requests</h1>
          <p className="text-muted-foreground">Manage requisition slips and stock requests</p>
        </div>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground">
            Last updated {new Date(lastUpdated).toLocaleTimeString()}
          </p>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input
                placeholder="Search requests..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as typeof sortKey)}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Sort: Date</SelectItem>
                <SelectItem value="urgency">Sort: Urgency</SelectItem>
                <SelectItem value="status">Sort: Status</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortDir} onValueChange={(value) => setSortDir(value as typeof sortDir)}>
              <SelectTrigger className="w-full lg:w-[140px]">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Desc</SelectItem>
                <SelectItem value="asc">Asc</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <Clock size={16} />
            Pending ({pendingRequests.length})
          </TabsTrigger>
          {canCreate && (
            <TabsTrigger value="create" className="gap-2">
              <Plus size={16} />
              Create Request
            </TabsTrigger>
          )}
          <TabsTrigger value="all">All Requests</TabsTrigger>
        </TabsList>

        {activeTab !== 'create' && null}

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pending Approval</CardTitle>
              <CardDescription>Requests awaiting review and approval</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <RequestTable data={pendingRequests} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardList size={20} />
                New Material Request
              </CardTitle>
              <CardDescription>Submit a requisition slip for project materials</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="project">Project</Label>
                  <Select
                    value={newRequest.projectId}
                    onValueChange={(v) => {
                      const next = { ...newRequest, projectId: v };
                      setNewRequest(next);
                      if (requestErrors.projectId) {
                        setRequestErrors((prev) => ({ ...prev, projectId: '' }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {requestErrors.projectId && (
                    <p className="text-xs text-destructive">{requestErrors.projectId}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="urgency">Urgency Level</Label>
                  <Select
                    value={newRequest.urgency}
                    onValueChange={(v) =>
                      setNewRequest((prev) => ({ ...prev, urgency: v as UrgencyLevel }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <Label>Requested Items</Label>
                {requestErrors.items && (
                  <p className="text-xs text-destructive">{requestErrors.items}</p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[140px]">Unit Price</TableHead>
                      <TableHead className="w-[100px]">Quantity</TableHead>
                      <TableHead className="w-[160px]">Estimated Cost</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newRequest.items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select
                            value={item.itemId}
                            onValueChange={(v) => {
                              const updated = [...newRequest.items];
                              updated[index].itemId = v;
                              setNewRequest((prev) => ({ ...prev, items: updated }));
                              if (requestErrors.items || requestErrors[`item-${index}`]) {
                                setRequestErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.items;
                                  delete next[`item-${index}`];
                                  return next;
                                });
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                              {scopedInventory.map((inv) => (
                                <SelectItem key={inv.id} value={inv.id}>
                                  {inv.name} ({inv.unit}) • ₱{inv.unitPrice.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {requestErrors[`item-${index}`] && (
                            <p className="text-xs text-destructive mt-1">{requestErrors[`item-${index}`]}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            ₱
                            {(scopedInventory.find((i) => i.id === item.itemId)?.unitPrice || 0).toLocaleString('en-PH', {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const updated = [...newRequest.items];
                              updated[index].quantity = parseInt(e.target.value) || 1;
                              setNewRequest((prev) => ({ ...prev, items: updated }));
                              if (requestErrors.items || requestErrors[`qty-${index}`]) {
                                setRequestErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.items;
                                  delete next[`qty-${index}`];
                                  return next;
                                });
                              }
                            }}
                          />
                          {requestErrors[`qty-${index}`] && (
                            <p className="text-xs text-destructive mt-1">{requestErrors[`qty-${index}`]}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-semibold text-primary">
                            ₱
                            {(
                              (scopedInventory.find((i) => i.id === item.itemId)?.unitPrice || 0) *
                              Number(item.quantity || 0)
                            ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder="Optional notes"
                            value={item.notes}
                            onChange={(e) => {
                              const updated = [...newRequest.items];
                              updated[index].notes = e.target.value;
                              setNewRequest((prev) => ({ ...prev, items: updated }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {newRequest.items.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setNewRequest((prev) => ({
                                  ...prev,
                                  items: prev.items.filter((_, i) => i !== index),
                                }));
                              }}
                            >
                              ×
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setNewRequest((prev) => ({
                      ...prev,
                      items: [...prev.items, { itemId: '', quantity: 1, notes: '' }],
                    }))
                  }
                >
                  <Plus size={16} className="mr-2" />
                  Add Item
                </Button>
                <div className="flex justify-end">
                  <div className="rounded-md bg-muted px-4 py-3 text-sm">
                    <span className="text-muted-foreground">Estimated Request Total: </span>
                    <span className="font-semibold text-primary">
                      ₱{getDraftEstimatedCost().toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="purpose">Purpose</Label>
                <Textarea
                  id="purpose"
                  placeholder="Describe the purpose of this request..."
                  value={newRequest.purpose}
                  onChange={(e) => {
                    const next = { ...newRequest, purpose: e.target.value };
                    setNewRequest(next);
                    if (requestErrors.purpose) {
                      setRequestErrors((prev) => ({ ...prev, purpose: '' }));
                    }
                  }}
                  rows={3}
                />
                {requestErrors.purpose && (
                  <p className="text-xs text-destructive">{requestErrors.purpose}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSubmitNewRequest} className="gap-2">
                  <ClipboardList size={18} />
                  Submit Request
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">All Requests</CardTitle>
              <CardDescription>Complete history of material requests</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <RequestTable data={requests} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Request Detail Modal */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request Details</DialogTitle>
            <DialogDescription>
              {selectedRequest?.requestNumber}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Request ID</p>
                  <p className="font-medium">{selectedRequest.requestNumber}</p>
                </div>
                {getStatusBadge(selectedRequest.status)}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Project</p>
                  <p className="font-medium">{selectedRequest.projectName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Requested By</p>
                  <p className="font-medium">{selectedRequest.requestedBy}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date</p>
                  <p className="font-medium">{new Date(selectedRequest.date).toLocaleDateString('en-PH')}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Requested Items</p>
                <ul className="space-y-1 text-sm">
                  {selectedRequest.items.map((item, idx) => (
                    <li key={idx} className="flex items-center justify-between border-b pb-1">
                      <span>{item.itemName}</span>
                      <span className="font-medium">{item.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea
                  id="remarks"
                  placeholder="Approval notes..."
                  value={approvalRemarks}
                  onChange={(e) => setApprovalRemarks(e.target.value)}
                  rows={3}
                />
                {isPaintChemist && selectedRequest && !isPaintOnlyRequest(selectedRequest) && (
                  <p className="text-xs text-destructive">
                    Approval disabled: all items must be in Paint & Consumables.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {selectedRequest && (
              <Button variant="outline" onClick={() => handlePrintRequest(selectedRequest)}>
                <FileText size={16} className="mr-2" />
                Download PDF
              </Button>
            )}
            {selectedRequest?.status === 'pending' ? (
              <>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => setIsDetailOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleReject(selectedRequest)}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white"
                  disabled={!canApprove}
                >
                  <XCircle size={16} />
                  Reject
                </Button>
                <Button
                  onClick={() => handleApprove(selectedRequest)}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!canApproveSelected}
                >
                  <CheckCircle size={16} />
                  Approve
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
