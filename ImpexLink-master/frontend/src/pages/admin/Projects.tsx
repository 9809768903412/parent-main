import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
 
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Search, FolderKanban, MapPin, CalendarDays, Building2 } from 'lucide-react';
import type { Project, Client, Order, Delivery, User as UserType } from '@/types';
import { toast } from '@/hooks/use-toast';
import { useResource } from '@/hooks/use-resource';
import { apiClient } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  rejected: 'bg-red-100 text-red-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  'on-hold': 'bg-yellow-100 text-yellow-800',
};

const mapProject = (project: any): Project => ({
  id: project.id?.toString?.() || project.projectId?.toString?.() || '',
  name: project.name || project.projectName || '',
  clientId: project.clientId?.toString?.() || null,
  clientName: project.clientName || project.client?.clientName || 'Unassigned',
  assignedPmId: project.assignedPmId?.toString?.() || null,
  assignedPmName: project.assignedPmName || project.assignedPm?.fullName || null,
  status: String(project.status || 'active').toLowerCase() as Project['status'],
  rejectionReason: project.rejectionReason || null,
  startDate: project.startDate
    ? typeof project.startDate === 'string'
      ? project.startDate
      : new Date(project.startDate).toISOString().split('T')[0]
    : '',
  endDate: project.endDate || undefined,
});

// TODO: Replace with real data
export default function ProjectsPage() {
  const { user } = useAuth();
  const roleInput = user?.roles?.length ? user.roles : user?.role;
  const isPresident = Array.isArray(roleInput) ? roleInput.includes('president') : roleInput === 'president';
  const isProjectManager = Array.isArray(roleInput) ? roleInput.includes('project_manager') : roleInput === 'project_manager';
  const isAdmin = Array.isArray(roleInput) ? roleInput.includes('admin') : roleInput === 'admin';
  const canEditStatus =
    !isPresident &&
    (Array.isArray(roleInput)
      ? roleInput.some((r) => ['admin', 'project_manager'].includes(r))
      : ['admin', 'project_manager'].includes(roleInput || ''));
  const isPrivileged =
    Array.isArray(roleInput)
      ? roleInput.some((r) => ['admin', 'president', 'engineer'].includes(r))
      : ['admin', 'president', 'engineer'].includes(roleInput || '');
  const [sortKey, setSortKey] = useState<'projectName' | 'status' | 'startDate'>('projectName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const { data: projects, setData: setProjects, loading: projectsLoading } = useResource<Project[]>(
    '/projects',
    [],
    [sortKey, sortDir, searchTerm, statusFilter],
    15_000,
    {
      q: searchTerm || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      sortBy: sortKey,
      sortDir,
    }
  );
  const { data: clients } = useResource<Client[]>('/clients', []);
  const { data: orders } = useResource<Order[]>('/orders', []);
  const { data: deliveries } = useResource<Delivery[]>('/deliveries', []);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    clientId: '',
    status: 'active' as const,
  });
  const [projectErrors, setProjectErrors] = useState<Record<string, string>>({});
  const [editProject, setEditProject] = useState({
    id: '',
    status: 'active' as Project['status'],
    startDate: '',
    rejectionReason: '',
    assignedPmId: 'unassigned',
  });
  const [editProjectErrors, setEditProjectErrors] = useState<Record<string, string>>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Project | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const scopedProjects =
    isProjectManager && !isPrivileged
      ? projects.filter((project) => project.assignedPmId === user?.id)
      : projects;

  const filteredProjects = scopedProjects.filter((project) => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.clientName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const pendingProjects = filteredProjects.filter((project) => project.status === 'pending');
  const visibleProjects = activeTab === 'pending' ? pendingProjects : filteredProjects;

  const getProjectStats = (projectId: string) => {
    const projectOrders = orders.filter((o) => o.projectId === projectId);
    const projectDeliveries = deliveries.filter((d) =>
      projectOrders.some((o) => o.id === d.orderId)
    );
    const totalValue = projectOrders.reduce((sum, o) => sum + o.total, 0);
    return { orderCount: projectOrders.length, deliveryCount: projectDeliveries.length, totalValue };
  };

  const getProjectLocation = (project: Project) => {
    const client = clients.find((c) => c.id === project.clientId);
    const address = client?.address || '';
    const parts = address.split(',');
    return parts.length > 1 ? parts[parts.length - 1].trim() : address || '—';
  };

  const getProgressPercent = (status: Project['status']) => {
    switch (status) {
      case 'completed':
        return 100;
      case 'on-hold':
        return 45;
      case 'active':
        return 65;
      case 'pending':
        return 20;
      case 'rejected':
      default:
        return 0;
    }
  };

  const handleCreateProject = () => {
    if (isPresident) return;
    const errors: Record<string, string> = {};
    if (!newProject.name.trim()) errors.name = 'Project name is required.';
    if (!newProject.clientId) errors.clientId = 'Client is required.';
    setProjectErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    const client = clients.find((c) => c.id === newProject.clientId);
    const project: Project = {
      id: `proj-${Date.now()}`,
      name: newProject.name,
      clientId: newProject.clientId,
      clientName: client?.name || '',
      status: newProject.status,
      startDate: new Date().toISOString().split('T')[0],
    };

    apiClient
      .post('/projects', {
        name: newProject.name,
        clientId: newProject.clientId,
        status: newProject.status,
      })
      .then((response) => setProjects([mapProject(response.data), ...projects]))
      .catch(() => setProjects([project, ...projects]));
    toast({
      title: 'Project Created',
      description: `${project.name} has been added`,
    });
    setShowCreateDialog(false);
    setNewProject({ name: '', clientId: '', status: 'active' });
    setProjectErrors({});
  };

  const handleOpenProject = (project: Project) => {
    if (isProjectManager && !isPrivileged && !scopedProjects.some((p) => p.id === project.id)) {
      toast({
        title: 'Access restricted',
        description: 'You can only view projects assigned to your account.',
        variant: 'destructive',
      });
      return;
    }
    setSelectedProject(project);
    setEditProject({
      id: project.id,
      status: project.status,
      startDate: project.startDate || '',
      rejectionReason: project.rejectionReason || '',
      assignedPmId: project.assignedPmId || 'unassigned',
    });
  };

  const handleSaveProject = () => {
    if (!canEditStatus) return;
    if (!editProject.id) return;
    if (editProject.status === 'rejected' && !editProject.rejectionReason.trim()) {
      setEditProjectErrors({ rejectionReason: 'Rejection reason is required.' });
      toast({
        title: 'Missing reason',
        description: 'Please provide a rejection reason.',
        variant: 'destructive',
      });
      return;
    }
    const needsStartDate = ['active', 'on-hold', 'completed'].includes(editProject.status);
    if (needsStartDate && !editProject.startDate) {
      setEditProjectErrors({ startDate: 'Start date is required.' });
      toast({
        title: 'Missing date',
        description: 'Please select a start date.',
        variant: 'destructive',
      });
      return;
    }
    if (editProject.startDate && Number.isNaN(Date.parse(editProject.startDate))) {
      setEditProjectErrors({ startDate: 'Invalid start date.' });
      toast({
        title: 'Invalid date',
        description: 'Please select a valid start date.',
        variant: 'destructive',
      });
      return;
    }
    setEditProjectErrors({});
    apiClient
      .put<Project>(`/projects/${editProject.id}`, {
        status: editProject.status,
        startDate: editProject.startDate || undefined,
        rejectionReason: editProject.status === 'rejected' ? editProject.rejectionReason : undefined,
        ...(isAdmin
          ? { assignedPmId: editProject.assignedPmId === 'unassigned' ? null : editProject.assignedPmId }
          : {}),
      })
      .then((res) => {
        const updated = mapProject(res.data);
        setProjects((prev) =>
          prev.map((p) =>
            p.id === editProject.id
              ? { ...p, ...updated }
              : p
          )
        );
        setSelectedProject((prev) => (prev && prev.id === editProject.id ? { ...prev, ...updated } : prev));
        toast({
          title: 'Project Updated',
          description: 'Project details saved successfully.',
        });
      })
      .catch(() => {
        toast({
          title: 'Failed to update project',
          description: 'Please try again.',
          variant: 'destructive',
        });
      });
  };

  const handleTabChange = (value: string) => {
    const next = value === 'pending' ? 'pending' : 'all';
    setActiveTab(next);
    setStatusFilter(next === 'pending' ? 'pending' : 'all');
  };

  const handleProjectDecision = async (project: Project, status: Project['status'], reason?: string) => {
    if (!canEditStatus) return;
    setActionLoadingId(project.id);
    try {
      const payload = {
        status,
        startDate: project.startDate || new Date().toISOString().slice(0, 10),
        ...(status === 'rejected' ? { rejectionReason: reason } : {}),
      };
      const res = await apiClient.put<Project>(`/projects/${project.id}`, payload);
      const updated = mapProject(res.data);
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, ...updated } : p))
      );
      toast({
        title: status === 'active' ? 'Project approved' : 'Project updated',
        description: `${project.name} set to ${status}.`,
      });
    } catch {
      toast({
        title: 'Update failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const openRejectModal = (project: Project) => {
    setRejectTarget(project);
    setRejectReason('');
    setRejectError('');
  };

  const confirmReject = async () => {
    if (!canEditStatus) return;
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required.');
      return;
    }
    await handleProjectDecision(rejectTarget, 'rejected', rejectReason.trim());
    setRejectTarget(null);
    setRejectReason('');
    setRejectError('');
  };

  const AdminAssigneeSelect = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
    const { data: users } = useResource<UserType[]>('/users', []);
    const assignableUsers = users.filter((u) => {
      const roleList = u.roles?.length ? u.roles : u.role ? [u.role] : [];
      return roleList.includes('project_manager');
    });
    const sortedUsers = [...assignableUsers].sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div>
        <Label>Assigned PM</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select PM" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {sortedUsers.map((pm) => (
              <SelectItem key={pm.id} value={pm.id}>
                {pm.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderKanban className="text-muted-foreground" />
            Projects
          </h2>
          <p className="text-muted-foreground">Manage client projects and track consumption</p>
        </div>
        {!isPresident && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus size={16} className="mr-2" />
            New Project
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="all">All Projects</TabsTrigger>
          <TabsTrigger value="pending">Pending Requests</TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full lg:w-[180px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(value) => setSortKey(value as typeof sortKey)}>
                <SelectTrigger className="w-full lg:w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="projectName">Sort: Name</SelectItem>
                  <SelectItem value="status">Sort: Status</SelectItem>
                  <SelectItem value="startDate">Sort: Start Date</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortDir} onValueChange={(value) => setSortDir(value as typeof sortDir)}>
                <SelectTrigger className="w-full lg:w-[140px]">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Asc</SelectItem>
                  <SelectItem value="desc">Desc</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="pending" />
      </Tabs>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {projectsLoading && visibleProjects.length === 0 ? (
          Array.from({ length: 6 }).map((_, idx) => (
            <Card key={`sk-${idx}`} className="p-4">
              <Skeleton className="h-4 w-2/3 mb-3" />
              <Skeleton className="h-3 w-1/2 mb-2" />
              <Skeleton className="h-2 w-full" />
            </Card>
          ))
        ) : (
          visibleProjects.map((project) => {
            const stats = getProjectStats(project.id);
            const progress = getProgressPercent(project.status);
            const statusMeta = {
              active: { label: 'Active', dot: 'bg-red-600', text: 'text-red-600' },
              'on-hold': { label: 'On Hold', dot: 'bg-orange-500', text: 'text-orange-600' },
              completed: { label: 'Completed', dot: 'bg-emerald-600', text: 'text-emerald-700' },
              pending: { label: 'Pending', dot: 'bg-amber-500', text: 'text-amber-700' },
              rejected: { label: 'Rejected', dot: 'bg-red-600', text: 'text-red-600' },
            }[project.status];
            return (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleOpenProject(project)}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{project.name}</p>
                      <div className={`mt-1 inline-flex items-center gap-2 text-xs ${statusMeta?.text || ''}`}>
                        <span className={`h-2 w-2 rounded-full ${statusMeta?.dot || 'bg-muted'}`} />
                        {statusMeta?.label || project.status}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 size={16} />
                    <span>{project.clientName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Assigned PM:{' '}
                    <span className="font-medium text-foreground">
                      {project.assignedPmName || (project.assignedPmId === user?.id ? 'You' : 'Unassigned')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin size={16} />
                    <span>{getProjectLocation(project)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays size={16} />
                    <span>
                      {project.startDate
                        ? format(new Date(project.startDate), 'MMM dd, yyyy')
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-[#C0392B]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats.orderCount} orders • ₱{stats.totalValue.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Project Detail Dialog */}
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedProject?.name}</DialogTitle>
            <DialogDescription>{selectedProject?.clientName}</DialogDescription>
          </DialogHeader>
          {selectedProject && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge className={statusColors[selectedProject.status]}>{selectedProject.status}</Badge>
                <span className="text-sm text-muted-foreground">
                  Start: {selectedProject.startDate ? format(new Date(selectedProject.startDate), 'MMM dd, yyyy') : '—'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: 'Requested', done: true },
                      { label: 'Approved', done: ['active', 'on-hold', 'completed'].includes(selectedProject.status) },
                      { label: 'In Progress', done: ['active', 'completed'].includes(selectedProject.status) },
                      { label: 'Completed', done: selectedProject.status === 'completed' },
                    ].map((step) => (
                      <div key={step.label} className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full ${step.done ? 'bg-emerald-600' : 'bg-muted'}`} />
                        <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Status Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>Client: <span className="font-medium">{selectedProject.clientName}</span></p>
                    <p>
                      Assigned PM:{' '}
                      <span className="font-medium">
                        {selectedProject.assignedPmName ||
                          (selectedProject.assignedPmId === user?.id ? 'You' : 'Unassigned')}
                      </span>
                    </p>
                    <p>Location: <span className="font-medium">{getProjectLocation(selectedProject)}</span></p>
                    <p>Orders: <span className="font-medium">{getProjectStats(selectedProject.id).orderCount}</span></p>
                    <p>Total Value: <span className="font-medium">₱{getProjectStats(selectedProject.id).totalValue.toLocaleString()}</span></p>
                  </CardContent>
                </Card>
              </div>

              {canEditStatus && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Update Status</CardTitle>
                    <CardDescription>Move projects out of on-hold or update status.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Status</Label>
                      <Select
                        value={editProject.status}
                        onValueChange={(value) => setEditProject((prev) => ({ ...prev, status: value as Project['status'] }))}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="on-hold">On Hold</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {isAdmin && (
                      <AdminAssigneeSelect
                        value={editProject.assignedPmId}
                        onChange={(value) => setEditProject((prev) => ({ ...prev, assignedPmId: value }))}
                      />
                    )}
                    <div>
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={editProject.startDate || ''}
                        onChange={(e) => setEditProject((prev) => ({ ...prev, startDate: e.target.value }))}
                        className="mt-1"
                      />
                      {editProjectErrors.startDate && (
                        <p className="text-xs text-destructive mt-1">{editProjectErrors.startDate}</p>
                      )}
                    </div>
                    {editProject.status === 'rejected' && (
                      <div>
                        <Label>Rejection Reason</Label>
                        <Input
                          value={editProject.rejectionReason}
                          onChange={(e) =>
                            setEditProject((prev) => ({ ...prev, rejectionReason: e.target.value }))
                          }
                          className="mt-1"
                        />
                        {editProjectErrors.rejectionReason && (
                          <p className="text-xs text-destructive mt-1">{editProjectErrors.rejectionReason}</p>
                        )}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button onClick={handleSaveProject}>Save Changes</Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Items</CardTitle>
                  <CardDescription>Items requested or ordered for this project</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {orders.filter((o) => o.projectId === selectedProject.id).flatMap((o) => o.items).length === 0 ? (
                      <li className="text-muted-foreground">No items linked yet</li>
                    ) : (
                      orders
                        .filter((o) => o.projectId === selectedProject.id)
                        .flatMap((o) => o.items)
                        .map((item, idx) => (
                          <li key={`${item.itemId}-${idx}`} className="flex justify-between border-b pb-1">
                            <span>{item.itemName}</span>
                            <span className="font-medium">{item.quantity}</span>
                          </li>
                        ))
                    )}
                  </ul>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedProject(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {!isPresident && (
        <>
          {/* Reject Project Dialog */}
          <Dialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Reject Project</DialogTitle>
                <DialogDescription>
                  Provide a reason for rejection. The client will be notified.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="rejectReason">Reason</Label>
                <Input
                  id="rejectReason"
                  value={rejectReason}
                  onChange={(e) => {
                    setRejectReason(e.target.value);
                    if (rejectError) setRejectError('');
                  }}
                  placeholder="e.g., Please provide a valid scope and timeline."
                />
                {rejectError && <p className="text-xs text-destructive">{rejectError}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => setRejectTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={confirmReject}
                >
                  Reject
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Create Project Dialog */}
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>Add a new project for a client</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Project Name</Label>
                  <Input
                    placeholder="e.g., Office Building Renovation"
                    value={newProject.name}
                    onChange={(e) => {
                      const next = { ...newProject, name: e.target.value };
                      setNewProject(next);
                      if (projectErrors.name) {
                        setProjectErrors((prev) => ({ ...prev, name: '' }));
                      }
                    }}
                    className="mt-1"
                  />
                  {projectErrors.name && <p className="text-xs text-destructive mt-1">{projectErrors.name}</p>}
                </div>
                <div>
                  <Label>Client</Label>
                  <Select
                    value={newProject.clientId}
                    onValueChange={(v) => {
                      setNewProject({ ...newProject, clientId: v });
                      if (projectErrors.clientId) {
                        setProjectErrors((prev) => ({ ...prev, clientId: '' }));
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectErrors.clientId && <p className="text-xs text-destructive mt-1">{projectErrors.clientId}</p>}
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={newProject.status}
                    onValueChange={(v: any) => setNewProject({ ...newProject, status: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="on-hold">On Hold</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setShowCreateDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleCreateProject}>Create Project</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
