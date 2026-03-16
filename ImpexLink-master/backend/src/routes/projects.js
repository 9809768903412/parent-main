const express = require('express');
const prisma = require('../utils/prisma');
const { parsePagination, buildPaginatedResponse, parseSort } = require('../utils/pagination');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isNonEmptyString, isValidDateString, isPositiveInt } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

const normalizeStatus = (value) =>
  value ? String(value).trim().toUpperCase().replace(/[-\s]+/g, '_') : undefined;

router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const q = req.query.q ? String(req.query.q) : '';
    const status = req.query.status ? String(req.query.status).toUpperCase() : '';
    const includeDeleted = req.query.includeDeleted === 'true';
    const onlyDeleted = req.query.onlyDeleted === 'true';
    const roleList = Array.isArray(req.user?.roles)
      ? req.user.roles.map((r) => String(r).toUpperCase())
      : [String(req.user?.role || '').toUpperCase()];
    const hasRole = (role) => roleList.includes(String(role).toUpperCase());
    let clientId = req.query.clientId ? Number(req.query.clientId) : null;
    let assignedPmId = req.query.assignedPmId ? Number(req.query.assignedPmId) : null;
    if (hasRole('CLIENT')) {
      const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
      if (user?.email) {
        const client = await prisma.client.findFirst({ where: { email: user.email } });
        clientId = client?.clientId || null;
        if (!clientId) {
          const empty = [];
          if (pagination) {
            return res.json(buildPaginatedResponse(empty, 0, pagination.page, pagination.pageSize));
          }
          return res.json(empty);
        }
      }
    }
    if (hasRole('PROJECT_MANAGER') && !hasRole('ADMIN') && !hasRole('PRESIDENT') && !hasRole('ENGINEER')) {
      assignedPmId = req.user.userId;
    }
    const where = {
      AND: [
        onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null },
        q
          ? {
              OR: [
                { projectName: { contains: q, mode: 'insensitive' } },
                { client: { clientName: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {},
        status ? { status } : {},
        clientId ? { clientId } : {},
        assignedPmId ? { assignedPmId } : {},
      ],
    };
    const sort = parseSort(req.query, ['projectName', 'status', 'startDate']);
    const orderBy = sort ? { [sort.sortBy]: sort.sortDir } : { projectName: 'asc' };
    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        include: { client: true, assignedPm: true },
        where,
        skip: pagination ? (pagination.page - 1) * pagination.pageSize : undefined,
        take: pagination ? pagination.pageSize : undefined,
        orderBy,
      }),
      prisma.project.count({ where }),
    ]);
    const data = projects.map((p) => ({
      id: p.projectId.toString(),
      name: p.projectName,
      clientId: p.clientId ? p.clientId.toString() : null,
      clientName: p.client?.clientName || 'Unassigned',
      assignedPmId: p.assignedPmId ? p.assignedPmId.toString() : null,
      assignedPmName: p.assignedPm?.fullName || null,
      status: p.status.toLowerCase(),
      startDate: p.startDate ? p.startDate.toISOString().split('T')[0] : null,
      endDate: null,
      rejectionReason: p.rejectionReason || null,
    }));
    if (pagination) {
      return res.json(buildPaginatedResponse(data, total, pagination.page, pagination.pageSize));
    }
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(['ADMIN', 'STAFF', 'CLIENT']), async (req, res, next) => {
  try {
    const projectName = req.body.name || req.body.projectName;
    if (!isNonEmptyString(projectName)) return res.status(400).json({ error: 'Project name is required' });
    if (req.body.startDate && !isValidDateString(req.body.startDate)) {
      return res.status(400).json({ error: 'Invalid start date' });
    }
    if (req.body.clientId && !isPositiveInt(req.body.clientId)) {
      return res.status(400).json({ error: 'Invalid client id' });
    }
    const rawAssignedPmId = req.body.assignedPmId === 'unassigned' ? null : req.body.assignedPmId;
    if (rawAssignedPmId !== undefined && rawAssignedPmId !== null && rawAssignedPmId !== '') {
      if (!isPositiveInt(rawAssignedPmId)) {
        return res.status(400).json({ error: 'Invalid assigned PM id' });
      }
    }
    if (req.body.status) {
      const status = normalizeStatus(req.body.status);
      if (!['PENDING', 'REJECTED', 'ACTIVE', 'ON_HOLD', 'COMPLETED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
    }
    const roleList = Array.isArray(req.user?.roles)
      ? req.user.roles.map((r) => String(r).toUpperCase())
      : [String(req.user?.role || '').toUpperCase()];
    const hasRole = (role) => roleList.includes(String(role).toUpperCase());
    const role = String(req.user?.role || '').toUpperCase();
    let clientId = req.body.clientId ? Number(req.body.clientId) : null;
    let status = normalizeStatus(req.body.status || 'ACTIVE');
    let startDate = req.body.startDate ? new Date(req.body.startDate) : new Date();
    let assignedPmId = req.body.assignedPmId ? Number(req.body.assignedPmId) : null;
    if (hasRole('CLIENT')) {
      const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
      if (!user?.email) return res.status(403).json({ error: 'Forbidden' });
      let client = await prisma.client.findFirst({ where: { email: user.email } });
      if (!client) {
        const inferredName = (req.body.companyName || req.body.clientName || user.fullName || user.email).toString();
        client = await prisma.client.create({
          data: {
            clientName: inferredName,
            email: user.email,
            contactPerson: user.fullName || inferredName,
          },
        });
      }
      clientId = client.clientId;
      status = 'PENDING';
      startDate = null;
      assignedPmId = null;
    }

    const project = await prisma.project.create({
      data: {
        projectName,
        clientId,
        status,
        startDate,
        assignedPmId,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CREATE',
        target: 'Project',
        details: `Created project ${project.projectName}`,
      },
    });

    if (role === 'CLIENT') {
      const admins = await prisma.user.findMany({
        where: { role: { roleName: 'ADMIN' }, deletedAt: null },
      });
      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.userId,
            type: 'ORDER_APPROVAL',
            title: 'New project request',
            message: `Project request "${project.projectName}" submitted.`,
            link: '/admin/projects',
          })),
        });
      }
    }

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole(['ADMIN', 'PROJECT_MANAGER']), async (req, res, next) => {
  try {
    if (req.body.projectName !== undefined && !isNonEmptyString(req.body.projectName)) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    if (req.body.startDate && !isValidDateString(req.body.startDate)) {
      return res.status(400).json({ error: 'Invalid start date' });
    }
    if (req.body.status) {
      const status = normalizeStatus(req.body.status);
      if (!['PENDING', 'REJECTED', 'ACTIVE', 'ON_HOLD', 'COMPLETED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
    }
    const existing = await prisma.project.findUnique({
      where: { projectId: Number(req.params.id) },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const roleList = Array.isArray(req.user?.roles)
      ? req.user.roles.map((r) => String(r).toUpperCase())
      : [String(req.user?.role || '').toUpperCase()];
    const hasRole = (role) => roleList.includes(String(role).toUpperCase());
    if (hasRole('PROJECT_MANAGER') && !hasRole('ADMIN')) {
      if (!existing.assignedPmId || existing.assignedPmId !== req.user.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.body.assignedPmId) {
        return res.status(403).json({ error: 'Assigned PM can only be changed by admin' });
      }
    }
    if (normalizeStatus(req.body.status) === 'REJECTED' && !isNonEmptyString(req.body.rejectionReason || '')) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }
    const assignedPmId =
      rawAssignedPmId === null || rawAssignedPmId === ''
        ? null
        : rawAssignedPmId !== undefined
          ? Number(rawAssignedPmId)
          : undefined;
    const project = await prisma.project.update({
      where: { projectId: Number(req.params.id) },
      data: {
        projectName: req.body.projectName,
        status: normalizeStatus(req.body.status),
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        rejectionReason: req.body.rejectionReason || undefined,
        assignedPmId,
      },
    });

    if (assignedPmId) {
      const pmRole = await prisma.role.findUnique({ where: { roleName: 'PROJECT_MANAGER' } });
      if (pmRole) {
        await prisma.userRole.upsert({
          where: {
            userId_roleId: { userId: assignedPmId, roleId: pmRole.roleId },
          },
          update: {},
          create: { userId: assignedPmId, roleId: pmRole.roleId },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'Project',
        details: `Updated project ${project.projectName}`,
      },
    });

    if (project.clientId) {
      const client = await prisma.client.findUnique({ where: { clientId: project.clientId } });
      if (client?.email) {
        const clientUser = await prisma.user.findUnique({ where: { email: client.email } });
        if (clientUser) {
          const statusText = project.status.toLowerCase().replace(/_/g, ' ');
          const message =
            project.status === 'REJECTED'
              ? `Project "${project.projectName}" was rejected. Reason: ${project.rejectionReason || 'Not provided'}.`
              : `Project "${project.projectName}" updated to ${statusText}.`;
          await prisma.notification.create({
            data: {
              userId: clientUser.userId,
              type: 'PROJECT_UPDATE',
              title: 'Project update',
              message,
              link: '/client',
            },
          });
          await prisma.auditLog.create({
            data: {
              userId: req.user.userId,
              action: 'NOTIFY',
              target: 'Notification',
              details: `Sent project update for ${project.projectName} to client`,
            },
          });
        }
      }
    }

    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resubmit', requireRole(['CLIENT']), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
    if (!user?.email) return res.status(403).json({ error: 'Forbidden' });
    const client = await prisma.client.findFirst({ where: { email: user.email } });
    if (!client) return res.status(400).json({ error: 'No client record found for this user.' });
    const existing = await prisma.project.findUnique({ where: { projectId } });
    if (!existing || existing.clientId !== client.clientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (existing.status !== 'REJECTED') {
      return res.status(400).json({ error: 'Only rejected projects can be resubmitted.' });
    }
    const name = req.body.name || req.body.projectName;
    if (name && !isNonEmptyString(name)) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const project = await prisma.project.update({
      where: { projectId },
      data: {
        status: 'PENDING',
        projectName: name || existing.projectName,
        rejectionReason: null,
        startDate: null,
      },
    });

    const admins = await prisma.user.findMany({
      where: { role: { roleName: 'ADMIN' }, deletedAt: null },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.userId,
          type: 'PROJECT_UPDATE',
          title: 'Project resubmission',
          message: `Project "${project.projectName}" was resubmitted for approval.`,
          link: '/admin/projects',
        })),
      });
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'NOTIFY',
          target: 'Notification',
          details: `Sent project resubmission for ${project.projectName} to ${admins.length} admins`,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'Project',
        details: `Resubmitted project ${project.projectName}`,
      },
    });

    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    await prisma.project.update({
      where: { projectId },
      data: { deletedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'DELETE',
        target: 'Project',
        details: `Soft-deleted project ${projectId}`,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/restore', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const project = await prisma.project.update({
      where: { projectId },
      data: { deletedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'RESTORE',
        target: 'Project',
        details: `Restored project ${projectId}`,
      },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
