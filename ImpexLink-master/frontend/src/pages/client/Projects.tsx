import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { FolderKanban, Search, MapPin, CalendarDays, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useResource } from '@/hooks/use-resource';
import { apiClient } from '@/api/client';
import type { Project, Client, Order, Delivery } from '@/types';

export default function ClientProjectsPage() {
  const { user } = useAuth();
  const { data: projects, reload: reloadProjects } = useResource<Project[]>('/projects', []);
  const { data: clients } = useResource<Client[]>('/clients', []);
  const { data: orders } = useResource<Order[]>('/orders', []);
  const { data: deliveries } = useResource<Delivery[]>('/deliveries', []);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitProject, setResubmitProject] = useState<Project | null>(null);
  const [resubmitName, setResubmitName] = useState('');
  const [resubmitError, setResubmitError] = useState('');

  const clientProjects = useMemo(() => {
    const scoped = projects.filter((p) => !user?.clientId || p.clientId === user.clientId);
    return scoped.filter((project) => {
      const matchesSearch =
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.clientName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [projects, user?.clientId, searchTerm, statusFilter]);

  const getProjectLocation = (project: Project) => {
    const client = clients.find((c) => c.id === project.clientId);
    const address = client?.address || '';
    const parts = address.split(',');
    return parts.length > 1 ? parts[parts.length - 1].trim() : address || '—';
  };

  const getProjectStats = (projectId: string) => {
    const projectOrders = orders.filter((o) => o.projectId === projectId);
    const projectDeliveries = deliveries.filter((d) =>
      projectOrders.some((o) => o.id === d.orderId)
    );
    const totalValue = projectOrders.reduce((sum, o) => sum + o.total, 0);
    return { orderCount: projectOrders.length, deliveryCount: projectDeliveries.length, totalValue };
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="text-muted-foreground" />
            Projects
          </h1>
          <p className="text-muted-foreground">Track project approvals, orders, and deliveries</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
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
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {clientProjects.map((project) => {
          const stats = getProjectStats(project.id);
          const statusMeta = {
            active: { label: 'Active', dot: 'bg-emerald-600', text: 'text-emerald-700' },
            'on-hold': { label: 'On Hold', dot: 'bg-orange-500', text: 'text-orange-600' },
            completed: { label: 'Completed', dot: 'bg-blue-600', text: 'text-blue-700' },
            pending: { label: 'Pending', dot: 'bg-amber-500', text: 'text-amber-700' },
            rejected: { label: 'Rejected', dot: 'bg-red-600', text: 'text-red-600' },
          }[project.status];
          return (
            <Card
              key={project.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedProject(project)}
            >
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="font-semibold">{project.name}</p>
                  <div className={`mt-1 inline-flex items-center gap-2 text-xs ${statusMeta?.text || ''}`}>
                    <span className={`h-2 w-2 rounded-full ${statusMeta?.dot || 'bg-muted'}`} />
                    {statusMeta?.label || project.status}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 size={16} />
                  <span>{project.clientName}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Assigned PM:{' '}
                  <span className="font-medium text-foreground">
                    {project.assignedPmName || 'Unassigned'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin size={16} />
                  <span>{getProjectLocation(project)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays size={16} />
                  <span>
                    {project.startDate ? format(new Date(project.startDate), 'MMM dd, yyyy') : '—'}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats.orderCount} orders • ₱{stats.totalValue.toLocaleString()}
                </div>
                {project.status === 'rejected' && (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openResubmit(project); }}>
                    Resubmit
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedProject?.name}</DialogTitle>
            <DialogDescription>{selectedProject?.clientName}</DialogDescription>
          </DialogHeader>
          {selectedProject && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge className="capitalize">{selectedProject.status}</Badge>
                <span className="text-sm text-muted-foreground">
                  Start: {selectedProject.startDate ? format(new Date(selectedProject.startDate), 'MMM dd, yyyy') : '—'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Assigned PM:{' '}
                <span className="font-medium text-foreground">
                  {selectedProject.assignedPmName || 'Unassigned'}
                </span>
              </p>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    { label: 'Requested', done: true },
                    { label: 'Approved', done: ['active', 'on-hold', 'completed'].includes(selectedProject.status) },
                    { label: 'In Progress', done: ['active', 'completed'].includes(selectedProject.status) },
                    { label: 'Completed', done: selectedProject.status === 'completed' },
                  ].map((step) => (
                    <div key={step.label} className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${step.done ? 'bg-emerald-600' : 'bg-muted'}`} />
                      <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Items</CardTitle>
                  <CardDescription>Items ordered for this project</CardDescription>
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
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedProject(null)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
