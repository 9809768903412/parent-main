const express = require('express');
const prisma = require('../utils/prisma');
const { parsePagination, buildPaginatedResponse, parseSort } = require('../utils/pagination');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isPositiveInt, isNonNegativeNumber, isValidDateString, isNonEmptyString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole(['ADMIN', 'STAFF', 'CLIENT']), async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const q = req.query.q ? String(req.query.q) : '';
    const status = req.query.status ? String(req.query.status).toUpperCase() : '';
    const role = String(req.user?.role || '').toUpperCase();
    let clientId = req.query.clientId ? Number(req.query.clientId) : null;
    if (role === 'CLIENT') {
      const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
      if (user?.email) {
        const client = await prisma.client.findFirst({ where: { email: user.email } });
        clientId = client?.clientId || null;
      }
    }
    const where = {
      AND: [
        { deletedAt: null },
        q
          ? {
              OR: [
                { client: { clientName: { contains: q, mode: 'insensitive' } } },
                { project: { projectName: { contains: q, mode: 'insensitive' } } },
                { customRequirements: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        status ? { status } : {},
        clientId ? { clientId } : {},
      ],
    };
    const sort = parseSort(req.query, ['createdAt', 'status']);
    const orderBy = sort ? { [sort.sortBy]: sort.sortDir } : { createdAt: 'desc' };
    const [requests, total] = await Promise.all([
      prisma.quoteRequest.findMany({
        include: { client: true, project: true, items: true },
        where,
        skip: pagination ? (pagination.page - 1) * pagination.pageSize : undefined,
        take: pagination ? pagination.pageSize : undefined,
        orderBy,
      }),
      prisma.quoteRequest.count({ where }),
    ]);

    const data = requests.map((r) => ({
      id: r.quoteRequestId.toString(),
      clientId: r.clientId?.toString() || null,
      clientName: r.client?.clientName || 'Client',
      projectName: r.project?.projectName || null,
      items: r.items.map((item) => ({
        name: item.itemName,
        quantity: item.quantity,
        notes: item.notes || null,
      })),
      customRequirements: r.customRequirements || null,
      status: r.status.toLowerCase(),
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      quotedAmount: r.quotedAmount ? Number(r.quotedAmount) : null,
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
    const { clientId, projectId, items, customRequirements } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }
    if (items.some((item) => !isNonEmptyString(item.name) || Number(item.quantity || 0) <= 0)) {
      return res.status(400).json({ error: 'Item name and quantity are required' });
    }
    if (clientId && !isPositiveInt(clientId)) {
      return res.status(400).json({ error: 'Invalid client' });
    }
    if (projectId && !isPositiveInt(projectId)) {
      return res.status(400).json({ error: 'Invalid project' });
    }

    const request = await prisma.quoteRequest.create({
      data: {
        clientId: clientId ? Number(clientId) : null,
        projectId: projectId ? Number(projectId) : null,
        customRequirements,
        items: {
          create: Array.isArray(items)
            ? items.map((item) => ({
                itemName: item.name,
                quantity: Number(item.quantity || 0),
                notes: item.notes,
              }))
            : [],
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CREATE',
        target: 'QuoteRequest',
        details: `Created quote request ${request.quoteRequestId}`,
      },
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole(['ADMIN', 'STAFF']), async (req, res, next) => {
  try {
    if (req.body.status) {
      const status = req.body.status.toUpperCase();
      if (!['PENDING', 'RESPONDED', 'APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
    }
    if (req.body.respondedAt && !isValidDateString(req.body.respondedAt)) {
      return res.status(400).json({ error: 'Invalid responded date' });
    }
    if (req.body.quotedAmount !== undefined && !isNonNegativeNumber(req.body.quotedAmount)) {
      return res.status(400).json({ error: 'Quoted amount must be 0 or greater' });
    }
    const request = await prisma.quoteRequest.update({
      where: { quoteRequestId: Number(req.params.id) },
      data: {
        status: req.body.status ? req.body.status.toUpperCase() : undefined,
        respondedAt: req.body.respondedAt ? new Date(req.body.respondedAt) : undefined,
        quotedAmount: req.body.quotedAmount,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'QuoteRequest',
        details: `Updated quote request ${request.quoteRequestId}`,
      },
    });
    res.json(request);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const quoteRequestId = Number(req.params.id);
    await prisma.quoteRequest.update({
      where: { quoteRequestId },
      data: { deletedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'DELETE',
        target: 'Quote Request',
        details: `Soft-deleted quote request ${quoteRequestId}`,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
