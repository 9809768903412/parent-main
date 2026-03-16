const express = require('express');
const prisma = require('../utils/prisma');
const { parsePagination, buildPaginatedResponse, parseSort } = require('../utils/pagination');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isPositiveInt, isValidDateString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

function mapRequest(r) {
  return {
    id: r.requestId.toString(),
    requestNumber: r.requestNumber,
    projectId: r.projectId?.toString() || null,
    projectName: r.project?.projectName || 'Unknown',
    requestedBy: r.requester?.fullName || 'User',
    requestedById: r.requestedBy?.toString() || null,
    approvedBy: r.approver?.fullName || null,
    approvedById: r.approvedBy?.toString() || null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    date: r.requestDate.toISOString(),
    items: r.items.map((item) => ({
      itemId: item.productId?.toString() || '',
      itemName: item.product?.itemName || '',
      unit: item.product?.unit || '',
      quantity: item.quantity,
      unitPrice: item.product ? Number(item.product.unitPrice) : 0,
      amount: item.product ? Number(item.product.unitPrice) * item.quantity : 0,
      notes: item.notes || null,
    })),
    purpose: r.purpose || '',
    urgency: (r.urgency || 'NORMAL').toLowerCase(),
    status: r.status.toLowerCase(),
    estimatedCost: Number(r.estCost || 0),
    remarks: r.remarks || null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const role = String(req.user?.role || '').toUpperCase();
    if (role === 'CLIENT') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pagination = parsePagination(req.query);
    const q = req.query.q ? String(req.query.q) : '';
    const status = req.query.status ? String(req.query.status).toUpperCase() : '';
    const includeDeleted = req.query.includeDeleted === 'true';
    const onlyDeleted = req.query.onlyDeleted === 'true';
    const where = {
      AND: [
        onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null },
        q
          ? {
              OR: [
                { requestNumber: { contains: q, mode: 'insensitive' } },
                { project: { projectName: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {},
        status ? { status } : {},
      ],
    };
    const sort = parseSort(req.query, ['createdAt', 'status', 'urgency']);
    const orderBy = sort ? { [sort.sortBy]: sort.sortDir } : { createdAt: 'desc' };
    const [requests, total] = await Promise.all([
      prisma.materialRequest.findMany({
        include: {
          project: true,
          requester: true,
          approver: true,
          items: { include: { product: true } },
        },
        where,
        skip: pagination ? (pagination.page - 1) * pagination.pageSize : undefined,
        take: pagination ? pagination.pageSize : undefined,
        orderBy,
      }),
      prisma.materialRequest.count({ where }),
    ]);

    const data = requests.map(mapRequest);

    if (pagination) {
      return res.json(buildPaginatedResponse(data, total, pagination.page, pagination.pageSize));
    }
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(['ADMIN', 'STAFF']), async (req, res, next) => {
  try {
    const { projectId, items, purpose, urgency } = req.body;
    const requestNumber = req.body.requestNumber || `REQ-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!projectId || !isPositiveInt(projectId)) return res.status(400).json({ error: 'Project is required' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }
    if (urgency && !['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(String(urgency).toUpperCase())) {
      return res.status(400).json({ error: 'Invalid urgency level' });
    }

    let estCost = 0;
    let itemCreates = [];
    try {
      itemCreates = Array.isArray(items)
        ? await Promise.all(
            items.map(async (item) => {
              if (Number(item.quantity || 0) <= 0) {
                throw new Error('Quantity must be greater than 0');
              }
              const product = await prisma.product.findUnique({
                where: { productId: Number(item.itemId || item.productId) },
              });
              if (!product) {
                throw new Error('Invalid product');
              }
              estCost += Number(product.unitPrice) * Number(item.quantity || 0);
              return {
                productId: item.itemId ? Number(item.itemId) : Number(item.productId),
                quantity: Number(item.quantity || 0),
                notes: item.notes || null,
              };
            })
          )
        : [];
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid items' });
    }

    const request = await prisma.materialRequest.create({
      data: {
        requestNumber,
        projectId: projectId ? Number(projectId) : null,
        requestedBy: req.user.userId,
        urgency: urgency ? urgency.toUpperCase() : 'NORMAL',
        estCost,
        purpose: purpose || null,
        items: { create: itemCreates },
      },
      include: { items: { include: { product: true } }, project: true, requester: true, approver: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CREATE',
        target: 'MaterialRequest',
        details: `Created request ${request.requestNumber}`,
      },
    });

    res.status(201).json(mapRequest(request));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const status = req.body.status ? req.body.status.toUpperCase() : undefined;
    if (status && !['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (req.body.requestDate && !isValidDateString(req.body.requestDate)) {
      return res.status(400).json({ error: 'Invalid request date' });
    }
    const remarks = req.body.remarks || null;
    const approvedAt = status === 'APPROVED' ? new Date() : undefined;
    const approvedBy = status === 'APPROVED' ? req.user.userId : undefined;

    const request = await prisma.materialRequest.update({
      where: { requestId: Number(req.params.id) },
      data: {
        status,
        remarks,
        approvedAt,
        approvedBy,
      },
      include: {
        items: { include: { product: true } },
        project: true,
        requester: true,
        approver: true,
      },
    });

    if (status === 'APPROVED') {
      for (const item of request.items) {
        const product = await prisma.product.findUnique({
          where: { productId: item.productId },
        });
        if (!product) continue;
        const newBalance = product.qtyOnHand - item.quantity;
        if (newBalance < 0) {
          return res.status(400).json({ error: `Insufficient stock for ${product.itemName}` });
        }
        const updatedStatus = newBalance <= 0 ? 'OUT_OF_STOCK' : newBalance <= product.lowStockThreshold ? 'LOW_STOCK' : 'AVAILABLE';
        await prisma.product.update({
          where: { productId: product.productId },
          data: { qtyOnHand: newBalance, status: updatedStatus },
        });
        await prisma.stockTransaction.create({
          data: {
            productId: product.productId,
            type: 'ISSUE',
            qtyChange: -item.quantity,
            newBalance,
            userId: req.user.userId,
            notes: `Material request ${request.requestNumber}`,
          },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'MaterialRequest',
        details: `Updated request ${request.requestNumber} to ${status || 'UNCHANGED'}`,
      },
    });

    res.json(mapRequest(request));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    await prisma.materialRequest.update({
      where: { requestId },
      data: { deletedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'DELETE',
        target: 'Material Request',
        details: `Soft-deleted request ${requestId}`,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/restore', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const request = await prisma.materialRequest.update({
      where: { requestId },
      data: { deletedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'RESTORE',
        target: 'MaterialRequest',
        details: `Restored request ${requestId}`,
      },
    });
    res.json(mapRequest(request));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
